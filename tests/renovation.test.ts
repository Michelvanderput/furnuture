import { describe, expect, it } from "vitest";
import { addWorkdays, autoPlan, lateTasks, paintArea, renoTotals, suggestions, taskCost, taskEnd } from "@/lib/renovation";
import type { Project, Task } from "@/lib/types";

const task = (over: Partial<Task>): Task => ({ id: "t", title: "Klus", kind: "overig", roomIds: [], who: "vakman", status: "idee", quotes: [], beforeMove: true, note: "", addedAt: 1, ...over });

describe("renovation costs", () => {
  it("uses the chosen quote, else the estimate", () => {
    const t = task({ estimate: 1000, quotes: [{ id: "a", company: "A", amount: 1200, addedAt: 1 }, { id: "b", company: "B", amount: 900, addedAt: 1 }] });
    expect(taskCost(t)).toEqual({ value: 1000, firm: false, known: true });
    expect(taskCost({ ...t, chosenQuote: "b" })).toEqual({ value: 900, firm: true, known: true });
    expect(renoTotals([{ ...t, chosenQuote: "b", status: "klaar" }, task({ id: "x", estimate: 300 }), task({ id: "y" })])).toEqual({
      total: 1200, estimated: 300, firm: 900, done: 900, count: 3, doneCount: 1, unpriced: 1,
    });
  });
  it("estimates walls and ceiling from the floor area", () => {
    expect(paintArea(16)).toBe(51); // 16 m² ceiling + 4 × 4 m × 2.6 m × 0.85
  });
});

describe("suggestions for this house", () => {
  const p: Project = {
    listing: { url: "", title: "Huis", photos: [], facts: { buildYear: "1965", energyLabel: "C", livingArea: "92 m²", stories: "3 woonlagen" } },
    rooms: [
      { id: "w", name: "Woonkamer", type: "woonkamer", area: 32 },
      { id: "b", name: "Badkamer", type: "badkamer", area: 5 },
    ],
    items: [],
  };
  it("prices room jobs by their size and adds safety and insulation for an older house", () => {
    const list = suggestions(p);
    const floor = list.find((s) => s.title === "Nieuwe vloer leggen")!;
    expect(floor.estimate).toBe(1450); // 32 m² × € 45, rounded
    expect(list.find((s) => s.title === "Badkamer vernieuwen")!.estimate).toBe(9000);
    expect(list.map((s) => s.title)).toEqual(expect.arrayContaining(["Rookmelders plaatsen", "Groepenkast laten controleren of vervangen", "Vloerisolatie", "Spouwmuurisolatie"]));
    expect(list.find((s) => s.title === "Rookmelders plaatsen")!.estimate).toBe(75); // 3 storeys
  });
  it("leaves out what is already planned", () => {
    const withTask: Project = { ...p, renovation: { tasks: [task({ title: "Nieuwe vloer leggen", roomIds: ["w"] })] } };
    expect(suggestions(withTask, "w").map((s) => s.title)).not.toContain("Nieuwe vloer leggen");
  });
});

describe("planning", () => {
  it("counts working days", () => {
    expect(addWorkdays("2026-10-02", 1)).toBe("2026-10-02"); // Friday
    expect(addWorkdays("2026-10-02", 2)).toBe("2026-10-05"); // over the weekend
    expect(addWorkdays("2026-10-03", 1)).toBe("2026-10-05"); // Saturday → Monday
  });
  it("plans like a builder: per room in order, rough work first, one job at a time for yourself", () => {
    const tasks = [
      task({ id: "floor", kind: "vloeren", roomIds: ["w"], days: 2 }),
      task({ id: "paint", kind: "schilderen", roomIds: ["w"], days: 3, who: "zelf" }),
      task({ id: "demo", kind: "sloop", roomIds: ["w"], days: 1 }),
      task({ id: "wiring", kind: "elektra", days: 1 }),
      task({ id: "bath", kind: "badkamer", roomIds: ["b"], days: 5 }),
      task({ id: "paint2", kind: "schilderen", roomIds: ["s"], days: 1, who: "zelf" }),
    ];
    const plan = autoPlan(tasks, "2026-10-01"); // Thursday
    const by = Object.fromEntries(plan.map((t) => [t.id, t]));
    expect(by.demo.start).toBe("2026-10-01");
    expect(by.wiring.start).toBe("2026-10-01"); // another trade, the whole house: side by side
    expect(by.bath.start).toBe("2026-10-02"); // after the wiring, next to the living room
    expect(by.paint.start).toBe("2026-10-02"); // after the demolition in the same room
    expect(taskEnd(by.paint)).toBe("2026-10-06");
    expect(by.paint2.start).toBe("2026-10-07"); // yourself: after your other paint job
    expect(by.floor.start).toBe("2026-10-07"); // after the paint in the same room
    expect(taskEnd(by.floor)).toBe("2026-10-08");
    expect(lateTasks({ moveDate: "2026-10-07", tasks: plan }).map((t) => t.id).sort()).toEqual(["bath", "floor"]);
  });
});
