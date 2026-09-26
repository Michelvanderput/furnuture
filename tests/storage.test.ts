import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";

const project = (): Project => ({
  listing: { url: "https://funda.nl/x", title: "Huis", photos: [{ id: "p1", url: "data:big", room: "woonkamer" }] },
  products: [],
  scenes: {
    p1: { photoId: "p1", layers: [] },
    p2: { photoId: "p2", layers: [] },
  },
});

async function fresh() {
  vi.resetModules();
  indexedDB.deleteDatabase("furnuture");
  return import("@/lib/storage");
}

/** Counts writes per key on the object store. */
function spyPuts() {
  const keys: string[] = [];
  const orig = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, v, k) {
    if (this.name === "kv") keys.push(String(k));
    return orig.call(this, v, k);
  });
  return keys;
}

describe("project storage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("round-trips a project stored in parts", async () => {
    const s = await fresh();
    const p = project();
    await s.saveProject(p);
    const loaded = await s.loadProject();
    expect(loaded?.legacy).toBe(false);
    expect(loaded?.project.listing).toEqual(p.listing);
    expect(Object.keys(loaded!.project.scenes).sort()).toEqual(["p1", "p2"]);
  });

  it("writes only the parts that changed", async () => {
    const s = await fresh();
    const p = project();
    await s.saveProject(p);
    const keys = spyPuts();
    const moved = { ...p, scenes: { ...p.scenes, p1: { photoId: "p1", layers: [] } } };
    await s.saveProject(moved);
    expect(keys).toEqual(["scene:p1"]);
  });

  it("deletes the design of a removed photo", async () => {
    const s = await fresh();
    const p = project();
    await s.saveProject(p);
    const { p2: _, ...rest } = p.scenes;
    await s.saveProject({ ...p, scenes: rest });
    const loaded = await s.loadProject();
    expect(Object.keys(loaded!.project.scenes)).toEqual(["p1"]);
  });

  it("reads the old single-record format and rewrites it in parts", async () => {
    const s = await fresh();
    const d = await s.openDb();
    await new Promise((res) => {
      const tx = d.transaction("kv", "readwrite");
      tx.objectStore("kv").put(project(), "project");
      tx.oncomplete = res;
    });
    const loaded = await s.loadProject();
    expect(loaded?.legacy).toBe(true);
    await s.saveProject(loaded!.project);
    const again = await s.loadProject();
    expect(again?.legacy).toBe(false);
    expect(again?.project.listing?.title).toBe("Huis");
  });
});
