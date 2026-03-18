// ─────────────────────────────────────────────
//  api/mcp.ts  –  Vercel Serverless MCP Endpoint
//  Implements MCP Streamable HTTP transport (stateless)
//  This is the main endpoint for all MCP clients
//
//  Usage with Claude Desktop / ChatGPT:
//    POST https://your-app.vercel.app/api/mcp
//    Authorization: Bearer <MCP_API_KEY>
// ─────────────────────────────────────────────
import type { IncomingMessage, ServerResponse } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../src/server";

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Validate the Bearer token against MCP_API_KEY env var */
function isAuthorized(req: IncomingMessage): boolean {
  const apiKey = process.env.MCP_API_KEY;
  // If no key is configured, deny all requests (fail-secure)
  if (!apiKey || apiKey.trim() === "") return false;

  const authHeader = (req.headers["authorization"] ?? "") as string;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7); // strip "Bearer "
  return safeCompare(token, apiKey.trim());
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Handle CORS preflight – no auth required for OPTIONS
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Accept, Authorization",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // Only accept POST requests for MCP Streamable HTTP
  if (req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "application/json",
      "Allow": "POST, OPTIONS",
    });
    res.end(
      JSON.stringify({
        error: "Method Not Allowed",
        message: "MCP Streamable HTTP endpoint only accepts POST requests.",
      })
    );
    return;
  }

  // ── Authentication ──────────────────────────────────────
  if (!isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Unauthorized",
        message: "Missing or invalid Authorization header. Use: Authorization: Bearer <MCP_API_KEY>",
      })
    );
    return;
  }
  // ────────────────────────────────────────────────────────

  // CORS headers so browser-based MCP clients can connect
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, mcp-session-id, Accept, Authorization"
  );

  // Parse the request body (Vercel passes it as stream)
  const body = await parseBody(req);

  // Create a fresh stateless transport + server per request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless – no session tracking needed
  });

  const mcpServer = createServer();

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    // Clean up resources after response is sent
    res.on("finish", () => {
      void transport.close();
      void mcpServer.close();
    });
  }
}

/**
 * Read and parse the JSON body from an IncomingMessage stream.
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });

    req.on("error", reject);
  });
}
