// ─────────────────────────────────────────────
//  tools/trends.ts
//  MCP Tool: keyword_trends
//  Returns Google Trends data: interest over time, related queries & topics
// ─────────────────────────────────────────────
import { z } from "zod";
import { fetchTrends, fetchTrendingSearches, TrendsResult } from "../providers/google-trends";

// ── Input schemas ──────────────────────────────────────────────────────────

export const KeywordTrendsSchema = z.object({
  keyword: z.string().min(1).describe("The keyword to fetch trend data for"),
  geo: z
    .string()
    .default("")
    .describe(
      "Geographic region code (e.g. 'US', 'GB', 'IN'). Leave empty for worldwide data."
    ),
  timeframe: z
    .string()
    .default("today 12-m")
    .describe(
      "Time range for trend data. Options: 'now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'"
    ),
});

export type KeywordTrendsInput = z.infer<typeof KeywordTrendsSchema>;

export const TrendingSearchesSchema = z.object({
  geo: z
    .string()
    .default("US")
    .describe("Country code for trending searches (e.g. 'US', 'GB', 'IN')"),
});

export type TrendingSearchesInput = z.infer<typeof TrendingSearchesSchema>;

// ── Output types ───────────────────────────────────────────────────────────

export interface KeywordTrendsResult extends TrendsResult {
  summary: {
    peakDate: string;
    peakValue: number;
    averageInterest: number;
    trend: "rising" | "falling" | "stable" | "insufficient_data";
  };
}

export interface TrendingSearchesResult {
  geo: string;
  count: number;
  trending: string[];
}

// ── Handlers ───────────────────────────────────────────────────────────────

export async function handleKeywordTrends(
  input: KeywordTrendsInput
): Promise<KeywordTrendsResult> {
  const data = await fetchTrends({
    keyword: input.keyword,
    geo: input.geo,
    timeframe: input.timeframe,
  });

  // ── Compute summary ──────────────────────────────────────────────────────
  const points = data.interestOverTime;
  let peakDate = "";
  let peakValue = 0;
  let totalValue = 0;

  for (const point of points) {
    totalValue += point.value;
    if (point.value > peakValue) {
      peakValue = point.value;
      peakDate = point.date;
    }
  }

  const averageInterest =
    points.length > 0 ? Math.round(totalValue / points.length) : 0;

  // Trend direction based on comparing first third vs last third of data
  let trend: KeywordTrendsResult["summary"]["trend"] = "insufficient_data";
  if (points.length >= 6) {
    const third = Math.floor(points.length / 3);
    const firstAvg =
      points.slice(0, third).reduce((s, p) => s + p.value, 0) / third;
    const lastAvg =
      points.slice(-third).reduce((s, p) => s + p.value, 0) / third;
    const diff = lastAvg - firstAvg;
    if (diff > 5) trend = "rising";
    else if (diff < -5) trend = "falling";
    else trend = "stable";
  }

  return {
    ...data,
    summary: { peakDate, peakValue, averageInterest, trend },
  };
}

export async function handleTrendingSearches(
  input: TrendingSearchesInput
): Promise<TrendingSearchesResult> {
  const trending = await fetchTrendingSearches(input.geo);
  return {
    geo: input.geo,
    count: trending.length,
    trending,
  };
}
