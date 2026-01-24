import { z } from "zod";
import { type TokenType } from "./auth.js";

export interface AccessContext {
  tokenType: TokenType;
  readOnly: boolean;
  project?: string;
  config?: string;
}

export type AccessLevel = "info" | "warning" | "critical";

export interface AccessMessage {
  level: AccessLevel;
  emoji: "ℹ️" | "⚠️" | "🚨";
  message: string;
}

/**
 * Check if config name indicates production (prod, prd, production, live).
 * Matches exact names and suffix patterns (*_prod, *-prod, etc).
 */
export function isProductionConfig(config: string): boolean {
  if (!config?.trim()) {
    return false;
  }

  const prodPatterns = [
    /^prod$/i,
    /^prd$/i,
    /^production$/i,
    /^live$/i,
    /_prod$/i,
    /_prd$/i,
    /_production$/i,
    /-prod$/i,
    /-prd$/i,
    /-production$/i,
  ];

  return prodPatterns.some((pattern) => pattern.test(config));
}

const TOKEN_TYPE_LABELS: Record<TokenType, string> = {
  service_token: "service token (project-scoped)",
  service_account: "service account",
  personal: "personal token",
  cli: "CLI token",
  scim: "SCIM token",
  unknown: "unknown",
};

export function getAccessMessages(ctx: AccessContext): AccessMessage[] {
  const messages: AccessMessage[] = [];

  // Info messages - always included to show current scope
  messages.push({
    level: "info",
    emoji: "ℹ️",
    message: `Token type: ${TOKEN_TYPE_LABELS[ctx.tokenType]}`,
  });

  if (ctx.project) {
    messages.push({
      level: "info",
      emoji: "ℹ️",
      message: `Project: ${ctx.project}`,
    });
  }

  if (ctx.config) {
    messages.push({
      level: "info",
      emoji: "ℹ️",
      message: `Config: ${ctx.config}`,
    });
  }

  if (ctx.readOnly) {
    messages.push({
      level: "info",
      emoji: "ℹ️",
      message: "Mode: read-only",
    });
  }

  // Critical messages - serious concerns
  if (ctx.tokenType === "unknown") {
    messages.push({
      level: "critical",
      emoji: "🚨",
      message: "UNKNOWN TOKEN TYPE - exercise extreme caution",
    });
  } else if (ctx.tokenType === "scim") {
    messages.push({
      level: "critical",
      emoji: "🚨",
      message:
        "SCIM TOKEN - intended for user provisioning, not secrets access",
    });
  }

  if (ctx.config && isProductionConfig(ctx.config)) {
    messages.push({
      level: "critical",
      emoji: "🚨",
      message: `PRODUCTION CONFIG: ${ctx.config}`,
    });
  }

  // Warning messages - elevated concerns
  if (!ctx.readOnly) {
    messages.push({
      level: "warning",
      emoji: "⚠️",
      message: "Write tools exposed - use caution when modifying secrets",
    });
  }

  if (!ctx.project) {
    messages.push({
      level: "warning",
      emoji: "⚠️",
      message: "No project filter applied",
    });
  }

  return messages;
}

/**
 * Create confirm_access tool requiring user acknowledgment before using Doppler tools.
 * Returns null if only info-level messages (safe mode).
 */
export function createConfirmAccessTool(ctx: AccessContext) {
  const messages = getAccessMessages(ctx);
  const infoMessages = messages.filter((m) => m.level === "info");
  const actionableMessages = messages.filter(
    (m) => m.level === "warning" || m.level === "critical",
  );

  if (actionableMessages.length === 0) {
    return null;
  }

  const description =
    "🛑 REQUIRED FIRST STEP: Call before any other Doppler tool. " +
    "Returns access level warnings that must be shown to the user for confirmation.";

  const scopeLines = infoMessages
    .map((m) => `  ${m.emoji} ${m.message}`)
    .join("\n");
  const warningLines = actionableMessages
    .map((w) => `  ${w.emoji} ${w.message}`)
    .join("\n");

  return {
    name: "confirm_access",
    description,
    parameters: z.object({}),
    execute: async () => {
      return `<security_confirmation required="true">
<instructions>
Before proceeding with any Doppler operations, you must obtain explicit user consent.
Display the access summary below to the user VERBATIM - do not summarize or rephrase.
The emojis and formatting are intentional for scannability.
</instructions>

<display_to_user>
Current access scope:
${scopeLines}

Warnings requiring confirmation:
${warningLines}
</display_to_user>

<then>
Ask the user: "Do you want me to proceed?"
Wait for explicit confirmation (e.g., "yes", "proceed", "go ahead") before calling any other Doppler tools.
</then>
</security_confirmation>`;
    },
  };
}
