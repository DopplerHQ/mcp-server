import { describe, it, expect } from "vitest";
import { ScopeViolationError } from "../src/errors.js";

describe("ScopeViolationError", () => {
  it("is an instance of Error", () => {
    const error = new ScopeViolationError("test message");
    expect(error).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const error = new ScopeViolationError("test message");
    expect(error.name).toBe("ScopeViolationError");
  });

  it("preserves the message", () => {
    const error = new ScopeViolationError("Project scope violation");
    expect(error.message).toBe("Project scope violation");
  });

  it("can be caught as Error", () => {
    const error = new ScopeViolationError("test");

    try {
      throw error;
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ScopeViolationError);
    }
  });
});
