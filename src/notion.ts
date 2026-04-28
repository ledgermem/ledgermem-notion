import type { Client } from "@notionhq/client";

interface RichTextItem {
  plain_text?: string;
}

interface NotionRateLimitError {
  code?: string;
  status?: number;
  headers?: { get?(name: string): string | null } | Record<string, string>;
}

function getRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as NotionRateLimitError;
  if (e.status !== 429 && e.code !== "rate_limited") return null;
  const headers = e.headers;
  let raw: string | null = null;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    raw = (headers as { get(name: string): string | null }).get("retry-after");
  } else if (headers && typeof headers === "object") {
    const h = headers as Record<string, string>;
    raw = h["retry-after"] ?? h["Retry-After"] ?? null;
  }
  const seconds = raw ? Number(raw) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return 1000;
  return Math.min(seconds * 1000, 60_000);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a Notion SDK call with exponential-ish 429 retry. Notion sets
 * `retry-after` on rate-limit responses and the SDK surfaces the header on
 * the thrown error; we honor it instead of silently swallowing the failure.
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const wait = getRetryAfterMs(err);
      if (wait === null || attempt >= maxRetries) throw err;
      await sleep(wait);
      attempt += 1;
    }
  }
}

interface BlockBase {
  type: string;
  has_children?: boolean;
  id?: string;
}

type BlockMap = Record<string, { rich_text?: RichTextItem[] }>;

const TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "quote",
  "callout",
  "toggle",
  "code",
]);

function richTextToString(rt: RichTextItem[] | undefined): string {
  if (!rt) return "";
  return rt.map((t) => t.plain_text ?? "").join("");
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
}

export function extractTitle(properties: unknown): string {
  if (!properties || typeof properties !== "object") return "Untitled";
  for (const prop of Object.values(properties as Record<string, unknown>)) {
    if (
      prop &&
      typeof prop === "object" &&
      "type" in prop &&
      (prop as { type: string }).type === "title"
    ) {
      const title = (prop as { title?: RichTextItem[] }).title;
      const text = richTextToString(title);
      return text || "Untitled";
    }
  }
  return "Untitled";
}

// Cap recursion depth so a pathological deeply-nested page can't stall the
// sync. Notion's UI rarely renders past ~10 levels of nesting in practice.
const MAX_BLOCK_DEPTH = 10;

async function collectBlockText(
  notion: Client,
  blockId: string,
  depth: number,
  out: string[],
): Promise<void> {
  let cursor: string | undefined;
  do {
    const res = await withRateLimitRetry(() =>
      notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      }),
    );
    for (const block of res.results as Array<BlockBase & BlockMap>) {
      if (TEXT_BLOCK_TYPES.has(block.type)) {
        const blockBody = (
          block as unknown as Record<string, { rich_text?: RichTextItem[] }>
        )[block.type];
        const text = richTextToString(blockBody?.rich_text);
        if (text) out.push(text);
      }
      // Toggles, list items, callouts, etc. nest their content as children.
      // Without recursion the synced memory only contains the top-level row
      // and silently drops everything inside, which made `recall` miss text
      // that was clearly present on the page.
      if (block.has_children && block.id && depth < MAX_BLOCK_DEPTH) {
        await collectBlockText(notion, block.id, depth + 1, out);
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
}

export async function fetchPageText(
  notion: Client,
  pageId: string,
): Promise<string> {
  const parts: string[] = [];
  await collectBlockText(notion, pageId, 0, parts);
  return parts.join("\n");
}

export async function* iterateWorkspacePages(
  notion: Client,
): AsyncGenerator<NotionPage> {
  let cursor: string | undefined;
  do {
    const res = await withRateLimitRetry(() =>
      notion.search({
        filter: { property: "object", value: "page" },
        page_size: 100,
        start_cursor: cursor,
      }),
    );
    for (const item of res.results) {
      if (item.object !== "page") continue;
      const page = item as unknown as {
        id: string;
        url: string;
        last_edited_time: string;
        properties: unknown;
      };
      yield {
        id: page.id,
        title: extractTitle(page.properties),
        url: page.url,
        lastEditedTime: page.last_edited_time,
      };
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
}
