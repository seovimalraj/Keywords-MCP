# Keywords MCP

An MCP (Model Context Protocol) server for keyword research. Connect it to Claude, ChatGPT, or any MCP-compatible client and run keyword research directly from your AI chat.

**All Phase 1 tools use free APIs — no API keys required.**

---

## Tools Available

| Tool | Description |
|---|---|
| `keyword_suggestions` | Google Autocomplete suggestions. Use `mode: expanded` for A–Z expansion (100+ keywords) |
| `keyword_trends` | Google Trends data — interest over time, related queries, related topics, trend direction |
| `trending_searches` | Today's trending search topics from Google Trends by country |
| `question_keywords` | Answer-the-Public style: questions grouped by what/why/how/when/where/who/which |
| `long_tail_keywords` | Long-tail variations via prepositions, comparisons, alphabetical, and intent modifiers |
| `full_keyword_research` | All-in-one report combining suggestions + trends + questions + long-tail in one call |

---

## Quick Start

### 1. Install & Build

```bash
npm install
npm run build
```

### 2. Connect to Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "keywords": {
      "command": "node",
      "args": ["D:/Downloads/Keywords MCP/dist/index.js"]
    }
  }
}
```

### 3. Connect to ChatGPT (via MCP bridge)

```json
{
  "mcpServers": {
    "keywords": {
      "command": "node",
      "args": ["D:/Downloads/Keywords MCP/dist/index.js"]
    }
  }
}
```

---

## Usage Examples

Once connected, ask your AI:

- *"Get keyword suggestions for 'content marketing' with expanded mode"*
- *"What are the Google Trends for 'AI tools' over the last 5 years in the US?"*
- *"Generate all question-style keywords for 'email marketing'"*
- *"Find long-tail keywords for 'coffee machine' including comparisons and intent"*
- *"Run a full keyword research report for 'react js'"*
- *"What's trending on Google in the UK today?"*

---

## Tool Parameters

### `keyword_suggestions`
| Param | Type | Default | Description |
|---|---|---|---|
| `keyword` | string | required | Seed keyword |
| `lang` | string | `"en"` | Language code |
| `country` | string | `"us"` | Country code |
| `mode` | `"basic"` \| `"expanded"` | `"basic"` | basic = top 10, expanded = A–Z (100+) |

### `keyword_trends`
| Param | Type | Default | Description |
|---|---|---|---|
| `keyword` | string | required | Keyword to check |
| `geo` | string | `""` | Country code (`"US"`, `"GB"`, `""` = worldwide) |
| `timeframe` | string | `"today 12-m"` | Time range (see options below) |

**Timeframe options:** `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`

### `trending_searches`
| Param | Type | Default | Description |
|---|---|---|---|
| `geo` | string | `"US"` | Country code |

### `question_keywords`
| Param | Type | Default | Description |
|---|---|---|---|
| `keyword` | string | required | Seed keyword |
| `lang` | string | `"en"` | Language |
| `country` | string | `"us"` | Country |
| `questionWords` | array | all | Filter to specific question words |

### `long_tail_keywords`
| Param | Type | Default | Description |
|---|---|---|---|
| `keyword` | string | required | Seed keyword |
| `categories` | array | all | `prepositions`, `comparisons`, `alphabetical`, `intent` |

### `full_keyword_research`
| Param | Type | Default | Description |
|---|---|---|---|
| `keyword` | string | required | Seed keyword |
| `lang` | string | `"en"` | Language |
| `country` | string | `"us"` | Country (also used as Trends geo) |
| `timeframe` | string | `"today 12-m"` | Trends timeframe |
| `includeTrends` | boolean | `true` | Include Google Trends data |

---

## Project Structure

```
src/
├── index.ts                      # Entry point (stdio transport)
├── server.ts                     # MCP server + tool registration
├── config.ts                     # Config (rate limits, timeouts, defaults)
├── providers/
│   ├── google-autocomplete.ts    # Google Suggest API (free, no key)
│   ├── google-trends.ts          # Google Trends API (free, no key)
│   └── answer-the-public.ts      # ATP-style engine (built on autocomplete)
├── tools/
│   ├── suggestions.ts            # keyword_suggestions handler
│   ├── trends.ts                 # keyword_trends + trending_searches handlers
│   ├── questions.ts              # question_keywords handler
│   ├── longTail.ts               # long_tail_keywords handler
│   └── fullResearch.ts           # full_keyword_research handler
└── utils/
    ├── cache.ts                  # In-memory cache (node-cache)
    ├── rateLimiter.ts            # Per-provider throttle (bottleneck)
    └── formatter.ts              # Dedup, sort, group utilities
```

---

## Development

```bash
npm run dev          # Run with ts-node (no build needed)
npm run build        # Compile TypeScript → dist/
npm run build:watch  # Watch mode for development
npm start            # Run compiled dist/index.js
```

---

## Coming in Phase 2

- DataForSEO / Keywords Everywhere integration (search volume + CPC)
- Keyword difficulty scoring
- SERP analysis (top 10 results for any keyword)
- Competitor keyword analysis
- Bulk keyword processing
