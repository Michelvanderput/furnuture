import { describe, expect, it } from "vitest";
import { dimsFromJsonLd, dimsFromLabels, dimsFromNamedMeasures, dimsFromTitle, formatDims, mergeDims } from "@/lib/dimensions";
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


describe("real shop pages", () => {
  it("IKEA: product measurements, the back rest as height, never the box", () => {
    const html =
      '"measurements":[{"measure":"57 cm","name":"Hoogte armleuning","type":"00138"},{"measure":"78 cm","name":"Diepte","type":"00044"},' +
      '{"measure":"23 cm","name":"Vrije hoogte onder meubel","type":"00242"},{"measure":"68 cm","name":"Hoogte rugleuning","type":"00413"},' +
      '{"measure":"41 cm","name":"Zithoogte","type":"00039"},{"measure":"171 cm","name":"Breedte","type":"00047"}],"packaging":{"measurements":[{"label":"Hoogte","text":"19 cm"}]}';
    expect(dimsFromNamedMeasures(html)).toEqual({ w: 171, d: 78, h: 68 });
  });

  it("skips packaging sizes in specification text", () => {
    expect(dimsFromLabels("Verpakkingsinformatie Breedte: 65 cm Hoogte: 19 cm")).toEqual({});
    expect(dimsFromLabels("Afmetingen Breedte: 220 cm Hoogte: 80 cm. Verpakking Hoogte: 19 cm")).toEqual({ w: 220, h: 80 });
  });
});

describe("length on tables", () => {
  it("reads 'Lengte' as the width when there is no 'Breedte', and keeps 'Diepte' as the depth", async () => {
    const { dimsFromLabels } = await import("@/lib/dimensions");
    expect(dimsFromLabels("Afmetingen Lengte: 180 cm Hoogte: 76 cm Diepte: 90 cm")).toEqual({ w: 180, d: 90, h: 76 });
    expect(dimsFromLabels("Breedte: 90 cm Lengte: 200 cm")).toEqual({ w: 90, d: 200, h: undefined });
  });
});
