// api/oauth/token.ts – Vercel serverless OAuth token endpoint
// POST → exchange authorization_code or refresh_token for access token
import type { IncomingMessage, ServerResponse } from "http";
import * as qs from "querystring";
import {
  validateClientCredentials,
  exchangeCode,
  rotateRefreshToken,
} from "../../src/oauth";

function extractClientCredentials(
  body: Record<string, string>,
  req: IncomingMessage,
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

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function getParsedBody(req: IncomingMessage): Promise<Record<string, string>> {
  const r = req as IncomingMessage & { body?: unknown };
  if (r.body !== undefined && r.body !== null) {
    if (typeof r.body === "object" && !Buffer.isBuffer(r.body)) {
      return r.body as Record<string, string>;
    }
    if (Buffer.isBuffer(r.body)) {
      return qs.parse(r.body.toString("utf8")) as Record<string, string>;
    }
    if (typeof r.body === "string") {
      return qs.parse(r.body) as Record<string, string>;
    }
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  return qs.parse(raw) as Record<string, string>;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST")    { sendJSON(res, 405, { error: "Method Not Allowed" }); return; }

  const body = await getParsedBody(req);

  const grantType = body["grant_type"] ?? "";
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
    sendJSON(res, 200, tokens);
    return;
  }

  sendJSON(res, 400, { error: "unsupported_grant_type" });
}
