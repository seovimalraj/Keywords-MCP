// ─────────────────────────────────────────────
//  tools/wikiResearch.ts
//  MCP Tool: wiki_keyword_context
//  Uses Wikipedia to provide semantic context for a keyword:
//    - Related topic titles (internal wiki links)
//    - Page categories (semantic groupings)
//    - Key phrases extracted from the summary
//    - Autocomplete suggestions (how Wikipedia names this topic)
//  Ideal for: topic cluster planning, LSI keywords, content structuring
// ─────────────────────────────────────────────
import { z } from "zod";
import {
  fetchWikipediaAutocomplete,
  fetchWikipediaEntityData,
  searchWikipedia,
} from "../providers/wikipedia";
import { cleanKeywords } from "../utils/formatter";

// ── Input schema ──────────────────────────────────────────────────────────

export const WikiResearchSchema = z.object({
  keyword: z.string().min(1).describe("The keyword or topic to research on Wikipedia"),
  includeRelatedArticles: z
    .boolean()
    .default(true)
    .describe("Include titles of related Wikipedia articles (internal links)"),
  includeCategories: z
    .boolean()
    .default(true)
    .describe("Include Wikipedia page categories (great for topic cluster names)"),
});

export type WikiResearchInput = z.infer<typeof WikiResearchSchema>;

// ── Output type ───────────────────────────────────────────────────────────

export interface WikiResearchResult {
  keyword: string;
  autocomplete: string[];             // how Wikipedia names this topic
  topSearchResults: Array<{
    title: string;
    description: string;
  }>;
  entityData: {
    title: string;
    summary: string;
    keyPhrases: string[];
    categories: string[];
    relatedTopics: string[];
  } | null;
  suggestedKeywords: string[];        // all keywords usable for SEO (deduped)
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleWikiResearch(
  input: WikiResearchInput
): Promise<WikiResearchResult> {
  const { keyword, includeRelatedArticles, includeCategories } = input;

  const [autocomplete, searchResults, entityData] = await Promise.all([
    fetchWikipediaAutocomplete(keyword),
    searchWikipedia(keyword, 8),
    fetchWikipediaEntityData(keyword),
  ]);

  // Gather all keyword-like terms from Wikipedia data
  const keywordPool: string[] = [
    ...autocomplete,
    ...searchResults.map((r) => r.title),
    ...(entityData?.keyPhrases ?? []),
    ...(includeCategories ? (entityData?.categories ?? []) : []),
    ...(includeRelatedArticles ? (entityData?.relatedTopics ?? []) : []),
  ];

  const suggestedKeywords = cleanKeywords(keywordPool).sort();

  return {
    keyword,
    autocomplete,
    topSearchResults: searchResults.map((r) => ({
      title: r.title,
      description: r.description,
    })),
    entityData: entityData
      ? {
          title: entityData.title,
          summary: entityData.summary,
          keyPhrases: entityData.keyPhrases,
          categories: includeCategories ? entityData.categories : [],
          relatedTopics: includeRelatedArticles ? entityData.relatedTopics : [],
        }
      : null,
    suggestedKeywords,
  };
}
