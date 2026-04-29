import "dotenv/config";
import express, { type Request, type Response } from "express";
import { Client } from "@notionhq/client";
import { Mnemo } from "@getmnemo/memory";
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
  const memory = new Mnemo({
    apiKey: cfg.getmnemoApiKey,
    workspaceId: cfg.getmnemoWorkspaceId,
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

  // Bounded dedup of (pageId, lastEditedTime) so the same Notion edit doesn't
  // re-ingest if Notion redelivers the webhook.
  const seen = new Set<string>();
  const SEEN_MAX = 5000;
  const isDuplicate = (key: string): boolean => {
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > SEEN_MAX) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return false;
  };

  app.post("/webhook", async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    // Webhook secret is REQUIRED — refusing unsigned deliveries is the only
    // thing keeping a random caller from triggering Notion fetches against
    // the configured workspace token.
    if (!cfg.notionWebhookSecret) {
      console.error("rejecting webhook: NOTION_WEBHOOK_SECRET not configured");
      return res.sendStatus(503);
    }
    if (!raw) return res.sendStatus(400);
    const ok = verifyNotionSignature(
      raw,
      req.header("x-notion-signature"),
      cfg.notionWebhookSecret,
    );
    if (!ok) return res.sendStatus(401);

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
    // Use the delivery id from the header when present so retries of the same
    // delivery are dropped; fall back to pageId for older payload shapes.
    const deliveryId = req.header("x-notion-request-id") ?? pageId;
    if (isDuplicate(deliveryId)) return;
    try {
      await handlePageUpdate(notion, memory, pageId);
    } catch (err) {
      console.error("handlePageUpdate failed:", err);
    }
  });

  return app;
}

export async function startServer(): Promise<void> {
  const cfg = loadConfig();
  const app = buildApp();
  const server = app.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Mnemo Notion sync listening on :${cfg.port}`);
  });

  // Graceful shutdown — drain in-flight handlePageUpdate calls before exit so
  // SIGTERM doesn't tear down a Notion-block fetch mid-pagination and leave
  // half a page ingested.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, draining HTTP server…`);
    const force = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn("Shutdown timed out, forcing exit.");
      process.exit(1);
    }, 30_000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      process.exit(0);
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Fatal:", err);
    process.exit(1);
  });
}
