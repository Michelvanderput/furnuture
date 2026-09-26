import { describe, expect, it } from "vitest";
import { shadingFromPixels } from "@/lib/shading";
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


describe("room light on a new floor", () => {
  it("is never black next to the measured floor (where erased furniture stood)", () => {
    const w = 40, h = 20;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(180);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 20; x++) mask[y * w + x] = 1; // floor only on the left
    const { multiply } = shadingFromPixels(rgba, mask, w, h);
    expect(Math.min(...Array.from({ length: w * h }, (_, i) => multiply[i * 4]))).toBeGreaterThan(200);
  });
});
