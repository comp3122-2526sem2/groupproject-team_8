import type { MaterialSegment } from "@/lib/materials/extract-text";

/**
 * A contiguous slice of text derived from a single `MaterialSegment`.
 *
 * Chunks are the unit of storage in the `material_chunks` table and the unit
 * of retrieval for RAG (see `retrieval.ts`).  `tokenCount` is stored alongside
 * the text so the retrieval loop can enforce token budgets without re-estimating.
 */
export type MaterialChunk = {
  text: string;
  sourceType: MaterialSegment["sourceType"];
  sourceIndex: number;
  sectionTitle?: string;
  extractionMethod: MaterialSegment["extractionMethod"];
  qualityScore?: number;
  tokenCount: number;
};

const DEFAULT_CHUNK_TOKENS = Number(process.env.CHUNK_TOKENS ?? 1000);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP ?? 100);

/**
 * Estimates the token count of a string using a 4-characters-per-token
 * heuristic.
 *
 * This is intentionally approximate — exact tokenisation (e.g., via
 * `tiktoken`) would be significantly slower and is not needed for chunking
 * decisions where a rough budget is sufficient.  Returns at least 1 so callers
 * never divide by zero when computing pressure ratios.
 *
 * @param text  The text to estimate.
 * @returns     Estimated token count (>= 1).
 */
export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Splits an array of `MaterialSegment` objects into fixed-size `MaterialChunk`
 * objects with configurable overlap.
 *
 * **Chunking algorithm**:
 * - Segments that fit within `DEFAULT_CHUNK_TOKENS` are emitted as a single
 *   chunk with no splitting.
 * - Longer segments are split word-by-word: words are accumulated into
 *   `current` until the next word would push the token count over the limit,
 *   at which point the accumulated text is emitted as a chunk.
 * - After each chunk, the start index is set back by `safeOverlap` words so
 *   adjacent chunks share context.  This prevents a concept that straddles a
 *   chunk boundary from being lost in both chunks.
 *
 * @param segments  Extracted material segments (from `extract-text.ts`).
 * @returns         An array of `MaterialChunk` objects ready for embedding.
 */
export function chunkSegments(segments: MaterialSegment[]) {
  const chunks: MaterialChunk[] = [];

  for (const segment of segments) {
    if (!segment.text.trim()) {
      continue;
    }

    const tokenCount = estimateTokenCount(segment.text);
    if (tokenCount <= DEFAULT_CHUNK_TOKENS) {
      // Segment fits in a single chunk — emit it directly without splitting.
      chunks.push({
        text: segment.text,
        sourceType: segment.sourceType,
        sourceIndex: segment.sourceIndex,
        sectionTitle: segment.sectionTitle,
        extractionMethod: segment.extractionMethod,
        qualityScore: segment.qualityScore,
        tokenCount,
      });
      continue;
    }

    const words = segment.text.split(/\s+/g);
    const wordLengths = words.map((word) => word.length);
    let start = 0;
    while (start < words.length) {
      let end = start;
      let current = "";
      while (end < words.length) {
        const next = current ? `${current} ${words[end]}` : words[end];
        if (estimateTokenCount(next) > DEFAULT_CHUNK_TOKENS) {
          break;
        }
        current = next;
        end += 1;
      }

      if (current) {
        chunks.push({
          text: current,
          sourceType: segment.sourceType,
          sourceIndex: segment.sourceIndex,
          sectionTitle: segment.sectionTitle,
          extractionMethod: segment.extractionMethod,
          qualityScore: segment.qualityScore,
          tokenCount: estimateTokenCount(current),
        });
      }

      if (end >= words.length) {
        break;
      }

      // --- Long-word escape hatch ---
      // If `current` is still empty after the inner loop, the word at `start`
      // is longer than `DEFAULT_CHUNK_TOKENS` on its own (e.g., a base64
      // string or a very long URL).  Emitting it as a single oversized chunk
      // prevents an infinite loop — without this guard `start` would never
      // advance and the while loop would spin forever.
      if (!current) {
        const longWord = words[start];
        chunks.push({
          text: longWord,
          sourceType: segment.sourceType,
          sourceIndex: segment.sourceIndex,
          sectionTitle: segment.sectionTitle,
          extractionMethod: segment.extractionMethod,
          qualityScore: segment.qualityScore,
          tokenCount: estimateTokenCount(longWord),
        });
        start = Math.min(start + 1, words.length);
        continue;
      }

      // --- Overlap calculation ---
      // `countOverlapWords` scans backward from `end` to find how many words
      // fit within the overlap token budget.  We then cap the result at
      // `maxOverlap` (one less than the total words in the current chunk) to
      // guarantee that `start` always advances by at least one word, preventing
      // a degenerate case where a very large `overlapTokens` setting would
      // cause `start` to stay in place and produce an infinite loop.
      const overlapWords = countOverlapWords(wordLengths, end, DEFAULT_CHUNK_OVERLAP);
      const maxOverlap = Math.max(0, end - start - 1);
      // `safeOverlap` is the minimum of the computed overlap and the maximum
      // safe overlap — ensures at least one word of forward progress.
      const safeOverlap = Math.min(overlapWords, maxOverlap);
      start = Math.max(0, end - safeOverlap);
    }
  }

  return chunks;
}

/**
 * Counts how many words (scanning backward from `end`) fit within the given
 * overlap token budget.
 *
 * **Why scan backward?**  We want the overlap region to be the *tail* of the
 * preceding chunk — the most recently seen content — so the next chunk begins
 * with words that bridge the boundary.  Scanning forward from `start` would
 * give us the leading words of the chunk instead.
 *
 * **What the cumulative char count is doing**: `overlapChars` accumulates
 * character counts including inter-word spaces (`+1` per word after the first)
 * as we walk back through `wordLengths`.  Once `Math.ceil(overlapChars / 4)`
 * reaches `overlapTokens`, we stop — we've found the overlap boundary.
 *
 * @param wordLengths    Array of character lengths for each word in the segment.
 * @param end            Index of the first word NOT included in the current chunk
 *                       (i.e., the chunk covers `[start, end)`).
 * @param overlapTokens  Maximum number of tokens the overlap region should occupy.
 * @returns              Number of words to include in the overlap (may be 0 if
 *                       `overlapTokens` is zero or non-finite).
 */
function countOverlapWords(wordLengths: number[], end: number, overlapTokens: number) {
  if (!Number.isFinite(overlapTokens) || overlapTokens <= 0) {
    return 0;
  }

  let overlapChars = 0;
  let overlapWords = 0;
  // Walk backward from the last word of the current chunk.
  for (let index = end - 1; index >= 0; index -= 1) {
    // Add this word's character length plus one space separator (except for
    // the very first word in the overlap region which needs no leading space).
    overlapChars += wordLengths[index] + (overlapWords > 0 ? 1 : 0);
    overlapWords += 1;
    if (Math.ceil(overlapChars / 4) >= overlapTokens) {
      break;
    }
  }
  return overlapWords;
}
