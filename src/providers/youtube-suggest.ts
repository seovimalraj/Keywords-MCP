// ─────────────────────────────────────────────
//  providers/youtube-suggest.ts
//  Uses Google's Suggest API with client=youtube (no API key needed)
//  Returns video-intent search queries
// ─────────────────────────────────────────────
import axios from "axios";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

export interface YoutubeSuggestOptions {
  keyword: string;
  lang?: string;
}

/**
 * Fetch YouTube autocomplete suggestions for a keyword.
 * These are video-intent queries — very different from web search patterns.
 */
export async function fetchYoutubeSuggestions(
  options: YoutubeSuggestOptions
): Promise<string[]> {
  const lang = options.lang ?? "en";
  const keyword = options.keyword.trim();

  const cacheKey = buildCacheKey("youtube_suggest", { keyword, lang });
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("youtube", async () => {
    const response = await axios.get<[string, string[]]>(
      config.youtube.suggestUrl,
      {
        params: {
          client: "youtube",
          q: keyword,
          hl: lang,
          ds: "yt",   // dataset=youtube
        },
        timeout: config.httpTimeout,
        headers: { "User-Agent": config.userAgent },
      }
    );

    const raw = response.data;
    if (!Array.isArray(raw) || !Array.isArray(raw[1])) return [];
    // YouTube returns nested arrays: ["query", [["suggestion", 0, []], ...]]
    const rawSuggestions = raw[1] as Array<string | [string, ...unknown[]]>;
    return rawSuggestions.map((s) => (Array.isArray(s) ? String(s[0]) : String(s)));
  });

  cacheSet(cacheKey, results);
  return results;
}

/**
 * Fetch A–Z expanded YouTube suggestions.
 */
export async function fetchYoutubeAlphabetSuggestions(
  options: YoutubeSuggestOptions
): Promise<string[]> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
  const allResults: string[] = [];

  const base = await fetchYoutubeSuggestions(options);
  allResults.push(...base);

  for (const letter of alphabet) {
    const results = await fetchYoutubeSuggestions({
      ...options,
      keyword: `${options.keyword} ${letter}`,
    });
    allResults.push(...results);
  }

  return [...new Set(allResults)];
}
