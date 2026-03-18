// ─────────────────────────────────────────────
//  providers/google-autocomplete.ts
//  Uses Google's free Suggest API (no key)
//  Endpoint: https://suggestqueries.google.com/complete/search?client=firefox&q=...
// ─────────────────────────────────────────────
import axios from "axios";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

export interface AutocompleteOptions {
  keyword: string;
  lang?: string;       // e.g. "en"
  country?: string;    // e.g. "us"
}

/**
 * Fetch Google autocomplete suggestions for a keyword.
 * Returns an array of suggestion strings.
 */
export async function fetchAutocompleteSuggestions(
  options: AutocompleteOptions
): Promise<string[]> {
  const lang = options.lang ?? config.googleAutocomplete.defaultLang;
  const country = options.country ?? config.googleAutocomplete.defaultCountry;
  const keyword = options.keyword.trim();

  const cacheKey = buildCacheKey("autocomplete", { keyword, lang, country });
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("googleAutocomplete", async () => {
    const response = await axios.get<[string, string[]]>(
      config.googleAutocomplete.baseUrl,
      {
        params: {
          client: "firefox",   // returns clean JSON array
          q: keyword,
          hl: lang,
          gl: country,
        },
        timeout: config.httpTimeout,
        headers: { "User-Agent": config.userAgent },
      }
    );

    // Response format: ["query", ["suggestion1", "suggestion2", ...]]
    const raw = response.data;
    if (!Array.isArray(raw) || !Array.isArray(raw[1])) return [];
    return raw[1] as string[];
  });

  cacheSet(cacheKey, results);
  return results;
}

/**
 * Fetch autocomplete suggestions for multiple alphabet-appended queries.
 * e.g. "keyword a", "keyword b" ... "keyword z"
 * This mimics what tools like Ubersuggest do to expand suggestions.
 */
export async function fetchAlphabetSuggestions(
  options: AutocompleteOptions
): Promise<string[]> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
  const allResults: string[] = [];

  // Base keyword first
  const base = await fetchAutocompleteSuggestions(options);
  allResults.push(...base);

  // Append each letter
  for (const letter of alphabet) {
    const letterResults = await fetchAutocompleteSuggestions({
      ...options,
      keyword: `${options.keyword} ${letter}`,
    });
    allResults.push(...letterResults);
  }

  return [...new Set(allResults)];
}

/**
 * Fetch autocomplete for a keyword with number suffixes (0-9).
 * Useful for finding listicle-type queries.
 */
export async function fetchNumberSuggestions(
  options: AutocompleteOptions
): Promise<string[]> {
  const allResults: string[] = [];

  for (let i = 0; i <= 9; i++) {
    const results = await fetchAutocompleteSuggestions({
      ...options,
      keyword: `${options.keyword} ${i}`,
    });
    allResults.push(...results);
  }

  return [...new Set(allResults)];
}
