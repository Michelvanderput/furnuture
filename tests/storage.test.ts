import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, Project } from "@/lib/types";

const item = (over: Partial<Item> = {}): Item => ({ id: "i1", roomId: "r1", title: "Bank", images: [], qty: 1, category: "banken", status: "idee", note: "", addedAt: 1, ...over });
const project = (): Project => ({
  listing: { url: "https://funda.nl/x", title: "Huis", photos: [{ id: "p1", url: "data:big", room: "woonkamer", roomId: "r1" }] },
  rooms: [{ id: "r1", name: "Woonkamer", type: "woonkamer" }],
  items: [item()],
  budget: 5000,
});

async function fresh() {
  vi.resetModules();
  indexedDB.deleteDatabase("furnuture");
  return import("@/lib/storage");
}

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
    expect(loaded?.current).toBe(true);
    expect(loaded?.project).toEqual(p);
  });

  it("writes only the parts that changed", async () => {
    const s = await fresh();
    const p = project();
    await s.saveProject(p);
    const keys = spyPuts();
    await s.saveProject({ ...p, items: [item({ status: "gekozen" })] });
    expect(keys).toEqual(["items"]);
    await s.saveProject({ ...p, items: [item({ status: "gekozen" })], budget: 6000 });
    expect(keys).toEqual(["items", "items", "settings"]);
  });

  it("converts version 2 (products, designs) into rooms and items", async () => {
    const s = await fresh();
    const { openDb } = s;
    const d = await openDb();
    await new Promise<void>((res) => {
      const tx = d.transaction("kv", "readwrite");
      const st = tx.objectStore("kv");
      st.put(2, "format");
      st.put({ url: "u", title: "Huis", photos: [{ id: "p1", url: "x", room: "slaapkamer" }], facts: { bedrooms: "3" } }, "listing");
      st.put(
        [
          { id: "a", url: "https://ikea.com/a", title: "Bed", image: "", images: [], shop: "IKEA", category: "bedden", status: "favoriet", note: "", room: "slaapkamer", priceValue: 299 },
          { id: "b", url: "https://x.nl/b", title: "Weg", image: "", images: [], shop: "X", category: "overig", status: "afgewezen", note: "" },
        ],
        "products",
      );
      st.put({ photoId: "p1", layers: [] }, "scene:p1");
      tx.oncomplete = () => res();
    });
    const loaded = await s.loadProject();
    expect(loaded?.current).toBe(false);
    const p = loaded!.project;
    expect(p.rooms.filter((r) => r.type === "slaapkamer")).toHaveLength(3);
    expect(p.items).toHaveLength(1);
    const bedroom = p.rooms.find((r) => r.type === "slaapkamer")!;
    expect(p.items[0]).toMatchObject({ title: "Bed", price: 299, status: "gekozen", roomId: bedroom.id, qty: 1 });
    expect(p.listing!.photos[0].roomId).toBe(bedroom.id);
  });
});
