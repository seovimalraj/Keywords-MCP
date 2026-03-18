// ─────────────────────────────────────────────
//  api/mcp.ts  –  Vercel Serverless MCP Endpoint
//  Implements MCP Streamable HTTP transport (stateless)
//  This is the main endpoint for all MCP clients
//
//  Usage with Claude Desktop / ChatGPT:
//    POST https://your-app.vercel.app/api/mcp
// ─────────────────────────────────────────────
import type { IncomingMessage, ServerResponse } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../src/server";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Only accept POST requests for MCP Streamable HTTP
  if (req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "application/json",
      "Allow": "POST",
    });
    res.end(
      JSON.stringify({
        error: "Method Not Allowed",
        message: "MCP Streamable HTTP endpoint only accepts POST requests.",
      })
    );
    return;
  }

  // CORS headers so browser-based MCP clients can connect
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, mcp-session-id, Accept"
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
