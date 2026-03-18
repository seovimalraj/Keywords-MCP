// ─────────────────────────────────────────────
//  tools/aiAnalysis.ts
//  MCP Tools powered by Gemini AI:
//    - keyword_intent        : classify a single keyword's search intent
//    - bulk_keyword_intent   : classify many keywords at once
//    - keyword_clusters      : group keywords into semantic topic clusters
//    - content_brief         : generate a full SEO content brief
//
//  Requires: GEMINI_API_KEY in .env
// ─────────────────────────────────────────────
import { z } from "zod";
import {
  classifyKeywordIntent,
  classifyBulkKeywordIntents,
  clusterKeywords,
  generateContentBrief,
} from "../providers/gemini";

// ── Schemas ───────────────────────────────────────────────────────────────

export const KeywordIntentSchema = z.object({
  keyword: z.string().min(1).describe("The single keyword to classify intent for"),
});

export const BulkKeywordIntentSchema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(80)
    .describe("List of keywords to classify (max 80 per call)"),
});

export const KeywordClustersSchema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(2)
    .max(80)
    .describe("List of keywords to group into semantic clusters"),
  seedTopic: z
    .string()
    .min(1)
    .describe("The main topic these keywords relate to (used as context for clustering)"),
});

export const ContentBriefSchema = z.object({
  primaryKeyword: z
    .string()
    .min(1)
    .describe("The primary target keyword for the content piece"),
  supportingKeywords: z
    .array(z.string())
    .default([])
    .describe("Supporting / secondary keywords to include in the brief (max 30)"),
});

// ── Input types ───────────────────────────────────────────────────────────

export type KeywordIntentInput = z.infer<typeof KeywordIntentSchema>;
export type BulkKeywordIntentInput = z.infer<typeof BulkKeywordIntentSchema>;
export type KeywordClustersInput = z.infer<typeof KeywordClustersSchema>;
export type ContentBriefInput = z.infer<typeof ContentBriefSchema>;

// ── Handlers ──────────────────────────────────────────────────────────────

export async function handleKeywordIntent(input: KeywordIntentInput) {
  return classifyKeywordIntent(input.keyword);
}

export async function handleBulkKeywordIntent(input: BulkKeywordIntentInput) {
  const results = await classifyBulkKeywordIntents(input.keywords);
  const intentGroups: Record<string, string[]> = {};

  for (const r of results) {
    if (!intentGroups[r.intent]) intentGroups[r.intent] = [];
    intentGroups[r.intent].push(r.keyword);
  }

  return {
    totalKeywords: results.length,
    intentBreakdown: intentGroups,
    details: results,
  };
}

export async function handleKeywordClusters(input: KeywordClustersInput) {
  const clusters = await clusterKeywords(input.keywords, input.seedTopic);
  return {
    seedTopic: input.seedTopic,
    totalClusters: clusters.length,
    totalKeywordsAssigned: clusters.reduce((sum, c) => sum + c.keywords.length, 0),
    clusters,
  };
}

export async function handleContentBrief(input: ContentBriefInput) {
  return generateContentBrief(input.primaryKeyword, input.supportingKeywords);
}
