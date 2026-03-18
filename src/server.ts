// ─────────────────────────────────────────────
//  server.ts  –  MCP Server setup & tool registration
// ─────────────────────────────────────────────
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  KeywordSuggestionsSchema,
  handleKeywordSuggestions,
} from "./tools/suggestions";
import {
  KeywordTrendsSchema,
  TrendingSearchesSchema,
  handleKeywordTrends,
  handleTrendingSearches,
} from "./tools/trends";
import {
  QuestionKeywordsSchema,
  handleQuestionKeywords,
} from "./tools/questions";
import {
  LongTailKeywordsSchema,
  handleLongTailKeywords,
} from "./tools/longTail";
import {
  FullResearchSchema,
  handleFullResearch,
} from "./tools/fullResearch";
import {
  MultiSuggestSchema,
  handleMultiSuggest,
} from "./tools/multiSuggest";
import {
  WikiResearchSchema,
  handleWikiResearch,
} from "./tools/wikiResearch";
import {
  KeywordIntentSchema,
  BulkKeywordIntentSchema,
  KeywordClustersSchema,
  ContentBriefSchema,
  handleKeywordIntent,
  handleBulkKeywordIntent,
  handleKeywordClusters,
  handleContentBrief,
} from "./tools/aiAnalysis";

// ── Helper: safely serialize results ──────────────────────────────────────

function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ── Server factory ─────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keywords-mcp",
    version: "1.0.0",
  });

  // ── Tool: keyword_suggestions ────────────────────────────────────────────
  server.tool(
    "keyword_suggestions",
    "Get autocomplete keyword suggestions from Google for a seed keyword. Use mode='expanded' to get A–Z alphabet expansion (100+ suggestions).",
    KeywordSuggestionsSchema.shape,
    async (input) => {
      const parsed = KeywordSuggestionsSchema.parse(input);
      const result = await handleKeywordSuggestions(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: keyword_trends ─────────────────────────────────────────────────
  server.tool(
    "keyword_trends",
    "Fetch Google Trends data for a keyword: interest over time (0–100 score), related queries, and related topics. Helps identify if a keyword is rising, stable, or declining.",
    KeywordTrendsSchema.shape,
    async (input) => {
      const parsed = KeywordTrendsSchema.parse(input);
      const result = await handleKeywordTrends(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: trending_searches ──────────────────────────────────────────────
  server.tool(
    "trending_searches",
    "Get today's trending search topics from Google Trends for a given country. Returns real-time trending queries.",
    TrendingSearchesSchema.shape,
    async (input) => {
      const parsed = TrendingSearchesSchema.parse(input);
      const result = await handleTrendingSearches(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: question_keywords ───────────────────────────────────────────────
  server.tool(
    "question_keywords",
    "Generate question-style keyword variations for a seed keyword. Returns questions grouped by question word (what, why, how, when, where, who, which). Uses Google Autocomplete to surface only real search queries.",
    QuestionKeywordsSchema.shape,
    async (input) => {
      const parsed = QuestionKeywordsSchema.parse(input);
      const result = await handleQuestionKeywords(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: long_tail_keywords ──────────────────────────────────────────────
  server.tool(
    "long_tail_keywords",
    "Generate long-tail keyword variations using prepositions, comparison phrases, A–Z expansion, and commercial/informational intent modifiers. All suggestions are validated through Google Autocomplete.",
    LongTailKeywordsSchema.shape,
    async (input) => {
      const parsed = LongTailKeywordsSchema.parse(input);
      const result = await handleLongTailKeywords(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: full_keyword_research ───────────────────────────────────────────
  server.tool(
    "full_keyword_research",
    "Run a complete keyword research report for a seed keyword in one call. Combines autocomplete suggestions, A–Z expansion, question keywords, long-tail variations, and optionally Google Trends data into a single unified report.",
    FullResearchSchema.shape,
    async (input) => {
      const parsed = FullResearchSchema.parse(input);
      const result = await handleFullResearch(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: multi_platform_suggestions ─────────────────────────────────────
  server.tool(
    "multi_platform_suggestions",
    "Fetch keyword suggestions from multiple platforms simultaneously: Google, YouTube, Amazon, and Pinterest. Shows how the same topic is searched differently across platforms. Use mode='expanded' for A–Z coverage per platform.",
    MultiSuggestSchema.shape,
    async (input) => {
      const parsed = MultiSuggestSchema.parse(input);
      const result = await handleMultiSuggest(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: wiki_keyword_context ────────────────────────────────────────────
  server.tool(
    "wiki_keyword_context",
    "Use Wikipedia to get semantic context for a keyword: related topics, page categories (great for topic clusters), key phrases, and how Wikipedia officially names this topic. Ideal for LSI keywords and content planning.",
    WikiResearchSchema.shape,
    async (input) => {
      const parsed = WikiResearchSchema.parse(input);
      const result = await handleWikiResearch(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: keyword_intent (AI) ─────────────────────────────────────────────
  server.tool(
    "keyword_intent",
    "Use Gemini AI to classify the search intent of a keyword: informational, commercial, transactional, navigational, local, or mixed. Requires GEMINI_API_KEY in .env.",
    KeywordIntentSchema.shape,
    async (input) => {
      const parsed = KeywordIntentSchema.parse(input);
      const result = await handleKeywordIntent(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: bulk_keyword_intent (AI) ────────────────────────────────────────
  server.tool(
    "bulk_keyword_intent",
    "Use Gemini AI to classify search intent for up to 80 keywords at once. Returns each keyword classified as informational/commercial/transactional/navigational/local/mixed, with a breakdown by intent group. Requires GEMINI_API_KEY.",
    BulkKeywordIntentSchema.shape,
    async (input) => {
      const parsed = BulkKeywordIntentSchema.parse(input);
      const result = await handleBulkKeywordIntent(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: keyword_clusters (AI) ───────────────────────────────────────────
  server.tool(
    "keyword_clusters",
    "Use Gemini AI to group a list of keywords into semantic topic clusters for content planning. Returns 4–8 clusters each with a cluster name, suggested pillar topic, and assigned keywords. Requires GEMINI_API_KEY.",
    KeywordClustersSchema.shape,
    async (input) => {
      const parsed = KeywordClustersSchema.parse(input);
      const result = await handleKeywordClusters(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  // ── Tool: content_brief (AI) ──────────────────────────────────────────────
  server.tool(
    "content_brief",
    "Use Gemini AI to generate a full SEO content brief for a target keyword. Returns a title, meta description, target audience, H2 section outline with key points, and FAQ questions. Requires GEMINI_API_KEY.",
    ContentBriefSchema.shape,
    async (input) => {
      const parsed = ContentBriefSchema.parse(input);
      const result = await handleContentBrief(parsed);
      return { content: [{ type: "text", text: toText(result) }] };
    }
  );

  return server;
}

// Export schema shapes for testing
export {
  KeywordSuggestionsSchema,
  KeywordTrendsSchema,
  TrendingSearchesSchema,
  QuestionKeywordsSchema,
  LongTailKeywordsSchema,
  FullResearchSchema,
  MultiSuggestSchema,
  WikiResearchSchema,
  KeywordIntentSchema,
  BulkKeywordIntentSchema,
  KeywordClustersSchema,
  ContentBriefSchema,
};

// Export void to satisfy TypeScript
export { z };
