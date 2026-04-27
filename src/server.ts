import "dotenv/config";
import express, { type Request, type Response } from "express";
import { Client } from "@notionhq/client";
import { LedgerMem } from "@ledgermem/memory";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.js";
import {
  extractPageIdFromEvent,
  handlePageUpdate,
  type NotionWebhookEvent,
} from "./sync.js";

function verifyNotionSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  // Notion's webhook signature header is `X-Notion-Signature: sha256=<hex>`
  const sig = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function buildApp(): express.Express {
  const cfg = loadConfig();
  const notion = new Client({ auth: cfg.notionToken });
  const memory = new LedgerMem({
    apiKey: cfg.ledgermemApiKey,
    workspaceId: cfg.ledgermemWorkspaceId,
  });

  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.post("/webhook", async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (cfg.notionWebhookSecret && raw) {
      const ok = verifyNotionSignature(
        raw,
        req.header("x-notion-signature"),
        cfg.notionWebhookSecret,
      );
      if (!ok) return res.sendStatus(401);
    }
    const body = req.body as
      | NotionWebhookEvent
      | { verification_token?: string };

    // Notion sends a verification handshake when the webhook is first registered.
    if ("verification_token" in body && body.verification_token) {
      return res.json({ verification_token: body.verification_token });
    }

    const event = body as NotionWebhookEvent;
    const pageId = extractPageIdFromEvent(event);
    if (!pageId) return res.sendStatus(204);

    res.sendStatus(200);
    try {
      await handlePageUpdate(notion, memory, pageId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("handlePageUpdate failed:", err);
    }
  });

  return app;
}

export async function startServer(): Promise<void> {
  const cfg = loadConfig();
  const app = buildApp();
  app.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`LedgerMem Notion sync listening on :${cfg.port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Fatal:", err);
    process.exit(1);
  });
}
