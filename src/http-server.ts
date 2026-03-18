// ─────────────────────────────────────────────
//  src/http-server.ts  –  HTTP entry point for Docker / self-hosted
//  Runs the MCP Streamable HTTP transport on Express
// ─────────────────────────────────────────────
import * as http from "http";
import * as dotenv from "dotenv";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server";

dotenv.config();

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const API_KEY = process.env.MCP_API_KEY?.trim() ?? "";

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!API_KEY) return false; // fail-secure: deny all if key not configured
  const authHeader = (req.headers["authorization"] ?? "") as string;
  if (!authHeader.startsWith("Bearer ")) return false;
  return safeCompare(authHeader.slice(7), API_KEY);
}

function sendJSON(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });
    req.on("error", reject);
  });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Accept, Authorization",
  "Access-Control-Max-Age": "86400",
};

const server = http.createServer(async (req, res) => {
  // Attach CORS headers to every response
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  // Health check (no auth needed)
  if (req.method === "GET" && req.url === "/health") {
    sendJSON(res, 200, { status: "ok", service: "keywords-mcp" });
    return;
  }

  // Info endpoint (no auth needed)
  if (req.method === "GET" && (req.url === "/" || req.url === "/api/info")) {
    sendJSON(res, 200, {
      name: "Keywords MCP",
      version: "1.0.0",
      mcpEndpoint: "/api/mcp",
      transport: "Streamable HTTP (stateless)",
      auth: "Authorization: Bearer <MCP_API_KEY>",
    });
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // MCP endpoint
  if (req.url === "/api/mcp") {
    if (req.method !== "POST") {
      sendJSON(res, 405, { error: "Method Not Allowed", message: "Use POST /api/mcp" });
      return;
    }

    if (!isAuthorized(req)) {
      sendJSON(res, 401, {
        error: "Unauthorized",
        message: "Missing or invalid Authorization header. Use: Authorization: Bearer <MCP_API_KEY>",
      });
      return;
    }

    const body = await parseBody(req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createServer();

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally {
      res.on("finish", () => {
        void transport.close();
        void mcpServer.close();
      });
    }
    return;
  }

  sendJSON(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  process.stderr.write(`Keywords MCP HTTP server running on port ${PORT}\n`);
  process.stderr.write(`MCP endpoint: http://localhost:${PORT}/api/mcp\n`);
  if (!API_KEY) {
    process.stderr.write("WARNING: MCP_API_KEY is not set — all requests will be rejected!\n");
  }
});

server.on("error", (err: Error) => {
  process.stderr.write(`Server error: ${err.message}\n`);
  process.exit(1);
});
