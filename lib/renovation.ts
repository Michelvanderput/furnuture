import { newId } from "./rooms";
import { euro } from "./shopping";
import type { Project, Quote, RenoKind, RenoStatus, Renovation, Room, Task } from "./types";

/**
 * Renovation ("verbouwing"): jobs per room or for the whole house, in the order work
 * is done — rough to fine: demolition and pipes first, then walls, kitchen and
 * bathroom, paint, and the floor last — with estimates from the room sizes, quotes,
 * and a plan from the key handover to moving day.
 */

export const PHASES = [
  { id: 1, label: "Slopen en voorbereiden", hint: "Eerst alles eruit wat weg moet." },
  { id: 2, label: "Leidingen en installaties", hint: "Elektra, water en verwarming, zolang muren en vloeren nog open mogen." },
  { id: 3, label: "Verduurzamen", hint: "Isoleren en glas: scheelt direct op de energierekening." },
  { id: 4, label: "Wanden en timmerwerk", hint: "Stucwerk en timmerwerk, voordat er geschilderd wordt." },
  { id: 5, label: "Keuken en badkamer", hint: "De grote klussen met de langste levertijd: vroeg bestellen." },
  { id: 6, label: "Afwerken", hint: "Eerst schilderen, dan de vloer: zo komt er geen verf op je nieuwe vloer." },
  { id: 7, label: "Buiten en oplevering", hint: "Tuin, schoonmaken en de laatste puntjes." },
] as const;

export const KINDS: Record<RenoKind, { label: string; phase: number; days: number }> = {
  sloop: { label: "Slopen", phase: 1, days: 2 },
  elektra: { label: "Elektra", phase: 2, days: 2 },
  leidingwerk: { label: "Leidingwerk", phase: 2, days: 2 },
  installaties: { label: "Verwarming en ventilatie", phase: 2, days: 2 },
  isolatie: { label: "Isolatie", phase: 3, days: 2 },
  kozijnen: { label: "Kozijnen en glas", phase: 3, days: 2 },
  stucwerk: { label: "Stucwerk", phase: 4, days: 3 },
  timmerwerk: { label: "Timmerwerk", phase: 4, days: 2 },
  keuken: { label: "Keuken", phase: 5, days: 5 },
  badkamer: { label: "Badkamer", phase: 5, days: 10 },
  schilderen: { label: "Schilderen", phase: 6, days: 2 },
  vloeren: { label: "Vloeren", phase: 6, days: 2 },
  tuin: { label: "Tuin", phase: 7, days: 4 },
  schoonmaak: { label: "Schoonmaken", phase: 7, days: 1 },
  overig: { label: "Overig", phase: 7, days: 1 },
};
export const KIND_ORDER = (Object.keys(KINDS) as RenoKind[]).sort((a, b) => KINDS[a].phase - KINDS[b].phase);

export const RENO_STATUS: { id: RenoStatus; label: string }[] = [
  { id: "idee", label: "Idee" },
  { id: "offerte", label: "Offertes" },
  { id: "gepland", label: "Gepland" },
  { id: "bezig", label: "Bezig" },
  { id: "klaar", label: "Klaar" },
];

export const renovationOf = (p: Project): Renovation => p.renovation ?? { tasks: [] };

// ---------------------------------------------------------------------------
// Costs

/** What a job costs: the chosen quote, else the estimate. */
export function taskCost(t: Task): { value: number; firm: boolean; known: boolean } {
  const q = t.quotes.find((x) => x.id === t.chosenQuote);
  if (q) return { value: q.amount, firm: true, known: true };
  if (t.estimate !== undefined) return { value: t.estimate, firm: false, known: true };
  return { value: 0, firm: false, known: false };
}
export const cheapestQuote = (t: Task): Quote | undefined => [...t.quotes].sort((a, b) => a.amount - b.amount)[0];

export interface RenoTotals {
  total: number;
  /** Part that is only an estimate (no chosen quote). */
  estimated: number;
  /** Chosen quotes. */
  firm: number;
  done: number;
  count: number;
  doneCount: number;
  /** Jobs still without a price. */
  unpriced: number;
}
export function renoTotals(tasks: Task[]): RenoTotals {
  const t: RenoTotals = { total: 0, estimated: 0, firm: 0, done: 0, count: tasks.length, doneCount: 0, unpriced: 0 };
  for (const task of tasks) {
    const c = taskCost(task);
    t.total += c.value;
    if (c.firm) t.firm += c.value;
    else t.estimated += c.value;
    if (!c.known) t.unpriced++;
    if (task.status === "klaar") (t.done += c.value), t.doneCount++;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Estimates from the room's size (rough Dutch prices, incl. VAT; always "±")

/** Walls + ceiling to paint for a floor area: a square room, 2.6 m high, 15% windows and doors. */
export const paintArea = (m2: number) => Math.round(m2 + 4 * Math.sqrt(m2) * 2.6 * 0.85);

const round = (n: number) => (n < 200 ? Math.round(n / 5) * 5 : n < 2000 ? Math.round(n / 25) * 25 : Math.round(n / 100) * 100);

/** Floor area of the ground floor, for floor insulation: living area / storeys. */
function groundFloor(p: Project): number {
  const area = parseInt(p.listing?.facts?.livingArea ?? "", 10);
  const stories = parseInt(p.listing?.facts?.stories ?? "", 10) || 2;
  return Number.isFinite(area) ? Math.round(area / Math.min(3, stories)) : 45;
}

export interface Suggestion {
  key: string;
  title: string;
  kind: RenoKind;
  roomId?: string;
  who: "zelf" | "vakman";
  estimate: number;
  days: number;
  beforeMove: boolean;
  why: string;
}

/**
 * Jobs that usually come up in this house: per room (paint, floor, kitchen, bathroom…,
 * priced by its m²) and for the whole house (safety, and insulation for older houses
 * and energy labels C and lower). Jobs already on the list are left out.
 */
export function suggestions(p: Project, roomId?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const rooms = roomId ? p.rooms.filter((r) => r.id === roomId) : p.rooms;
  for (const r of rooms) out.push(...roomSuggestions(r, p.rooms.find((x) => x.type === r.type)?.id === r.id));
  if (!roomId) out.push(...houseSuggestions(p));
  const tasks = renovationOf(p).tasks;
  const have = new Set(tasks.map((t) => keyOf(t.title, t.roomIds[0])));
  return out
    .filter((s) => !have.has(keyOf(s.title, s.roomId)) && !similarTask(tasks, s.kind, s.roomId))
    // The whole house first (safety, insulation), then in the order the work is done.
    .sort((a, b) => Number(!!a.roomId) - Number(!!b.roomId) || KINDS[a.kind].phase - KINDS[b.kind].phase);
}

/** A job of this kind in this room (or for the whole house) is already on the list. */
export function similarTask(tasks: Task[], kind: RenoKind, roomId?: string): Task | undefined {
  return tasks.find((t) => t.kind === kind && (roomId ? t.roomIds.includes(roomId) : t.roomIds.length === 0) && kind !== "overig");
}
const keyOf = (title: string, roomId?: string) => `${roomId ?? "huis"}:${title.toLowerCase()}`;

/** `first`: the first room of its kind (the stairs are suggested once, not for every landing). */
function roomSuggestions(r: Room, first = true): Suggestion[] {
  const a = r.area ?? ({ woonkamer: 30, keuken: 10, slaapkamer: 12, badkamer: 6, toilet: 2, hal: 8, werkkamer: 9, zolder: 20, tuin: 50 } as Record<string, number>)[r.type] ?? 10;
  const s = (title: string, kind: RenoKind, who: "zelf" | "vakman", estimate: number, why: string, beforeMove = true, days?: number): Suggestion => ({
    key: keyOf(title, r.id),
    title,
    kind,
    roomId: r.id,
    who,
    estimate: round(estimate),
    days: days ?? KINDS[kind].days,
    beforeMove,
    why,
  });
  const paint = paintArea(a);
  const list: Suggestion[] = [];
  if (["woonkamer", "slaapkamer", "werkkamer", "zolder", "hal", "overig"].includes(r.type)) {
    list.push(s(`Muren en plafond schilderen`, "schilderen", "zelf", paint * 3.5, `± ${paint} m² verven; zelf ± € 3,50/m² aan verf en spullen (schilder ± € 20/m²).`, true, Math.max(1, Math.round(paint / 40))));
    if (r.type !== "hal") list.push(s(`Nieuwe vloer leggen`, "vloeren", "vakman", a * 45, `${a} m² laminaat of pvc, gelegd ± € 45/m² (zelf ± € 25/m²). Leg de vloer na het schilderen.`, true, Math.max(1, Math.round(a / 20))));
  }
  if (r.type === "hal" && first) list.push(s("Trap bekleden", "timmerwerk", "vakman", 1400, "Een open of versleten trap: bekleden met laminaat of pvc, ± € 1.400."));
  if (r.type === "keuken") {
    list.push(s("Keuken opknappen (fronten, werkblad)", "keuken", "zelf", 1500, "Nieuwe fronten, greepjes en werkblad: veel effect voor weinig geld."));
    list.push(s("Nieuwe keuken", "keuken", "vakman", 9000, "Een complete keuken incl. apparatuur en plaatsen, middenklasse ± € 9.000. Levertijd vaak 6–10 weken.", true, 5));
  }
  if (r.type === "badkamer") {
    list.push(s("Badkamer opfrissen (kitten, voegen, kranen)", "badkamer", "zelf", 300, "Nieuwe kitnaden, voegen en kranen: een badkamer voelt meteen schoon."));
    list.push(s("Badkamer vernieuwen", "badkamer", "vakman", Math.max(9000, a * 1600), `Complete badkamer, ${a} m²: ± € 1.600/m², minimaal ± € 9.000. Duurt ± 2 weken.`, true, 10));
  }
  if (r.type === "toilet") list.push(s("Toilet vernieuwen", "badkamer", "vakman", 2500, "Nieuwe tegels, hangtoilet en fonteintje: ± € 2.500.", true, 5));
  if (r.type === "tuin") list.push(s("Tuin opknappen", "tuin", "zelf", a * 20, `${a} m²: zelf ± € 20/m² aan planten, grond en tegels (hovenier ± € 60/m²).`, false));
  return list;
}

function houseSuggestions(p: Project): Suggestion[] {
  const f = p.listing?.facts ?? {};
  const year = parseInt(f.buildYear ?? "", 10);
  const label = (f.energyLabel ?? "").toUpperCase();
  const stories = parseInt(f.stories ?? "", 10) || 2;
  const s = (title: string, kind: RenoKind, who: "zelf" | "vakman", estimate: number, why: string, beforeMove = true, days?: number): Suggestion => ({
    key: keyOf(title),
    title,
    kind,
    who,
    estimate: round(estimate),
    days: days ?? KINDS[kind].days,
    beforeMove,
    why,
  });
  const list: Suggestion[] = [
    s("Sloten vervangen", "timmerwerk", "zelf", 150, "Je weet niet wie er nog sleutels heeft. Kies SKG** of hoger.", true, 1),
    s("Rookmelders plaatsen", "elektra", "zelf", stories * 25, `Verplicht op elke verdieping met een verblijfsruimte of vluchtroute: ${stories} verdieping${stories > 1 ? "en" : ""}.`, true, 1),
    s("Schoonmaken voor de verhuizing", "schoonmaak", "zelf", 80, "Nu het huis nog leeg is, kan het overal bij.", true, 1),
  ];
  if (Number.isFinite(year) && year < 1985) list.push(s("Groepenkast laten controleren of vervangen", "elektra", "vakman", 1000, `Bouwjaar ${year}: vaak nog weinig groepen en geen aardlekschakelaars. Vervangen ± € 1.000.`, true, 1));
  const weak = /^[C-G]/.test(label) || (!label && Number.isFinite(year) && year < 1995);
  if (weak) {
    const why = `Energielabel ${label || "onbekend"}${Number.isFinite(year) ? `, bouwjaar ${year}` : ""}.`;
    list.push(s("Vloerisolatie", "isolatie", "vakman", groundFloor(p) * 30, `${why} ± € 30/m² onder de begane grond. Met 2 maatregelen mogelijk ISDE-subsidie.`, false, 1));
    if (!Number.isFinite(year) || (year >= 1920 && year < 1980)) list.push(s("Spouwmuurisolatie", "isolatie", "vakman", 1800, `${why} Spouw vullen is in 1 dag gedaan en verdient zich snel terug. Mogelijk ISDE-subsidie.`, false, 1));
    list.push(s("Dakisolatie", "isolatie", "vakman", 3500, `${why} Warmte ontsnapt vooral via het dak. Mogelijk ISDE-subsidie.`, true, 2));
    list.push(s("HR++-glas", "kozijnen", "vakman", 3000, `${why} Enkel of oud dubbel glas vervangen. Mogelijk ISDE-subsidie.`, false, 2));
  }
  return list;
}

export const taskFromSuggestion = (s: Suggestion): Task => ({
  id: newId(),
  title: s.title,
  kind: s.kind,
  roomIds: s.roomId ? [s.roomId] : [],
  who: s.who,
  status: "idee",
  estimate: s.estimate,
  quotes: [],
  days: s.days,
  beforeMove: s.beforeMove,
  note: "",
  why: s.why,
  addedAt: Date.now(),
  source: "suggestie",
});

// ---------------------------------------------------------------------------
// Planning

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T12:00:00Z`);
export const today = () => iso(new Date());

/** The date `n` working days after `from` (weekends skipped); the start itself counts as day 1. */
export function addWorkdays(from: string, n: number): string {
  const d = parse(from);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  let left = Math.max(1, n) - 1;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return iso(d);
}
export const nextWorkday = (s: string) => addWorkdays(iso(new Date(parse(s).getTime() + 86_400_000)), 1);
export const taskEnd = (t: Task) => (t.start ? addWorkdays(t.start, t.days ?? KINDS[t.kind].days) : undefined);
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

/**
 * Plans every job that is not done, from the key date, as a builder would:
 * - in one room the work follows the phases (walls before paint before floor);
 * - demolition and pipes for the whole house come before all finishing work;
 * - one trade does one job at a time, and you can only do one job yourself at a time;
 * - everything else runs side by side (paint a bedroom while the bathroom is being done).
 */
export function autoPlan(tasks: Task[], keyDate: string): Task[] {
  const todo = tasks.filter((t) => t.status !== "klaar").sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const busyUntil = new Map<string, string>(); // lane -> last day taken
  let roughEnd: string | undefined; // end of house-wide demolition and pipes
  const out = new Map<string, Task>();
  for (const t of todo) {
    const phase = KINDS[t.kind].phase;
    const lanes = [
      ...t.roomIds.map((r) => `kamer:${r}`),
      ...(t.roomIds.length ? [] : [`vak:${t.kind}`]),
      ...(t.who === "zelf" ? ["zelf"] : [`vak:${t.kind}`]),
    ];
    const after = [...lanes.map((l) => busyUntil.get(l)), phase > 2 ? roughEnd : undefined].filter((d): d is string => !!d).sort().at(-1);
    const start = after ? nextWorkday(after) : addWorkdays(keyDate, 1);
    const planned = { ...t, start, days: t.days ?? KINDS[t.kind].days };
    const end = taskEnd(planned)!;
    lanes.forEach((l) => busyUntil.set(l, end));
    if (phase <= 2 && !t.roomIds.length && (!roughEnd || end > roughEnd)) roughEnd = end;
    out.set(t.id, planned);
  }
  return tasks.map((t) => out.get(t.id) ?? t);
}

/** Jobs that must be done before moving in but end after moving day (or are not planned yet). */
export function lateTasks(r: Renovation): Task[] {
  if (!r.moveDate) return [];
  return r.tasks.filter((t) => t.beforeMove && t.status !== "klaar" && (taskEnd(t) ?? "9999") > r.moveDate!);
}

// ---------------------------------------------------------------------------
// Sharing

export function renovationText(p: Project): string {
  const r = renovationOf(p);
  const room = (t: Task) => (t.roomIds.length ? t.roomIds.map((id) => p.rooms.find((x) => x.id === id)?.name ?? "").filter(Boolean).join(", ") : "Hele huis");
  const lines = [`🔨 Verbouwplan ${p.listing?.title ?? "ons nieuwe huis"}`, ""];
  if (r.keyDate) lines.push(`Sleutel: ${r.keyDate}${r.moveDate ? ` · verhuizen: ${r.moveDate}` : ""}`, "");
  for (const phase of PHASES) {
    const list = r.tasks.filter((t) => KINDS[t.kind].phase === phase.id);
    if (!list.length) continue;
    lines.push(`— ${phase.label} —`);
    for (const t of list) {
      const c = taskCost(t);
      lines.push(
        `${t.status === "klaar" ? "✅" : "☐"} ${t.title} (${room(t)}) · ${t.who === "zelf" ? "zelf" : "vakman"} · ${c.known ? `${c.firm ? "" : "± "}${euro(c.value)}` : "prijs?"}${t.start ? ` · ${t.start}` : ""}`,
      );
    }
    lines.push("");
  }
  const tt = renoTotals(r.tasks);
  lines.push(`Totaal: ${euro(tt.total)}${tt.estimated ? ` (waarvan ± ${euro(tt.estimated)} geschat)` : ""}`);
  return lines.join("\n");
}
