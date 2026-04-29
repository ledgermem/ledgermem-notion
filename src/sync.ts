import type { Client } from "@notionhq/client";
import type { Mnemo } from "@getmnemo/memory";
import { fetchPageText, iterateWorkspacePages, type NotionPage } from "./notion.js";

export interface MemoryClient {
  add: Mnemo["add"];
  search: Mnemo["search"];
}

export interface IngestResult {
  pageId: string;
  title: string;
  bytes: number;
  skipped: boolean;
}

export async function ingestPage(
  notion: Client,
  memory: MemoryClient,
  page: NotionPage,
): Promise<IngestResult> {
  const body = await fetchPageText(notion, page.id);
  if (!body.trim()) {
    return { pageId: page.id, title: page.title, bytes: 0, skipped: true };
  }
  const content = `# ${page.title}\n\n${body}`;
  await memory.add(content, {
    metadata: {
      source: "notion",
      threadId: page.id,
      userId: "notion-sync",
      url: page.url,
      lastEditedTime: page.lastEditedTime,
      title: page.title,
    },
  });
  return {
    pageId: page.id,
    title: page.title,
    bytes: content.length,
    skipped: false,
  };
}

export interface BackfillSummary {
  total: number;
  ingested: number;
  skipped: number;
  errors: number;
}

export async function backfillWorkspace(
  notion: Client,
  memory: MemoryClient,
  onProgress?: (r: IngestResult) => void,
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    total: 0,
    ingested: 0,
    skipped: 0,
    errors: 0,
  };
  for await (const page of iterateWorkspacePages(notion)) {
    summary.total += 1;
    try {
      const r = await ingestPage(notion, memory, page);
      if (r.skipped) summary.skipped += 1;
      else summary.ingested += 1;
      onProgress?.(r);
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}

export interface NotionWebhookEvent {
  type?: string;
  page?: { id?: string };
  entity?: { id?: string; type?: string };
}

/**
 * Pull a page id out of a Notion webhook payload regardless of whether it's
 * the simpler `page.id` shape or the newer `entity.id` shape.
 */
export function extractPageIdFromEvent(event: NotionWebhookEvent): string | null {
  if (event.page?.id) return event.page.id;
  if (event.entity?.id && event.entity.type === "page") return event.entity.id;
  return null;
}

export async function handlePageUpdate(
  notion: Client,
  memory: MemoryClient,
  pageId: string,
): Promise<IngestResult> {
  const res = await notion.pages.retrieve({ page_id: pageId });
  const page = res as unknown as {
    id: string;
    url: string;
    last_edited_time: string;
    properties: unknown;
  };
  const { extractTitle } = await import("./notion.js");
  const ingestable: NotionPage = {
    id: page.id,
    title: extractTitle(page.properties),
    url: page.url,
    lastEditedTime: page.last_edited_time,
  };
  return ingestPage(notion, memory, ingestable);
}
