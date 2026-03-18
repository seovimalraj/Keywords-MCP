// api/oauth/authorize.ts – Vercel serverless OAuth authorization endpoint
// GET  → show login form
// POST → validate credentials, redirect with code
import type { IncomingMessage, ServerResponse } from "http";
import * as qs from "querystring";
import {
  safeCompare,
  validateUserCredentials,
  isRedirectUriAllowed,
  createAuthCode,
  renderAuthorizePage,
  OAUTH_CLIENT_ID,
  OAUTH_PASSWORD,
} from "../../src/oauth";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url    = new URL(req.url ?? "/", "http://localhost");

  // ── GET: show the login form ──────────────────────────────────
  if (method === "GET") {
    const clientId    = url.searchParams.get("client_id")    ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const scope       = url.searchParams.get("scope")        ?? "mcp";
    const state       = url.searchParams.get("state")        ?? "";
    const respType    = url.searchParams.get("response_type") ?? "";

    if (respType !== "code") {
      sendJSON(res, 400, { error: "unsupported_response_type" });
      return;
    }
    if (!clientId || !safeCompare(clientId, OAUTH_CLIENT_ID)) {
      sendJSON(res, 400, { error: "invalid_client" });
      return;
    }
    if (!redirectUri || !isRedirectUriAllowed(redirectUri)) {
      sendJSON(res, 400, { error: "invalid_redirect_uri" });
      return;
    }

    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderAuthorizePage({ clientId, redirectUri, scope, state }));
    return;
  }

  // ── POST: process login ───────────────────────────────────────
  if (method === "POST") {
    const raw  = await readRawBody(req);
    const body = qs.parse(raw) as Record<string, string>;

    const clientId    = body["client_id"]    ?? "";
    const redirectUri = body["redirect_uri"] ?? "";
    const scope       = body["scope"]        ?? "mcp";
    const state       = body["state"]        ?? "";
    const username    = body["username"]     ?? "";
    const password    = body["password"]     ?? "";

    const rerender = (error: string): void => {
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderAuthorizePage({ clientId, redirectUri, scope, state, error }));
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

    res.writeHead(302, { Location: target.toString() });
    res.end();
    return;
  }

  sendJSON(res, 405, { error: "Method Not Allowed" });
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
