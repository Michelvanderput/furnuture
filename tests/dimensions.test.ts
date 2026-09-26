import { describe, expect, it } from "vitest";
import { dimsFromJsonLd, dimsFromLabels, dimsFromTitle, formatDims, mergeDims } from "@/lib/dimensions";
import { parseProduct } from "@/lib/extract";

describe("product dimensions", () => {
  it("reads schema.org sizes in any unit", () => {
    expect(
      dimsFromJsonLd({
        width: { "@type": "QuantitativeValue", value: 2200, unitCode: "MMT" },
        depth: { value: "95", unitCode: "CMT" },
        height: "0,8 m",
      }),
    ).toEqual({ w: 220, d: 95, h: 80 });
  });

  it("reads specification labels", () => {
    expect(dimsFromLabels("Afmetingen Breedte: 220 cm Diepte: 95 cm Hoogte: 83 cm Zithoogte: 45 cm")).toEqual({ w: 220, d: 95, h: 83 });
    expect(dimsFromLabels("Width 180cm, Length 200 cm")).toEqual({ w: 180, d: 200 });
  });

  it("reads sizes in titles", () => {
    expect(dimsFromTitle("Hoekbank Lisa 220x95x80 cm")).toEqual({ w: 220, d: 95, h: 80 });
    expect(dimsFromTitle("Boxspring 160 x 200")).toEqual({ w: 160, d: 200 });
    expect(dimsFromTitle("Eettafel B180 x D90 x H76 cm")).toEqual({ w: 180, d: 90, h: 76 });
    expect(dimsFromTitle("Vloerkleed 2x3 m")).toEqual({ w: 200, d: 300 });
    expect(dimsFromTitle("Lamp Bol")).toEqual({});
  });

  it("merges sources and formats", () => {
    expect(mergeDims({ w: 220 }, { w: 999, d: 95 }, { h: 80 })).toEqual({ w: 220, d: 95, h: 80 });
    expect(mergeDims({}, {})).toBeUndefined();
    expect(formatDims({ w: 220, d: 95 })).toBe("220 × 95 × ? cm");
  });

  it("is part of reading a product page", () => {
    const html = `<meta property="og:title" content="SÖDERHAMN 3-zitsbank"><meta property="og:image" content="https://x.nl/a.jpg">
      <div class="specs"><dt>Breedte:</dt><dd>198 cm</dd><dt>Diepte:</dt><dd>99 cm</dd><dt>Hoogte:</dt><dd>83 cm</dd></div>`;
    expect(parseProduct(html, "https://www.ikea.com/nl/nl/p/x").dims).toEqual({ w: 198, d: 99, h: 83 });
  });
});
