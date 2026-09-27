import { NextResponse } from "next/server";
import { FetchError, fetchHtml } from "@/lib/fetchPage";
import { parseProduct } from "@/lib/extract";

export const runtime = "nodejs";

/** POST { url } -> product title, image(s), price, shop and a guessed category. */
export async function POST(req: Request) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  try {
    if (!url) throw new FetchError("Plak een link naar een product.");
    const page = await fetchHtml(url);
    const info = parseProduct(page.html, page.finalUrl);
    // A product that no longer exists often redirects to an overview page ("Producten").
    const path = (u: string) => new URL(u).pathname.replace(/\/$/, "");
    if (path(page.finalUrl) !== path(url) && info.priceValue === undefined) {
      throw new FetchError("Deze link verwijst niet (meer) naar een product: de winkel stuurt door naar een overzichtspagina.", 422);
    }
    info.images = info.images.filter((i) => i !== page.finalUrl);
    info.image = info.images[0] ?? "";
    if (!info.image) throw new FetchError("Geen productafbeelding gevonden op deze pagina.", 422);
    return NextResponse.json(info);
  } catch (e) {
    const status = e instanceof FetchError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status });
  }
}
