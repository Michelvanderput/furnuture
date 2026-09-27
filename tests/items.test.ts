import { describe, expect, it } from "vitest";
import { roomsNamed } from "@/lib/ai";
import { makeOptionOf, patchItems, rivalOf } from "@/lib/items";
import type { Item, Project } from "@/lib/types";

const item = (over: Partial<Item>): Item => ({ id: "x", roomId: "r1", title: "", images: [], qty: 1, category: "overig", status: "gekozen", note: "", addedAt: 1, price: 100, url: "https://s.nl/x", ...over });
const project = (items: Item[]): Project => ({
  listing: null,
  rooms: [
    { id: "r1", name: "Woonkamer", type: "woonkamer" },
    { id: "s1", name: "Slaapkamer 1", type: "slaapkamer" },
    { id: "s2", name: "Slaapkamer 2", type: "slaapkamer" },
    { id: "h", name: "Hal & overloop", type: "hal" },
  ],
  items,
});

describe("two products for the same thing", () => {
  const molly = item({ id: "a", title: "Hoekbank MOLLY", category: "banken" });
  it("a second sofa in the same room is a rival", () => {
    expect(rivalOf([molly], item({ id: "b", title: "GLOSTAD 3-zitsbank", category: "banken" }))?.id).toBe("a");
    expect(rivalOf([molly], item({ id: "b", title: "Fauteuil Strandmon", category: "banken" }))).toBeUndefined();
    expect(rivalOf([molly], item({ id: "b", title: "Bank", category: "banken", roomId: "s1" }))).toBeUndefined();
  });
  it("other things only when their names match", () => {
    const table = item({ id: "t", title: "Eettafel Ferrara", category: "tafels" });
    expect(rivalOf([table], item({ id: "c", title: "Salontafel rond", category: "tafels" }))).toBeUndefined();
    expect(rivalOf([table], item({ id: "c", title: "Eettafel eiken 200 cm", category: "tafels" }))?.id).toBe("t");
  });
  it("placeholders are filled, not rivals", () => {
    expect(rivalOf([item({ id: "p", title: "Bank", category: "banken", url: undefined, price: undefined })], item({ id: "b", title: "Bank", category: "banken" }))).toBeUndefined();
  });
  it("making an option moves its own options along", () => {
    const p = makeOptionOf("b", "a")(project([molly, item({ id: "b" }), item({ id: "c", alternativeOf: "b" })]));
    expect(p.items.map((i) => i.alternativeOf)).toEqual([undefined, "a", "a"]);
  });
  it("ordering several at once sets the order date", () => {
    const p = patchItems(["a"], { status: "besteld" })(project([molly]));
    expect(p.items[0].orderedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("rooms in the AI's renovation plan", () => {
  const p = project([]);
  it("finds one room, several, or a group", () => {
    expect(roomsNamed(p, "Woonkamer")).toEqual(["r1"]);
    expect(roomsNamed(p, "Slaapkamer 1, Slaapkamer 2")).toEqual(["s1", "s2"]);
    expect(roomsNamed(p, "Slaapkamers")).toEqual(["s1", "s2"]);
    expect(roomsNamed(p, "Hele huis", "Wanden en plafond slaapkamers schilderen")).toEqual(["s1", "s2"]);
    expect(roomsNamed(p, "Hal & overloop")).toEqual(["h"]);
    expect(roomsNamed(p, "Hele huis", "Isolatie verbeteren")).toEqual([]);
  });
});
