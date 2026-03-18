// ─────────────────────────────────────────────
//  tools/fullResearch.ts
//  MCP Tool: full_keyword_research
//  Runs all tools (suggestions + trends + questions + long-tail)
//  in a single call and returns a unified report
// ─────────────────────────────────────────────
import { z } from "zod";
import { fetchAutocompleteSuggestions, fetchAlphabetSuggestions } from "../providers/google-autocomplete";
import { fetchTrends } from "../providers/google-trends";
import { generateAtpKeywords } from "../providers/answer-the-public";
import { cleanKeywords, sortByRelevance } from "../utils/formatter";

// ── Input schema ──────────────────────────────────────────────────────────

export const FullResearchSchema = z.object({
  keyword: z.string().min(1).describe("The seed keyword to research"),
  lang: z.string().default("en").describe("Language code"),
  country: z.string().default("us").describe("Country/region code (also used for Trends geo)"),
  timeframe: z
    .string()
    .default("today 12-m")
    .describe("Google Trends timeframe, e.g. 'today 12-m', 'today 5-y'"),
  includeTrends: z
    .boolean()
    .default(true)
    .describe("Whether to include Google Trends data (takes extra time)"),
});

export type FullResearchInput = z.infer<typeof FullResearchSchema>;

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleFullResearch(input: FullResearchInput) {
  const { keyword, lang, country, timeframe, includeTrends } = input;

  // Run parallel where possible
  const [suggestions, alphabetical, atpData, trendsData] = await Promise.all([
    fetchAutocompleteSuggestions({ keyword, lang, country }),
    fetchAlphabetSuggestions({ keyword, lang, country }),
    generateAtpKeywords({
      keyword,
      lang,
      country,
      include: ["questions", "prepositions", "comparisons", "alphabetical", "intent"],
    }),
    includeTrends
      ? fetchTrends({ keyword, geo: country.toUpperCase(), timeframe })
      : Promise.resolve(null),
  ]);

  const topSuggestions = sortByRelevance(cleanKeywords(suggestions), keyword);
  const expandedSuggestions = sortByRelevance(cleanKeywords(alphabetical), keyword);

  const allKeywords = cleanKeywords([
    ...topSuggestions,
    ...expandedSuggestions,
    ...Object.values(atpData.questions).flat(),
    ...Object.values(atpData.prepositions).flat(),
    ...atpData.comparisons,
    ...atpData.alphabetical,
    ...Object.values(atpData.intent).flat(),
  ]).sort();

  return {
    keyword,
    generatedAt: new Date().toISOString(),
    summary: {
      totalUniqueKeywords: allKeywords.length,
      topSuggestionsCount: topSuggestions.length,
      expandedSuggestionsCount: expandedSuggestions.length,
      questionsCount: Object.values(atpData.questions).flat().length,
      longTailCount: Object.values(atpData.prepositions).flat().length +
        atpData.comparisons.length +
        atpData.alphabetical.length,
      intentKeywordsCount: Object.values(atpData.intent).flat().length,
    },
    topSuggestions,
    expandedSuggestions,
    questions: atpData.questions,
    prepositions: atpData.prepositions,
    comparisons: atpData.comparisons,
    intentKeywords: atpData.intent,
    trends: trendsData
      ? {
          interestOverTime: trendsData.interestOverTime,
          relatedQueries: trendsData.relatedQueries,
          relatedTopics: trendsData.relatedTopics,
        }
      : null,
    allKeywords,
  };
}
