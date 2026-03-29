import "server-only";

/**
 * All AI generation in this platform is routed through the Python FastAPI
 * backend (`backend/`).  Next.js server actions call the functions in this
 * file, which handle:
 *   - Timeout enforcement via `AbortController`
 *   - API key forwarding
 *   - snake_case ↔ camelCase field mapping between TypeScript and Python
 *   - Unwrapping the standard `{ ok, data, error, meta }` response envelope
 *
 * Never call AI providers directly from Next.js — all AI calls must go through
 * the Python backend so provider routing, rate-limiting, and safety checks are
 * applied consistently.
 */

export type PythonBackendProvider = "openrouter" | "openai" | "gemini";

export type PythonBackendUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

/**
 * Options for a text generation request to the Python backend.
 *
 * `timeoutMs` is mandatory (not optional) to force callers to make an explicit
 * latency budget decision rather than inheriting an arbitrary default.
 */
export type PythonBackendGenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  sessionId?: string;
  transforms?: string[];
  providerOrder?: PythonBackendProvider[];
  defaultProvider?: PythonBackendProvider;
};

/** Result of a successful text generation call. */
export type PythonBackendGenerateResult = {
  provider: PythonBackendProvider;
  model: string;
  content: string;
  usage?: PythonBackendUsage;
  latencyMs: number;
};

/**
 * Options for an embeddings generation request to the Python backend.
 *
 * `accessToken` and `sandboxId` are forwarded to the backend for guest-mode
 * RLS enforcement — the backend uses them to scope the embedding operation to
 * the guest's sandbox.
 */
export type PythonBackendEmbeddingsOptions = {
  inputs: string[];
  timeoutMs: number;
  accessToken?: string | null;
  sandboxId?: string | null;
  providerOrder?: PythonBackendProvider[];
  defaultProvider?: PythonBackendProvider;
};

/** Result of a successful embeddings generation call. */
export type PythonBackendEmbeddingsResult = {
  provider: PythonBackendProvider;
  model: string;
  embeddings: number[][];
  usage?: PythonBackendUsage;
  latencyMs: number;
};

export type TeachingBriefStatus = "empty" | "ready" | "generating" | "no_data" | "error";

/** Structured teaching brief payload returned by the analytics endpoint. */
export type TeachingBriefPayload = {
  summary: string;
  strongestAction: string;
  attentionItems: string[];
  misconceptions: Array<{
    topicId: string | null;
    topicTitle: string;
    description: string;
  }>;
  studentsToWatch: Array<{
    studentId: string;
    displayName: string;
    reason: string;
  }>;
  nextStep: string;
  recommendedActivity: {
    type: string;
    reason: string;
  } | null;
  evidenceBasis: string;
};

export type TeachingBriefActionResult = {
  status: TeachingBriefStatus;
  generatedAt: string | null;
  isStale: boolean;
  isRefreshing: boolean;
  hasEvidence: boolean;
  payload: TeachingBriefPayload | null;
  error: string | null;
};

/**
 * An attention item from the Python backend can arrive as either:
 *   - A plain string (older backend schema / simple case)
 *   - An object with `{ topic?, title?, detail?, description? }` (structured case)
 *
 * `normalizeAttentionItem` handles both shapes and collapses them into a
 * single readable string for the UI.  The field aliases (topic/title,
 * detail/description) exist because the backend has used both naming
 * conventions across versions.
 */
type TeachingBriefAttentionItem =
  | string
  | {
      topic?: string;
      title?: string;
      detail?: string;
      description?: string;
    };

type TeachingBriefMisconception = {
  topic_id?: string | null;
  topic_title?: string;
  topic?: string;
  title?: string;
  description?: string;
};

type TeachingBriefStudentToWatch = {
  student_id?: string;
  display_name?: string;
  reason?: string;
};

type TeachingBriefRecommendedActivity = {
  type?: string;
  reason?: string;
};

function normalizeBriefText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalizes a `TeachingBriefAttentionItem` into a display string.
 *
 * The Python backend returns attention items in two shapes:
 *
 * - **String shape** (simple): the item is already a human-readable sentence.
 *   Return it as-is after trimming.
 *
 * - **Object shape** (structured): the item has a `topic`/`title` heading and
 *   a `detail`/`description` body.  Both field-name variants are supported
 *   because the backend has used both across versions.  When both are present
 *   the result is formatted as "Topic: detail"; when only one is available,
 *   that one is returned alone.
 *
 * @param item  The raw attention item from the backend response.
 * @returns     A normalised display string (may be empty if both fields are blank).
 */
function normalizeAttentionItem(item: TeachingBriefAttentionItem): string {
  if (typeof item === "string") {
    return normalizeBriefText(item);
  }

  // Prefer `topic` over `title` and `detail` over `description`, falling back
  // to the alias if the primary field is absent.
  const topic = normalizeBriefText(item.topic ?? item.title);
  const detail = normalizeBriefText(item.detail ?? item.description);

  if (topic && detail) return `${topic}: ${detail}`;
  return topic || detail;
}

function normalizeRecommendedActivity(
  activity: TeachingBriefRecommendedActivity | null | undefined,
): TeachingBriefPayload["recommendedActivity"] {
  const type = normalizeBriefText(activity?.type);
  if (!type) {
    return null;
  }

  return {
    type,
    reason: normalizeBriefText(activity?.reason),
  };
}

type EnvelopeError = {
  message?: string;
  code?: string;
};

/**
 * Standard response envelope used by all Python backend endpoints.
 *
 * Every response must be `{ ok: true, data: T }` for success or
 * `{ ok: false, error: { message, code } }` for failure.
 * The `meta` field carries request-level diagnostics (e.g., `request_id`)
 * useful for correlating server logs.
 */
type Envelope<T> = {
  ok?: boolean;
  data?: T;
  error?: EnvelopeError | null;
  meta?: {
    request_id?: string;
  };
};

/**
 * Sends a text generation request to the Python backend's `/v1/llm/generate`
 * endpoint and returns the camelCase-normalised result.
 *
 * **snake_case ↔ camelCase mapping**: The Python backend uses snake_case
 * field names (e.g., `max_tokens`, `latency_ms`) while TypeScript consumers
 * expect camelCase (e.g., `maxTokens`, `latencyMs`).  This function performs
 * the translation in both directions so the rest of the codebase never needs
 * to know about the Python naming convention.
 *
 * @param options  Generation options including the system/user prompts and
 *                 the mandatory `timeoutMs` budget.
 * @returns        The generated text content along with provider metadata.
 */
export async function generateTextViaPythonBackend(
  options: PythonBackendGenerateOptions,
): Promise<PythonBackendGenerateResult> {
  const payload = await postToPythonBackend<{
    provider: PythonBackendProvider;
    model: string;
    content: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms: number;
  }>({
    path: "/v1/llm/generate",
    timeoutMs: options.timeoutMs,
    // Translate camelCase TypeScript options to snake_case Python fields.
    body: {
      system: options.system,
      user: options.user,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      timeout_ms: options.timeoutMs,
      session_id: options.sessionId,
      transforms: options.transforms,
      provider_order: options.providerOrder,
      default_provider: options.defaultProvider,
    },
  });

  // Translate snake_case Python response fields back to camelCase.
  return {
    provider: payload.provider,
    model: payload.model,
    content: payload.content,
    usage: normalizeUsage(payload.usage),
    latencyMs: payload.latency_ms,
  };
}

/**
 * Sends an embeddings generation request to the Python backend's
 * `/v1/llm/embeddings` endpoint.
 *
 * The `Authorization` header is conditionally included so the backend can
 * enforce guest-mode RLS on the embedding operation when an access token is
 * present.
 *
 * @param options  Embeddings options including the input strings and timeout.
 * @returns        The embedding vectors along with provider metadata.
 */
export async function generateEmbeddingsViaPythonBackend(
  options: PythonBackendEmbeddingsOptions,
): Promise<PythonBackendEmbeddingsResult> {
  const payload = await postToPythonBackend<{
    provider: PythonBackendProvider;
    model: string;
    embeddings: number[][];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms: number;
  }>({
    path: "/v1/llm/embeddings",
    timeoutMs: options.timeoutMs,
    body: {
      inputs: options.inputs,
      sandbox_id: options.sandboxId ?? null,
      timeout_ms: options.timeoutMs,
      provider_order: options.providerOrder,
      default_provider: options.defaultProvider,
    },
    headers: options.accessToken
      ? {
          Authorization: `Bearer ${options.accessToken}`,
        }
      : undefined,
  });

  return {
    provider: payload.provider,
    model: payload.model,
    embeddings: payload.embeddings,
    usage: normalizeUsage(payload.usage),
    latencyMs: payload.latency_ms,
  };
}

/**
 * Requests a teaching brief snapshot from the analytics endpoint.
 *
 * The backend may return a cached brief (`isStale: true` if data has changed
 * since the last generation) or kick off a background re-generation when
 * `forceRefresh` is true.  The `isRefreshing` field in the result signals to
 * the UI that a fresh brief is being computed and it should poll again.
 *
 * All snake_case response fields are translated to camelCase here.  Struct
 * fields that can arrive under multiple aliases (e.g., `topic_title` / `topic`
 * / `title`) are normalised with explicit fallback chains.
 *
 * @param input.classId      Target class UUID.
 * @param input.userId       Requesting teacher's user id.
 * @param input.forceRefresh When true, the backend ignores the cache and starts
 *                           a new analysis job.
 * @param input.accessToken  Bearer token forwarded for guest-mode RLS.
 * @param input.sandboxId    Guest sandbox id forwarded for RLS scoping.
 * @returns  A `TeachingBriefActionResult` ready for UI consumption.
 */
export async function requestClassTeachingBrief(input: {
  classId: string;
  userId: string;
  forceRefresh: boolean;
  accessToken?: string | null;
  sandboxId?: string | null;
}): Promise<TeachingBriefActionResult> {
  const payload = await postToPythonBackend<{
    status: TeachingBriefStatus;
    generated_at: string | null;
    is_stale: boolean;
    has_evidence: boolean;
    payload?: {
      summary?: string;
      strongest_action?: string;
      attention_items?: TeachingBriefAttentionItem[];
      misconceptions?: TeachingBriefMisconception[];
      students_to_watch?: TeachingBriefStudentToWatch[];
      next_step?: string;
      recommended_activity?: TeachingBriefRecommendedActivity | null;
      evidence_basis?: string;
    } | null;
    error_message?: string | null;
  }>({
    path: "/v1/analytics/class-teaching-brief",
    timeoutMs: 30_000,
    body: {
      user_id: input.userId,
      class_id: input.classId,
      sandbox_id: input.sandboxId ?? null,
      force_refresh: input.forceRefresh,
    },
    headers: input.accessToken
      ? {
          Authorization: `Bearer ${input.accessToken}`,
        }
      : undefined,
  });

  return {
    status: payload.status,
    generatedAt: payload.generated_at ?? null,
    isStale: payload.is_stale,
    // Derive `isRefreshing` from status rather than trusting a dedicated field,
    // so the UI doesn't need to understand the backend's status enum directly.
    isRefreshing: payload.status === "generating",
    hasEvidence: payload.has_evidence,
    payload: payload.payload
      ? {
          summary: normalizeBriefText(payload.payload.summary),
          strongestAction: normalizeBriefText(payload.payload.strongest_action),
          attentionItems: (payload.payload.attention_items ?? []).map(
            normalizeAttentionItem,
          ).filter((item): item is string => item.length > 0),
          misconceptions: (payload.payload.misconceptions ?? []).map((item) => ({
            topicId: normalizeBriefText(item.topic_id) || null,
            // Support both topic_title (new) and topic/title (older aliases).
            topicTitle: normalizeBriefText(item.topic_title ?? item.topic ?? item.title),
            description: normalizeBriefText(item.description),
          })).filter((item) => item.topicTitle.length > 0 || item.description.length > 0),
          studentsToWatch: (payload.payload.students_to_watch ?? []).map((student) => ({
            studentId: normalizeBriefText(student.student_id),
            displayName: normalizeBriefText(student.display_name) || normalizeBriefText(student.student_id) || "Unknown",
            reason: normalizeBriefText(student.reason),
          })).filter((student) => student.studentId.length > 0 || student.reason.length > 0),
          nextStep: normalizeBriefText(payload.payload.next_step),
          recommendedActivity: normalizeRecommendedActivity(payload.payload.recommended_activity),
          evidenceBasis: normalizeBriefText(payload.payload.evidence_basis),
        }
      : null,
    error: payload.error_message ?? null,
  };
}


/**
 * Internal HTTP client for all Python backend POST requests.
 *
 * Handles:
 * - Base URL configuration (`PYTHON_BACKEND_URL` env var)
 * - API key forwarding via `x-api-key` header (if `PYTHON_BACKEND_API_KEY` is set)
 * - Timeout enforcement via `fetchWithTimeout`
 * - Envelope unwrapping: validates `ok`, `data` presence, and surfaces
 *   `error.message` on failure
 *
 * @param input.path       Endpoint path relative to the backend base URL (e.g., "/v1/llm/generate").
 * @param input.timeoutMs  Request timeout in milliseconds.
 * @param input.body       Request body (will be JSON-serialised).
 * @param input.headers    Optional extra headers merged with Content-Type and api-key.
 * @returns                The unwrapped `data` field from the response envelope.
 */
async function postToPythonBackend<T>(input: {
  path: string;
  timeoutMs: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}): Promise<T> {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/+$/, "")}${input.path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        ...(input.headers ?? {}),
      },
      body: JSON.stringify(input.body),
    },
    input.timeoutMs,
    `Python backend request (${input.path})`,
  );

  const payload = (await safeJson(response)) as Envelope<T> | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error?.message ?? `Python backend request failed with ${response.status}.`);
  }

  return payload.data;
}

/**
 * Translates a snake_case usage object from the Python backend into the
 * camelCase `PythonBackendUsage` shape expected by TypeScript callers.
 *
 * Returns `undefined` rather than a partial object when no usage data was
 * provided, so callers can distinguish "no usage reported" from "zero tokens".
 */
function normalizeUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}) {
  if (!usage) {
    return undefined;
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

/** Parses the response body as JSON, returning `null` on parse failure. */
async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Wraps `fetch` with an `AbortController`-based timeout.
 *
 * Why `didTimeout` is tracked separately from `signal.aborted`:
 * `signal.aborted` is true for ANY abort, including user-initiated cancellation
 * (e.g., a React navigation abort).  By setting `didTimeout = true` *before*
 * calling `controller.abort()`, we distinguish a timeout-abort (which should
 * produce a "timed out" error message) from an unrelated abort (which should
 * re-throw the original error or a generic failure message).
 *
 * The `finally` block unconditionally clears the timer so the Node.js event
 * loop is not held open if the request completes before the timeout fires.
 *
 * @param url        The URL to fetch.
 * @param init       Standard `RequestInit` options (signal will be overridden).
 * @param timeoutMs  Maximum time to wait before aborting.
 * @param label      Human-readable description for the timeout error message.
 * @returns          The `Response` if the request completes within `timeoutMs`.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
) {
  let didTimeout = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout || isAbortError(error)) {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }
    throw error instanceof Error ? error : new Error(`${label} failed.`);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns true if `error` is a DOM `AbortError` (thrown by `fetch` on abort). */
function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
