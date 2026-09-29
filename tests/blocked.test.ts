import { afterEach, describe, expect, it, vi } from "vitest";
import { titleFromUrl } from "@/lib/products";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "76.76.21.21" }] }));

describe("shops that block reading their pages", () => {
  it("takes a name from the link", () => {
    expect(titleFromUrl("https://www.karwei.nl/assortiment/karwei-binnenlak-zijdeglans-750-ml-wit/p/B455123")).toBe("Karwei binnenlak zijdeglans 750 ml wit");
    expect(titleFromUrl("https://www.bol.com/nl/nl/p/ikea-lack-bijzettafel-zwart-55x55-cm/9200000070880557/")).toBe("Ikea lack bijzettafel zwart 55x55 cm");
    expect(titleFromUrl("https://www.kwantum.nl/hoekbank-regalo-links-bruin-4327433")).toBe("Hoekbank regalo links bruin");
    expect(titleFromUrl("https://www.example.nl/p/12345")).toBeUndefined();
  });

  afterEach(() => vi.unstubAllGlobals());
  it("sees a bot check that answers 200 as blocked", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html><title>Vercel Security Checkpoint</title></html>", { status: 200 }));
    const { fetchHtml, FetchError } = await import("@/lib/fetchPage");
    await expect(fetchHtml("https://www.karwei.nl/x")).rejects.toMatchObject({ status: 403 });
    expect(FetchError).toBeDefined();
  });
  it("and a 429 too", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    const { fetchHtml } = await import("@/lib/fetchPage");
    await expect(fetchHtml("https://www.karwei.nl/x")).rejects.toMatchObject({ status: 403, message: "De website blokkeert automatisch ophalen." });
  });
});
