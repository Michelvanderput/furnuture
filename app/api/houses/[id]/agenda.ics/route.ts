import { agenda, toIcs } from "@/lib/agenda";
import { fromRows } from "@/lib/db/rows";
import { DbError, isPremium, isUuid, loadHouse } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The planning as a calendar subscription (webcal://…/agenda.ics): the iPhone, Google
 * or Outlook calendar fetches it every few hours, so changes show up by themselves.
 * A Premium feature (see the audit's premium strategy).
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    if (!(await isPremium(id))) throw new DbError("Agenda-koppeling is een Premium-functie. Upgrade deze woning via /premium.", 402);
    const { house, rows } = await loadHouse(id);
    const name = String(house.name);
    const origin = new URL(req.url).origin;
    const ics = toIcs(agenda(fromRows(house, rows)).events, name, `${origin}/?woning=${encodeURIComponent(name)}#/planning`);
    return new Response(ics, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `inline; filename="furnuture-planning.ics"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Fout", { status: e instanceof DbError ? e.status : 500 });
  }
}
