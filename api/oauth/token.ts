// api/oauth/token.ts – Vercel serverless OAuth token endpoint
// POST → exchange authorization_code or refresh_token for access token
import type { IncomingMessage, ServerResponse } from "http";
type VercelRequest  = IncomingMessage & { body?: unknown; query: Record<string, string | string[]> };
type VercelResponse = ServerResponse  & {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  end(): void;
};
import {
  validateClientCredentials,
  exchangeCode,
  rotateRefreshToken,
} from "../../src/oauth";

function extractClientCredentials(
  body: Record<string, string>,
  req: VercelRequest,
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

export default function handler(req: VercelRequest, res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "Method Not Allowed" }); return; }

  const body        = (req.body ?? {}) as Record<string, string>;
  const grantType   = body["grant_type"] ?? "";
  const { clientId, clientSecret } = extractClientCredentials(body, req);

  if (!validateClientCredentials(clientId, clientSecret)) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }

  if (grantType === "authorization_code") {
    const code        = body["code"]         ?? "";
    const redirectUri = body["redirect_uri"] ?? "";
    const tokens = exchangeCode(code, clientId, clientSecret, redirectUri);
    if (!tokens) {
      res.status(400).json({ error: "invalid_grant", error_description: "Code invalid or expired" });
      return;
    }
    res.status(200).json(tokens);
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = body["refresh_token"] ?? "";
    const tokens = rotateRefreshToken(refreshToken, clientId, clientSecret);
    if (!tokens) {
      res.status(400).json({ error: "invalid_grant", error_description: "Refresh token invalid or expired" });
      return;
    }
    res.status(200).json(tokens);
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
}
