import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, deliveryPlan, expectedDelivery, orderAdvice, roomReady } from "@/lib/delivery";
import { patchItem } from "@/lib/items";
import { leadFromJsonLd, parseLeadTime } from "@/lib/leadTime";
import { parseProduct } from "@/lib/extract";
import type { Item, Project, Task } from "@/lib/types";

const item = (over: Partial<Item> = {}): Item => ({ id: "i1", roomId: "r1", title: "Bank", images: [], qty: 1, category: "banken", status: "gekozen", note: "", addedAt: 1, ...over });
const task = (over: Partial<Task> = {}): Task => ({ id: "t1", title: "Vloer", kind: "vloeren", roomIds: ["r1"], who: "vakman", status: "gepland", quotes: [], beforeMove: true, note: "", addedAt: 1, ...over });
const project = (items: Item[], tasks: Task[] = []): Project => ({
  listing: null,
  rooms: [
    { id: "r1", name: "Woonkamer", type: "woonkamer" },
    { id: "r2", name: "Slaapkamer", type: "slaapkamer" },
  ],
  items,
  renovation: { keyDate: "2026-10-05", moveDate: "2026-11-02", tasks },
});

describe("delivery times from shop pages", () => {
  it("reads the ways shops write it", () => {
    expect(parseLeadTime("Levertijd: 4 - 6 weken")).toEqual({ days: 42, text: "4 – 6 weken" });
    expect(parseLeadTime("Leverbaar binnen 3 werkdagen")).toEqual({ days: 5, text: "3 werkdagen" });
    expect(parseLeadTime("Verwachte levertijd 1 week")).toEqual({ days: 7, text: "1 week" });
    expect(parseLeadTime("Voor 23:00 besteld, morgen in huis")).toEqual({ days: 1, text: "morgen in huis" });
    expect(parseLeadTime("Bezorgd in 2 tot 3 dagen")).toEqual({ days: 3, text: "2 – 3 dagen" });
    expect(parseLeadTime("Bezorgen 4 werkdagen")?.days).toBe(6);
    expect(parseLeadTime("Deze bank is 220 cm breed")).toBeUndefined();
  });
  it("reads schema.org delivery data", () => {
    expect(leadFromJsonLd({ deliveryLeadTime: { maxValue: 5, unitCode: "WEE" } })?.days).toBe(35);
    expect(leadFromJsonLd([{ shippingDetails: { deliveryTime: { handlingTime: { maxValue: 2, unitCode: "DAY" }, transitTime: { maxValue: 3, unitCode: "DAY" } } } }])?.days).toBe(5);
    expect(leadFromJsonLd({ price: 10 })).toBeUndefined();
  });
  it("comes with the product", () => {
    const html = `<html><head><title>Bank Oslo</title><meta property="og:image" content="https://shop.nl/bank.jpg"></head><body><h1>Bank Oslo</h1><p>Levertijd: 8 - 10 weken</p></body></html>`;
    expect(parseProduct(html, "https://shop.nl/bank-oslo")).toMatchObject({ leadDays: 70, leadText: "8 – 10 weken" });
  });
});

describe("delivery planning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("sets the order date when ordering, and clears it when going back", () => {
    let p = project([item()]);
    p = patchItem("i1", { status: "besteld" })(p);
    expect(p.items[0].orderedAt).toBe("2026-09-28");
    p = patchItem("i1", { status: "gekozen" })(p);
    expect(p.items[0].orderedAt).toBeUndefined();
  });

  it("works out when it arrives", () => {
    expect(expectedDelivery(item({ status: "besteld", orderedAt: "2026-09-28", leadDays: 14 }))).toBe("2026-10-12");
    expect(expectedDelivery(item({ status: "besteld", orderedAt: "2026-09-28", leadDays: 14, deliveryDate: "2026-10-20" }))).toBe("2026-10-20");
    expect(expectedDelivery(item({ status: "gekozen", leadDays: 14 }))).toBeUndefined();
  });

  it("knows when a room is ready", () => {
    const p = project([], [task({ start: "2026-10-12", days: 3 }), task({ id: "t2", kind: "schilderen", roomIds: [], start: "2026-10-06", days: 5 }), task({ id: "t3", roomIds: ["r2"], start: "2026-10-20", days: 2 })]);
    expect(roomReady(p, "r1").date).toBe("2026-10-14");
    expect(roomReady(p, "r2").date).toBe("2026-10-21");
  });

  it("says when to order", () => {
    const p = project([item({ leadDays: 21 })], [task({ start: "2026-10-12", days: 3 })]);
    const a = orderAdvice(p, p.items[0]);
    expect(a.latest).toBe(addDays("2026-11-02", -21));
    expect(a.earliest).toBeUndefined(); // already past: no need to say "not before"
    expect(orderAdvice(p, { ...p.items[0], leadDays: 7 }).earliest).toBe("2026-10-08");
    expect(a.late).toBe(false);
    expect(orderAdvice(p, { ...p.items[0], leadDays: 60 }).late).toBe(true);
  });

  it("flags deliveries after moving day and before the room is ready", () => {
    const p = project(
      [
        item({ id: "a", status: "besteld", deliveryDate: "2026-11-10" }),
        item({ id: "b", status: "besteld", deliveryDate: "2026-10-13", category: "verlichting" }),
        item({ id: "c", status: "besteld", deliveryDate: "2026-10-20", category: "verlichting" }),
        item({ id: "d", status: "besteld" }),
        item({ id: "e", leadDays: 10 }),
        item({ id: "f" }),
        item({ id: "g", alternativeOf: "f", leadDays: 3 }),
      ],
      [task({ start: "2026-10-12", days: 3 })],
    );
    const plan = deliveryPlan(p);
    expect(plan.incoming.map((d) => [d.item.id, d.issue])).toEqual([
      ["b", "voor-klaar"],
      ["c", undefined],
      ["a", "na-verhuizing"],
    ]);
    expect(plan.undated.map((i) => i.id)).toEqual(["d"]);
    expect(plan.toOrder.map((o) => o.item.id)).toEqual(["e"]);
    expect(plan.noLead.map((i) => i.id)).toEqual(["f"]);
  });
});
