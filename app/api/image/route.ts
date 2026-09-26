import { FetchError, safeFetch } from "@/lib/fetchPage";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * GET ?url=... -> proxies an image so the browser can read its pixels
 * (canvas cut-outs and in-browser AI need same-origin images).
 */
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url");
  try {
    if (!target) throw new FetchError("url ontbreekt");
    const res = await safeFetch(target, { headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" } });
    const type = res.headers.get("content-type") ?? "";
    // SVG is refused: served from our origin it could run scripts.
    if (!res.ok || !type.startsWith("image/") || type.includes("svg")) throw new FetchError("Geen afbeelding", 502);
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) throw new FetchError("Afbeelding te groot", 413);
    return new Response(body, {
      headers: { "content-type": type, "cache-control": "public, max-age=86400, immutable" },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Fout", { status: e instanceof FetchError ? e.status : 500 });
  }
}
