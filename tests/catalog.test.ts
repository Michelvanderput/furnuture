import { describe, expect, it } from "vitest";
import { CATALOG, entries, groupsFor, houseEstimate, itemFrom, onList, profileChoices, profileFor, type Profile } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/categories";
import { lineCost } from "@/lib/shopping";
import { searchTerm, shopsFor } from "@/lib/shops";
import type { Room } from "@/lib/types";

const room = (id: string, name: string, type: Room["type"], area?: number): Room => ({ id, name, type, area });

describe("standard lists", () => {
  it("every list is sound: known categories, rising prices, no double names", () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const p of Object.keys(CATALOG) as Profile[]) {
      const list = entries(p);
      expect(list.length).toBeGreaterThan(4);
      expect(list.some((x) => x.must)).toBe(true);
      expect(new Set(list.map((x) => x.title)).size).toBe(list.length);
      for (const x of list) {
        expect(cats.has(x.category)).toBe(true);
        expect(x.price[0]).toBeLessThanOrEqual(x.price[1]);
        expect(x.price[1]).toBeLessThanOrEqual(x.price[2]);
      }
    }
  });
  it("a living room gets the dining corner too", () => {
    expect(groupsFor("woonkamer").map((g) => g.name)).toContain("Eethoek");
  });
  it("picks the kind of bedroom", () => {
    const beds = [room("a", "Slaapkamer 1", "slaapkamer", 11), room("b", "Slaapkamer 2", "slaapkamer", 14), room("c", "Kinderkamer", "slaapkamer", 8), room("d", "Logeerkamer", "slaapkamer")];
    expect(beds.map((r) => profileFor(r, beds))).toEqual(["slaapkamer", "hoofdslaapkamer", "kinderkamer", "logeerkamer"]);
    const named = [room("a", "Slaapkamer 2", "slaapkamer", 20), room("b", "Hoofdslaapkamer", "slaapkamer", 12)];
    expect(named.map((r) => profileFor(r, named))).toEqual(["slaapkamer", "hoofdslaapkamer"]);
    expect(profileFor(room("x", "Berging", "overig"))).toBe("berging");
    expect(profileFor(room("x", "Bijkeuken", "overig"))).toBe("wasruimte");
    expect(profileFor(room("x", "Dakterras", "tuin"))).toBe("balkon");
    expect(profileChoices("slaapkamer")).toContain("werkkamer");
  });
  it("becomes a 'still to find' item with a price, and counts as on the list", () => {
    const x = entries("eetkamer").find((e) => e.title === "Eetkamerstoelen")!;
    const item = itemFrom(x, "r1", 1, "i1");
    expect(item).toMatchObject({ title: "Eetkamerstoelen", qty: 4, estimate: 120, must: true, status: "idee", suggestion: "Eetkamerstoelen" });
    expect(lineCost(item)).toMatchObject({ value: 480, estimate: true });
    expect(onList([item], "r1", x)).toBe(true);
    expect(onList([{ ...item, title: "Stoel Lisabon", suggestion: "Eetkamerstoelen" }], "r1", x)).toBe(true);
    expect(onList([item], "r2", x)).toBe(false);
  });
  it("estimates the whole house per price level", () => {
    const rooms = [room("w", "Woonkamer", "woonkamer"), room("k", "Keuken", "keuken"), room("s", "Slaapkamer", "slaapkamer"), room("p", "Plattegrond", "plattegrond")];
    const [b, m, l] = ([0, 1, 2] as const).map((t) => houseEstimate(rooms, t));
    expect(b.must).toBeLessThan(m.must);
    expect(m.must).toBeLessThan(l.must);
    expect(m.must).toBeLessThan(m.all);
    expect(m.all).toBeGreaterThan(3000);
  });
});

describe("shop search", () => {
  it("searches the right shops with a clean term", () => {
    expect(searchTerm("Eetkamerstoelen (set van 4-6)")).toBe("eetkamerstoelen");
    expect(searchTerm("Gordijnen of jaloezieën")).toBe("gordijnen");
    expect(shopsFor("bedden")[0].name).toBe("Beter Bed");
    expect(shopsFor("banken").map((s) => s.name)).toContain("Marktplaats");
    expect(shopsFor("keuken")[0].search("waterkoker")).toBe("https://www.coolblue.nl/zoeken?query=waterkoker");
  });
});

describe("floors, paint and tiles", () => {
  it("work out the amounts from the room's m²", () => {
    const woon = { id: "w", name: "Woonkamer", type: "woonkamer" as const, area: 30 };
    const list = entries("woonkamer", woon);
    const floor = list.find((x) => x.title === "PVC-vloer of laminaat")!;
    expect(floor.qty).toBe(33); // 30 m² + 10% cutting waste
    expect(floor.hint).toMatch(/^33 m² vloer/);
    expect(list.find((x) => x.title.startsWith("Muurverf"))!.qty).toBe(5); // ± 48 m² wall, 10 m² per pot
    expect(list.find((x) => x.title.startsWith("Plafondverf"))!.qty).toBe(3);
    expect(list.find((x) => x.title === "Plinten")!.qty).toBe(22);
    const item = itemFrom(floor, "w", 1, "i");
    expect(lineCost(item).value).toBe(33 * 30);
    expect(item.note).toBe("33 × m² (richtprijs per m²)");
  });
  it("use a usual size when the room's m² is unknown, and say so", () => {
    const bath = entries("badkamer", { id: "b", name: "Badkamer", type: "badkamer" as const });
    const tiles = bath.find((x) => x.title === "Vloertegels")!;
    expect(tiles.qty).toBe(7); // 6 m² + 10%
    expect(tiles.hint).toMatch(/^7 m² vloer \(geschat\)/);
  });
  it("floors and paint are searched at DIY shops", () => {
    expect(shopsFor("verf").map((s) => s.name)).toEqual(["Praxis", "GAMMA", "Karwei", "Hornbach", "Action"]);
    expect(searchTerm("PVC-vloer of laminaat")).toBe("pvc-vloer");
  });
});
