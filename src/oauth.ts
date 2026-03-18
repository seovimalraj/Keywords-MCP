// ─────────────────────────────────────────────
//  src/oauth.ts – OAuth 2.0 Authorization Code flow
//  Stateless HMAC-signed tokens — works across Vercel serverless invocations
// ─────────────────────────────────────────────
import * as crypto from "crypto";

// ── Config (read once at startup) ────────────────────────────────
export const OAUTH_CLIENT_ID     = process.env.OAUTH_CLIENT_ID?.trim()     ?? "";
export const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET?.trim() ?? "";
export const OAUTH_USERNAME      = process.env.OAUTH_USERNAME?.trim()       ?? "admin";
export const OAUTH_PASSWORD      = process.env.OAUTH_PASSWORD?.trim()       ?? "";

// Secret used to sign all tokens — falls back to MCP_API_KEY if not set separately
const TOKEN_SECRET = process.env.OAUTH_TOKEN_SECRET?.trim()
  ?? process.env.MCP_API_KEY?.trim()
  ?? "dev-insecure-secret-set-OAUTH_TOKEN_SECRET-in-production";

const ACCESS_TOKEN_TTL_MS  = parseInt(process.env.OAUTH_TOKEN_TTL ?? String(24 * 60 * 60_000), 10);
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const AUTH_CODE_TTL_MS     = 5 * 60_000;

// ── Stateless token helpers ───────────────────────────────────────
interface TokenPayload {
  t:   "code" | "access" | "refresh"; // type
  cid: string;   // clientId
  ruri?: string; // redirectUri (auth codes only)
  scp: string;   // scope
  exp: number;   // expiry (ms epoch)
}

function signToken(payload: TokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data     = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
  // Constant-time compare
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as TokenPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────
export function safeCompare(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  const len    = Math.max(aBytes.length, bBytes.length);
  const padA   = Buffer.concat([aBytes, Buffer.alloc(len - aBytes.length)]);
  const padB   = Buffer.concat([bBytes, Buffer.alloc(len - bBytes.length)]);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) diff |= padA[i] ^ padB[i];
  return diff === 0;
}

export function validateClientCredentials(clientId: string, clientSecret: string): boolean {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) return false;
  return safeCompare(clientId, OAUTH_CLIENT_ID) && safeCompare(clientSecret, OAUTH_CLIENT_SECRET);
}

export function validateUserCredentials(username: string, password: string): boolean {
  if (!OAUTH_PASSWORD) return false;
  return safeCompare(username, OAUTH_USERNAME) && safeCompare(password, OAUTH_PASSWORD);
}

export function isRedirectUriAllowed(uri: string): boolean {
  const allowlist = process.env.OAUTH_REDIRECT_URIS ?? "";
  if (allowlist) {
    return allowlist.split(",").map(s => s.trim()).some(pattern => {
      if (pattern.endsWith("*")) {
        return uri.startsWith(pattern.slice(0, -1));
      }
      return uri === pattern;
    });
  }
  return uri.startsWith("https://");
}

// ── Auth code ────────────────────────────────────────────────────
export function createAuthCode(clientId: string, redirectUri: string, scope: string): string {
  return signToken({ t: "code", cid: clientId, ruri: redirectUri, scp: scope, exp: Date.now() + AUTH_CODE_TTL_MS });
}

// ── Token response shape ─────────────────────────────────────────
export interface TokenResponse {
  access_token:  string;
  token_type:    "Bearer";
  expires_in:    number;
  refresh_token: string;
  scope:         string;
}

function issueTokenPair(clientId: string, scope: string): TokenResponse {
  const access  = signToken({ t: "access",  cid: clientId, scp: scope, exp: Date.now() + ACCESS_TOKEN_TTL_MS });
  const refresh = signToken({ t: "refresh", cid: clientId, scp: scope, exp: Date.now() + REFRESH_TOKEN_TTL_MS });
  return {
    access_token:  access,
    token_type:    "Bearer",
    expires_in:    Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refresh,
    scope,
  };
}

// ── Grant: authorization_code ────────────────────────────────────
export function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): TokenResponse | null {
  if (!validateClientCredentials(clientId, clientSecret)) return null;
  const p = verifyToken(code);
  if (!p || p.t !== "code") return null;
  if (!safeCompare(p.cid, clientId))         return null;
  // Only validate redirect_uri if the token request actually provides one
  if (p.ruri && redirectUri && !safeCompare(p.ruri, redirectUri)) return null;
  return issueTokenPair(clientId, p.scp);
}

// ── Grant: refresh_token ─────────────────────────────────────────
export function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): TokenResponse | null {
  if (!validateClientCredentials(clientId, clientSecret)) return null;
  const p = verifyToken(refreshToken);
  if (!p || p.t !== "refresh") return null;
  if (!safeCompare(p.cid, clientId)) return null;
  return issueTokenPair(clientId, p.scp);
}

// ── Token introspection ───────────────────────────────────────────
export function validateAccessToken(token: string): { clientId: string; scope: string } | null {
  const p = verifyToken(token);
  if (!p || p.t !== "access") return null;
  return { clientId: p.cid, scope: p.scp };
}

// ── Revocation (stateless — tokens naturally expire) ─────────────
export function revokeToken(_token: string): void {
  // Stateless tokens can't be revoked from memory, but we return 200 per RFC 7009.
  // Tokens expire on their own within ACCESS_TOKEN_TTL_MS / REFRESH_TOKEN_TTL_MS.
}

// ── HTML helpers (XSS-safe) ───────────────────────────────────────
function escHtml(s: string): string {
  return s
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#x27;");
}

export function renderAuthorizePage(params: {
  clientId:    string;
  redirectUri: string;
  scope:       string;
  state:       string;
  error?:      string;
}): string {
  const e = escHtml;
  const errorHtml = params.error
    ? `<p class="error">&#x26A0; ${e(params.error)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorize – Keywords MCP</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body   { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex;
             align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card  { background: #fff; border-radius: 12px; padding: 36px 40px; max-width: 420px;
             width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.10); }
    h1     { margin: 0 0 4px; font-size: 1.3rem; }
    .sub   { color: #666; font-size: .875rem; margin: 0 0 24px; }
    .scope { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;
             padding: 10px 14px; font-size: .85rem; color: #0369a1; margin-bottom: 24px; }
    label  { display: block; font-size: .875rem; font-weight: 500; margin-bottom: 4px; }
    input[type=text], input[type=password] {
             width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px;
             font-size: .95rem; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    button { width: 100%; padding: 11px; background: #6366f1; color: #fff; border: none;
             border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #4f46e5; }
    .error { color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;
             border-radius: 8px; padding: 10px 14px; font-size: .875rem; margin-bottom: 16px; }
    .meta  { font-size: .75rem; color: #9ca3af; margin-top: 16px; word-break: break-all; }
  </style>
</head>
<body>
<div class="card">
  <h1>Keywords MCP</h1>
  <p class="sub">An application is requesting access to your keyword research tools.</p>

  <div class="scope">
    <strong>App:</strong> ${e(params.clientId)}<br/>
    <strong>Scope:</strong> ${e(params.scope || "mcp")}
  </div>

  ${errorHtml}

  <form method="POST" action="/oauth/authorize" autocomplete="off">
    <input type="hidden" name="client_id"     value="${e(params.clientId)}" />
    <input type="hidden" name="redirect_uri"  value="${e(params.redirectUri)}" />
    <input type="hidden" name="scope"         value="${e(params.scope)}" />
    <input type="hidden" name="state"         value="${e(params.state)}" />
    <input type="hidden" name="response_type" value="code" />

    <label for="username">Username</label>
    <input id="username" type="text"     name="username" autocomplete="username" required />

    <label for="password">Password</label>
    <input id="password" type="password" name="password" autocomplete="current-password" required />

    <button type="submit">Authorize Access</button>
  </form>

  <p class="meta">Redirect: ${e(params.redirectUri)}</p>
</div>
</body>
</html>`;
}
