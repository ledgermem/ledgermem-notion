import { describe, it, expect, vi } from "vitest";
import {
  ingestPage,
  backfillWorkspace,
  extractPageIdFromEvent,
  handlePageUpdate,
  type MemoryClient,
} from "./sync.js";
import { extractTitle } from "./notion.js";

function makeMemory(): MemoryClient {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
  } as MemoryClient;
}

function makeNotion(opts: {
  blocks?: unknown[];
  searchPages?: unknown[];
  pageRetrieve?: unknown;
}) {
  return {
    blocks: {
      children: {
        list: vi.fn().mockResolvedValue({
          results: opts.blocks ?? [],
          has_more: false,
          next_cursor: null,
        }),
      },
    },
    search: vi.fn().mockResolvedValue({
      results: opts.searchPages ?? [],
      has_more: false,
      next_cursor: null,
    }),
    pages: {
      retrieve: vi.fn().mockResolvedValue(opts.pageRetrieve ?? {}),
    },
  } as unknown as Parameters<typeof ingestPage>[0];
}

describe("extractTitle", () => {
  it("returns Untitled for missing title", () => {
    expect(extractTitle({})).toBe("Untitled");
    expect(extractTitle(null)).toBe("Untitled");
  });

  it("extracts plain_text from a title property", () => {
    const props = {
      Name: { type: "title", title: [{ plain_text: "Hello" }] },
    };
    expect(extractTitle(props)).toBe("Hello");
  });
});

describe("ingestPage", () => {
  it("skips pages with no body text", async () => {
    const notion = makeNotion({ blocks: [] });
    const memory = makeMemory();
    const r = await ingestPage(notion, memory, {
      id: "p1",
      title: "Empty",
      url: "https://x",
      lastEditedTime: "2026-01-01T00:00:00Z",
    });
    expect(r.skipped).toBe(true);
    expect(memory.add).not.toHaveBeenCalled();
  });

  it("ingests page text with title prefix and metadata", async () => {
    const notion = makeNotion({
      blocks: [
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "hello" }] } },
        { type: "heading_1", heading_1: { rich_text: [{ plain_text: "world" }] } },
      ],
    });
    const memory = makeMemory();
    const r = await ingestPage(notion, memory, {
      id: "p2",
      title: "My Page",
      url: "https://notion.so/p2",
      lastEditedTime: "2026-01-02T00:00:00Z",
    });
    expect(r.skipped).toBe(false);
    expect(memory.add).toHaveBeenCalledTimes(1);
    const [content, opts] = (memory.add as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("# My Page");
    expect(content).toContain("hello");
    expect(content).toContain("world");
    expect(opts.metadata.source).toBe("notion");
    expect(opts.metadata.threadId).toBe("p2");
    expect(opts.metadata.url).toBe("https://notion.so/p2");
  });
});

describe("backfillWorkspace", () => {
  it("walks the workspace and aggregates a summary", async () => {
    const notion = makeNotion({
      searchPages: [
        {
          object: "page",
          id: "p1",
          url: "u1",
          last_edited_time: "t1",
          properties: { Name: { type: "title", title: [{ plain_text: "A" }] } },
        },
        {
          object: "page",
          id: "p2",
          url: "u2",
          last_edited_time: "t2",
          properties: { Name: { type: "title", title: [{ plain_text: "B" }] } },
        },
      ],
      blocks: [
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } },
      ],
    });
    const memory = makeMemory();
    const summary = await backfillWorkspace(notion, memory);
    expect(summary.total).toBe(2);
    expect(summary.ingested).toBe(2);
    expect(memory.add).toHaveBeenCalledTimes(2);
  });
});

describe("extractPageIdFromEvent", () => {
  it("reads page.id", () => {
    expect(extractPageIdFromEvent({ page: { id: "abc" } })).toBe("abc");
  });

  it("reads entity.id when type is page", () => {
    expect(
      extractPageIdFromEvent({ entity: { id: "xyz", type: "page" } }),
    ).toBe("xyz");
  });

  it("returns null when nothing matches", () => {
    expect(extractPageIdFromEvent({})).toBeNull();
    expect(
      extractPageIdFromEvent({ entity: { id: "x", type: "database" } }),
    ).toBeNull();
  });
});

describe("handlePageUpdate", () => {
  it("retrieves the page and ingests it", async () => {
    const notion = makeNotion({
      pageRetrieve: {
        id: "p9",
        url: "https://n",
        last_edited_time: "t",
        properties: { Name: { type: "title", title: [{ plain_text: "P9" }] } },
      },
      blocks: [
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } },
      ],
    });
    const memory = makeMemory();
    const r = await handlePageUpdate(notion, memory, "p9");
    expect(r.skipped).toBe(false);
    expect(memory.add).toHaveBeenCalled();
  });
});
