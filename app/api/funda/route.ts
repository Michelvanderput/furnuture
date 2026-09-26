import { NextResponse } from "next/server";
import { FetchError, fetchHtml } from "@/lib/fetchPage";
import { isFundaUrl, parseFunda } from "@/lib/extract";

export const runtime = "nodejs";

/**
 * POST { url } -> fetches the listing (plus its photo page) and returns the photos.
 * POST { url, html } -> parses page source the user pasted (fallback when Funda blocks us).
 */
export async function POST(req: Request) {
  const { url, html } = (await req.json().catch(() => ({}))) as { url?: string; html?: string };
  try {
    if (html) return NextResponse.json(parseFunda(html, url || "https://www.funda.nl/"));
    if (!url || !isFundaUrl(url)) throw new FetchError("Plak een link naar een woning op funda.nl.");

    const listing = await fetchHtml(url);
    const result = parseFunda(listing.html, listing.finalUrl);

    // The listing page only shows a handful of photos; the media page has all of them.
    const mediaUrl = new URL("media/foto/", listing.finalUrl.endsWith("/") ? listing.finalUrl : `${listing.finalUrl}/`);
    const media = await fetchHtml(mediaUrl.toString()).catch(() => null);
    if (media) {
      const extra = parseFunda(media.html, media.finalUrl).photos;
      result.photos = [...new Set([...result.photos, ...extra])];
    }
    if (result.photos.length === 0) {
      throw new FetchError("Geen foto's gevonden. Plak de paginabron of upload de foto's handmatig.", 422);
    }
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof FetchError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status });
  }
}
