import { describe, expect, it } from "vitest";
import { parseProduct } from "@/lib/extract";

const page = (head: string, body = "") => `<html><head><title>Test</title><meta property="og:image" content="https://shop.nl/p.jpg">${head}</head><body>${body}</body></html>`;
const ld = (x: unknown) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`;

describe("prices from shop pages", () => {
  it("a product in a @graph (Westwing)", () => {
    const html = page(ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": "Product", name: "Bank Fluente", offers: [{ "@type": "Offer", price: 999, priceCurrency: "EUR" }] }] }));
    expect(parseProduct(html, "https://www.westwing.nl/bank-fluente-159737.html")).toMatchObject({ title: "Bank Fluente", priceValue: 999 });
  });
  it("the size in the link, from a product group (JYSK)", () => {
    const v = (size: string, price: string) => ({ "@type": "Product", name: `Dekbed ${size}`, offers: { "@type": "Offer", url: `https://jysk.nl/dekbed-${size}`, price } });
    const html = page(ld({ "@type": "ProductGroup", name: "Dekbed", hasVariant: [v("140x200", "69.99"), v("135x200", "59.99"), v("200x200", "89.99")] }));
    expect(parseProduct(html, "https://jysk.nl/dekbed-200x200")).toMatchObject({ title: "Dekbed 200x200", priceValue: 89.99 });
    // No size in the link: the cheapest.
    expect(parseProduct(html, "https://jysk.nl/dekbed")).toMatchObject({ priceValue: 59.99 });
  });
  it("an aggregate offer with offers inside, and Dutch notation", () => {
    const html = page(ld({ "@type": "Product", name: "Kast", offers: { "@type": "AggregateOffer", offers: [{ price: "1.299,00", priceCurrency: "EUR" }] } }));
    expect(parseProduct(html, "https://shop.nl/kast").priceValue).toBe(1299);
  });
  it("microdata when there is no structured data", () => {
    const html = page("", `<span itemprop="price" content="249.95"></span><meta itemprop="priceCurrency" content="EUR">`);
    expect(parseProduct(html, "https://shop.nl/stoel").priceValue).toBe(249.95);
  });
  it("the page's own price in app data, not a price of another product (Auping)", () => {
    const data = JSON.stringify([
      { path: "/nl/dekbedovertrekken/stripe-beige", name: "Beige", price: { finalPrice: 119.95 } },
      { sku: "BK318A", name: "White", price: { currencyCode: "EUR", finalPrice: 129.95 }, images: ["x"], path: "/nl/dekbedovertrekken/stripe-white" },
    ]);
    const html = page("", `<script>self.__next_f.push([1,${JSON.stringify(data)}])</script>`);
    expect(parseProduct(html, "https://www.auping.com/nl/dekbedovertrekken/stripe-white").priceValue).toBe(129.95);
  });
});
