// api/oauth/revoke.ts – Vercel serverless OAuth token revocation (RFC 7009)
import type { IncomingMessage, ServerResponse } from "http";
import * as qs from "querystring";
import { validateClientCredentials, revokeToken } from "../../src/oauth";

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

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST")    { sendJSON(res, 405, { error: "Method Not Allowed" }); return; }

  const raw  = await readRawBody(req);
  const body = qs.parse(raw) as Record<string, string>;

  const clientId     = body["client_id"]     ?? "";
  const clientSecret = body["client_secret"] ?? "";
  const token        = body["token"]         ?? "";

  if (!validateClientCredentials(clientId, clientSecret)) {
    sendJSON(res, 401, { error: "invalid_client" });
    return;
  }

  revokeToken(token);
  sendJSON(res, 200, {}); // RFC 7009: always 200
}
