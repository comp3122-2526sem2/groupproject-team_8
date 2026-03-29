import { generateEmbeddingsWithFallback } from "@/lib/ai/providers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { estimateTokenCount } from "@/lib/materials/chunking";

/**
 * A single chunk returned by the `match_material_chunks` vector-search RPC.
 *
 * `similarity` is the cosine similarity score [0, 1] from pgvector.  Chunks
 * are returned pre-ordered by descending similarity so the loop below can
 * apply budget constraints without re-sorting.
 */
export type RetrievedChunk = {
  id: string;
  material_id: string;
  material_title: string;
  source_type: string;
  source_index: number;
  section_title: string | null;
  text: string;
  token_count: number;
  similarity: number;
};

const DEFAULT_CONTEXT_TOKENS = Number(process.env.RAG_CONTEXT_TOKENS ?? 24000);
const DEFAULT_MATCH_COUNT = Number(process.env.RAG_MATCH_COUNT ?? 24);
// Per-material cap: maximum number of chunks from any single material that can
// appear in one retrieval result.  Without this cap, a very long or very
// relevant material could fill the entire context window and crowd out chunks
// from other materials, causing the AI to ignore the rest of the class content.
const DEFAULT_MAX_PER_MATERIAL = Number(process.env.RAG_MAX_PER_MATERIAL ?? 6);

/**
 * Embeds `query`, runs a vector similarity search over the class's material
 * chunks, and assembles the results into a prompt-ready context block.
 *
 * **Selection algorithm** (greedy token-budget loop):
 * 1. Embed the query string using the configured embedding provider.
 * 2. Call `match_material_chunks` via RPC, which returns up to
 *    `DEFAULT_MATCH_COUNT` chunks ordered by descending cosine similarity.
 * 3. Iterate through the ranked chunks:
 *    a. Skip any chunk whose material has already contributed
 *       `DEFAULT_MAX_PER_MATERIAL` chunks (per-material diversity cap).
 *    b. If adding this chunk would exceed `maxTokens`, stop immediately
 *       (greedy early break — we assume the remaining chunks would also
 *       exceed the budget because they are generally larger than the
 *       marginal remaining space).
 *    c. Otherwise, accept the chunk and update the running token total.
 * 4. Pass accepted chunks to `buildContext` for rendering.
 *
 * @param classId   UUID of the class whose material chunks to search.
 * @param query     The student's question used as the similarity query.
 * @param maxTokens Maximum total tokens the context block may consume;
 *                  defaults to `DEFAULT_CONTEXT_TOKENS` (24 000).
 * @param options.timeoutMs   Embedding request timeout.
 * @param options.accessToken Bearer token forwarded for guest-mode RLS.
 * @param options.sandboxId   Guest sandbox id forwarded for RLS scoping.
 * @returns  A rendered context string ready for prompt injection, or an
 *           empty string if no relevant chunks were found.
 */
export async function retrieveMaterialContext(
  classId: string,
  query: string,
  maxTokens = DEFAULT_CONTEXT_TOKENS,
  options?: {
    timeoutMs?: number;
    accessToken?: string | null;
    sandboxId?: string | null;
  },
) {
  const embeddingResult = await generateEmbeddingsWithFallback({
    inputs: [query],
    timeoutMs: options?.timeoutMs,
    accessToken: options?.accessToken,
    sandboxId: options?.sandboxId,
  });

  const [embedding] = embeddingResult.embeddings;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("match_material_chunks", {
    p_class_id: classId,
    query_embedding: embedding,
    match_count: DEFAULT_MATCH_COUNT,
  });

  if (error) {
    throw new Error(error.message);
  }

  const chunks = (data ?? []) as RetrievedChunk[];
  // Track how many chunks from each material have been accepted so far.
  const usageByMaterial = new Map<string, number>();
  const selected: RetrievedChunk[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    // --- Per-material diversity cap ---
    // Skip this chunk if its parent material has already contributed the
    // maximum allowed number of chunks to prevent one material dominating.
    const used = usageByMaterial.get(chunk.material_id) ?? 0;
    if (used >= DEFAULT_MAX_PER_MATERIAL) {
      continue;
    }
    const chunkTokens = chunk.token_count || estimateTokenCount(chunk.text);
    // --- Greedy early break ---
    // Stop as soon as adding the next highest-similarity chunk would exceed
    // the token budget.  Because chunks are pre-sorted by similarity (highest
    // first), once we hit the budget limit the remaining chunks are no better
    // and can be safely discarded.
    if (usedTokens + chunkTokens > maxTokens) {
      break;
    }
    usageByMaterial.set(chunk.material_id, used + 1);
    selected.push(chunk);
    usedTokens += chunkTokens;
  }

  return buildContext(selected);
}

/**
 * Renders an array of retrieved chunks into the plaintext context block
 * injected into the AI prompt.
 *
 * **Source-header label format contract**: Each chunk is prefixed with a label
 * of the form `"Source N | <material_title> | <source_type> <source_index>"`.
 * The `"Source N"` portion (where N is the 1-based chunk position) is the
 * citation key the AI is instructed to use in its `citations` array.  The
 * system prompt in `buildChatPrompt` (context.ts) explicitly states that
 * `sourceLabel` must exactly match one of these labels.  Any change to this
 * format must be mirrored in the system prompt to keep citations resolvable.
 *
 * @param chunks  Selected `RetrievedChunk` objects (order determines Source N numbering).
 * @returns       A multi-section string with `---` separators, or `""` if empty.
 */
export function buildContext(chunks: RetrievedChunk[]) {
  if (chunks.length === 0) {
    return "";
  }

  return chunks
    .map((chunk, index) => {
      // Label format: "Source 1 | My Textbook | page 3"
      // This exact format is referenced in the AI system prompt — do not alter.
      const header = `Source ${index + 1} | ${chunk.material_title} | ${chunk.source_type} ${chunk.source_index}`;
      return `${header}\n${chunk.text}`.trim();
    })
    .join("\n\n---\n\n");
}
