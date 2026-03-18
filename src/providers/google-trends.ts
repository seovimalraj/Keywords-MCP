// ─────────────────────────────────────────────
//  providers/google-trends.ts
//  Uses Google Trends unofficial API (no key)
//  Parses the JSON responses from trends.google.com
// ─────────────────────────────────────────────
import axios from "axios";
import { config } from "../config";
import { throttle } from "../utils/rateLimiter";
import { buildCacheKey, cacheGet, cacheSet } from "../utils/cache";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TrendOptions {
  keyword: string;
  geo?: string;         // e.g. "US", "GB", "" for worldwide
  timeframe?: string;   // e.g. "today 12-m", "today 5-y", "now 7-d"
}

export interface TrendDataPoint {
  date: string;
  value: number;        // 0–100 relative interest
}

export interface RelatedQuery {
  query: string;
  value: string;        // "100" = top, or "+500%" = rising
  type: "top" | "rising";
}

export interface RelatedTopic {
  topic: string;
  value: string;
  type: "top" | "rising";
}

export interface TrendsResult {
  keyword: string;
  geo: string;
  timeframe: string;
  interestOverTime: TrendDataPoint[];
  relatedQueries: RelatedQuery[];
  relatedTopics: RelatedTopic[];
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Google Trends API returns a non-standard response prefixed with ")]}'\n".
 * We need to strip that prefix before parsing JSON.
 */
function parseGoogleTrendsResponse(raw: string): unknown {
  const cleaned = raw.replace(/^\)\]\}'\n/, "");
  return JSON.parse(cleaned);
}

/**
 * Step 1: Get the "token" required for subsequent Trends API calls.
 * Google requires a token fetched from /explore before hitting widget APIs.
 */
async function fetchExploreToken(
  keyword: string,
  geo: string,
  timeframe: string
): Promise<{ token: string; timelineWidget: unknown; relatedQueriesWidget: unknown; relatedTopicsWidget: unknown }> {
  const comparisonItem = JSON.stringify([
    {
      keyword,
      geo,
      time: timeframe,
    },
  ]);

  const response = await axios.get(`${config.googleTrends.baseUrl}/explore`, {
    params: {
      hl: "en-US",
      tz: "-330",
      req: comparisonItem,
    },
    headers: {
      "User-Agent": config.userAgent,
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: config.httpTimeout,
  });

  const data = parseGoogleTrendsResponse(response.data as string) as {
    widgets: Array<{ id: string; token: string; request: unknown }>;
  };

  const widgets = data?.widgets ?? [];

  const timelineWidget = widgets.find((w) => w.id === "TIMESERIES") ?? null;
  const relatedQueriesWidget = widgets.find((w) => w.id === "RELATED_QUERIES") ?? null;
  const relatedTopicsWidget = widgets.find((w) => w.id === "RELATED_TOPICS") ?? null;

  const token = (timelineWidget as { token?: string })?.token ?? "";

  return { token, timelineWidget, relatedQueriesWidget, relatedTopicsWidget };
}

/**
 * Step 2: Fetch interest-over-time data using the timeline widget token.
 */
async function fetchInterestOverTime(
  widget: unknown
): Promise<TrendDataPoint[]> {
  const w = widget as { token?: string; request?: unknown };
  if (!w || !w.token) return [];

  const response = await axios.get(`${config.googleTrends.baseUrl}/multiline`, {
    params: {
      hl: "en-US",
      tz: "-330",
      req: JSON.stringify(w.request),
      token: w.token,
      csv: false,
    },
    headers: {
      "User-Agent": config.userAgent,
    },
    timeout: config.httpTimeout,
  });

  const data = parseGoogleTrendsResponse(response.data as string) as {
    default?: { timelineData?: Array<{ formattedTime?: string; value?: number[] }> };
  };

  const timeline = data?.default?.timelineData ?? [];

  return timeline.map((point) => ({
    date: point.formattedTime ?? "",
    value: Array.isArray(point.value) ? (point.value[0] ?? 0) : 0,
  }));
}

/**
 * Step 3: Fetch related queries using the related queries widget.
 */
async function fetchRelatedQueries(widget: unknown): Promise<RelatedQuery[]> {
  const w = widget as { token?: string; request?: unknown };
  if (!w || !w.token) return [];

  const response = await axios.get(`${config.googleTrends.baseUrl}/widgetdata/relatedsearches`, {
    params: {
      hl: "en-US",
      tz: "-330",
      req: JSON.stringify(w.request),
      token: w.token,
    },
    headers: {
      "User-Agent": config.userAgent,
    },
    timeout: config.httpTimeout,
  });

  const data = parseGoogleTrendsResponse(response.data as string) as {
    default?: {
      rankedList?: Array<{
        rankedKeyword?: Array<{
          query?: string;
          value?: number;
          formattedValue?: string;
          link?: number;
        }>;
      }>;
    };
  };

  const rankedList = data?.default?.rankedList ?? [];
  const results: RelatedQuery[] = [];

  // First list = top queries, second list = rising queries
  const topList = rankedList[0]?.rankedKeyword ?? [];
  const risingList = rankedList[1]?.rankedKeyword ?? [];

  for (const item of topList) {
    results.push({
      query: item.query ?? "",
      value: String(item.value ?? 0),
      type: "top",
    });
  }

  for (const item of risingList) {
    results.push({
      query: item.query ?? "",
      value: item.formattedValue ?? String(item.value ?? 0),
      type: "rising",
    });
  }

  return results.filter((r) => r.query.length > 0);
}

/**
 * Step 4: Fetch related topics using the related topics widget.
 */
async function fetchRelatedTopics(widget: unknown): Promise<RelatedTopic[]> {
  const w = widget as { token?: string; request?: unknown };
  if (!w || !w.token) return [];

  const response = await axios.get(`${config.googleTrends.baseUrl}/widgetdata/relatedsearches`, {
    params: {
      hl: "en-US",
      tz: "-330",
      req: JSON.stringify(w.request),
      token: w.token,
    },
    headers: {
      "User-Agent": config.userAgent,
    },
    timeout: config.httpTimeout,
  });

  const data = parseGoogleTrendsResponse(response.data as string) as {
    default?: {
      rankedList?: Array<{
        rankedKeyword?: Array<{
          topic?: { title?: string };
          value?: number;
          formattedValue?: string;
        }>;
      }>;
    };
  };

  const rankedList = data?.default?.rankedList ?? [];
  const results: RelatedTopic[] = [];

  const topList = rankedList[0]?.rankedKeyword ?? [];
  const risingList = rankedList[1]?.rankedKeyword ?? [];

  for (const item of topList) {
    results.push({
      topic: item.topic?.title ?? "",
      value: String(item.value ?? 0),
      type: "top",
    });
  }

  for (const item of risingList) {
    results.push({
      topic: item.topic?.title ?? "",
      value: item.formattedValue ?? String(item.value ?? 0),
      type: "rising",
    });
  }

  return results.filter((r) => r.topic.length > 0);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch full Google Trends data for a keyword including:
 * - Interest over time (0–100 score per week/month)
 * - Related queries (top + rising)
 * - Related topics (top + rising)
 */
export async function fetchTrends(options: TrendOptions): Promise<TrendsResult> {
  const geo = options.geo ?? config.googleTrends.defaultGeo;
  const timeframe = options.timeframe ?? config.googleTrends.defaultTimeframe;
  const keyword = options.keyword.trim();

  const cacheKey = buildCacheKey("trends", { keyword, geo, timeframe });
  const cached = cacheGet<TrendsResult>(cacheKey);
  if (cached) return cached;

  const result = await throttle("googleTrends", async () => {
    // Step 1 – get widgets and tokens
    const { timelineWidget, relatedQueriesWidget, relatedTopicsWidget } =
      await fetchExploreToken(keyword, geo, timeframe);

    // Step 2 – parallel fetch of all three data types
    const [interestOverTime, relatedQueries, relatedTopics] = await Promise.all([
      fetchInterestOverTime(timelineWidget),
      fetchRelatedQueries(relatedQueriesWidget),
      fetchRelatedTopics(relatedTopicsWidget),
    ]);

    return {
      keyword,
      geo,
      timeframe,
      interestOverTime,
      relatedQueries,
      relatedTopics,
    } as TrendsResult;
  });

  // Cache trends for 1 hour
  cacheSet(cacheKey, result, 3600);
  return result;
}

/**
 * Fetch trending searches for a given country code (real-time trending topics).
 * Returns list of trending search terms.
 */
export async function fetchTrendingSearches(geo: string = "US"): Promise<string[]> {
  const cacheKey = buildCacheKey("trending_searches", { geo });
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const results = await throttle("googleTrends", async () => {
    const response = await axios.get(
      `${config.googleTrends.baseUrl}/dailytrends`,
      {
        params: {
          hl: "en-US",
          tz: "-330",
          geo,
          ns: 15,
        },
        headers: { "User-Agent": config.userAgent },
        timeout: config.httpTimeout,
      }
    );

    const data = parseGoogleTrendsResponse(response.data as string) as {
      default?: {
        trendingSearchesDays?: Array<{
          trendingSearches?: Array<{
            title?: { query?: string };
            relatedQueries?: Array<{ query?: string }>;
          }>;
        }>;
      };
    };

    const days = data?.default?.trendingSearchesDays ?? [];
    const terms: string[] = [];

    for (const day of days) {
      for (const search of day.trendingSearches ?? []) {
        if (search.title?.query) terms.push(search.title.query);
        for (const related of search.relatedQueries ?? []) {
          if (related.query) terms.push(related.query);
        }
      }
    }

    return [...new Set(terms)];
  });

  // Cache trending for 30 minutes (it changes throughout the day)
  cacheSet(cacheKey, results, 1800);
  return results;
}
