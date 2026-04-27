export interface AppConfig {
  notionToken: string;
  notionWorkspaceId: string;
  notionWebhookSecret?: string;
  ledgermemApiKey: string;
  ledgermemWorkspaceId: string;
  port: number;
}

const REQUIRED = [
  "NOTION_TOKEN",
  "NOTION_WORKSPACE_ID",
  "LEDGERMEM_API_KEY",
  "LEDGERMEM_WORKSPACE_ID",
] as const;

export function loadConfig(): AppConfig {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  return {
    notionToken: process.env.NOTION_TOKEN as string,
    notionWorkspaceId: process.env.NOTION_WORKSPACE_ID as string,
    notionWebhookSecret: process.env.NOTION_WEBHOOK_SECRET,
    ledgermemApiKey: process.env.LEDGERMEM_API_KEY as string,
    ledgermemWorkspaceId: process.env.LEDGERMEM_WORKSPACE_ID as string,
    port: Number(process.env.PORT ?? 8080),
  };
}
