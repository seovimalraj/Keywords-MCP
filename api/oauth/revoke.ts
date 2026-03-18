// api/oauth/revoke.ts – Vercel serverless OAuth token revocation (RFC 7009)
import type { IncomingMessage, ServerResponse } from "http";
import * as qs from "querystring";
import { validateClientCredentials, revokeToken } from "../../src/oauth";

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
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST")    { sendJSON(res, 405, { error: "Method Not Allowed" }); return; }

  const body = await getParsedBody(req);

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
