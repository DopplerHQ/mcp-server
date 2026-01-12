import { describe, it, expect } from "vitest";
import { isProductionConfig } from "../src/access-warnings.js";

interface StartupContext {
  tokenType: string;
  readOnly: boolean;
  project?: string;
  config?: string;
}

// Mirror of warning generation logic from index.ts
function generateWarnings(ctx: StartupContext): string[] {
  const warnings: string[] = [];

  if (ctx.tokenType === "unknown") {
    warnings.push("CRITICAL: unknown token");
  }

  if (!ctx.readOnly && ctx.config && isProductionConfig(ctx.config)) {
    warnings.push(`CRITICAL: production config "${ctx.config}"`);
  }

  if (!ctx.readOnly) {
    warnings.push("WARNING: write access");
  }

  if (!ctx.project) {
    warnings.push("WARNING: full workspace access");
  }

  return warnings;
}

describe("isProductionConfig", () => {
  describe("exact matches", () => {
    it.each(["prod", "prd", "production", "live"])(
      "matches %s (case insensitive)",
      (config) => {
        expect(isProductionConfig(config)).toBe(true);
        expect(isProductionConfig(config.toUpperCase())).toBe(true);
        expect(
          isProductionConfig(config.charAt(0).toUpperCase() + config.slice(1)),
        ).toBe(true);
      },
    );
  });

  describe("suffix patterns", () => {
    it.each([
      "app_prod",
      "app_prd",
      "app_production",
      "app-prod",
      "app-prd",
      "app-production",
      "my-service_prod",
      "API_PROD",
    ])("matches %s", (config) => {
      expect(isProductionConfig(config)).toBe(true);
    });
  });

  describe("non-production configs", () => {
    it.each([
      "dev",
      "development",
      "staging",
      "stg",
      "test",
      "qa",
      "sandbox",
      "local",
      "prod_backup", // prod is prefix, not suffix
      "production_old",
      "my-product", // contains 'prod' but not as suffix
      "reproduce", // contains 'prod' substring
    ])("does not match %s", (config) => {
      expect(isProductionConfig(config)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(isProductionConfig("")).toBe(false);
    });

    it("handles single characters", () => {
      expect(isProductionConfig("p")).toBe(false);
    });
  });
});

describe("startup warnings generation", () => {
  describe("unknown token type", () => {
    it("emits critical warning for unknown token", () => {
      const warnings = generateWarnings({
        tokenType: "unknown",
        readOnly: true,
        project: "my-app",
      });

      expect(warnings).toContainEqual(expect.stringContaining("CRITICAL"));
      expect(warnings).toContainEqual(expect.stringContaining("unknown token"));
    });

    it("does not emit for known token types", () => {
      for (const tokenType of ["service_account", "personal", "cli"]) {
        const warnings = generateWarnings({
          tokenType,
          readOnly: true,
          project: "my-app",
        });

        expect(warnings.some((w) => w.includes("unknown token"))).toBe(false);
      }
    });
  });

  describe("production config with write access", () => {
    it("emits critical warning for production + write", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: false,
        project: "my-app",
        config: "production",
      });

      expect(warnings).toContainEqual(expect.stringContaining("CRITICAL"));
      expect(warnings).toContainEqual(
        expect.stringContaining("production config"),
      );
    });

    it("does not emit for production + read-only", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: true,
        project: "my-app",
        config: "production",
      });

      expect(warnings.some((w) => w.includes("production config"))).toBe(false);
    });

    it("does not emit for non-production configs", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: false,
        project: "my-app",
        config: "development",
      });

      expect(warnings.some((w) => w.includes("production config"))).toBe(false);
    });
  });

  describe("write access warning", () => {
    it("emits warning when write access is enabled", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: false,
        project: "my-app",
      });

      expect(warnings).toContainEqual(expect.stringContaining("write access"));
    });

    it("does not emit when read-only", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: true,
        project: "my-app",
      });

      expect(warnings.some((w) => w.includes("write access"))).toBe(false);
    });
  });

  describe("workspace scope warning", () => {
    it("emits warning when no project scope", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: true,
      });

      expect(warnings).toContainEqual(
        expect.stringContaining("full workspace access"),
      );
    });

    it("does not emit when project is scoped", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: true,
        project: "my-app",
      });

      expect(warnings.some((w) => w.includes("full workspace"))).toBe(false);
    });
  });

  describe("combined scenarios", () => {
    it("safest config: read-only + project-scoped + known token", () => {
      const warnings = generateWarnings({
        tokenType: "service_account",
        readOnly: true,
        project: "my-app",
        config: "development",
      });

      // Should have no warnings at all
      expect(warnings).toHaveLength(0);
    });

    it("riskiest config: write + no scope + unknown token + production", () => {
      const warnings = generateWarnings({
        tokenType: "unknown",
        readOnly: false,
        config: "production",
      });

      // Should have all warnings
      expect(warnings.length).toBeGreaterThanOrEqual(3);
      expect(warnings.some((w) => w.includes("CRITICAL"))).toBe(true);
      expect(warnings.some((w) => w.includes("write access"))).toBe(true);
      expect(warnings.some((w) => w.includes("full workspace"))).toBe(true);
    });
  });
});
