// ─────────────────────────────────────────────
//  providers/pinterest-suggest.ts
//  Uses Pinterest's public SearchBoxSuggestionsResource (no API key needed)
//  Returns visual/lifestyle/creative-intent queries
// ─────────────────────────────────────────────
import axios from "axios";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

export interface PinterestSuggestOptions {
  keyword: string;
}

interface PinterestSuggestionItem {
  display_name?: string;
  term?: string;
  title_text?: string;
}

interface PinterestResponse {
  resource_response?: {
    data?: PinterestSuggestionItem[];
  };
}

/**
 * Fetch Pinterest autocomplete suggestions for a keyword.
 * These reveal visual/lifestyle/craft/DIY/fashion/home-decor intent queries.
 */
export async function fetchPinterestSuggestions(
  options: PinterestSuggestOptions
): Promise<string[]> {
  const keyword = options.keyword.trim();

  const cacheKey = buildCacheKey("pinterest_suggest", { keyword });
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("pinterest", async () => {
    const response = await axios.get<PinterestResponse>(
      config.pinterest.suggestUrl,
      {
        params: {
          source_url: `/search/pins/?q=${encodeURIComponent(keyword)}`,
          data: JSON.stringify({
            options: {
              term: keyword,
              count: 12,
            },
          }),
        },
        timeout: config.httpTimeout,
        headers: {
          "User-Agent": config.userAgent,
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": "https://www.pinterest.com/",
        },
      }
    );

    const items = response.data?.resource_response?.data ?? [];
    return items
      .map((item) => item.display_name ?? item.term ?? item.title_text ?? "")
      .filter(Boolean);
  });

  cacheSet(cacheKey, results);
  return results;
}

/**
 * Fetch A–Z expanded Pinterest suggestions.
 */
export async function fetchPinterestAlphabetSuggestions(
  options: PinterestSuggestOptions
): Promise<string[]> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
  const allResults: string[] = [];

  const base = await fetchPinterestSuggestions(options);
  allResults.push(...base);

  for (const letter of alphabet) {
    const results = await fetchPinterestSuggestions({
      keyword: `${options.keyword} ${letter}`,
    });
    allResults.push(...results);
  }

  return [...new Set(allResults)];
}
