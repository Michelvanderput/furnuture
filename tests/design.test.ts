import { describe, expect, it } from "vitest";
import { designList } from "@/lib/shopping";
import type { Product } from "@/lib/types";

const product = (id: string, category: Product["category"], priceValue?: number): Product => ({
  id, url: `https://shop.nl/${id}`, title: id, image: "x", images: [], shop: "shop", category, status: "optie", note: "", priceValue,
});

describe("designList", () => {
  it("counts furniture per use and paint once", () => {
    const products = [product("stoel", "stoelen", 50), product("verf", "verf", 30), product("lamp", "verlichting")];
    const d = designList(["stoel", "stoel", "verf", "verf", "lamp", "weg"], products);
    expect(d.items.map((x) => [x.product.id, x.count])).toEqual([["stoel", 2], ["verf", 2], ["lamp", 1]]);
    expect(d.total).toBe(130);
    expect(d.unknown).toBe(1);
  });
});
