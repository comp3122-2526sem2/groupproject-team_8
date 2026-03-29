import type { ChatCompactionSummary, ClassChatMessage } from "@/lib/chat/types";
import { parseChatCompactionSummary } from "@/lib/chat/validation";
import { estimateTokenCount } from "@/lib/materials/chunking";

function parseFiniteNumberEnv(envValue: string | undefined, fallback: number) {
  if (typeof envValue === "string" && envValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(envValue ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const CHAT_CONTEXT_RECENT_TURNS = parseFiniteNumberEnv(process.env.CHAT_CONTEXT_RECENT_TURNS, 12);
export const CHAT_COMPACTION_TRIGGER_TURNS = parseFiniteNumberEnv(process.env.CHAT_COMPACTION_TRIGGER_TURNS, 30);
export const CHAT_COMPACTION_MIN_NEW_TURNS = parseFiniteNumberEnv(process.env.CHAT_COMPACTION_MIN_NEW_TURNS, 6);
export const CHAT_CONTEXT_WINDOW_TOKENS = parseFiniteNumberEnv(process.env.CHAT_CONTEXT_WINDOW_TOKENS, 12000);
export const CHAT_OUTPUT_TOKEN_RESERVE = parseFiniteNumberEnv(process.env.CHAT_OUTPUT_TOKEN_RESERVE, 1400);

const CHAT_COMPACTION_CONTEXT_PRESSURE = parseFiniteNumberEnv(process.env.CHAT_COMPACTION_CONTEXT_PRESSURE, 0.8);
const MAX_KEY_TERMS = 12;
const MAX_LIST_ITEMS = 8;
const MAX_HIGHLIGHTS = 8;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

type CompactionAnchor = {
  createdAt: string;
  messageId: string;
  turnCount: number;
};

type ScoredTurn = {
  message: ClassChatMessage;
  score: number;
};

/**
 * Decision record returned by `buildCompactionDecision`.
 *
 * `shouldCompact` drives whether the caller triggers a compaction cycle.
 * `reason` identifies which of the dual-trigger paths (token pressure vs.
 * message count) fired, or why compaction was skipped.
 * `pressureRatio` is the fraction of the usable token budget already consumed
 * by the current conversation — useful for diagnostic logging.
 */
export type CompactionDecision = {
  shouldCompact: boolean;
  reason:
    | "below_trigger"
    | "no_new_turns"
    | "low_context_pressure"
    | "message_count_trigger"
    | "token_pressure";
  estimatedPromptTokens: number;
  pressureRatio: number;
  unsummarizedTurnCount: number;
};

/**
 * The compacted summary produced by one compaction cycle.
 *
 * `summary` is the structured `ChatCompactionSummary` that will be persisted
 * to the database; `summaryText` is its pre-rendered plaintext form that gets
 * injected into the next chat prompt as "Compacted conversation memory".
 */
export type CompactionResult = {
  summary: ChatCompactionSummary;
  summaryText: string;
};

/**
 * Parses and validates a raw unknown value as a `ChatCompactionSummary`.
 *
 * Thin wrapper around the validation layer so callers don't need to import
 * from two different modules.
 *
 * @param raw    The raw value (typically from a Supabase JSON column).
 * @returns      A validated `ChatCompactionSummary` or `null` if validation fails.
 */
export function parseCompactionSummary(raw: unknown): ChatCompactionSummary | null {
  return parseChatCompactionSummary(raw);
}

/**
 * Stable chronological comparator for chat messages.
 *
 * Sorts by ISO-8601 `createdAt` string first (lexicographic order preserves
 * chronology for ISO dates).  If two messages share the same timestamp — which
 * can happen because we offset the assistant message by only 1 ms — we fall
 * back to comparing `id` strings to guarantee a deterministic order.
 *
 * @param a  First message to compare.
 * @param b  Second message to compare.
 * @returns  Negative, zero, or positive per Array.sort convention.
 */
export function compareMessageChronology(a: Pick<ClassChatMessage, "createdAt" | "id">, b: Pick<ClassChatMessage, "createdAt" | "id">) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  return a.id.localeCompare(b.id);
}

/**
 * Returns a new array of messages sorted oldest-first.
 *
 * Does not mutate the input array.
 *
 * @param messages  Unsorted array of chat messages.
 * @returns         A sorted shallow copy.
 */
export function sortMessagesChronologically(messages: ClassChatMessage[]) {
  return [...messages].sort(compareMessageChronology);
}

/**
 * Decides whether the current conversation should be compacted before the
 * next AI call is made.
 *
 * Two independent triggers can fire:
 *
 * - **Token pressure**: When the estimated prompt tokens exceed
 *   `CHAT_COMPACTION_CONTEXT_PRESSURE` (default 80 %) of the usable token
 *   budget, compaction fires immediately to reclaim context space.  This is
 *   the primary trigger — it prevents the model from silently truncating input.
 *
 * - **Message count**: When the conversation is at least `2 × triggerTurns`
 *   messages long and token pressure hasn't fired yet, compaction runs anyway.
 *   This catches slow conversations whose token count stays low but whose turn
 *   count would still degrade summary quality over time if left indefinitely.
 *
 * Guards that prevent premature compaction:
 * - `below_trigger`: total message count hasn't reached `triggerTurns` yet.
 * - `no_new_turns`: all compactable turns were already captured by a previous
 *   compaction cycle (the `compactedThrough` anchor covers them all).
 * - `low_context_pressure`: token budget is fine and message count hasn't
 *   hit the secondary threshold.
 *
 * @param input.messages              Full chronological message history.
 * @param input.existingSummary       The last stored compaction summary, or null.
 * @param input.pendingUserMessage    The user message about to be sent (included
 *                                    in the token estimate so pressure is accurate).
 * @param input.recentTurns           How many tail messages to keep outside the
 *                                    compaction window (defaults to `CHAT_CONTEXT_RECENT_TURNS`).
 * @param input.triggerTurns          Minimum message count before compaction is
 *                                    considered (defaults to `CHAT_COMPACTION_TRIGGER_TURNS`).
 * @param input.minNewTurns           Minimum new (unsummarized) turns required to
 *                                    actually compact (defaults to `CHAT_COMPACTION_MIN_NEW_TURNS`).
 * @returns  A `CompactionDecision` with the verdict and diagnostic metadata.
 */
export function buildCompactionDecision(input: {
  messages: ClassChatMessage[];
  existingSummary: ChatCompactionSummary | null;
  pendingUserMessage: string;
  recentTurns?: number;
  triggerTurns?: number;
  minNewTurns?: number;
}): CompactionDecision {
  const recentTurns = Math.max(2, input.recentTurns ?? CHAT_CONTEXT_RECENT_TURNS);
  const triggerTurns = Math.max(recentTurns + 2, input.triggerTurns ?? CHAT_COMPACTION_TRIGGER_TURNS);
  const minNewTurns = Math.max(1, input.minNewTurns ?? CHAT_COMPACTION_MIN_NEW_TURNS);
  const messages = sortMessagesChronologically(input.messages);
  const candidates = collectCompactionCandidates(messages, recentTurns, input.existingSummary);

  // Estimate tokens for the full prompt including the pending user message so
  // the pressure reading accounts for what the model will actually receive.
  const estimatedPromptTokens = estimateTokenCount([
    input.pendingUserMessage,
    ...messages.map((message) => message.content),
  ].join("\n"));
  const usableBudget = Math.max(1, CHAT_CONTEXT_WINDOW_TOKENS - CHAT_OUTPUT_TOKEN_RESERVE);
  const pressureRatio = estimatedPromptTokens / usableBudget;

  // --- Guard: too few total messages ---

  if (messages.length < triggerTurns) {
    return {
      shouldCompact: false,
      reason: "below_trigger",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  // --- Guard: not enough new (unsummarized) turns to warrant compaction ---

  if (candidates.length < minNewTurns) {
    return {
      shouldCompact: false,
      reason: "no_new_turns",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  // --- Primary trigger: token pressure ---

  if (pressureRatio >= CHAT_COMPACTION_CONTEXT_PRESSURE) {
    return {
      shouldCompact: true,
      reason: "token_pressure",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  // --- Secondary trigger: message-count overflow ---
  // Fire when the conversation has grown to at least 2× the primary trigger
  // threshold even if the token budget is not under pressure yet.

  if (messages.length >= triggerTurns * 2) {
    return {
      shouldCompact: true,
      reason: "message_count_trigger",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  return {
    shouldCompact: false,
    reason: "low_context_pressure",
    estimatedPromptTokens,
    pressureRatio,
    unsummarizedTurnCount: candidates.length,
  };
}

/**
 * Builds a new compaction summary from the current message history.
 *
 * The function scores each candidate turn, selects the most important ones,
 * then incrementally merges them with the previous summary (if any) to
 * produce an updated `ChatCompactionSummary`.
 *
 * Returns `null` when there are no new turns to compact (callers should skip
 * persisting in this case).
 *
 * @param input.messages            Full message history (will be sorted internally).
 * @param input.existingSummary     Previous compaction summary to merge into, or null.
 * @param input.latestUserMessage   The student's most recent question — used to
 *                                  boost relevance scores for terms that overlap
 *                                  with the current query.
 * @param input.recentTurns         Number of tail messages excluded from compaction.
 * @returns  A `CompactionResult` containing the merged summary and its text, or null.
 */
export function buildCompactionResult(input: {
  messages: ClassChatMessage[];
  existingSummary: ChatCompactionSummary | null;
  latestUserMessage: string;
  recentTurns?: number;
}): CompactionResult | null {
  const messages = sortMessagesChronologically(input.messages);
  const recentTurns = Math.max(2, input.recentTurns ?? CHAT_CONTEXT_RECENT_TURNS);
  const candidates = collectCompactionCandidates(messages, recentTurns, input.existingSummary);
  if (candidates.length === 0) {
    return null;
  }

  const latestQueryTerms = extractTerms(input.latestUserMessage);
  const scored = candidates.map((message, index) => ({
    message,
    score: scoreTurn({
      message,
      index,
      total: candidates.length,
      latestQueryTerms,
    }),
  }));

  const selected = selectChronologicalHighlights(scored);
  const compactedThrough = selected[selected.length - 1];
  if (!compactedThrough) {
    return null;
  }
  const compactedThroughIndex = candidates.findIndex(
    (candidate) => candidate.id === compactedThrough.id && candidate.createdAt === compactedThrough.createdAt,
  );
  const compactedTurnDelta = compactedThroughIndex >= 0 ? compactedThroughIndex + 1 : candidates.length;

  const merged = mergeSummary({
    existingSummary: input.existingSummary,
    selected,
    compactedThrough,
    compactedTurnDelta,
    latestQueryTerms,
  });

  return {
    summary: merged,
    summaryText: buildCompactionMemoryText(merged),
  };
}

/**
 * Renders a `ChatCompactionSummary` into the plaintext block injected into
 * the AI prompt as "Compacted conversation memory".
 *
 * The trailing instruction ("If this memory conflicts with recent transcript
 * turns, prefer the recent transcript.") ensures the model prioritises
 * verbatim transcript content over the lossy compacted representation.
 *
 * @param summary  The structured summary to render, or null/undefined.
 * @returns        A multi-line string suitable for direct prompt injection,
 *                 or an empty string if no summary is available.
 */
export function buildCompactionMemoryText(summary: ChatCompactionSummary | null | undefined) {
  if (!summary) {
    return "";
  }

  const lines: string[] = [];
  lines.push("Compacted conversation memory (older turns):");
  if (summary.timeline.highlights.length > 0) {
    lines.push(`Timeline highlights: ${summary.timeline.highlights.join(" | ")}`);
  }
  if (summary.keyTerms.length > 0) {
    lines.push(`Key terms: ${summary.keyTerms.map((term) => term.term).join(", ")}`);
  }
  if (summary.resolvedFacts.length > 0) {
    lines.push(`Resolved points: ${summary.resolvedFacts.join(" | ")}`);
  }
  if (summary.openQuestions.length > 0) {
    lines.push(`Open questions: ${summary.openQuestions.join(" | ")}`);
  }
  if (summary.studentNeeds.length > 0) {
    lines.push(`Student needs: ${summary.studentNeeds.join(" | ")}`);
  }
  lines.push("If this memory conflicts with recent transcript turns, prefer the recent transcript.");
  return lines.join("\n");
}

/**
 * Returns the subset of messages that are candidates for compaction.
 *
 * "Candidates" are messages that:
 * 1. Fall outside the protected recent-turns window (the tail `recentTurns`
 *    messages are always kept verbatim in the prompt), AND
 * 2. Were created *after* the `compactedThrough` anchor from the previous
 *    compaction cycle (already-summarized messages are excluded to avoid
 *    re-processing them).
 *
 * If no prior summary exists (first compaction), all messages outside the
 * recent window are candidates.
 */
function collectCompactionCandidates(
  chronologicalMessages: ClassChatMessage[],
  recentTurns: number,
  existingSummary: ChatCompactionSummary | null,
) {
  if (chronologicalMessages.length <= recentTurns) {
    return [];
  }

  const compactableWindow = chronologicalMessages.slice(0, chronologicalMessages.length - recentTurns);
  const anchor = existingSummary?.compactedThrough ?? null;
  if (!anchor) {
    return compactableWindow;
  }

  return compactableWindow.filter((message) => isAfterAnchor(message, anchor));
}

/**
 * Returns true when `message` was created strictly after the compaction anchor.
 *
 * Uses the same createdAt+id tie-break as `compareMessageChronology` so the
 * exclusion boundary is consistent with the sort order.
 */
function isAfterAnchor(message: ClassChatMessage, anchor: CompactionAnchor) {
  if (message.createdAt !== anchor.createdAt) {
    return message.createdAt > anchor.createdAt;
  }
  return message.id > anchor.messageId;
}

/**
 * Scores a single candidate turn for inclusion in the compaction highlights.
 *
 * Score weights and their rationale:
 *
 * - **+0.8 per overlapping term** (`overlapCount * 0.8`): Turns that share
 *   vocabulary with the student's current query are more likely to be
 *   contextually relevant to the ongoing topic thread.
 *
 * - **+1.5 for student questions** (`asksQuestion && not assistant`): Questions
 *   signal explicit knowledge gaps and anchor the conversational arc; they are
 *   highly worth preserving in the memory.
 *
 * - **+1.3 for confusion signals** (`hasConfusionSignal && not assistant`):
 *   Phrases like "stuck" or "confused" mark moments the student needed extra
 *   help — important diagnostic context for the model going forward.
 *
 * - **+1.1 for cited assistant replies** (`assistant && citations.length > 0`):
 *   Cited responses are grounded answers that resolved questions; retaining
 *   them prevents the model from re-deriving the same answer.
 *
 * - **+0.7 for resolution signals** (`hasResolutionSignal && assistant`):
 *   Phrases like "therefore" or "the answer is" mark conclusive explanations.
 *   Lower weight than confusion because resolutions are often already captured
 *   in `resolvedFacts`.
 *
 * - **Capped at 18 selected turns** in `selectChronologicalHighlights` to
 *   keep the compacted memory block from growing unbounded.
 *
 * All scores start at `1 + recencyFactor` where `recencyFactor` is a
 * normalised position index [0, 1], so more recent candidates get a slight
 * head-start even with no other signals.
 */
function scoreTurn(input: {
  message: ClassChatMessage;
  index: number;
  total: number;
  latestQueryTerms: string[];
}) {
  const { message, index, total, latestQueryTerms } = input;
  const content = message.content.toLowerCase();
  const messageTerms = extractTerms(message.content);
  const overlapCount = messageTerms.filter((term) => latestQueryTerms.includes(term)).length;
  // Recency factor: later messages score slightly higher than earlier ones
  // within the candidate window, all else being equal.
  const recencyFactor = (index + 1) / Math.max(1, total);
  const asksQuestion = /[?]/.test(message.content);
  const hasConfusionSignal = /(stuck|confused|not sure|don't understand|help)/i.test(content);
  const hasResolutionSignal = /(therefore|so the answer|this means|remember)/i.test(content);

  let score = 1 + recencyFactor;
  // +0.8 per term shared with the current query (topic relevance boost).
  score += overlapCount * 0.8;
  // +1.5 for student questions — explicit knowledge gaps are high-value anchors.
  if (asksQuestion && message.authorKind !== "assistant") {
    score += 1.5;
  }
  // +1.3 for confusion signals in student turns — important diagnostic context.
  if (hasConfusionSignal && message.authorKind !== "assistant") {
    score += 1.3;
  }
  // +1.1 for cited assistant replies — grounded answers are worth retaining.
  if (message.authorKind === "assistant" && message.citations.length > 0) {
    score += 1.1;
  }
  // +0.7 for resolution language in assistant replies — lower weight because
  // resolutions are often already captured as resolvedFacts.
  if (hasResolutionSignal && message.authorKind === "assistant") {
    score += 0.7;
  }
  return score;
}

/**
 * Selects the top-scoring turns and re-sorts them into chronological order.
 *
 * Two sorts are intentional:
 * 1. **Score-descending sort** (first): selects the `selectedCount`
 *    highest-value turns from the full candidate set.
 * 2. **Chronological re-sort** (second): restores temporal order so that the
 *    memory text and `timeline.highlights` read as a coherent narrative.
 *    Presenting highlights out of order would confuse the model about when
 *    events occurred relative to each other.
 *
 * The cap of 18 is chosen to stay within a comfortable token budget for the
 * memory block while still capturing the most important conversational moments.
 */
function selectChronologicalHighlights(scoredTurns: ScoredTurn[]) {
  const selectedCount = Math.min(18, scoredTurns.length);
  const top = [...scoredTurns]
    .sort((left, right) => right.score - left.score)
    .slice(0, selectedCount)
    .sort((left, right) => compareMessageChronology(left.message, right.message));

  return top.map((entry) => entry.message);
}

/**
 * Incrementally merges newly selected turns into the existing summary.
 *
 * This is an additive term-frequency accumulation:
 *
 * - **keyTerms**: Terms from prior compaction cycles are seeded into
 *   `mergedTermMap` with their existing weights and occurrence counts.  Each
 *   newly selected message then contributes +1 to weight and occurrences for
 *   every non-stop-word token it contains.  Short tokens (< 4 chars) are
 *   skipped unless they appear in `latestQueryTerms`, which keeps the term
 *   list domain-relevant.  The result is sorted by descending weight and
 *   capped at `MAX_KEY_TERMS` (12) to prevent unbounded growth.
 *
 * - **resolvedFacts**: First sentences from assistant messages — representing
 *   confirmed answers — are appended to the prior list and deduped.
 *
 * - **openQuestions**: First sentences from student questions are appended and
 *   deduped similarly.
 *
 * - **studentNeeds**: First sentences from student confusion signals are
 *   captured to help the model surface persistent difficulties.
 *
 * - **timeline.highlights**: Compact one-liners from every selected message
 *   are accumulated; the list is capped at `MAX_HIGHLIGHTS` (8) — oldest
 *   entries drop off first.
 *
 * - **compactedThrough**: Updated to the chronologically latest selected
 *   message so the next compaction cycle knows where to resume.
 *
 * @returns  A complete `ChatCompactionSummary` ready for persistence.
 */
function mergeSummary(input: {
  existingSummary: ChatCompactionSummary | null;
  selected: ClassChatMessage[];
  compactedThrough: ClassChatMessage;
  compactedTurnDelta: number;
  latestQueryTerms: string[];
}): ChatCompactionSummary {
  const previous = input.existingSummary;
  const generatedAt = new Date().toISOString();
  // Seed the term map with all terms from prior compaction cycles.
  const mergedTermMap = new Map<string, { weight: number; occurrences: number; lastSeen: string }>();

  for (const term of previous?.keyTerms ?? []) {
    mergedTermMap.set(term.term, {
      weight: term.weight,
      occurrences: term.occurrences,
      lastSeen: term.lastSeen,
    });
  }

  // Accumulate terms from the newly selected turns.
  const latestQuerySet = new Set(input.latestQueryTerms);
  input.selected.forEach((message) => {
    for (const term of extractTerms(message.content)) {
      // Skip short tokens that are not part of the current query — they are
      // likely filler words that escaped the stop-word list.
      if (!latestQuerySet.has(term) && term.length < 4) {
        continue;
      }
      const existing = mergedTermMap.get(term);
      mergedTermMap.set(term, {
        weight: (existing?.weight ?? 0) + 1,
        occurrences: (existing?.occurrences ?? 0) + 1,
        lastSeen: message.createdAt,
      });
    }
  });

  const keyTerms = [...mergedTermMap.entries()]
    .map(([term, value]) => ({
      term,
      weight: Number(value.weight.toFixed(2)),
      occurrences: value.occurrences,
      lastSeen: value.lastSeen,
    }))
    .sort((left, right) => right.weight - left.weight || right.occurrences - left.occurrences)
    .slice(0, MAX_KEY_TERMS);

  const resolvedFacts = uniq([
    ...(previous?.resolvedFacts ?? []),
    ...input.selected
      .filter((message) => message.authorKind === "assistant")
      .map((message) => firstSentence(message.content))
      .filter(Boolean),
  ]).slice(-MAX_LIST_ITEMS);

  const openQuestions = uniq([
    ...(previous?.openQuestions ?? []),
    ...input.selected
      .filter((message) => message.authorKind !== "assistant")
      .filter((message) => /[?]/.test(message.content))
      .map((message) => firstSentence(message.content))
      .filter(Boolean),
  ]).slice(-MAX_LIST_ITEMS);

  const studentNeeds = uniq([
    ...(previous?.studentNeeds ?? []),
    ...input.selected
      .filter((message) => message.authorKind !== "assistant")
      .filter((message) => /(stuck|confused|not sure|don't understand|help)/i.test(message.content))
      .map((message) => firstSentence(message.content))
      .filter(Boolean),
  ]).slice(-MAX_LIST_ITEMS);

  const highlights = uniq([
    ...(previous?.timeline.highlights ?? []),
    ...input.selected.map((message) => compactLine(message.content)),
  ]).slice(-MAX_HIGHLIGHTS);

  // Accumulate cumulative turn count across all compaction cycles.
  const priorCount = previous?.compactedThrough.turnCount ?? 0;
  const summary: ChatCompactionSummary = {
    version: "v1",
    generatedAt,
    compactedThrough: {
      createdAt: input.compactedThrough.createdAt,
      messageId: input.compactedThrough.id,
      turnCount: priorCount + input.compactedTurnDelta,
    },
    keyTerms,
    resolvedFacts,
    openQuestions,
    studentNeeds,
    timeline: {
      from: previous?.timeline.from ?? input.selected[0]?.createdAt ?? input.compactedThrough.createdAt,
      to: input.compactedThrough.createdAt,
      highlights,
    },
  };

  return summary;
}

function firstSentence(text: string) {
  const sentence = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return compactLine(sentence);
}

function compactLine(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 160) {
    return clean;
  }
  return `${clean.slice(0, 157).trim()}...`;
}

function extractTerms(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !STOP_WORDS.has(item));
}

function uniq(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
