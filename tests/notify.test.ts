import { describe, expect, it } from "vitest";
import { activity, dailyReminder, noteUrl, type Before } from "@/lib/notify";
import type { Changes } from "@/lib/db/rows";
import type { Item, Project, Task } from "@/lib/types";

const before = (over: Partial<Before> = {}): Before => ({ items: new Map(), tasks: new Map(), quotes: new Set(), house: { name: "Huis" }, ...over });
const changes = (upserts: Changes["upserts"], house?: Changes["house"]): Changes => ({ upserts, deletes: [], house });

describe("news for the other devices", () => {
  it("ordering is news, typing a note is not", () => {
    const b = before({ items: new Map([["a", { id: "a", status: "gekozen", title: "Bank" }]]) });
    expect(activity(b, changes([{ table: "items", rows: [{ id: "a", status: "besteld", title: "Bank" }] }]), "Sanne")).toEqual({ title: "Sanne heeft Bank besteld", body: "", open: "item:a" });
    expect(activity(b, changes([{ table: "items", rows: [{ id: "a", status: "gekozen", title: "Bank", data: { note: "grijs" } }] }]), "Sanne")).toBeNull();
  });
  it("many changes become one notification", () => {
    const b = before({
      tasks: new Map([
        ["t1", { id: "t1", status: "gepland", title: "Vloer", start: "2026-10-10" }],
        ["t2", { id: "t2", status: "idee", title: "Verf", start: null }],
      ]),
    });
    const n = activity(
      b,
      changes([
        { table: "items", rows: [{ id: "n1", title: "Lamp" }, { id: "n2", title: "Kleed" }] },
        { table: "tasks", rows: [{ id: "t1", status: "klaar", title: "Vloer", start: "2026-10-10" }, { id: "t2", status: "idee", title: "Verf", start: "2026-10-12" }] },
        { table: "quotes", rows: [{ id: "q1", task_id: "t1", company: "Schilder BV", amount: 1400 }] },
      ], { move_date: "2026-11-20" }),
      "Michel",
    )!;
    expect(n.title).toBe("Michel werkte het huis bij");
    expect(n.body.split("\n")).toEqual(["Michel zette 2 producten op de lijst", "Klaar: Vloer", "De planning van een klus is verschoven", "en nog 2"]);
    expect(n.open).toBe("task:t1");
  });
  it("links to the house by name", () => {
    expect(noteUrl("Dorpsstraat 12", "item:a")).toBe("/?woning=Dorpsstraat%2012&open=item%3Aa");
  });
});

describe("the morning reminder", () => {
  const item = (over: Partial<Item>): Item => ({ id: "i", roomId: "r1", title: "Bank", images: [], qty: 1, category: "banken", status: "gekozen", note: "", addedAt: 1, ...over });
  const task = (over: Partial<Task>): Task => ({ id: "t", title: "Vloer leggen", kind: "vloeren", roomIds: ["r1"], who: "vakman", status: "gepland", quotes: [], beforeMove: true, note: "", addedAt: 1, ...over });
  const p = (items: Item[], tasks: Task[] = []): Project => ({ listing: null, rooms: [{ id: "r1", name: "Woonkamer", type: "woonkamer" }], items, renovation: { keyDate: "2026-10-08", moveDate: "2026-11-01", tasks } });

  it("says what to order, what arrives and what starts, on the right day only", () => {
    const project = p([item({ id: "a", leadDays: 31 }), item({ id: "b", title: "Tafel", status: "besteld", deliveryDate: "2026-10-02" })], [task({ start: "2026-10-02", days: 2 })]);
    const n = dailyReminder(project, "2026-10-01")!;
    expect(n.title).toBe("Vandaag in je planning");
    expect(n.body.split("\n")).toEqual(["Vandaag bestellen: Bank, anders is het er niet op de verhuisdag", "Morgen bezorgd: Tafel (de kamer is nog niet klaar)", "Morgen begint: Vloer leggen", "Nog een week tot de sleutel"]);
    expect(dailyReminder(project, "2026-10-03")).toBeNull();
  });
});

describe("questions for one person", () => {
  it("show up only for them and the sender", async () => {
    const { forMe, memberName } = await import("@/lib/push");
    const store = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
    const n = { id: "1", kind: "ask", title: "", body: "", url: null, member: "Michel", recipients: ["Sanne"], created_at: "" };
    memberName.set("Sanne");
    expect(forMe(n)).toBe(true);
    memberName.set("michel");
    expect(forMe(n)).toBe(true);
    memberName.set("Oma");
    expect(forMe(n)).toBe(false);
    expect(forMe({ ...n, recipients: null })).toBe(true);
  });
});
