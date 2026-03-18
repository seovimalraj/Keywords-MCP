// ─────────────────────────────────────────────
//  utils/formatter.ts  –  Output helpers
// ─────────────────────────────────────────────

/**
 * Deduplicate and clean an array of keyword strings.
 */
export function cleanKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Sort keywords by estimated relevance (longer phrases = more long-tail = potentially more specific).
 * Falls back to alphabetical when relevance is equal.
 */
export function sortByRelevance(keywords: string[], seed: string): string[] {
  const seedLower = seed.toLowerCase();
  return [...keywords].sort((a, b) => {
    const aStarts = a.startsWith(seedLower) ? 0 : 1;
    const bStarts = b.startsWith(seedLower) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.localeCompare(b);
  });
}

/**
 * Group an array of keywords into an object keyed by first word after the seed.
 */
export function groupByModifier(
  keywords: string[],
  seed: string
): Record<string, string[]> {
  const seedLower = seed.toLowerCase();
  const result: Record<string, string[]> = {};

  for (const kw of keywords) {
    const rest = kw.toLowerCase().replace(seedLower, "").trim();
    const firstWord = rest.split(" ")[0] || "other";
    if (!result[firstWord]) result[firstWord] = [];
    result[firstWord].push(kw);
  }

  return result;
}
