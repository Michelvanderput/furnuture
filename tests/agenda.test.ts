import { describe, expect, it } from "vitest";
import { agenda, dayLabel, monthGrid, onDay, toIcs, weekLabel, weekNumber, weekStart } from "@/lib/agenda";
import type { Item, Project, Task } from "@/lib/types";

const item = (over: Partial<Item>): Item => ({ id: "i", roomId: "r1", title: "Bank", images: [], qty: 1, category: "banken", status: "gekozen", note: "", addedAt: 1, ...over });
const task = (over: Partial<Task>): Task => ({ id: "t", title: "Vloer leggen", kind: "vloeren", roomIds: ["r1"], who: "vakman", status: "gepland", quotes: [], beforeMove: true, note: "", addedAt: 1, ...over });
const project = (items: Item[], tasks: Task[]): Project => ({
  listing: null,
  rooms: [{ id: "r1", name: "Woonkamer", type: "woonkamer" }],
  items,
  renovation: { keyDate: "2026-10-05", moveDate: "2026-11-02", tasks },
});

describe("agenda", () => {
  const p = project(
    [
      item({ id: "a", status: "besteld", deliveryDate: "2026-10-07", category: "verlichting", title: "Lamp" }),
      item({ id: "b", leadDays: 30 }),
      item({ id: "c", status: "besteld", title: "Kast", category: "kasten" }),
      item({ id: "d", title: "Stoel", category: "stoelen" }),
    ],
    [task({ start: "2026-10-06", days: 3 }), task({ id: "u", title: "Schilderen", kind: "schilderen", start: undefined })],
  );
  const a = agenda(p, "2026-10-01");

  it("puts everything with a date in order", () => {
    expect(a.events.map((e) => [e.kind, e.date])).toEqual([
      ["bestellen", "2026-10-03"],
      ["mijlpaal", "2026-10-05"],
      ["klus", "2026-10-06"],
      ["levering", "2026-10-07"],
      ["mijlpaal", "2026-11-02"],
    ]);
    expect(a.events.find((e) => e.kind === "klus")).toMatchObject({ end: "2026-10-08", open: "task:t", tone: "ok" });
  });
  it("flags a delivery before the room is ready, and lists what has no date", () => {
    expect(a.events.find((e) => e.kind === "levering")).toMatchObject({ tone: "warn", sub: expect.stringContaining("kamer pas 8 okt klaar") });
    expect(a.attention.map((e) => e.id)).toEqual(["order:b", "delivery:a"]);
    expect(a.unplanned.map((u) => [u.kind, u.id])).toEqual([
      ["klus", "u"],
      ["levering", "c"],
      ["levertijd", "d"],
    ]);
  });
  it("shows jobs on working days only", () => {
    const job = { id: "x", kind: "klus" as const, date: "2026-10-09", end: "2026-10-13", title: "", roomIds: [], tone: "ok" as const };
    expect(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"].map((d) => onDay(job, d))).toEqual([true, false, false, true]);
  });
});

describe("weeks, days and months", () => {
  it("names weeks and days", () => {
    expect(weekStart("2026-10-08")).toBe("2026-10-05");
    expect(weekNumber("2026-10-08")).toBe(41);
    expect(weekNumber("2027-01-01")).toBe(53);
    expect(weekLabel("2026-10-05", "2026-10-08")).toBe("Deze week");
    expect(weekLabel("2026-10-12", "2026-10-08")).toBe("Volgende week");
    expect(weekLabel("2026-10-26", "2026-10-08")).toMatch(/^Week 44 · 26 okt/);
    expect(dayLabel("2026-10-09", "2026-10-08")).toMatch(/^Morgen · vr 9 okt/);
  });
  it("gives whole weeks for a month", () => {
    const days = monthGrid("2026-10");
    expect(days[0]).toBe("2026-09-28");
    expect(days.at(-1)).toBe("2026-11-01");
    expect(days.length % 7).toBe(0);
  });
});

describe("calendar file", () => {
  it("is a valid all-day calendar", () => {
    const ics = toIcs(agenda(project([], [task({ start: "2026-10-06", days: 3, title: "Vloer, plinten; drempel" })]), "2026-10-01").events, "Dorpsstraat 12");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261006\r\nDTEND;VALUE=DATE:20261009");
    expect(ics).toContain(String.raw`SUMMARY:🔨 Vloer\, plinten\; drempel`);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});
