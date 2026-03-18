// ─────────────────────────────────────────────
//  config.ts  –  Central configuration
// ─────────────────────────────────────────────
import * as dotenv from "dotenv";
dotenv.config();

export const config = {
  // Google Autocomplete – no API key required
  googleAutocomplete: {
    baseUrl: "https://suggestqueries.google.com/complete/search",
    defaultLang: "en",
    defaultCountry: "us",
    maxSuggestions: 10,
  },

  // Google Trends – uses unofficial JSON endpoint (no key required)
  googleTrends: {
    baseUrl: "https://trends.google.com/trends/api",
    defaultGeo: "",       // "" = worldwide
    defaultTimeframe: "today 12-m",
  },

  // YouTube Autocomplete – no API key required
  youtube: {
    suggestUrl: "https://suggestqueries.google.com/complete/search",
  },

  // Amazon Product Suggest – no API key required
  amazon: {
    suggestUrl: "https://completion.amazon.com/search/complete",
    defaultMarketplace: "1",   // 1 = amazon.com
  },

  // Pinterest Autocomplete – no API key required (uses public resource endpoint)
  pinterest: {
    suggestUrl: "https://www.pinterest.com/resource/SearchBoxSuggestionsResource/get/",
  },

  // Wikipedia OpenSearch API – no API key required
  wikipedia: {
    apiUrl: "https://en.wikipedia.org/w/api.php",
    searchUrl: "https://en.wikipedia.org/w/rest.php/v1/search/page",
  },

  // Gemini AI – requires GEMINI_API_KEY in .env
  gemini: {
    apiKey: process.env["GEMINI_API_KEY"] ?? "",
    model: "gemini-1.5-flash",   // free tier: 15 RPM, 1500 RPD
    maxOutputTokens: 2048,
  },

  // Cache settings
  cache: {
    stdTTL: 3600,         // 1 hour default TTL (seconds)
    checkperiod: 600,     // check for expired keys every 10 min
    maxKeys: 1000,
  },

  // Rate limit settings (requests per second per provider)
  rateLimits: {
    googleAutocomplete: { minTime: 500,  maxConcurrent: 2 },  // 2 req/s
    googleTrends:       { minTime: 2000, maxConcurrent: 1 },  // 1 req/2s (strict)
    youtube:            { minTime: 500,  maxConcurrent: 2 },  // same as google suggest
    amazon:             { minTime: 800,  maxConcurrent: 2 },
    pinterest:          { minTime: 1000, maxConcurrent: 1 },
    wikipedia:          { minTime: 500,  maxConcurrent: 3 },
    gemini:             { minTime: 4500, maxConcurrent: 1 },  // free tier: 15 RPM = 1 req/4s
  },

  // HTTP timeout (ms)
  httpTimeout: 10000,

  // User agent to use for requests
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};
