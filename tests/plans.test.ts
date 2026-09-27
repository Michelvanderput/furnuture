import { describe, expect, it } from "vitest";
import { plansOf } from "@/lib/plans";
import type { FloorPlan, Project } from "@/lib/types";

const plan = (id: string, photoId: string) => ({ id, photoId, name: id, imageW: 1, imageH: 1, rooms: [], items: [], links: {} }) as FloorPlan;

describe("plansOf", () => {
  it("skips plans of an earlier house", () => {
    const project = {
      listing: { url: "b", title: "B", photos: [{ id: "p2", url: "x", room: "plattegrond" }] },
      products: [],
      scenes: {},
      plans: [plan("old", "p1"), plan("new", "p2")],
    } as unknown as Project;
    expect(plansOf(project).map((p) => p.id)).toEqual(["new"]);
    expect(plansOf({ ...project, listing: null })).toEqual([]);
  });
});
