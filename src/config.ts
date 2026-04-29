export interface AppConfig {
  notionToken: string;
  notionWorkspaceId: string;
  notionWebhookSecret?: string;
  getmnemoApiKey: string;
  getmnemoWorkspaceId: string;
  port: number;
}

const REQUIRED = [
  "NOTION_TOKEN",
  "NOTION_WORKSPACE_ID",
  "GETMNEMO_API_KEY",
  "GETMNEMO_WORKSPACE_ID",
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
    getmnemoApiKey: process.env.GETMNEMO_API_KEY as string,
    getmnemoWorkspaceId: process.env.GETMNEMO_WORKSPACE_ID as string,
    port: Number(process.env.PORT ?? 8080),
  };
}
