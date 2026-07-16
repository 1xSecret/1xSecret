import { describe, expect, it } from "vitest";

import { lockoutSecondsFor } from "./retrieval-throttle";

describe("lockoutSecondsFor", () => {
  it("only locks on every 2nd failure", () => {
    expect(lockoutSecondsFor(0)).toBeNull();
    expect(lockoutSecondsFor(1)).toBeNull();
    expect(lockoutSecondsFor(3)).toBeNull();
    expect(lockoutSecondsFor(5)).toBeNull();
  });

  it("doubles the lockout each step from 30s", () => {
    expect(lockoutSecondsFor(2)).toBe(30);
    expect(lockoutSecondsFor(4)).toBe(60);
    expect(lockoutSecondsFor(6)).toBe(120);
    expect(lockoutSecondsFor(8)).toBe(240);
    expect(lockoutSecondsFor(10)).toBe(480);
  });

  it("caps the lockout at one hour", () => {
    // 2^n grows past the cap; every deep step stays clamped.
    expect(lockoutSecondsFor(20)).toBe(3600);
    expect(lockoutSecondsFor(100)).toBe(3600);
  });
});
