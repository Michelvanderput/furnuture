import { NextResponse } from "next/server";
import { countSince, DbError, houseRow, isUuid } from "@/lib/db/supabase";
import { sendToHouse } from "@/lib/push.server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * POST { kind: "ask", device, member, open: "item:<id>", about: "Hoekbank MOLLY", message? }
 *   -> "Sanne vraagt of je naar Hoekbank MOLLY wilt kijken" on the other devices.
 * POST { kind: "test", device, member } -> a test notification on this device only.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    const b = (await req.json()) as { kind?: string; device?: string; member?: string; open?: string; about?: string; message?: string; delay?: number; to?: string[] };
    const house = await houseRow(id, ["name"]);
    if (!house) throw new DbError("Woning niet gevonden", 404);
    const houseName = String(house.name);
    const device = clip(b.device, 64);
    const member = clip(b.member, 40);

    if (b.kind === "test") {
      if (!device) throw new DbError("Onbekend apparaat", 400);
      // Time to leave the app: iOS shows no banner while the web app is in front.
      const wait = Math.min(Math.max(Number(b.delay) || 0, 0), 8);
      if (wait) await new Promise((r) => setTimeout(r, wait * 1000));
      const r = await sendToHouse(id, { title: "Meldingen staan aan", body: `Je krijgt hier berichten over ${houseName}.` }, { kind: "test", houseName, onlyDevice: device, device, member, log: false });
      return NextResponse.json(r);
    }

    if (b.kind !== "ask") throw new DbError("Onbekend soort melding", 400);
    // Enough to be useful, not enough to annoy (or to abuse the endpoint).
    if ((await countSince(id, "ask", new Date(Date.now() - 3_600_000))) >= 30) throw new DbError("Even genoeg gevraagd: probeer het over een uur nog eens.", 429);
    const about = clip(b.about, 80);
    const open = /^(item|task):[A-Za-z0-9_-]{1,40}$/.test(b.open ?? "") ? b.open : undefined;
    const message = clip(b.message, 200);
    const who = member || "Je partner";
    const to = (Array.isArray(b.to) ? b.to : []).map((n) => clip(n, 40)).filter(Boolean).slice(0, 10);
    const r = await sendToHouse(
      id,
      { title: `${who} vraagt of je naar ${about || "iets"} wilt kijken`, body: message || "Tik om het te openen.", open },
      { kind: "ask", houseName, exceptDevice: device, device, member, to },
    );
    return NextResponse.json(r);
  } catch (e) {
    return fail(e);
  }
}
