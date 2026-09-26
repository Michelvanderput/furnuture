import { NextResponse } from "next/server";
import { FetchError, fetchHtml, safeFetch } from "@/lib/fetchPage";
import { fundaListingId, isFundaUrl, parseFunda, parseFundaApi } from "@/lib/extract";
import type { FundaResult } from "@/lib/types";

export const runtime = "nodejs";
// Funda serves Dutch visitors; run close to them.
export const preferredRegion = ["fra1", "cdg1", "ams1"];

const API_BASE = "https://listing-detail-page.funda.io/api/v4/listing/object/nl";

function appHeaders(): Record<string, string> {
  const traceId = String(Math.floor(Math.random() * 9e17) + 1e18);
  const parentId = Math.floor(Math.random() * 9e14 + 1e15).toString(16);
  const tid = `${Math.floor(Date.now() / 1000).toString(16)}00000000`;
  // Same headers the Funda Android app sends.
  return {
    "user-agent": "Dart/3.11 (dart:io)",
    accept: "application/json",
    "content-type": "application/json",
    "x-funda-app-platform": "android",
    "x-funda-app-version": "7.14.11",
    "x-datadog-origin": "rum",
    "x-datadog-sampling-priority": "0",
    "x-datadog-parent-id": traceId,
    tracestate: `dd=s:0;o:rum;p:${parentId}`,
    traceparent: `00-${tid}${traceId.slice(0, 16)}-${parentId}-00`,
  };
}

/** Funda's mobile-app API: tries the URL id as tinyId first, then as globalId. */
async function fromAppApi(id: string): Promise<FundaResult | null> {
  for (const url of [`${API_BASE}/tinyId/${id}`, `${API_BASE}/${id}`]) {
    try {
      const res = await safeFetch(url, { headers: appHeaders() });
      if (!res.ok) continue;
      const result = parseFundaApi(await res.json());
      if (result.photos.length > 0) return result;
    } catch {
      // Try the next endpoint, then the website.
    }
  }
  return null;
}

async function fromWebsite(url: string): Promise<FundaResult> {
  const listing = await fetchHtml(url);
  const result = parseFunda(listing.html, listing.finalUrl);
  // The listing page only shows a handful of photos; the media page has all of them.
  const mediaUrl = new URL("media/foto/", listing.finalUrl.endsWith("/") ? listing.finalUrl : `${listing.finalUrl}/`);
  const media = await fetchHtml(mediaUrl.toString()).catch(() => null);
  if (media) result.photos = [...new Set([...result.photos, ...parseFunda(media.html, media.finalUrl).photos])];
  return result;
}

/**
 * POST { url } -> listing photos, via Funda's app API or else the website.
 * POST { url, html } -> parses page source the user pasted.
 */
export async function POST(req: Request) {
  const { url, html } = (await req.json().catch(() => ({}))) as { url?: string; html?: string };
  try {
    if (html) return NextResponse.json(parseFunda(html, url || "https://www.funda.nl/"));
    if (!url || !isFundaUrl(url)) throw new FetchError("Plak een link naar een woning op funda.nl.");

    const id = fundaListingId(url);
    const result =
      (id && (await fromAppApi(id))) ||
      (await fromWebsite(url).catch((e) => {
        throw new FetchError(
          `Funda blokkeert ophalen vanaf onze server${e instanceof FetchError ? "" : " (geen verbinding)"}. ` +
            "Gebruik hieronder de knop 'Foto's van Funda halen', plak de paginabron of upload de foto's.",
          502,
        );
      }));
    if (!result.title) result.title = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-2) ?? "");
    if (result.photos.length === 0) {
      throw new FetchError("Geen foto's gevonden. Gebruik de knop 'Foto's van Funda halen' of upload de foto's.", 422);
    }
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof FetchError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status });
  }
}
