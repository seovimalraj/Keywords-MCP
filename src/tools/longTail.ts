// ─────────────────────────────────────────────
//  tools/longTail.ts
//  MCP Tool: long_tail_keywords
//  Returns long-tail keyword expansions using:
//    - Preposition-based queries (keyword for X, keyword without X)
//    - Intent-based modifiers (best keyword, buy keyword, etc.)
//    - Comparison phrases (keyword vs, keyword alternative)
//    - Alphabetical expansion (keyword a, keyword b, ...)
// ─────────────────────────────────────────────
import { z } from "zod";
import { generateAtpKeywords } from "../providers/answer-the-public";
import { cleanKeywords } from "../utils/formatter";

// ── Input schema ──────────────────────────────────────────────────────────

export const LongTailKeywordsSchema = z.object({
  keyword: z.string().min(1).describe("The seed keyword to expand into long-tail variations"),
  lang: z.string().default("en").describe("Language code"),
  country: z.string().default("us").describe("Country code"),
  categories: z
    .array(z.enum(["prepositions", "comparisons", "alphabetical", "intent"]))
    .default(["prepositions", "comparisons", "alphabetical", "intent"])
    .describe("Which long-tail categories to include"),
});

export type LongTailKeywordsInput = z.infer<typeof LongTailKeywordsSchema>;

// ── Output type ───────────────────────────────────────────────────────────

export interface LongTailKeywordsResult {
  keyword: string;
  totalKeywords: number;
  byCategory: {
    prepositions?: Record<string, string[]>;   // grouped by preposition
    comparisons?: string[];
    alphabetical?: string[];
    intent?: Record<string, string[]>;         // grouped by intent type
  };
  allKeywords: string[];    // flat deduplicated list sorted alphabetically
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleLongTailKeywords(
  input: LongTailKeywordsInput
): Promise<LongTailKeywordsResult> {
  const atpData = await generateAtpKeywords({
    keyword: input.keyword,
    lang: input.lang,
    country: input.country,
    include: input.categories,
  });

  const result: LongTailKeywordsResult = {
    keyword: input.keyword,
    totalKeywords: 0,
    byCategory: {},
    allKeywords: [],
  };

  const allKeywords: string[] = [];

  if (input.categories.includes("prepositions")) {
    result.byCategory.prepositions = atpData.prepositions;
    allKeywords.push(...Object.values(atpData.prepositions).flat());
  }

  if (input.categories.includes("comparisons")) {
    result.byCategory.comparisons = atpData.comparisons;
    allKeywords.push(...atpData.comparisons);
  }

  if (input.categories.includes("alphabetical")) {
    result.byCategory.alphabetical = atpData.alphabetical;
    allKeywords.push(...atpData.alphabetical);
  }

  if (input.categories.includes("intent")) {
    result.byCategory.intent = atpData.intent;
    allKeywords.push(...Object.values(atpData.intent).flat());
  }

  result.allKeywords = cleanKeywords(allKeywords).sort();
  result.totalKeywords = result.allKeywords.length;

  return result;
}
