import { describe, it, expect } from "vitest";
import { detectTokenType, type TokenType } from "../src/auth.js";
import {
  isProductionConfig,
  getAccessMessages,
  createConfirmAccessTool,
  type AccessContext,
  type AccessMessage,
} from "../src/access-warnings.js";

// =============================================================================
// Token Type Detection
// =============================================================================

describe("detectTokenType", () => {
  describe("service tokens (dp.st.*)", () => {
    it("detects service tokens (project/config scoped)", () => {
      expect(detectTokenType("dp.st.abc123")).toBe("service_token");
      expect(detectTokenType("dp.st.xxx.yyy.zzz")).toBe("service_token");
    });

    it("handles minimal valid service token", () => {
      expect(detectTokenType("dp.st.x")).toBe("service_token");
    });
  });

  describe("service account tokens (dp.sa.*)", () => {
    it("detects service account tokens (workspace automation)", () => {
      expect(detectTokenType("dp.sa.abc123")).toBe("service_account");
      expect(detectTokenType("dp.sa.xxx.yyy.zzz")).toBe("service_account");
    });

    it("handles minimal valid service account token", () => {
      expect(detectTokenType("dp.sa.x")).toBe("service_account");
    });
  });

  describe("SCIM tokens (dp.scim.*)", () => {
    it("detects SCIM tokens", () => {
      expect(detectTokenType("dp.scim.abc123")).toBe("scim");
    });
  });

  describe("personal tokens (dp.pt.*)", () => {
    it("detects personal tokens", () => {
      expect(detectTokenType("dp.pt.abc123")).toBe("personal");
      expect(detectTokenType("dp.pt.xxx.yyy")).toBe("personal");
    });

    it("handles minimal valid personal token", () => {
      expect(detectTokenType("dp.pt.x")).toBe("personal");
    });
  });

  describe("CLI tokens (dp.ct.*)", () => {
    it("detects CLI tokens", () => {
      expect(detectTokenType("dp.ct.abc123")).toBe("cli");
      expect(detectTokenType("dp.ct.xxx.yyy")).toBe("cli");
    });

    it("handles minimal valid CLI token", () => {
      expect(detectTokenType("dp.ct.x")).toBe("cli");
    });
  });

  describe("unknown tokens", () => {
    it("returns unknown for unrecognized prefixes", () => {
      expect(detectTokenType("dp.xx.abc123")).toBe("unknown");
      expect(detectTokenType("dp.personal.abc123")).toBe("unknown");
      expect(detectTokenType("dp.foo.abc123")).toBe("unknown");
    });

    it("returns unknown for malformed tokens", () => {
      expect(detectTokenType("invalid-token")).toBe("unknown");
      expect(detectTokenType("not-a-doppler-token")).toBe("unknown");
      expect(detectTokenType("abc123")).toBe("unknown");
    });

    it("returns unknown for empty or whitespace input", () => {
      expect(detectTokenType("")).toBe("unknown");
      expect(detectTokenType("   ")).toBe("unknown");
    });

    it("returns unknown for tokens missing required parts", () => {
      expect(detectTokenType("dp.")).toBe("unknown");
      expect(detectTokenType("dp")).toBe("unknown");
      expect(detectTokenType("dp.st")).toBe("unknown"); // missing third part
      expect(detectTokenType("dp.st.")).toBe("unknown"); // empty third part
    });

    it("returns unknown for tokens with wrong prefix", () => {
      expect(detectTokenType("doppler.st.abc")).toBe("unknown");
      expect(detectTokenType("DP.st.abc")).toBe("unknown"); // case sensitive
      expect(detectTokenType("dpp.st.abc")).toBe("unknown");
    });
  });
});

// =============================================================================
// Production Config Detection
// =============================================================================

describe("isProductionConfig", () => {
  describe("exact production matches (case insensitive)", () => {
    it.each(["prod", "prd", "production", "live"])(
      'matches "%s" as production',
      (config) => {
        expect(isProductionConfig(config)).toBe(true);
      },
    );

    it("matches regardless of case", () => {
      expect(isProductionConfig("PROD")).toBe(true);
      expect(isProductionConfig("Prod")).toBe(true);
      expect(isProductionConfig("PRODUCTION")).toBe(true);
      expect(isProductionConfig("Production")).toBe(true);
      expect(isProductionConfig("LIVE")).toBe(true);
      expect(isProductionConfig("Live")).toBe(true);
      expect(isProductionConfig("PRD")).toBe(true);
      expect(isProductionConfig("Prd")).toBe(true);
    });
  });

  describe("suffix patterns with underscore", () => {
    it.each([
      "app_prod",
      "app_prd",
      "app_production",
      "my_service_prod",
      "api_prod",
      "backend_production",
    ])('matches "%s" as production', (config) => {
      expect(isProductionConfig(config)).toBe(true);
    });

    it("matches suffix patterns case insensitively", () => {
      expect(isProductionConfig("APP_PROD")).toBe(true);
      expect(isProductionConfig("App_Prod")).toBe(true);
      expect(isProductionConfig("app_PRODUCTION")).toBe(true);
    });
  });

  describe("suffix patterns with hyphen", () => {
    it.each([
      "app-prod",
      "app-prd",
      "app-production",
      "my-service-prod",
      "api-prod",
      "backend-production",
    ])('matches "%s" as production', (config) => {
      expect(isProductionConfig(config)).toBe(true);
    });

    it("matches hyphen suffix patterns case insensitively", () => {
      expect(isProductionConfig("APP-PROD")).toBe(true);
      expect(isProductionConfig("App-Prod")).toBe(true);
      expect(isProductionConfig("app-PRODUCTION")).toBe(true);
    });
  });

  describe("non-production configs", () => {
    it.each([
      "dev",
      "development",
      "staging",
      "stg",
      "test",
      "testing",
      "qa",
      "sandbox",
      "local",
      "ci",
      "preview",
    ])('does not match "%s" as production', (config) => {
      expect(isProductionConfig(config)).toBe(false);
    });

    it("does not match when prod is a prefix, not suffix", () => {
      expect(isProductionConfig("prod_backup")).toBe(false);
      expect(isProductionConfig("production_old")).toBe(false);
      expect(isProductionConfig("prod-backup")).toBe(false);
      expect(isProductionConfig("production-archive")).toBe(false);
    });

    it("does not match when prod is a substring", () => {
      expect(isProductionConfig("reproduce")).toBe(false);
      expect(isProductionConfig("my-product")).toBe(false);
      expect(isProductionConfig("productivity")).toBe(false);
      expect(isProductionConfig("introduction")).toBe(false);
    });

    it("does not match development environments with similar naming", () => {
      expect(isProductionConfig("dev_prod_mirror")).toBe(false); // prod in middle
      expect(isProductionConfig("preprod")).toBe(false); // prefix without separator
      expect(isProductionConfig("nonprod")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(isProductionConfig("")).toBe(false);
    });

    it("handles whitespace", () => {
      expect(isProductionConfig("   ")).toBe(false);
      expect(isProductionConfig(" prod ")).toBe(false); // has spaces
    });

    it("handles special characters", () => {
      expect(isProductionConfig("prod!")).toBe(false);
      expect(isProductionConfig("prod@live")).toBe(false);
    });
  });
});

// =============================================================================
// Access Messages Generation
// =============================================================================

describe("getAccessMessages", () => {
  // ---------------------------------------------------------------------------
  // Info-level messages (always shown, no confirmation needed)
  // ---------------------------------------------------------------------------
  describe("scope info messages", () => {
    it("includes token type info for all known token types", () => {
      const knownTypes: TokenType[] = [
        "service_token",
        "service_account",
        "personal",
        "cli",
        "scim",
      ];

      for (const tokenType of knownTypes) {
        const ctx: AccessContext = {
          tokenType,
          readOnly: true,
          project: "my-app",
        };

        const messages = getAccessMessages(ctx);
        const tokenInfo = messages.find(
          (m) => m.level === "info" && m.message.includes("Token type"),
        );

        expect(tokenInfo).toBeDefined();
        expect(tokenInfo?.emoji).toBe("ℹ️");
      }
    });

    it("includes project scope info when project is set", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: true,
        project: "my-app",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "info",
        emoji: "ℹ️",
        message: "Project: my-app",
      });
    });

    it("includes config scope info when config is set", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: true,
        project: "my-app",
        config: "development",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "info",
        emoji: "ℹ️",
        message: "Config: development",
      });
    });

    it("includes read-only info when in read-only mode", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: true,
        project: "my-app",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "info",
        emoji: "ℹ️",
        message: "Mode: read-only",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Critical-level messages (require confirmation)
  // ---------------------------------------------------------------------------
  describe("critical messages", () => {
    it("emits critical message for unknown token type", () => {
      const ctx: AccessContext = {
        tokenType: "unknown",
        readOnly: true,
        project: "my-app",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "critical",
        emoji: "🚨",
        message: expect.stringContaining("UNKNOWN TOKEN TYPE"),
      });
    });

    it("emits critical message for SCIM token type", () => {
      const ctx: AccessContext = {
        tokenType: "scim",
        readOnly: true,
        project: "my-app",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "critical",
        emoji: "🚨",
        message: expect.stringContaining("SCIM TOKEN"),
      });
    });

    it("emits critical message for production configs", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: false,
        project: "my-app",
        config: "production",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "critical",
        emoji: "🚨",
        message: expect.stringContaining("PRODUCTION CONFIG"),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Warning-level messages (require confirmation)
  // ---------------------------------------------------------------------------
  describe("warning messages", () => {
    it("emits warning for write access enabled", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: false,
        project: "my-app",
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "warning",
        emoji: "⚠️",
        message: expect.stringContaining("Write tools exposed"),
      });
    });

    it("emits warning when no project scope (full workspace access)", () => {
      const ctx: AccessContext = {
        tokenType: "service_account",
        readOnly: true,
      };

      const messages = getAccessMessages(ctx);

      expect(messages).toContainEqual({
        level: "warning",
        emoji: "⚠️",
        message: expect.stringContaining("No project filter applied"),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Safe mode (info only, no warnings or critical)
  // ---------------------------------------------------------------------------
  describe("safe mode", () => {
    it("returns only info messages for fully safe config", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: true,
        project: "my-app",
        config: "development",
      };

      const messages = getAccessMessages(ctx);
      const nonInfoMessages = messages.filter((m) => m.level !== "info");

      expect(nonInfoMessages).toHaveLength(0);
      expect(messages.length).toBeGreaterThan(0); // Should still have info messages
    });

    it("includes all scope info even in safe mode", () => {
      const ctx: AccessContext = {
        tokenType: "service_token",
        readOnly: true,
        project: "my-app",
        config: "development",
      };

      const messages = getAccessMessages(ctx);
      const infoMessages = messages.filter((m) => m.level === "info");

      // Should have: token type, project, config, mode
      expect(infoMessages.length).toBeGreaterThanOrEqual(4);
    });
  });
});

// =============================================================================
// Confirm Access Tool
// =============================================================================

describe("createConfirmAccessTool", () => {
  it("returns null when only info-level messages (safe mode)", () => {
    const ctx: AccessContext = {
      tokenType: "service_token",
      readOnly: true,
      project: "my-app",
      config: "development",
    };

    const tool = createConfirmAccessTool(ctx);

    // Info messages exist but don't trigger confirmation
    expect(tool).toBeNull();
  });

  it("returns tool when there are warning-level messages", () => {
    const ctx: AccessContext = {
      tokenType: "service_token",
      readOnly: false, // This triggers a warning
      project: "my-app",
    };

    const tool = createConfirmAccessTool(ctx);

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("confirm_access");
  });

  it("returns tool when there are critical-level messages", () => {
    const ctx: AccessContext = {
      tokenType: "unknown", // This triggers a critical
      readOnly: true,
      project: "my-app",
    };

    const tool = createConfirmAccessTool(ctx);

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("confirm_access");
  });

  it("tool description indicates it is required first step", () => {
    const ctx: AccessContext = {
      tokenType: "service_account",
      readOnly: false,
    };

    const tool = createConfirmAccessTool(ctx);

    expect(tool?.description).toContain("REQUIRED FIRST STEP");
  });

  it("tool execute includes both scope info and warnings", async () => {
    const ctx: AccessContext = {
      tokenType: "service_token",
      readOnly: false,
      project: "my-app",
    };

    const tool = createConfirmAccessTool(ctx);
    const result = await tool?.execute({});

    // XML structure
    expect(result).toContain("<security_confirmation");
    expect(result).toContain("<display_to_user>");
    // Should contain scope info section
    expect(result).toContain("ℹ️");
    expect(result).toContain("Project: my-app");
    expect(result).toContain("Token type:");
    // Should contain warnings section
    expect(result).toContain("Write tools exposed");
    expect(result).toContain("Do you want me to proceed?");
  });

  it("tool execute shows all scope info even with multiple warnings", async () => {
    const ctx: AccessContext = {
      tokenType: "unknown",
      readOnly: false,
      config: "production",
    };

    const tool = createConfirmAccessTool(ctx);
    const result = await tool?.execute({});

    // Scope info
    expect(result).toContain("Token type:");
    expect(result).toContain("Config: production");
    // Warnings
    expect(result).toContain("UNKNOWN TOKEN TYPE");
    expect(result).toContain("Write tools exposed");
    expect(result).toContain("No project filter applied");
    expect(result).toContain("PRODUCTION CONFIG");
  });

  it("tool includes production warning when connected to production", async () => {
    const ctx: AccessContext = {
      tokenType: "service_token",
      readOnly: false,
      project: "my-app",
      config: "prod",
    };

    const tool = createConfirmAccessTool(ctx);
    const result = await tool?.execute({});

    expect(result).toContain("PRODUCTION CONFIG");
  });
});

// =============================================================================
// Combined Scenarios
// =============================================================================

describe("combined scenarios", () => {
  it("safest config: read-only + project-scoped + service_token + non-prod", () => {
    const ctx: AccessContext = {
      tokenType: "service_token",
      readOnly: true,
      project: "my-app",
      config: "development",
    };

    const messages = getAccessMessages(ctx);
    const tool = createConfirmAccessTool(ctx);

    // All messages should be info level
    expect(messages.every((m) => m.level === "info")).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    expect(tool).toBeNull();
  });

  it("riskiest config: write + no scope + unknown token + production", () => {
    const ctx: AccessContext = {
      tokenType: "unknown",
      readOnly: false,
      config: "production",
    };

    const messages = getAccessMessages(ctx);
    const tool = createConfirmAccessTool(ctx);

    // Should have warnings and criticals
    expect(messages.some((m) => m.level === "warning")).toBe(true);
    expect(messages.some((m) => m.level === "critical")).toBe(true);
    expect(tool).not.toBeNull();
  });
});
