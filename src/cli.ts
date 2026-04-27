#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { Client } from "@notionhq/client";
import { LedgerMem } from "@ledgermem/memory";
import { loadConfig } from "./config.js";
import { backfillWorkspace } from "./sync.js";

const program = new Command();
program
  .name("ledgermem-notion")
  .description("LedgerMem connector for Notion");

program
  .command("notion-import")
  .description("Walk the Notion workspace and ingest every page into LedgerMem")
  .action(async () => {
    const cfg = loadConfig();
    const notion = new Client({ auth: cfg.notionToken });
    const memory = new LedgerMem({
      apiKey: cfg.ledgermemApiKey,
      workspaceId: cfg.ledgermemWorkspaceId,
    });
    const summary = await backfillWorkspace(notion, memory, (r) => {
      const tag = r.skipped ? "skip" : "ingest";
      // eslint-disable-next-line no-console
      console.log(`[${tag}] ${r.pageId} ${r.title} (${r.bytes} bytes)`);
    });
    // eslint-disable-next-line no-console
    console.log(
      `Done. total=${summary.total} ingested=${summary.ingested} skipped=${summary.skipped} errors=${summary.errors}`,
    );
  });

program
  .command("notion-sync")
  .description("Run the webhook listener (alias for `npm start`)")
  .action(async () => {
    const { startServer } = await import("./server.js");
    await startServer();
  });

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
