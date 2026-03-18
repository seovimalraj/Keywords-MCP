// ─────────────────────────────────────────────
//  providers/wikipedia.ts
//  Uses Wikipedia's public OpenSearch + REST APIs (no API key needed)
//  Returns related topics, entity summaries, and link clusters
//  for semantic context and LSI keyword ideas
// ─────────────────────────────────────────────
import axios from "axios";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WikiSearchResult {
  title: string;
  description: string;
  excerpt: string;
}

export interface WikiEntityData {
  title: string;
  summary: string;
  relatedTopics: string[];       // titles of linked articles (internal wiki links)
  categories: string[];          // page categories (great for semantic clustering)
  keyPhrases: string[];          // notable terms extracted from the summary
}

// ── Internal response types ────────────────────────────────────────────────

interface WikiOpenSearchResponse {
  0: string;
  1: string[];
  2: string[];
  3: string[];
}

interface WikiRestSearchItem {
  title?: string;
  description?: string;
  excerpt?: string;
}

interface WikiPageData {
  title?: string;
  extract?: string;
  categories?: Array<{ title?: string }>;
  links?: Array<{ title?: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract notable noun-phrases from a Wikipedia summary paragraph.
 * Uses simple capitalization heuristics to find proper nouns and terms.
 */
function extractKeyPhrases(text: string): string[] {
  // Match capitalized words / phrases (proper nouns, technical terms)
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) ?? [];
  // Also extract quoted terms
  const quoted = text.match(/"([^"]+)"/g)?.map((q) => q.replace(/"/g, "")) ?? [];
  return [...new Set([...matches, ...quoted])]
    .filter((p) => p.length > 3)
    .slice(0, 30);
}

/**
 * Clean Wikipedia category names by removing "Category:" prefix.
 */
function cleanCategory(cat: string): string {
  return cat.replace(/^Category:\s*/i, "").trim();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Search Wikipedia for pages matching a keyword.
 * Returns titles, descriptions, and excerpts of matching articles.
 */
export async function searchWikipedia(keyword: string, limit = 10): Promise<WikiSearchResult[]> {
  const cacheKey = buildCacheKey("wiki_search", { keyword, limit });
  const cached = cacheGet<WikiSearchResult[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("wikipedia", async () => {
    const response = await axios.get<WikiRestSearchItem[]>(
      `${config.wikipedia.searchUrl}`,
      {
        params: {
          q: keyword,
          limit,
        },
        timeout: config.httpTimeout,
        headers: {
          "User-Agent": "keywords-mcp/1.0 (keyword research tool)",
          "Accept": "application/json",
        },
      }
    );

    const pages = Array.isArray(response.data) ? response.data : (response.data as { pages?: WikiRestSearchItem[] }).pages ?? [];
    return (pages as WikiRestSearchItem[]).map((p) => ({
      title: p.title ?? "",
      description: p.description ?? "",
      excerpt: (p.excerpt ?? "").replace(/<[^>]+>/g, "").trim(),
    }));
  });

  cacheSet(cacheKey, results, 86400); // cache for 24 hours (Wikipedia changes slowly)
  return results;
}

/**
 * Get autocomplete suggestions from Wikipedia OpenSearch.
 * Useful for finding how topics are officially named / categorized.
 */
export async function fetchWikipediaAutocomplete(keyword: string): Promise<string[]> {
  const cacheKey = buildCacheKey("wiki_autocomplete", { keyword });
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("wikipedia", async () => {
    const response = await axios.get<WikiOpenSearchResponse>(
      config.wikipedia.apiUrl,
      {
        params: {
          action: "opensearch",
          search: keyword,
          limit: 12,
          format: "json",
          origin: "*",
        },
        timeout: config.httpTimeout,
        headers: {
          "User-Agent": "keywords-mcp/1.0",
          "Accept": "application/json",
        },
      }
    );

    const data = response.data;
    if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
    return data[1] as string[];
  });

  cacheSet(cacheKey, results, 86400);
  return results;
}

/**
 * Get rich entity data for a keyword from Wikipedia.
 * Returns summary, categories (for semantic grouping), and related article titles.
 */
export async function fetchWikipediaEntityData(keyword: string): Promise<WikiEntityData | null> {
  const cacheKey = buildCacheKey("wiki_entity", { keyword });
  const cached = cacheGet<WikiEntityData | null>(cacheKey);
  if (cached !== undefined) return cached;

  const result = await throttle("wikipedia", async () => {
    const response = await axios.get<{ query?: { pages?: Record<string, WikiPageData> } }>(
      config.wikipedia.apiUrl,
      {
        params: {
          action: "query",
          titles: keyword,
          prop: "extracts|categories|links",
          exintro: true,          // intro section only
          explaintext: true,      // plain text, no HTML
          cllimit: 20,
          pllimit: 50,
          format: "json",
          origin: "*",
          redirects: 1,
        },
        timeout: config.httpTimeout,
        headers: {
          "User-Agent": "keywords-mcp/1.0",
          "Accept": "application/json",
        },
      }
    );

    const pages = response.data?.query?.pages ?? {};
    const page = Object.values(pages)[0] as WikiPageData | undefined;

    if (!page || !page.title) return null;

    const summary = page.extract ?? "";
    const categories = (page.categories ?? [])
      .map((c) => cleanCategory(c.title ?? ""))
      .filter(Boolean);
    const relatedTopics = (page.links ?? [])
      .map((l) => l.title ?? "")
      .filter(Boolean)
      .slice(0, 30);
    const keyPhrases = extractKeyPhrases(summary);

    return {
      title: page.title,
      summary: summary.slice(0, 500),  // first 500 chars
      relatedTopics,
      categories,
      keyPhrases,
    } as WikiEntityData;
  });

  cacheSet(cacheKey, result, 86400);
  return result;
}
