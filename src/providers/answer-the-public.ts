// ─────────────────────────────────────────────
//  providers/answer-the-public.ts
//  Internal Answer-the-Public style engine.
//  Generates structured question & comparison keywords
//  by combining seed + prepositions + question words,
//  then validates them through Google Autocomplete to
//  surface only queries people are actually searching for.
// ─────────────────────────────────────────────

import { fetchAutocompleteSuggestions } from "./google-autocomplete";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";
import { cleanKeywords } from "../utils/formatter";

// ── Modifier banks ─────────────────────────────────────────────────────────

const QUESTION_PREFIXES: Record<string, string[]> = {
  what: [
    "what is",
    "what are",
    "what does",
    "what was",
    "what can",
    "what should",
  ],
  why: [
    "why is",
    "why are",
    "why does",
    "why do",
    "why should",
    "why would",
    "why can't",
  ],
  how: [
    "how to",
    "how do",
    "how does",
    "how can",
    "how much",
    "how many",
    "how long",
    "how often",
  ],
  when: [
    "when is",
    "when does",
    "when to",
    "when should",
    "when can",
    "when will",
  ],
  where: [
    "where is",
    "where to",
    "where can",
    "where does",
    "where are",
    "where do",
  ],
  who: [
    "who is",
    "who are",
    "who can",
    "who should",
    "who does",
  ],
  which: [
    "which is",
    "which are",
    "which one",
    "which type of",
  ],
  can: [
    "can i",
    "can you",
    "can we",
  ],
  is: [
    "is it",
    "is there",
    "is a",
    "is the",
  ],
  are: [
    "are there",
    "are they",
    "are all",
  ],
  will: [
    "will it",
    "will there be",
  ],
};

const PREPOSITIONS: string[] = [
  "for", "without", "with", "near", "vs", "versus",
  "like", "to", "from", "in", "on", "at", "about",
  "after", "before", "during", "instead of",
];

const COMPARISON_MODIFIERS: string[] = [
  "vs", "versus", "or", "compared to", "alternative to",
  "alternative", "better than", "similar to",
];

const INTENT_MODIFIERS: Record<string, string[]> = {
  commercial: [
    "best", "top", "cheap", "affordable", "buy", "price", "cost",
    "review", "reviews", "comparison", "deal", "discount", "coupon",
  ],
  informational: [
    "guide", "tutorial", "tips", "how to", "examples",
    "meaning", "definition", "explained", "overview", "introduction",
  ],
  local: [
    "near me", "in [city]", "local", "nearby",
  ],
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface AtpOptions {
  keyword: string;
  lang?: string;
  country?: string;
  /** Which categories to include. Omit for all. */
  include?: Array<"questions" | "prepositions" | "comparisons" | "alphabetical" | "intent">;
}

export interface AtpResult {
  keyword: string;
  questions: Record<string, string[]>;          // grouped by question word
  prepositions: Record<string, string[]>;       // grouped by preposition
  comparisons: string[];
  alphabetical: string[];
  intent: Record<string, string[]>;             // grouped by intent type
  totalCount: number;
}

// ── Core engine ─────────────────────────────────────────────────────────────

/**
 * Run a batch of prefix+keyword queries through Google Autocomplete
 * and return results grouped by the prefix.
 */
async function batchQueryGroup(
  prefixes: string[],
  keyword: string,
  lang: string,
  country: string
): Promise<Record<string, string[]>> {
  const grouped: Record<string, string[]> = {};

  for (const prefix of prefixes) {
    const query = `${prefix} ${keyword}`;
    try {
      const suggestions = await fetchAutocompleteSuggestions({ keyword: query, lang, country });
      const relevant = suggestions.filter((s) =>
        s.toLowerCase().includes(keyword.toLowerCase())
      );
      if (relevant.length > 0) {
        grouped[prefix] = relevant;
      }
    } catch {
      // Skip failed suggestions gracefully
    }
  }

  return grouped;
}

/**
 * Generate Answer-the-Public style keyword data for a seed keyword.
 *
 * This engine:
 * 1. Queries Google Autocomplete with every question prefix ("what is X", "how to X", etc.)
 * 2. Queries with every preposition ("X for", "X without", etc.)
 * 3. Queries comparison phrases ("X vs", "X alternative", etc.)
 * 4. Runs A–Z expansion to find alphabetical long-tails
 * 5. Queries commercial + informational intent modifiers
 */
export async function generateAtpKeywords(options: AtpOptions): Promise<AtpResult> {
  const keyword = options.keyword.trim().toLowerCase();
  const lang = options.lang ?? "en";
  const country = options.country ?? "us";
  const include = options.include ?? ["questions", "prepositions", "comparisons", "alphabetical", "intent"];

  const cacheKey = buildCacheKey("atp", { keyword, lang, country, include: include.join(",") });
  const cached = cacheGet<AtpResult>(cacheKey);
  if (cached) return cached;

  const result: AtpResult = {
    keyword,
    questions: {},
    prepositions: {},
    comparisons: [],
    alphabetical: [],
    intent: {},
    totalCount: 0,
  };

  // ── 1. Questions ──────────────────────────────────────────────────────────
  if (include.includes("questions")) {
    for (const [questionWord, prefixes] of Object.entries(QUESTION_PREFIXES)) {
      const grouped = await batchQueryGroup(prefixes, keyword, lang, country);
      const allForWord: string[] = [];
      for (const suggestions of Object.values(grouped)) {
        allForWord.push(...suggestions);
      }
      const cleaned = cleanKeywords(allForWord);
      if (cleaned.length > 0) {
        result.questions[questionWord] = cleaned;
      }
    }
  }

  // ── 2. Prepositions ───────────────────────────────────────────────────────
  if (include.includes("prepositions")) {
    const prepPrefixes = PREPOSITIONS.map((p) => `${keyword} ${p}`);
    for (const prep of PREPOSITIONS) {
      try {
        const suggestions = await fetchAutocompleteSuggestions({
          keyword: `${keyword} ${prep}`,
          lang,
          country,
        });
        const relevant = suggestions.filter((s) =>
          s.toLowerCase().includes(keyword.toLowerCase())
        );
        if (relevant.length > 0) {
          result.prepositions[prep] = cleanKeywords(relevant);
        }
      } catch {
        // Skip failed suggestions gracefully
      }
    }
    void prepPrefixes; // suppress unused warning
  }

  // ── 3. Comparisons ────────────────────────────────────────────────────────
  if (include.includes("comparisons")) {
    const compResults: string[] = [];
    for (const mod of COMPARISON_MODIFIERS) {
      try {
        const suggestions = await fetchAutocompleteSuggestions({
          keyword: `${keyword} ${mod}`,
          lang,
          country,
        });
        compResults.push(...suggestions);
      } catch {
        // Skip failed suggestions gracefully
      }
    }
    result.comparisons = cleanKeywords(compResults);
  }

  // ── 4. Alphabetical ───────────────────────────────────────────────────────
  if (include.includes("alphabetical")) {
    const alphResults: string[] = [];
    const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
    for (const letter of alphabet) {
      try {
        const suggestions = await fetchAutocompleteSuggestions({
          keyword: `${keyword} ${letter}`,
          lang,
          country,
        });
        alphResults.push(...suggestions);
      } catch {
        // Skip failed suggestions gracefully
      }
    }
    result.alphabetical = cleanKeywords(alphResults);
  }

  // ── 5. Intent-based modifiers ─────────────────────────────────────────────
  if (include.includes("intent")) {
    for (const [intentType, modifiers] of Object.entries(INTENT_MODIFIERS)) {
      const intentResults: string[] = [];
      for (const mod of modifiers) {
        if (mod.includes("[city]")) continue; // skip placeholder modifiers
        try {
          const suggestions = await fetchAutocompleteSuggestions({
            keyword: `${mod} ${keyword}`,
            lang,
            country,
          });
          intentResults.push(...suggestions);
          // Also try modifier after keyword
          const suggestions2 = await fetchAutocompleteSuggestions({
            keyword: `${keyword} ${mod}`,
            lang,
            country,
          });
          intentResults.push(...suggestions2);
        } catch {
          // Skip failed suggestions gracefully
        }
      }
      const cleaned = cleanKeywords(intentResults);
      if (cleaned.length > 0) {
        result.intent[intentType] = cleaned;
      }
    }
  }

  // ── Compute total count ────────────────────────────────────────────────────
  const questionCount = Object.values(result.questions).flat().length;
  const prepCount = Object.values(result.prepositions).flat().length;
  const compCount = result.comparisons.length;
  const alphCount = result.alphabetical.length;
  const intentCount = Object.values(result.intent).flat().length;
  result.totalCount = questionCount + prepCount + compCount + alphCount + intentCount;

  cacheSet(cacheKey, result, 3600);
  return result;
}
