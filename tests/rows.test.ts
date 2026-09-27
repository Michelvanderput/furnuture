import { describe, expect, it } from "vitest";
import { batches, diff, fromRows, isEmpty, slugify, snapshot, toRows } from "@/lib/db/rows";
import type { Project } from "@/lib/types";

const project = (): Project => ({
  listing: {
    url: "https://www.funda.nl/detail/koop/utrecht/huis-1/",
    title: "Dorpsstraat 12",
    photos: [
      { id: "p1", url: "https://cloud.funda.nl/a.jpg", room: "woonkamer", roomId: "r1" },
      { id: "p2", url: "https://cloud.funda.nl/b.jpg", room: "overig" },
    ],
    facts: { livingArea: "112 m²", energyLabel: "C" },
  },
  rooms: [
    { id: "r1", name: "Woonkamer", type: "woonkamer", area: 32, budget: 4000 },
    { id: "r2", name: "Hal", type: "hal", floor: "Begane grond" },
  ],
  items: [
    { id: "i1", roomId: "r1", title: "Bank", images: ["x.jpg"], qty: 1, category: "banken", status: "gekozen", note: "grijs", addedAt: 5, price: 899, url: "https://shop.nl/bank", shop: "shop.nl", must: true, width: 220 } as Project["items"][number],
    { id: "i2", roomId: null, title: "Lamp", images: [], qty: 2, category: "verlichting", status: "idee", note: "", addedAt: 6, alternativeOf: "i1" },
  ],
  renovation: {
    keyDate: "2026-11-01",
    budget: 12000,
    tasks: [
      {
        id: "t1",
        title: "Muren schilderen",
        kind: "schilderen",
        roomIds: ["r1"],
        who: "vakman",
        status: "offerte",
        estimate: 1500,
        quotes: [{ id: "q1", company: "Schilder BV", amount: 1400, addedAt: 1_700_000_000_000 }],
        chosenQuote: "q1",
        start: "2026-11-03",
        days: 3,
        beforeMove: true,
        note: "RAL 9010",
        addedAt: 7,
      },
    ],
  },
  budget: 15000,
  style: "Japandi",
});

describe("database rows", () => {
  it("round-trips a project through rows", () => {
    const p = project();
    const { house, rows } = toRows(p, "Dorpsstraat 12");
    expect(house.name).toBe("Dorpsstraat 12");
    expect(rows.quotes[0].task_id).toBe("t1");
    // The database returns every column, also the empty ones.
    const back = fromRows({ ...house, created_at: "x" }, JSON.parse(JSON.stringify(rows)));
    expect(back.rooms).toEqual(p.rooms.map((r) => expect.objectContaining(r)));
    expect(back.items[0]).toMatchObject({ id: "i1", title: "Bank", price: 899, must: true, note: "grijs", images: ["x.jpg"], width: 220 });
    expect(back.items[1]).toMatchObject({ roomId: null, alternativeOf: "i1", qty: 2 });
    expect(back.renovation?.tasks[0]).toMatchObject({ title: "Muren schilderen", roomIds: ["r1"], chosenQuote: "q1", note: "RAL 9010", start: "2026-11-03" });
    expect(back.renovation?.tasks[0].quotes[0]).toMatchObject({ company: "Schilder BV", amount: 1400, addedAt: 1_700_000_000_000 });
    expect(back.renovation?.keyDate).toBe("2026-11-01");
    expect(back.listing?.photos.map((ph) => ph.id)).toEqual(["p1", "p2"]);
    expect(back.budget).toBe(15000);
    expect(back.style).toBe("Japandi");
    // Loading and saving again changes nothing.
    const again = toRows(back, "Dorpsstraat 12");
    expect(isEmpty(diff(snapshot(house, rows), again.house, again.rows))).toBe(true);
  });

  it("sends only what changed", () => {
    const p = project();
    const before = toRows(p, "Huis");
    const snap = snapshot(before.house, before.rows);
    const next: Project = { ...p, items: [{ ...p.items[0], status: "besteld" }], rooms: p.rooms.slice(0, 1) };
    const after = toRows(next, "Huis");
    const c = diff(snap, after.house, after.rows);
    expect(c.house).toBeUndefined();
    expect(c.upserts).toEqual([{ table: "items", rows: [expect.objectContaining({ id: "i1", status: "besteld" })] }]);
    expect(c.deletes).toEqual([
      { table: "rooms", ids: ["r2"] },
      { table: "items", ids: ["i2"] },
    ]);
    expect(diff(snap, { ...before.house, budget: 1 }, before.rows).house).toMatchObject({ budget: 1 });
    expect(diff(null, before.house, before.rows).upserts.length).toBeGreaterThan(0);
  });

  it("splits big saves into requests that fit", () => {
    const big = "x".repeat(1000);
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, url: big }));
    const parts = batches({ house: { name: "Huis" }, upserts: [{ table: "photos", rows }], deletes: [{ table: "items", ids: ["a"] }] }, 10_000);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.flatMap((b) => b.upserts.flatMap((u) => u.rows)).length).toBe(50);
    expect(parts.every((b) => JSON.stringify(b).length <= 10_000 + 1100)).toBe(true);
    expect(parts[0].house).toEqual({ name: "Huis" });
    expect(parts.filter((b) => b.deletes.length).length).toBe(1);
  });

  it("normalises names", () => {
    expect(slugify("  Dorpsstraat 12, Utrecht ")).toBe("dorpsstraat-12-utrecht");
    expect(slugify("Één Café")).toBe("een-cafe");
    expect(slugify("DORPSSTRAAT   12")).toBe(slugify("dorpsstraat 12"));
    expect(slugify("!!!")).toBe("");
  });
});
