// ─────────────────────────────────────────────
//  tools/multiSuggest.ts
//  MCP Tool: multi_platform_suggestions
//  Fetches keyword suggestions from multiple platforms simultaneously:
//    Google, YouTube, Amazon, Pinterest
//  Ideal for comparing how the same topic is searched across different platforms
// ─────────────────────────────────────────────
import { z } from "zod";
import { fetchAutocompleteSuggestions, fetchAlphabetSuggestions } from "../providers/google-autocomplete";
import { fetchYoutubeSuggestions, fetchYoutubeAlphabetSuggestions } from "../providers/youtube-suggest";
import { fetchAmazonSuggestions, fetchAmazonAlphabetSuggestions } from "../providers/amazon-suggest";
import { fetchPinterestSuggestions, fetchPinterestAlphabetSuggestions } from "../providers/pinterest-suggest";
import { cleanKeywords } from "../utils/formatter";

// ── Input schema ──────────────────────────────────────────────────────────

export const MultiSuggestSchema = z.object({
  keyword: z.string().min(1).describe("The seed keyword to search across platforms"),
  platforms: z
    .array(z.enum(["google", "youtube", "amazon", "pinterest"]))
    .default(["google", "youtube", "amazon", "pinterest"])
    .describe("Which platforms to fetch suggestions from"),
  mode: z
    .enum(["basic", "expanded"])
    .default("basic")
    .describe("basic = top suggestions only. expanded = A–Z alphabet expansion per platform"),
  lang: z.string().default("en").describe("Language code for Google suggestions"),
  country: z.string().default("us").describe("Country code for Google suggestions"),
});

export type MultiSuggestInput = z.infer<typeof MultiSuggestSchema>;

// ── Output type ───────────────────────────────────────────────────────────

export interface PlatformSuggestions {
  platform: string;
  count: number;
  suggestions: string[];
}

export interface MultiSuggestResult {
  keyword: string;
  mode: string;
  platforms: PlatformSuggestions[];
  combined: string[];         // all unique suggestions across all platforms
  totalUnique: number;
  platformExclusive: Record<string, string[]>;  // keywords only found on that platform
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleMultiSuggest(
  input: MultiSuggestInput
): Promise<MultiSuggestResult> {
  const { keyword, platforms, mode, lang, country } = input;

  // Fetch from all requested platforms in parallel
  const fetchPromises: Promise<{ platform: string; suggestions: string[] }>[] = [];

  if (platforms.includes("google")) {
    const p = mode === "expanded"
      ? fetchAlphabetSuggestions({ keyword, lang, country })
      : fetchAutocompleteSuggestions({ keyword, lang, country });
    fetchPromises.push(p.then((s) => ({ platform: "google", suggestions: cleanKeywords(s) })));
  }

  if (platforms.includes("youtube")) {
    const p = mode === "expanded"
      ? fetchYoutubeAlphabetSuggestions({ keyword, lang })
      : fetchYoutubeSuggestions({ keyword, lang });
    fetchPromises.push(p.then((s) => ({ platform: "youtube", suggestions: cleanKeywords(s) })));
  }

  if (platforms.includes("amazon")) {
    const p = mode === "expanded"
      ? fetchAmazonAlphabetSuggestions({ keyword })
      : fetchAmazonSuggestions({ keyword });
    fetchPromises.push(p.then((s) => ({ platform: "amazon", suggestions: cleanKeywords(s) })));
  }

  if (platforms.includes("pinterest")) {
    const p = mode === "expanded"
      ? fetchPinterestAlphabetSuggestions({ keyword })
      : fetchPinterestSuggestions({ keyword });
    fetchPromises.push(p.then((s) => ({ platform: "pinterest", suggestions: cleanKeywords(s) })));
  }

  const platformResults = await Promise.all(fetchPromises);

  // Build combined unique list
  const combined = cleanKeywords(platformResults.flatMap((r) => r.suggestions)).sort();

  // Find platform-exclusive keywords (unique to that platform)
  const platformExclusive: Record<string, string[]> = {};
  for (const pr of platformResults) {
    const otherKeywords = new Set(
      platformResults
        .filter((r) => r.platform !== pr.platform)
        .flatMap((r) => r.suggestions)
    );
    platformExclusive[pr.platform] = pr.suggestions.filter((s) => !otherKeywords.has(s));
  }

  return {
    keyword,
    mode,
    platforms: platformResults.map((r) => ({
      platform: r.platform,
      count: r.suggestions.length,
      suggestions: r.suggestions,
    })),
    combined,
    totalUnique: combined.length,
    platformExclusive,
  };
}
