// ─────────────────────────────────────────────
//  index.ts  –  MCP Server entry point
//  Connects the server to stdio transport
// ─────────────────────────────────────────────
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP stdio communication
  process.stderr.write("Keywords MCP server running on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
