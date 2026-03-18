// api/oauth/debug.ts – TEMPORARY: log exactly what ChatGPT sends to the token endpoint
// Remove this file after debugging is complete
import type { IncomingMessage, ServerResponse } from "http";
type VercelRequest  = IncomingMessage & { body?: unknown; query: Record<string, string | string[]> };
type VercelResponse = ServerResponse & { status(c: number): VercelResponse; json(b: unknown): void; };

export default function handler(req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    method:  req.method,
    headers: req.headers,
    body:    req.body,
    query:   req.query,
  });
}
