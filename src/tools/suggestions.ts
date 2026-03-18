// ─────────────────────────────────────────────
//  tools/suggestions.ts
//  MCP Tool: keyword_suggestions
//  Returns autocomplete suggestions from Google (+ alphabet expansion)
// ─────────────────────────────────────────────
import { z } from "zod";
import {
  fetchAutocompleteSuggestions,
  fetchAlphabetSuggestions,
} from "../providers/google-autocomplete";
import { cleanKeywords, sortByRelevance } from "../utils/formatter";

// ── Input schema ──────────────────────────────────────────────────────────

export const KeywordSuggestionsSchema = z.object({
  keyword: z.string().min(1).describe("The seed keyword to get suggestions for"),
  lang: z.string().default("en").describe("Language code, e.g. 'en', 'es', 'fr'"),
  country: z.string().default("us").describe("Country code, e.g. 'us', 'gb', 'in'"),
  mode: z
    .enum(["basic", "expanded"])
    .default("basic")
    .describe(
      "basic = top 10 suggestions only. expanded = A–Z alphabet expansion (returns 100+ suggestions)"
    ),
});

export type KeywordSuggestionsInput = z.infer<typeof KeywordSuggestionsSchema>;

// ── Output type ──────────────────────────────────────────────────────────

export interface KeywordSuggestionsResult {
  keyword: string;
  mode: string;
  count: number;
  suggestions: string[];
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleKeywordSuggestions(
  input: KeywordSuggestionsInput
): Promise<KeywordSuggestionsResult> {
  let raw: string[];

  if (input.mode === "expanded") {
    raw = await fetchAlphabetSuggestions({
      keyword: input.keyword,
      lang: input.lang,
      country: input.country,
    });
  } else {
    raw = await fetchAutocompleteSuggestions({
      keyword: input.keyword,
      lang: input.lang,
      country: input.country,
    });
  }

  const suggestions = sortByRelevance(cleanKeywords(raw), input.keyword);

  return {
    keyword: input.keyword,
    mode: input.mode,
    count: suggestions.length,
    suggestions,
  };
}
