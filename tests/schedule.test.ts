import { describe, expect, it } from "vitest";
import { dueDay, localNow } from "@/lib/schedule";

const at = (iso: string) => new Date(iso);

describe("the morning reminder at the device's own time", () => {
  it("uses the device's time zone", () => {
    expect(localNow("Europe/Amsterdam", at("2026-10-01T06:30:00Z"))).toEqual({ day: "2026-10-01", min: 8 * 60 + 30 });
    expect(localNow("Europe/Amsterdam", at("2026-12-01T06:30:00Z"))).toEqual({ day: "2026-12-01", min: 7 * 60 + 30 });
  });
  it("is due from its time, once a day", () => {
    expect(dueDay("08:00", "Europe/Amsterdam", null, at("2026-10-01T05:55:00Z"))).toBeNull(); // 07:55
    expect(dueDay("08:00", "Europe/Amsterdam", null, at("2026-10-01T06:05:00Z"))).toBe("2026-10-01");
    expect(dueDay("08:00", "Europe/Amsterdam", "2026-10-01", at("2026-10-01T06:10:00Z"))).toBeNull();
  });
  it("catches up later that day when the cron runs only once, but not at night", () => {
    expect(dueDay("08:00", "Europe/Amsterdam", null, at("2026-10-01T07:59:00Z"))).toBe("2026-10-01"); // 09:59
    expect(dueDay("08:00", "Europe/Amsterdam", null, at("2026-10-01T20:30:00Z"))).toBeNull(); // 22:30
  });
  it("a late run just after midnight still belongs to yesterday", () => {
    expect(dueDay("23:30", "Europe/Amsterdam", null, at("2026-09-30T22:20:00Z"))).toBe("2026-09-30"); // 00:20
    expect(dueDay("23:30", "Europe/Amsterdam", "2026-09-30", at("2026-09-30T22:20:00Z"))).toBeNull();
  });
});
