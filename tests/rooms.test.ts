import { describe, expect, it } from "vitest";
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

