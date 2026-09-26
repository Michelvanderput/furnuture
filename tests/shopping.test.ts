import { describe, expect, it } from "vitest";
import { euro, extractLinks, parsePrice, shoppingListCsv, shoppingListText, totalsPerRoom } from "@/lib/shopping";
import type { Product } from "@/lib/types";

const product = (over: Partial<Product>): Product => ({
  id: "x", url: "https://shop.nl/x", title: "Bank", image: "", images: [], shop: "Shop", category: "banken",
  status: "favoriet", note: "", ...over,
});

describe("shopping helpers", () => {
  it("parses Dutch and English prices", () => {
    expect(parsePrice("€ 1.299,95")).toBe(1299.95);
    expect(parsePrice("24,95")).toBe(24.95);
    expect(parsePrice("1,299.50")).toBe(1299.5);
    expect(parsePrice("799")).toBe(799);
    expect(parsePrice("gratis")).toBeUndefined();
  });

  it("finds links in shared text", () => {
    expect(extractLinks("Kijk: https://www.ikea.com/nl/nl/p/a-1/. En https://praxis.nl/b, ok")).toEqual([
      "https://www.ikea.com/nl/nl/p/a-1/",
      "https://praxis.nl/b",
    ]);
  });

  it("totals favourites per room and builds a list", () => {
    const list = [
      product({ id: "a", priceValue: 800, price: "€ 800,00", room: "woonkamer" }),
      product({ id: "b", priceValue: 200, room: "woonkamer", title: 'Lamp "Bol"' }),
      product({ id: "c", priceValue: 50 }),
      product({ id: "d", priceValue: 999, status: "optie" }),
    ];
    expect(totalsPerRoom(list)).toEqual([
      { room: "woonkamer", label: "Woonkamer", total: 1000, count: 2 },
      { room: null, label: "Algemeen", total: 50, count: 1 },
    ]);
    expect(shoppingListText(list)).toContain(`Totaal: ${euro(1050)}`);
    const csv = shoppingListCsv(list);
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain('"Lamp ""Bol"""');
    expect(csv).toContain('"800,00"');
  });
});
