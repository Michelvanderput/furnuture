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
    item({ id: "b", price: 50, qty: 4, status: "gekozen" }),
    item({ id: "c", estimate: 300, status: "gekozen" }),
    item({ id: "f", price: 120 }),
    item({ id: "d" }),
    item({ id: "e", price: 999, alternativeOf: "a" }),
  ];
  it("counts only chosen items against the budget; ideas apart; not alternatives", () => {
    expect(lineCost(items[1])).toEqual({ value: 200, estimate: false, known: true });
    expect(totals(items)).toEqual({ planned: 1300, ideas: 120, ideaCount: 2, estimated: 300, spent: 800, count: 5, bought: 1, unpriced: 1, must: 800 });
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
  const p: Project = { listing: null, rooms: [], items: [item({ id: "a", price: 800, status: "gekozen" }), item({ id: "b", price: 600, status: "gekozen", alternativeOf: "a" }), item({ id: "c", price: 700, alternativeOf: "a" })] };
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
    expect(text).toContain(`Gekozen: ${euro(0)}`);
    expect(text).toContain(`Nog ideeën: ${euro(449.95)}`);
    expect(text).toContain(`Nog geen kamer (${euro(400)} aan ideeën)`);
    const csv = planCsv(p);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain('"Lamp ""Bol"""');
  });
});

describe("a product takes the place of what was still to find", () => {
  it("fills the one matching placeholder in the room, keeping its quantity and must-have", async () => {
    const { addOrFill } = await import("@/lib/items");
    const p: Project = {
      listing: null,
      rooms: [],
      items: [
        item({ id: "ph", title: "Bank (3-zits)", estimate: 800, must: true, qty: 1 }),
        item({ id: "st", title: "Stoelen", category: "stoelen", estimate: 75, qty: 4 }),
        item({ id: "st2", title: "Barkrukken", category: "stoelen", estimate: 60, qty: 2 }),
      ],
    };
    const sofa = item({ id: "new", title: "EKTORP", url: "https://ikea.com/e", price: 699, shop: "IKEA" });
    const chair = item({ id: "new2", title: "LISABO", category: "stoelen", url: "https://ikea.com/l", price: 50 });
    const { apply, replaced } = addOrFill([sofa, chair]);
    const next = apply(p);
    expect(replaced.map((r) => r.placeholder.id)).toEqual(["ph"]); // two chair placeholders: not guessed
    const filled = next.items.find((i) => i.id === "ph")!;
    expect(filled).toMatchObject({ title: "EKTORP", price: 699, must: true, status: "gekozen", suggestion: "Bank (3-zits)" });
    expect(next.items.map((i) => i.id)).toEqual(["ph", "st", "st2", "new2"]);
  });
});

describe("which placeholder a product fills", () => {
  it("uses the name when there are several of the same kind", async () => {
    const { placeholderFor, sharesName } = await import("@/lib/items");
    expect(sharesName("Kledingkast (2-deurs)", "KLEDINGKAST 2 DEUREN EN 2 LADES MOLLY")).toBe(true);
    expect(sharesName("Nachtkastjes (2×)", "KLEDINGKAST 2 DEUREN EN 2 LADES MOLLY")).toBe(false);
    const items = [
      item({ id: "n", title: "Nachtkastjes", category: "kasten", estimate: 50, qty: 2 }),
      item({ id: "k", title: "Kledingkast (2-deurs)", category: "kasten", estimate: 250 }),
    ];
    const product = item({ id: "p", title: "KLEDINGKAST 2 DEUREN EN 2 LADES MOLLY", category: "kasten", url: "https://x.nl/k", price: 229 });
    expect(placeholderFor(items, product)?.id).toBe("k");
  });
});
