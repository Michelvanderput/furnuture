import { describe, expect, it } from "vitest";
import { applyRooms, parseJson, smallPhoto } from "@/lib/ai";
import { defaultRooms } from "@/lib/rooms";
import type { Listing, Project } from "@/lib/types";

const listing = (over: Partial<Listing> = {}): Listing => ({ url: "u", title: "Huis", photos: [], ...over });

describe("default rooms", () => {
  it("follows Funda's number of bedrooms, bathrooms and the garden", () => {
    const rooms = defaultRooms(listing({ facts: { bedrooms: "4", bathrooms: "1 badkamer", plotArea: "167 m²" } }));
    expect(rooms.filter((r) => r.type === "slaapkamer").map((r) => r.name)).toEqual(["Hoofdslaapkamer", "Slaapkamer 2", "Slaapkamer 3", "Slaapkamer 4"]);
    expect(rooms.some((r) => r.type === "tuin")).toBe(true);
    expect(rooms.filter((r) => r.type === "badkamer")).toHaveLength(1);
  });
  it("reads bedrooms from the room count when needed", () => {
    expect(defaultRooms(listing({ facts: { rooms: "5 kamers (3 slaapkamers)" } })).filter((r) => r.type === "slaapkamer")).toHaveLength(3);
  });
});

describe("AI helpers", () => {
  it("reads JSON from a fenced answer", () => {
    expect(parseJson<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJson("geen json")).toThrow();
  });
  it("sends Funda photos small", () => {
    expect(smallPhoto("https://cloud.funda.nl/valentina_media/1/2/3.jpg?options=width=1440")).toBe("https://cloud.funda.nl/valentina_media/1/2/3.jpg?options=width=384");
  });
  it("applies proposed rooms, keeping ids (and items) of rooms of the same kind", () => {
    const p: Project = {
      listing: listing({ photos: [{ id: "p0", url: "a", room: "overig" }, { id: "p1", url: "b", room: "overig" }] }),
      rooms: [
        { id: "w", name: "Woonkamer", type: "woonkamer", budget: 3000 },
        { id: "x", name: "Werkkamer", type: "werkkamer" },
        { id: "z", name: "Zolder", type: "zolder" },
      ],
      items: [{ id: "i", roomId: "z", title: "Kast", images: [], qty: 1, category: "kasten", status: "idee", note: "", addedAt: 1 }],
    };
    const next = applyRooms(p, {
      rooms: [
        { id: "n1", name: "Woonkamer met open keuken", type: "woonkamer", area: 38, photoIdx: [1] },
        { id: "n2", name: "Slaapkamer", type: "slaapkamer", photoIdx: [0] },
      ],
      photoTypes: { 0: "slaapkamer", 1: "woonkamer" },
    });
    expect(next.rooms.map((r) => r.id)).toEqual(["w", "n2", "z"]); // werkkamer (empty) gone, zolder kept for its item
    expect(next.rooms[0]).toMatchObject({ name: "Woonkamer met open keuken", area: 38, budget: 3000 });
    expect(next.listing!.photos.map((ph) => ph.roomId)).toEqual(["n2", "w"]);
  });
});
