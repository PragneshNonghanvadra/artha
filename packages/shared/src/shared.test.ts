import { describe, expect, test } from "bun:test";
import { CATEGORIES, INDIA_DEFAULT_PROFILE, monthKey, normalizeDescription, normalizeMoney } from "./index";

describe("shared finance defaults", () => {
  test("uses India-first vault defaults without hard-coding global assumptions", () => {
    expect(INDIA_DEFAULT_PROFILE.country).toBe("IN");
    expect(INDIA_DEFAULT_PROFILE.baseCurrency).toBe("INR");
    expect(INDIA_DEFAULT_PROFILE.fiscalYearStartMonth).toBe(4);
    expect(INDIA_DEFAULT_PROFILE.timezone).toBe("Asia/Kolkata");
  });

  test("keeps the initial category set stable", () => {
    expect(CATEGORIES).toContain("Income");
    expect(CATEGORIES).toContain("Investments");
    expect(CATEGORIES).toContain("Transfers");
    expect(CATEGORIES).toContain("Uncategorized");
  });

  test("normalizes Indian formatted money strings", () => {
    expect(normalizeMoney("₹1,23,456.70")).toBe(123456.7);
    expect(normalizeMoney("-2,500")).toBe(-2500);
    expect(normalizeMoney("")).toBeNull();
  });

  test("normalizes descriptions and month keys consistently", () => {
    expect(normalizeDescription(" UPI/PAYTM  Food   ORDER ")).toBe("upi paytm food order");
    expect(monthKey("2026-05-16")).toBe("2026-05");
  });
});
