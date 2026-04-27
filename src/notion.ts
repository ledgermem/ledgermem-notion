import type { Client } from "@notionhq/client";

interface RichTextItem {
  plain_text?: string;
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

export async function fetchPageText(
  notion: Client,
  pageId: string,
): Promise<string> {
  const parts: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of res.results as Array<BlockBase & BlockMap>) {
      if (!TEXT_BLOCK_TYPES.has(block.type)) continue;
      const blockBody = (block as unknown as Record<string, { rich_text?: RichTextItem[] }>)[
        block.type
      ];
      const text = richTextToString(blockBody?.rich_text);
      if (text) parts.push(text);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return parts.join("\n");
}

export async function* iterateWorkspacePages(
  notion: Client,
): AsyncGenerator<NotionPage> {
  let cursor: string | undefined;
  do {
    const res = await notion.search({
      filter: { property: "object", value: "page" },
      page_size: 100,
      start_cursor: cursor,
    });
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
