// ─────────────────────────────────────────────
//  api/index.ts  –  Landing page / info endpoint
//  Returns info about the MCP server and available tools
// ─────────────────────────────────────────────
import type { IncomingMessage, ServerResponse } from "http";

const INFO = {
  name: "Keywords MCP",
  version: "1.0.0",
  description:
    "MCP server for keyword research. Powered by Google Autocomplete, Google Trends, YouTube, Amazon, Pinterest, Wikipedia, and Gemini AI.",
  mcpEndpoint: "/api/mcp",
  transport: "Streamable HTTP (stateless)",
  tools: [
    {
      name: "keyword_suggestions",
      description: "Google Autocomplete suggestions (basic or A–Z expanded)",
      requiresKey: false,
    },
    {
      name: "keyword_trends",
      description: "Google Trends data – interest over time, related queries & topics",
      requiresKey: false,
    },
    {
      name: "trending_searches",
      description: "Today's trending searches from Google Trends by country",
      requiresKey: false,
    },
    {
      name: "question_keywords",
      description: "Answer-the-Public style: questions grouped by what/why/how/when/where/who",
      requiresKey: false,
    },
    {
      name: "long_tail_keywords",
      description: "Long-tail variations via prepositions, comparisons, alphabetical, intent",
      requiresKey: false,
    },
    {
      name: "full_keyword_research",
      description: "All-in-one report: suggestions + trends + questions + long-tail",
      requiresKey: false,
    },
    {
      name: "multi_platform_suggestions",
      description: "Suggestions from Google + YouTube + Amazon + Pinterest simultaneously",
      requiresKey: false,
    },
    {
      name: "wiki_keyword_context",
      description: "Wikipedia entity data: related topics, categories, key phrases",
      requiresKey: false,
    },
    {
      name: "keyword_intent",
      description: "AI: classify single keyword search intent",
      requiresKey: true,
      keyName: "GEMINI_API_KEY",
    },
    {
      name: "bulk_keyword_intent",
      description: "AI: classify up to 80 keywords intent at once",
      requiresKey: true,
      keyName: "GEMINI_API_KEY",
    },
    {
      name: "keyword_clusters",
      description: "AI: group keywords into semantic topic clusters",
      requiresKey: true,
      keyName: "GEMINI_API_KEY",
    },
    {
      name: "content_brief",
      description: "AI: generate full SEO content brief with H2 outline + FAQ",
      requiresKey: true,
      keyName: "GEMINI_API_KEY",
    },
  ],
  connectWith: {
    claudeDesktop: {
      config: {
        mcpServers: {
          keywords: {
            command: "npx",
            args: ["mcp-remote", "https://YOUR_DEPLOYMENT_URL/api/mcp"],
          },
        },
      },
    },
    note: "Replace YOUR_DEPLOYMENT_URL with your actual Vercel deployment URL.",
  },
};

export default function handler(
  _req: IncomingMessage,
  res: ServerResponse
): void {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.writeHead(200);
  res.end(JSON.stringify(INFO, null, 2));
}
