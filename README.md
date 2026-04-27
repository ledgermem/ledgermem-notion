# LedgerMem Notion

Notion connector for [LedgerMem](https://ledgermem.dev). Two execution modes:

- **`notion-import`** — backfill: walks the workspace and ingests every page's text content as a memory
- **`notion-sync`** — webhook listener: when Notion sends a page-update event, the page is re-ingested

## Features

- Streams workspace pages via the Notion `search` API with cursor pagination
- Pulls page content via `blocks.children.list`, flattens supported block types into plain text
- Re-ingests on `page.updated` (and similar) webhook events; supports both `page.id` and the newer `entity.id` payload shape
- Handles the Notion webhook verification handshake automatically
- Optional `X-Notion-Signature` HMAC validation when `NOTION_WEBHOOK_SECRET` is set

## Setup

1. Create an internal integration at https://www.notion.so/my-integrations
2. Copy the **Integration Token** — this is `NOTION_TOKEN`
3. Share the workspace pages (or a top-level page) with your integration so it has read access
4. For sync: register a webhook in your integration settings pointing at `https://your-host/webhook`

_Screenshots: `docs/notion-integration.png` (placeholder)_

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NOTION_TOKEN` | yes | Internal integration token (`secret_...`) |
| `NOTION_WORKSPACE_ID` | yes | Notion workspace identifier (used in metadata) |
| `NOTION_WEBHOOK_SECRET` | no | If set, enforces `X-Notion-Signature` HMAC validation |
| `LEDGERMEM_API_KEY` | yes | LedgerMem API key |
| `LEDGERMEM_WORKSPACE_ID` | yes | LedgerMem workspace id |
| `PORT` | no | Webhook port (default `8080`) |

## Run

```bash
cp .env.example .env
npm install

# Backfill the workspace (one-shot):
npm run import

# Run the webhook listener:
npm run dev
npm test
```

## Deploy

- **Backfill as a job:** `docker run --env-file .env --entrypoint node ledgermem-notion dist/cli.js notion-import`
- **Webhook listener:** `docker run --env-file .env -p 8080:8080 ledgermem-notion`
- **Cron-style backfill:** wire the `notion-import` command to a Kubernetes CronJob, ECS scheduled task, or GitHub Actions schedule

## License

MIT
