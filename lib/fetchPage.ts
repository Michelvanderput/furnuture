import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
};

export class FetchError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Rejects non-http(s) URLs and hosts that resolve to private networks (SSRF guard). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("Dat is geen geldige link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("Alleen http(s)-links worden ondersteund.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new FetchError("Deze website kon niet gevonden worden.");
  if (addresses.some(isPrivateAddress)) throw new FetchError("Deze link is niet toegestaan.");
  return url;
}

/** Fetch with manual redirects so every hop passes the SSRF guard. */
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = raw;
  for (let i = 0; i <= maxRedirects; i++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...BROWSER_HEADERS, ...(init.headers as Record<string, string> | undefined) },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new FetchError("Te veel doorverwijzingen.");
}

export async function fetchHtml(raw: string): Promise<{ html: string; finalUrl: string }> {
  const res = await safeFetch(raw);
  if (!res.ok) {
    if (res.status === 404 || res.status === 410) throw new FetchError("Deze pagina bestaat niet (meer).", 404);
    throw new FetchError(
      res.status === 403 || res.status === 429 ? "De website blokkeert automatisch ophalen." : `De website gaf een foutmelding (${res.status}).`,
      502,
    );
  }
  const html = (await res.text()).slice(0, 5_000_000);
  return { html, finalUrl: res.url || raw };
}
