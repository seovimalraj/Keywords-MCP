// ─────────────────────────────────────────────
//  providers/amazon-suggest.ts
//  Uses Amazon's public completion API (no API key needed)
//  Returns product/shopping-intent search queries
// ─────────────────────────────────────────────
import axios from "axios";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

export interface AmazonSuggestOptions {
  keyword: string;
  /** Amazon marketplace ID. 1=US, 3=UK, 4=DE, 5=FR, 6=JP, 44551177011=IN */
  marketplace?: string;
}

/**
 * Fetch Amazon product search autocomplete suggestions for a keyword.
 * These are high-purchase-intent queries from Amazon shoppers.
 */
export async function fetchAmazonSuggestions(
  options: AmazonSuggestOptions
): Promise<string[]> {
  const marketplace = options.marketplace ?? config.amazon.defaultMarketplace;
  const keyword = options.keyword.trim();

  const cacheKey = buildCacheKey("amazon_suggest", { keyword, marketplace });
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("amazon", async () => {
    const response = await axios.get<[string, string[]]>(
      config.amazon.suggestUrl,
      {
        params: {
          method: "completion",
          q: keyword,
          mkt: marketplace,
          "search-alias": "aps",  // aps = all product search
          client: "amazon-search-ui",
          x: "String",
          cf: "1",
        },
        timeout: config.httpTimeout,
        headers: {
          "User-Agent": config.userAgent,
          "Accept": "*/*",
        },
      }
    );

    const raw = response.data;
    if (!Array.isArray(raw) || !Array.isArray(raw[1])) return [];
    return (raw[1] as unknown[]).map(String);
  });

  cacheSet(cacheKey, results);
  return results;
}

/**
 * Fetch A–Z expanded Amazon suggestions.
 */
export async function fetchAmazonAlphabetSuggestions(
  options: AmazonSuggestOptions
): Promise<string[]> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
  const allResults: string[] = [];

  const base = await fetchAmazonSuggestions(options);
  allResults.push(...base);

  for (const letter of alphabet) {
    const results = await fetchAmazonSuggestions({
      ...options,
      keyword: `${options.keyword} ${letter}`,
    });
    allResults.push(...results);
  }

  return [...new Set(allResults)];
}
