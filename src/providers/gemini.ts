// ─────────────────────────────────────────────
//  providers/gemini.ts
//  Uses Google Gemini 1.5 Flash API (free tier: 15 RPM, 1500 RPD)
//  Requires: GEMINI_API_KEY in .env
//
//  Capabilities:
//    - Keyword intent classification (informational/commercial/transactional/navigational)
//    - Topic cluster generation
//    - Content brief outline from keyword list
//    - Related keyword suggestions (semantic, not autocomplete)
// ─────────────────────────────────────────────
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

// ── Types ──────────────────────────────────────────────────────────────────

export type SearchIntent =
  | "informational"    // user wants to learn
  | "commercial"       // user is comparing/researching before buying
  | "transactional"    // user wants to buy/sign up/download
  | "navigational"     // user wants to find a specific site/page
  | "local"            // user wants a nearby service/place
  | "mixed";           // multiple intents detected

export interface KeywordIntentResult {
  keyword: string;
  intent: SearchIntent;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface TopicCluster {
  clusterName: string;
  pillarTopic: string;
  keywords: string[];
}

export interface ContentBriefSection {
  heading: string;
  keyPoints: string[];
  targetKeywords: string[];
}

export interface ContentBrief {
  title: string;
  metaDescription: string;
  targetAudience: string;
  primaryKeyword: string;
  sections: ContentBriefSection[];
  faqQuestions: string[];
}

// ── Gemini client factory ──────────────────────────────────────────────────

let geminiClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!config.gemini.apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured. Add it to your .env file to use AI features."
      );
    }
    geminiClient = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return geminiClient;
}

async function callGemini(prompt: string): Promise<string> {
  return throttle("gemini", async () => {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: {
        maxOutputTokens: config.gemini.maxOutputTokens,
        temperature: 0.2,    // low temperature for structured / factual outputs
      },
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

/**
 * Parse JSON from Gemini response, stripping markdown code fences if present.
 */
function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Classify the search intent of a single keyword using Gemini.
 */
export async function classifyKeywordIntent(
  keyword: string
): Promise<KeywordIntentResult> {
  const cacheKey = buildCacheKey("gemini_intent", { keyword });
  const cached = cacheGet<KeywordIntentResult>(cacheKey);
  if (cached) return cached;

  const prompt = `Classify the search intent of this keyword for SEO purposes.

Keyword: "${keyword}"

Return ONLY a JSON object in this exact format:
{
  "keyword": "${keyword}",
  "intent": "informational|commercial|transactional|navigational|local|mixed",
  "confidence": "high|medium|low",
  "reasoning": "one sentence explanation"
}

Intent definitions:
- informational: user wants to learn (how to, what is, why, guide, tutorial)
- commercial: user is researching/comparing before buying (best, review, vs, top)
- transactional: user wants to take action (buy, price, order, download, sign up)
- navigational: user wants a specific site (brand name + login/website)
- local: user wants a nearby place/service (near me, in [city])
- mixed: multiple clear intents detected`;

  const raw = await callGemini(prompt);
  const result = parseJsonResponse<KeywordIntentResult>(raw);

  cacheSet(cacheKey, result, 86400); // intent doesn't change much, cache 24h
  return result;
}

/**
 * Classify intent for multiple keywords in a single Gemini call.
 * More efficient than calling classifyKeywordIntent one by one.
 */
export async function classifyBulkKeywordIntents(
  keywords: string[]
): Promise<KeywordIntentResult[]> {
  if (keywords.length === 0) return [];

  const cacheKey = buildCacheKey("gemini_bulk_intent", {
    keywords: [...keywords].sort().join("|"),
  });
  const cached = cacheGet<KeywordIntentResult[]>(cacheKey);
  if (cached) return cached;

  // Gemini can handle 50+ keywords per call efficiently
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += 40) {
    chunks.push(keywords.slice(i, i + 40));
  }

  const allResults: KeywordIntentResult[] = [];

  for (const chunk of chunks) {
    const keywordList = chunk.map((k, i) => `${i + 1}. "${k}"`).join("\n");
    const prompt = `Classify the search intent of each keyword below for SEO.

Keywords:
${keywordList}

Return ONLY a JSON array, one object per keyword:
[
  {
    "keyword": "...",
    "intent": "informational|commercial|transactional|navigational|local|mixed",
    "confidence": "high|medium|low",
    "reasoning": "brief one-line explanation"
  }
]

Intent definitions:
- informational: wants to learn (how to, what is, why, guide, tutorial)
- commercial: researching before buying (best, review, vs, top, comparison)
- transactional: wants to take action (buy, price, order, download, sign up, coupon)
- navigational: wants a specific site/brand
- local: wants a nearby service (near me, in [city])
- mixed: multiple clear intents`;

    const raw = await callGemini(prompt);
    const results = parseJsonResponse<KeywordIntentResult[]>(raw);
    allResults.push(...results);
  }

  cacheSet(cacheKey, allResults, 86400);
  return allResults;
}

/**
 * Group a list of keywords into semantic topic clusters.
 * Returns cluster names, pillar topics, and assigned keywords.
 */
export async function clusterKeywords(
  keywords: string[],
  seedTopic: string
): Promise<TopicCluster[]> {
  if (keywords.length === 0) return [];

  const cacheKey = buildCacheKey("gemini_cluster", {
    seedTopic,
    keywords: [...keywords].sort().join("|"),
  });
  const cached = cacheGet<TopicCluster[]>(cacheKey);
  if (cached) return cached;

  const keywordList = keywords.slice(0, 80).join('", "');
  const prompt = `Group the following keywords into semantic topic clusters for content planning.
Seed topic: "${seedTopic}"

Keywords: ["${keywordList}"]

Create 4–8 distinct clusters. Each cluster should have:
- A clear cluster name (the overarching topic)
- A pillar topic (the main article/page topic for this cluster)
- The keywords that belong to this cluster

Return ONLY a JSON array:
[
  {
    "clusterName": "cluster name",
    "pillarTopic": "suggested main content topic for this cluster",
    "keywords": ["keyword1", "keyword2", ...]
  }
]`;

  const raw = await callGemini(prompt);
  const result = parseJsonResponse<TopicCluster[]>(raw);

  cacheSet(cacheKey, result, 86400);
  return result;
}

/**
 * Generate a content brief (outline) for a target keyword.
 * Returns a structured H2/H3 outline with target keywords per section & FAQ.
 */
export async function generateContentBrief(
  primaryKeyword: string,
  supportingKeywords: string[]
): Promise<ContentBrief> {
  const cacheKey = buildCacheKey("gemini_brief", {
    primaryKeyword,
    supporting: [...supportingKeywords].sort().join("|"),
  });
  const cached = cacheGet<ContentBrief>(cacheKey);
  if (cached) return cached;

  const kwList = supportingKeywords.slice(0, 30).join('", "');
  const prompt = `Create an SEO content brief for the primary keyword below.

Primary keyword: "${primaryKeyword}"
Supporting keywords: ["${kwList}"]

The brief must include:
- Compelling title tag (max 60 chars)
- Meta description (max 155 chars)
- Target audience description
- 5–8 H2 sections, each with 3–5 key points and 2–3 target keywords
- 5 FAQ questions (People Also Ask style)

Return ONLY a JSON object:
{
  "title": "...",
  "metaDescription": "...",
  "targetAudience": "...",
  "primaryKeyword": "${primaryKeyword}",
  "sections": [
    {
      "heading": "H2 heading",
      "keyPoints": ["point1", "point2", "point3"],
      "targetKeywords": ["kw1", "kw2"]
    }
  ],
  "faqQuestions": ["question1?", "question2?", ...]
}`;

  const raw = await callGemini(prompt);
  const result = parseJsonResponse<ContentBrief>(raw);

  cacheSet(cacheKey, result, 86400);
  return result;
}
