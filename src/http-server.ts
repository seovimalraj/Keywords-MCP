// ─────────────────────────────────────────────
//  src/http-server.ts  –  HTTP entry point for Docker / self-hosted
//  Runs the MCP Streamable HTTP transport over plain Node.js http
// ─────────────────────────────────────────────
import * as http from "http";
import * as qs from "querystring";
import * as dotenv from "dotenv";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server";
import {
  safeCompare,
  validateAccessToken,
  validateClientCredentials,
  validateUserCredentials,
  isRedirectUriAllowed,
  createAuthCode,
  exchangeCode,
  rotateRefreshToken,
  revokeToken,
  renderAuthorizePage,
  OAUTH_CLIENT_ID,
  OAUTH_PASSWORD,
} from "./oauth";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────
const PORT            = parseInt(process.env.PORT          ?? "3000",  10);
const API_KEY         = process.env.MCP_API_KEY?.trim()    ?? "";
const MAX_BODY_BYTES  = parseInt(process.env.MAX_BODY_BYTES ?? String(1 * 1024 * 1024), 10); // 1 MB
const REQ_TIMEOUT_MS  = parseInt(process.env.REQ_TIMEOUT_MS ?? "55000", 10);                 // 55 s
const RATE_LIMIT_RPM  = parseInt(process.env.RATE_LIMIT_RPM ?? "60",    10);                 // per IP

// ── Structured logger ─────────────────────────────────────────────
function log(level: "INFO" | "WARN" | "ERROR", msg: string, extra?: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  (level === "ERROR" ? process.stderr : process.stdout).write(entry + "\n");
}

// ── Per-IP rate limiter (sliding window, in-memory) ───────────────
interface RateBucket { count: number; windowStart: number; }
const rateBuckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000;

// Prune stale buckets every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now - b.windowStart > WINDOW_MS) rateBuckets.delete(ip);
  }
}, 5 * 60_000).unref();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_RPM;
}

function getClientIP(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw?.split(",")[0]?.trim()) ?? req.socket.remoteAddress ?? "unknown";
}

// ── Security ──────────────────────────────────────────────────────
function isAuthorized(req: http.IncomingMessage): boolean {
  const header = (req.headers["authorization"] ?? "") as string;
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7);

  // 1. Accept static MCP_API_KEY (backward-compatible)
  if (API_KEY && safeCompare(token, API_KEY)) return true;

  // 2. Accept live OAuth access token
  if (validateAccessToken(token)) return true;

  return false;
}

// Parse URL-encoded form body (for OAuth endpoints)
async function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > 64_000) { req.destroy(new Error("PAYLOAD_TOO_LARGE")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = qs.parse(raw) as Record<string, string>;
      resolve(parsed);
    });
    req.on("error", reject);
  });
}

// Extract client credentials: body params take precedence, then Basic auth header
function extractClientCredentials(
  body: Record<string, string>,
  req: http.IncomingMessage,
): { clientId: string; clientSecret: string } {
  if (body["client_id"] && body["client_secret"]) {
    return { clientId: body["client_id"], clientSecret: body["client_secret"] };
  }
  const authHeader = (req.headers["authorization"] ?? "") as string;
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const [clientId, ...rest] = decoded.split(":");
    return { clientId: clientId ?? "", clientSecret: rest.join(":") };
  }
  return { clientId: "", clientSecret: "" };
}

// ── Helpers ───────────────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options":  "nosniff",
  "X-Frame-Options":         "DENY",
  "X-XSS-Protection":        "1; mode=block",
  "Referrer-Policy":         "no-referrer",
  "Content-Security-Policy": "default-src 'none'",
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Accept, Authorization",
  "Access-Control-Max-Age":       "86400",
};

function applyHeaders(res: http.ServerResponse): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(CORS_HEADERS))     res.setHeader(k, v);
}

function sendJSON(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type":   "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });

    req.on("error", reject);
  });
}

// ── Request handler ───────────────────────────────────────────────
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const start  = Date.now();
  const ip     = getClientIP(req);
  const method = req.method ?? "?";
  const url    = req.url    ?? "/";

  applyHeaders(res);

  // Per-IP rate limit (applied to all endpoints except health)
  if (url !== "/health" && isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    sendJSON(res, 429, { error: "Too Many Requests", message: "Rate limit: 60 req/min per IP" });
    log("WARN", "rate_limited", { ip, method, url });
    return;
  }

  // ── Route: health check ──────────────────────────────────────
  if (method === "GET" && url === "/health") {
    sendJSON(res, 200, { status: "ok", service: "keywords-mcp", uptime: process.uptime() });
    return;
  }

  // ── Route: info ──────────────────────────────────────────────
  if (method === "GET" && (url === "/" || url === "/api/info")) {
    sendJSON(res, 200, {
      name: "Keywords MCP",
      version: "1.0.0",
      mcpEndpoint: "/api/mcp",
      transport: "Streamable HTTP (stateless)",
      auth: "OAuth 2.0 (Authorization Code) or static Bearer token",
      oauth: {
        authorization_url: "/oauth/authorize",
        token_url:         "/oauth/token",
        revocation_url:    "/oauth/revoke",
        grant_types:       ["authorization_code", "refresh_token"],
        scope:             "mcp",
      },
    });
    return;
  }

  // ── Route: OAuth – GET /oauth/authorize (show login form) ────
  if (method === "GET" && url?.startsWith("/oauth/authorize")) {
    const urlObj      = new URL(url, "http://localhost");
    const clientId    = urlObj.searchParams.get("client_id")    ?? "";
    const redirectUri = urlObj.searchParams.get("redirect_uri") ?? "";
    const scope       = urlObj.searchParams.get("scope")        ?? "mcp";
    const state       = urlObj.searchParams.get("state")        ?? "";
    const respType    = urlObj.searchParams.get("response_type") ?? "";

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

    // Loosen CSP for the login page so the form and styles render
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderAuthorizePage({ clientId, redirectUri, scope, state }));
    return;
  }

  // ── Route: OAuth – POST /oauth/authorize (process login) ─────
  if (method === "POST" && url?.startsWith("/oauth/authorize")) {
    const body        = await parseFormBody(req);
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
      log("WARN", "oauth_login_failed", { ip, username });
      rerender("Invalid username or password.");
      return;
    }

    const code    = createAuthCode(clientId, redirectUri, scope);
    const target  = new URL(redirectUri);
    target.searchParams.set("code",  code);
    if (state) target.searchParams.set("state", state);

    log("INFO", "oauth_code_issued", { ip, clientId });
    res.writeHead(302, { Location: target.toString() });
    res.end();
    return;
  }

  // ── Route: OAuth – POST /oauth/token ─────────────────────────
  if (method === "POST" && url === "/oauth/token") {
    const body       = await parseFormBody(req);
    const grantType  = body["grant_type"] ?? "";
    const { clientId, clientSecret } = extractClientCredentials(body, req);

    if (!validateClientCredentials(clientId, clientSecret)) {
      sendJSON(res, 401, { error: "invalid_client" });
      return;
    }

    if (grantType === "authorization_code") {
      const code        = body["code"]         ?? "";
      const redirectUri = body["redirect_uri"] ?? "";
      const tokens = exchangeCode(code, clientId, clientSecret, redirectUri);
      if (!tokens) {
        sendJSON(res, 400, { error: "invalid_grant", error_description: "Code invalid or expired" });
        return;
      }
      log("INFO", "oauth_token_issued", { ip, clientId, grant: "authorization_code" });
      sendJSON(res, 200, tokens);
      return;
    }

    if (grantType === "refresh_token") {
      const refreshToken = body["refresh_token"] ?? "";
      const tokens = rotateRefreshToken(refreshToken, clientId, clientSecret);
      if (!tokens) {
        sendJSON(res, 400, { error: "invalid_grant", error_description: "Refresh token invalid or expired" });
        return;
      }
      log("INFO", "oauth_token_issued", { ip, clientId, grant: "refresh_token" });
      sendJSON(res, 200, tokens);
      return;
    }

    sendJSON(res, 400, { error: "unsupported_grant_type" });
    return;
  }

  // ── Route: OAuth – POST /oauth/revoke ─────────────────────────
  if (method === "POST" && url === "/oauth/revoke") {
    const body  = await parseFormBody(req);
    const token = body["token"] ?? "";
    const { clientId, clientSecret } = extractClientCredentials(body, req);
    if (!validateClientCredentials(clientId, clientSecret)) {
      sendJSON(res, 401, { error: "invalid_client" });
      return;
    }
    revokeToken(token);
    log("INFO", "oauth_token_revoked", { ip, clientId });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}"); // RFC 7009: always 200, even if token not found
    return;
  }

  // ── Route: CORS preflight ────────────────────────────────────
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Route: MCP endpoint ──────────────────────────────────────
  if (url === "/api/mcp") {
    if (method !== "POST") {
      sendJSON(res, 405, { error: "Method Not Allowed", message: "Use POST /api/mcp" });
      return;
    }

    if (!isAuthorized(req)) {
      sendJSON(res, 401, {
        error: "Unauthorized",
        message: "Required: Authorization: Bearer <MCP_API_KEY>",
      });
      log("WARN", "unauthorized", { ip, method, url });
      return;
    }

    // Request timeout watchdog
    const timeout = setTimeout(() => {
      if (!res.writableEnded) {
        sendJSON(res, 504, { error: "Gateway Timeout", message: "Request exceeded time limit" });
        log("WARN", "request_timeout", { ip, url, ms: Date.now() - start });
      }
    }, REQ_TIMEOUT_MS);

    let body: unknown;
    try {
      body = await parseBody(req);
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "PAYLOAD_TOO_LARGE") {
        sendJSON(res, 413, { error: "Payload Too Large", message: `Body exceeds ${MAX_BODY_BYTES} bytes` });
      } else {
        sendJSON(res, 400, { error: "Bad Request", message: "Could not read request body" });
      }
      log("WARN", "body_parse_error", { ip, msg });
      return;
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createServer();

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      clearTimeout(timeout);
      if (!res.writableEnded) {
        sendJSON(res, 500, { error: "Internal Server Error" });
      }
      log("ERROR", "mcp_handler_error", { ip, err: String(err) });
      return;
    } finally {
      clearTimeout(timeout);
      res.on("finish", () => {
        void transport.close();
        void mcpServer.close();
        log("INFO", "request", { ip, method, url, status: res.statusCode, ms: Date.now() - start });
      });
    }
    return;
  }

  sendJSON(res, 404, { error: "Not Found" });
  log("INFO", "request", { ip, method, url, status: 404, ms: Date.now() - start });
}

// ── HTTP server ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err: unknown) => {
    if (!res.writableEnded) sendJSON(res, 500, { error: "Internal Server Error" });
    log("ERROR", "unhandled_request_error", { err: String(err) });
  });
});

server.keepAliveTimeout = 65_000; // slightly above common load-balancer 60 s
server.headersTimeout   = 66_000;

server.on("error", (err: NodeJS.ErrnoException) => {
  log("ERROR", "server_error", { code: err.code, msg: err.message });
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────
let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log("INFO", "shutdown_started", { signal });

  server.close((err) => {
    if (err) log("ERROR", "shutdown_error", { err: String(err) });
    else     log("INFO",  "shutdown_complete", {});
    process.exit(err ? 1 : 0);
  });

  // Force-kill after 10 s if connections are still open
  setTimeout(() => {
    log("WARN", "shutdown_forced", {});
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// ── Safety nets ───────────────────────────────────────────────────
process.on("uncaughtException", (err: Error) => {
  log("ERROR", "uncaught_exception", { err: err.message, stack: err.stack });
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: unknown) => {
  log("ERROR", "unhandled_rejection", { reason: String(reason) });
  // Don't exit — rejections can be transient per-request errors
});

// ── Start ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  log("INFO", "server_started", { port: PORT, pid: process.pid });
  log("INFO", "mcp_endpoint",   { url: `http://localhost:${PORT}/api/mcp` });
  if (!API_KEY) log("WARN", "no_api_key", { msg: "MCP_API_KEY not set — all requests will be rejected" });
});
