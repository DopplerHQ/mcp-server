import { describe, it, expect } from "vitest";
import { detectTokenType, type TokenType } from "../src/auth.js";

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
    });
  });

  describe("CLI tokens (dp.ct.*)", () => {
    it("detects CLI tokens", () => {
      expect(detectTokenType("dp.ct.abc123")).toBe("cli");
    });
  });

  describe("unknown tokens", () => {
    it("returns unknown for unrecognized prefixes", () => {
      expect(detectTokenType("dp.xx.abc123")).toBe("unknown");
    });

    it("returns unknown for malformed tokens", () => {
      expect(detectTokenType("invalid-token")).toBe("unknown");
      expect(detectTokenType("")).toBe("unknown");
    });

    it("returns unknown for tokens missing required parts", () => {
      expect(detectTokenType("dp.st")).toBe("unknown");
      expect(detectTokenType("dp.st.")).toBe("unknown");
    });
  });
});
