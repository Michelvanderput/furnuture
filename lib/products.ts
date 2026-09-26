import type { Product, ProductInfo, RoomType } from "./types";
import { newId } from "./useProject";

/** Same product page, ignoring tracking parameters and a trailing slash. */
export const sameLink = (a: string, b: string) =>
  a.replace(/[?#].*$/, "").replace(/\/$/, "") === b.replace(/[?#].*$/, "").replace(/\/$/, "");

/**
 * Reads a webshop link into a product. When the shop blocks us, the link is
 * kept anyway (with `error`), so the user can add a photo by hand.
 */
export async function fetchProduct(url: string, room?: RoomType): Promise<{ product: Product; error?: string }> {
  try {
    const res = await fetch("/api/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as ProductInfo & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "mislukt");
    return { product: { ...data, id: newId(), status: "optie", note: "", room } };
  } catch (e) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return {
      product: { id: newId(), url, title: host, image: "", images: [], shop: host, category: "overig", status: "optie", note: "", room },
      error: `${host}: ${e instanceof Error ? e.message : e}`,
    };
  }
}
