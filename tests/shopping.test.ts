import { describe, expect, it } from "vitest";
import { alternativesOf, byShop, euro, extractLinks, lineCost, parsePrice, planCsv, planText, suggestSplit, totals } from "@/lib/shopping";
import { chooseAlternative, removeItem } from "@/lib/items";
import type { Item, Project } from "@/lib/types";

const item = (over: Partial<Item>): Item => ({ id: "x", roomId: "r1", title: "Bank", images: [], qty: 1, category: "banken", status: "idee", note: "", addedAt: 1, ...over });

describe("prices and links", () => {
  it("parses Dutch and English prices", () => {
    expect(parsePrice("€ 1.299,95")).toBe(1299.95);
    expect(parsePrice("24,95")).toBe(24.95);
    expect(parsePrice("1,299.50")).toBe(1299.5);
    expect(parsePrice("€ 1.299")).toBe(1299);
    expect(parsePrice("12.99")).toBe(12.99);
    expect(parsePrice("gratis")).toBeUndefined();
  });
  it("finds links in shared text", () => {
    expect(extractLinks("Kijk: https://www.ikea.com/nl/nl/p/a-1/. En https://praxis.nl/b, ok")).toEqual(["https://www.ikea.com/nl/nl/p/a-1/", "https://praxis.nl/b"]);
  });
});

describe("totals", () => {
  const items = [
    item({ id: "a", price: 800, status: "besteld", must: true }),
    item({ id: "b", price: 50, qty: 4 }),
    item({ id: "c", estimate: 300 }),
    item({ id: "d" }),
    item({ id: "e", price: 999, alternativeOf: "a" }),
  ];
  it("counts price × quantity, estimates, bought and must-haves; not alternatives", () => {
    expect(lineCost(items[1])).toEqual({ value: 200, estimate: false, known: true });
    expect(totals(items)).toEqual({ planned: 1300, estimated: 300, spent: 800, count: 4, bought: 1, unpriced: 1, must: 800 });
  });
  it("groups per shop, things to find last", () => {
    const g = byShop([item({ id: "a", shop: "IKEA", price: 10 }), item({ id: "b", estimate: 5 }), item({ id: "c", shop: "JYSK", price: 50 })]);
    expect(g.map((x) => x.shop)).toEqual(["JYSK", "IKEA", "Nog te vinden"]);
  });
  it("splits a budget over rooms, living room the most", () => {
    const split = suggestSplit(10000, [
      { id: "w", name: "Woonkamer", type: "woonkamer" },
      { id: "s1", name: "Slaapkamer", type: "slaapkamer" },
      { id: "s2", name: "Slaapkamer 2", type: "slaapkamer" },
    ]);
    expect(split.w).toBeGreaterThan(split.s1);
    expect(split.s1).toBeGreaterThan(split.s2);
    expect(Math.abs(split.w + split.s1 + split.s2 - 10000)).toBeLessThanOrEqual(20);
  });
});

describe("alternatives", () => {
  const p: Project = { listing: null, rooms: [], items: [item({ id: "a", price: 800 }), item({ id: "b", price: 600, alternativeOf: "a" }), item({ id: "c", price: 700, alternativeOf: "a" })] };
  it("choosing an alternative makes the old choice an option", () => {
    const next = chooseAlternative("b")(p);
    expect(next.items.find((i) => i.id === "b")!.alternativeOf).toBeUndefined();
    expect(alternativesOf(next.items, "b").map((i) => i.id).sort()).toEqual(["a", "c"]);
    expect(totals(next.items).planned).toBe(600);
  });
  it("removing the chosen one promotes the first option", () => {
    const next = removeItem("a")(p);
    expect(next.items.find((i) => i.id === "b")!.alternativeOf).toBeUndefined();
    expect(next.items.find((i) => i.id === "c")!.alternativeOf).toBe("b");
  });
});

describe("export", () => {
  const p: Project = {
    listing: { url: "", title: "Karbindersdreef 49", photos: [] },
    rooms: [{ id: "r1", name: "Woonkamer", type: "woonkamer" }],
    items: [item({ id: "a", title: 'Lamp "Bol"', price: 49.95, shop: "IKEA", url: "https://ikea.com/a" }), item({ id: "b", title: "Tafel", estimate: 400, roomId: null })],
    budget: 1000,
  };
  it("builds a readable text list and a CSV", () => {
    const text = planText(p);
    expect(text).toContain("— Woonkamer");
    expect(text).toContain("— Nog geen kamer");
    expect(text).toContain(`Totaal: ${euro(449.95)}`);
    const csv = planCsv(p);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain('"Lamp ""Bol"""');
  });
});
