// api/oauth/revoke.ts – Vercel serverless OAuth token revocation (RFC 7009)
import type { IncomingMessage, ServerResponse } from "http";
type VercelRequest  = IncomingMessage & { body?: unknown; query: Record<string, string | string[]> };
type VercelResponse = ServerResponse  & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  end(): void;
};
import { validateClientCredentials, revokeToken } from "../../src/oauth";

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "Method Not Allowed" }); return; }

  const body         = (req.body ?? {}) as Record<string, string>;
  const clientId     = body["client_id"]     ?? "";
  const clientSecret = body["client_secret"] ?? "";
  const token        = body["token"]         ?? "";

  if (!validateClientCredentials(clientId, clientSecret)) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }

  revokeToken(token);
  res.status(200).json({}); // RFC 7009: always 200
}
