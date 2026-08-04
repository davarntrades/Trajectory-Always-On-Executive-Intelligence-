/**
 * Connector definitions.
 *
 * Each declares its capabilities and the permission ceiling for each. The
 * ceiling is a hard cap: a policy can lower a capability's tier but can never
 * raise it above what is declared here. `send_email` can reach `execute` only
 * because this file says it may — and even then only if a policy opts in.
 *
 * Phase 1 ships the interfaces and capability declarations. Phase 2 fills in
 * `pull` with real OAuth clients; nothing downstream changes when it does.
 */

import { defineConnector, register } from "./registry";

export { allConnectors, configuredConnectors, getConnector, register, toEvent } from "./registry";

export const gmail = register(
  defineConnector({
    id: "gmail",
    name: "Gmail",
    description: "Inbound and outbound mail. Drives waiting-item and follow-up detection.",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    capabilities: [
      { id: "read_messages", description: "Read message metadata and bodies", maxTier: "observe" },
      { id: "draft_email", description: "Compose a draft without sending", maxTier: "draft" },
      { id: "send_email", description: "Send mail on Davarn's behalf", maxTier: "execute" },
    ],
  }),
);

export const calendar = register(
  defineConnector({
    id: "calendar",
    name: "Google Calendar",
    description: "Meetings, cancellations and free time. Drives daily shape and urgency.",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CALENDAR_REFRESH_TOKEN"],
    capabilities: [
      { id: "read_events", description: "Read calendar events", maxTier: "observe" },
      { id: "propose_time", description: "Suggest a meeting slot", maxTier: "recommend" },
      { id: "create_event", description: "Book a meeting", maxTier: "approve" },
    ],
  }),
);

export const github = register(
  defineConnector({
    id: "github",
    name: "GitHub",
    description: "PRs, issues, merges, releases. The primary project momentum signal.",
    requiredEnv: ["GITHUB_TOKEN"],
    capabilities: [
      { id: "read_activity", description: "Read repo activity", maxTier: "observe" },
      { id: "comment", description: "Comment on an issue or PR", maxTier: "approve" },
    ],
  }),
);

export const notion = register(
  defineConnector({
    id: "notion",
    name: "Notion",
    description: "Project docs, specs and task boards.",
    requiredEnv: ["NOTION_TOKEN"],
    capabilities: [
      { id: "read_pages", description: "Read pages and databases", maxTier: "observe" },
      { id: "update_page", description: "Write to a page", maxTier: "approve" },
    ],
  }),
);

export const slack = register(
  defineConnector({
    id: "slack",
    name: "Slack",
    description: "Team and customer channels.",
    requiredEnv: ["SLACK_BOT_TOKEN"],
    capabilities: [
      { id: "read_messages", description: "Read channel messages", maxTier: "observe" },
      { id: "post_message", description: "Post to a channel", maxTier: "approve" },
    ],
  }),
);

export const linear = register(
  defineConnector({
    id: "linear",
    name: "Linear",
    description: "Issue tracking and cycle progress.",
    requiredEnv: ["LINEAR_API_KEY"],
    capabilities: [
      { id: "read_issues", description: "Read issues and cycles", maxTier: "observe" },
      { id: "create_issue", description: "Create an issue", maxTier: "approve" },
      { id: "update_issue", description: "Update issue state", maxTier: "approve" },
    ],
  }),
);

export const drive = register(
  defineConnector({
    id: "drive",
    name: "Google Drive",
    description: "Documents, proposals and contracts.",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DRIVE_REFRESH_TOKEN"],
    capabilities: [
      { id: "read_files", description: "Read file metadata and contents", maxTier: "observe" },
      { id: "create_doc", description: "Create a document", maxTier: "draft" },
    ],
  }),
);

/**
 * MCP servers register as a connector whose capabilities are discovered at
 * runtime rather than declared. Until discovery lands, the ceiling stays at
 * `approve` — an unknown tool never gets autonomous execution.
 */
export const mcp = register(
  defineConnector({
    id: "mcp",
    name: "MCP Servers",
    description: "Model Context Protocol servers. Capabilities discovered at runtime.",
    requiredEnv: ["MCP_SERVER_URL"],
    capabilities: [
      { id: "discover", description: "Enumerate tools exposed by the server", maxTier: "observe" },
      { id: "invoke_tool", description: "Call a discovered tool", maxTier: "approve" },
    ],
  }),
);
