// api/oauth/authorize.ts – Vercel serverless OAuth authorization endpoint
// GET  → show login form
// POST → validate credentials, redirect with code
import type { IncomingMessage, ServerResponse } from "http";
// Vercel augments IncomingMessage with body/query at runtime
type VercelRequest  = IncomingMessage & { body?: unknown; query: Record<string, string | string[]> };
type VercelResponse = ServerResponse  & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  send(body: string): void;
  redirect(status: number, url: string): void;
  end(): void;
};
import {
  safeCompare,
  validateUserCredentials,
  isRedirectUriAllowed,
  createAuthCode,
  renderAuthorizePage,
  OAUTH_CLIENT_ID,
  OAUTH_PASSWORD,
} from "../../src/oauth";

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const method = req.method ?? "GET";

  // ── GET: show the login form ──────────────────────────────────
  if (method === "GET") {
    const q           = req.query as Record<string, string>;
    const clientId    = q["client_id"]     ?? "";
    const redirectUri = q["redirect_uri"]  ?? "";
    const scope       = q["scope"]         ?? "mcp";
    const state       = q["state"]         ?? "";
    const respType    = q["response_type"] ?? "";

    if (respType !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }
    if (!clientId || !safeCompare(clientId, OAUTH_CLIENT_ID)) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }
    if (!redirectUri || !isRedirectUriAllowed(redirectUri)) {
      res.status(400).json({ error: "invalid_redirect_uri" });
      return;
    }

    res.status(200).send(renderAuthorizePage({ clientId, redirectUri, scope, state }));
    return;
  }

  // ── POST: process login ───────────────────────────────────────
  if (method === "POST") {
    const body        = (req.body ?? {}) as Record<string, string>;
    const clientId    = body["client_id"]    ?? "";
    const redirectUri = body["redirect_uri"] ?? "";
    const scope       = body["scope"]        ?? "mcp";
    const state       = body["state"]        ?? "";
    const username    = body["username"]     ?? "";
    const password    = body["password"]     ?? "";

    const rerender = (error: string): void => {
      res.status(400).send(renderAuthorizePage({ clientId, redirectUri, scope, state, error }));
    };

    if (!safeCompare(clientId, OAUTH_CLIENT_ID)) { rerender("Invalid client."); return; }
    if (!isRedirectUriAllowed(redirectUri))       { rerender("Invalid redirect URI."); return; }

    if (!OAUTH_PASSWORD || !validateUserCredentials(username, password)) {
      rerender("Invalid username or password.");
      return;
    }

    const code   = createAuthCode(clientId, redirectUri, scope);
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state) target.searchParams.set("state", state);

    res.redirect(302, target.toString());
    return;
  }

  res.status(405).json({ error: "Method Not Allowed" });
}
