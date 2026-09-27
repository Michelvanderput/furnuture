import { describe, expect, it } from "vitest";
import { guessCategory } from "@/lib/categories";
import { extractFundaPhotos, fundaListingId, largeImageUrl, isFundaUrl, parseFunda, parseFundaApi, parseProduct, productImages, withoutShopName } from "@/lib/extract";

describe("funda", () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Keizersgracht 1 - Amsterdam | funda">
      <meta property="og:image" content="https://cloud.funda.nl/valentina_media/190/123/456.jpg?options=width=720">
    </head><body>
      <img src="https://cloud.funda.nl/valentina_media/190/123/456.jpg?options=width=360">
      <img srcset="https://cloud.funda.nl/valentina_media/190/123/457.jpg?options=width=720 720w">
      <script>window.__DATA__={"photos":["https:\\/\\/cloud.funda.nl\\/valentina_media\\/190\\/123\\/458_720x480.jpg"]}</script>
      <img src="https://cloud.funda.nl/valentina_media/190/123/457_360x240.jpg">
      <img src="https://assets.fstatic.nl/logo.png">
    </body></html>`;

  it("finds unique listing photos, including escaped JSON URLs", () => {
    expect(extractFundaPhotos(html)).toEqual([
      "https://cloud.funda.nl/valentina_media/190/123/456.jpg?options=width=1440",
      "https://cloud.funda.nl/valentina_media/190/123/457.jpg?options=width=1440",
      "https://cloud.funda.nl/valentina_media/190/123/458_720x480.jpg?options=width=1440",
    ]);
  });

  it("strips the funda suffix from the title", () => {
    expect(parseFunda(html, "https://www.funda.nl/x").title).toBe("Keizersgracht 1 - Amsterdam");
  });

  it("falls back to og:image when there are no cloud.funda.nl photos", () => {
    const res = parseFunda('<meta property="og:image" content="/foto.jpg">', "https://www.funda.nl/detail/1/");
    expect(res.photos).toEqual(["https://www.funda.nl/foto.jpg"]);
  });

  it("recognises funda URLs", () => {
    expect(isFundaUrl("https://www.funda.nl/detail/koop/amsterdam/huis-1/43000000/")).toBe(true);
    expect(isFundaUrl("https://funda.nl.evil.com/")).toBe(false);
    expect(isFundaUrl("nope")).toBe(false);
  });
});

describe("products", () => {
  it("reads JSON-LD Product data", () => {
    const html = `
      <title>ignored</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","itemListElement":[{"name":"Woonkamer"},{"name":"Banken"}]},
        {"@type":"Product","name":"SÖDERHAMN 3-zitsbank","image":["https://www.ikea.com/nl/img/a.jpg","//www.ikea.com/nl/img/b.jpg"],
         "brand":{"@type":"Brand","name":"IKEA"},"offers":{"@type":"Offer","price":"799.00","priceCurrency":"EUR"}}]}
      </script>`;
    const p = parseProduct(html, "https://www.ikea.com/nl/nl/p/soderhamn-3-zitsbank-s19305882/");
    expect(p.title).toBe("SÖDERHAMN 3-zitsbank");
    expect(p.images).toEqual(["https://www.ikea.com/nl/img/a.jpg", "https://www.ikea.com/nl/img/b.jpg"]);
    expect(p.image).toBe("https://www.ikea.com/nl/img/a.jpg");
    expect(p.priceValue).toBe(799);
    expect(p.price).toMatch(/799,00/);
    expect(p.shop).toBe("Ikea");
    expect(p.category).toBe("banken");
  });

  it("falls back to Open Graph tags and ignores broken JSON-LD", () => {
    const html = `
      <script type="application/ld+json">{ broken</script>
      <meta property="og:title" content="Eiken PVC vloer &amp; ondervloer">
      <meta property="og:image" content="https://cdn.shop.nl/vloer.jpg">
      <meta property="product:price:amount" content="24,95">`;
    const p = parseProduct(html, "https://www.praxis.nl/vloeren/123");
    expect(p.title).toBe("Eiken PVC vloer & ondervloer");
    expect(p.image).toBe("https://cdn.shop.nl/vloer.jpg");
    expect(p.priceValue).toBe(24.95);
    expect(p.category).toBe("vloeren");
  });

  it("picks up a paint colour", () => {
    const html = `<meta property="og:title" content="Flexa Creations muurverf Warm Sand"><script>{"hex":"#d8c3a5"}</script>`;
    const p = parseProduct(html, "https://www.flexa.nl/kleuren/warm-sand");
    expect(p.category).toBe("verf");
    expect(p.color).toBe("#d8c3a5");
  });
});

describe("guessCategory", () => {
  it.each([
    ["Bureaustoel Markus", "stoelen"],
    ["Vloerkleed Wol 200x300", "vloerkleden"],
    ["Visgraat laminaat eiken", "vloeren"],
    ["Hanglamp Rotan", "verlichting"],
    ["Hoekbank Lisa", "banken"],
    ["Boxspring 180x200", "bedden"],
    ["Eettafel ovaal", "tafels"],
    ["Boekenkast Billy", "kasten"],
    ["Rolgordijn verduisterend", "raamdecoratie"],
    ["Metro tegel wit", "tegels"],
    ["Iets onbekends", "overig"],
  ])("%s -> %s", (title, category) => {
    expect(guessCategory(title)).toBe(category);
  });
});

describe("funda app API", () => {
  it("takes the listing id from the URL", () => {
    expect(fundaListingId("https://www.funda.nl/detail/koop/verkocht/maastricht/huis-karbindersdreef-49/17284428/")).toBe("17284428");
    expect(fundaListingId("https://www.funda.nl/detail/koop/amsterdam/huis-a-1/43117443/media/foto/")).toBe("43117443");
    expect(fundaListingId("https://www.funda.nl/")).toBeNull();
  });

  it("builds photo URLs from MediaBaseUrl and labels floor plans and rooms", () => {
    const res = parseFundaApi({
      AddressDetails: { Title: "Karbindersdreef 49", SubTitle: "6225 XX Maastricht" },
      Media: {
        Photos: {
          MediaBaseUrl: "https://cloud.funda.nl/valentina_media/{id}.jpg",
          Items: [{ Id: "224/063/577" }, { Id: "224/063/578", DisplayName: "Keuken" }, { Id: "224/063/577" }],
        },
        FloorPlan: { MediaBaseUrl: "https://cloud.funda.nl/valentina_media/{id}.png", Items: [{ Id: "224/063/600" }] },
      },
    });
    expect(res.title).toBe("Karbindersdreef 49, 6225 XX Maastricht");
    expect(res.photos).toEqual([
      "https://cloud.funda.nl/valentina_media/224/063/577.jpg",
      "https://cloud.funda.nl/valentina_media/224/063/578.jpg",
      "https://cloud.funda.nl/valentina_media/224/063/600.png",
    ]);
    expect(res.rooms).toEqual({
      "https://cloud.funda.nl/valentina_media/224/063/578.jpg": "keuken",
      "https://cloud.funda.nl/valentina_media/224/063/600.png": "plattegrond",
    });
  });

  it("falls back to any photo URL in an unknown JSON shape", () => {
    const res = parseFundaApi({ foo: ["https://cloud.funda.nl/valentina_media/1/2/3.jpg"] });
    expect(res.photos).toEqual(["https://cloud.funda.nl/valentina_media/1/2/3.jpg?options=width=1440"]);
  });
});


describe("product images", () => {
  it("asks shop CDNs for a large version", () => {
    expect(largeImageUrl("https://cdn.shopify.com/s/files/1/bank_200x.jpg?v=1")).toBe("https://cdn.shopify.com/s/files/1/bank.jpg?v=1");
    expect(largeImageUrl("https://www.ikea.com/nl/nl/images/products/bank.jpg?f=xs")).toBe("https://www.ikea.com/nl/nl/images/products/bank.jpg?f=xl");
    expect(largeImageUrl("https://img.shop.nl/a.jpg?width=300&height=300")).toBe("https://img.shop.nl/a.jpg?width=1200");
    expect(largeImageUrl("https://x.imgix.net/a.jpg?w=200&s=abc")).toBe("https://x.imgix.net/a.jpg?w=200&s=abc");
    expect(largeImageUrl("https://other.nl/photo_1200x800.jpg")).toBe("https://other.nl/photo_1200x800.jpg");
  });

  it("drops logos and svgs, dedupes sizes, keeps originals as fallback", () => {
    const out = productImages(
      ["/logo.png", "https://s.nl/icon.svg", "https://s.nl/bank.jpg?width=300", "https://s.nl/bank.jpg?width=600", "//s.nl/stoel.jpg"],
      "https://s.nl/p/bank",
    );
    expect(out).toEqual(["https://s.nl/bank.jpg?width=1200", "https://s.nl/stoel.jpg", "https://s.nl/bank.jpg?width=300"]);
  });
});

describe("shop quirks", () => {
  it("the title decides the category over the shop menu", () => {
    expect(guessCategory("Baseline laminaat - wild eiken - 6mm", undefined, "Tegels & vloeren Laminaat", "tegels vloeren laminaat")).toBe("vloeren");
    expect(guessCategory("Wandtegel wit 20x25", undefined, "Tegels & vloeren")).toBe("tegels");
  });
  it("asks CloudFront image folders for a large size", () => {
    expect(largeImageUrl("https://d2fb1ew6v6wv87.cloudfront.net/products/10063742/s01/424x424/origin.webp")).toBe(
      "https://d2fb1ew6v6wv87.cloudfront.net/products/10063742/s01/1400x1400/origin.webp",
    );
  });
});

describe("product titles", () => {
  it("drops the shop's name at the end", () => {
    expect(withoutShopName("Flexa Kleur van het Jaar 2025 | True Joy™ | Flexa", "Flexa")).toBe("Flexa Kleur van het Jaar 2025 | True Joy™");
    expect(withoutShopName("Bank Lissabon - 3-zits - Leen Bakker", "Leenbakker")).toBe("Bank Lissabon - 3-zits");
    expect(withoutShopName("GLOSTAD 3-zitsbank - Knisa donkergrijs", "Ikea")).toBe("GLOSTAD 3-zitsbank - Knisa donkergrijs");
  });
});

describe("Funda facts", () => {
  it("reads price, areas, rooms and build year from the app API", async () => {
    const { parseFundaApi } = await import("@/lib/extract");
    const r = parseFundaApi({
      Price: { SellingPrice: "€ 349.000 k.k." },
      FastView: { LivingArea: "92 m²", PlotArea: "167 m²", NumberOfBedrooms: "4", EnergyLabel: "C" },
      AddressDetails: { Title: "Karbindersdreef 49", SubTitle: "6216 PE Maastricht", City: "Maastricht", NeighborhoodName: "Belfort" },
      ListingDescription: { Description: "Ruime woning." },
      KenmerkSections: [
        { KenmerkenList: [{ Id: "bouw-bouwjaar", Label: "Bouwjaar", Value: "1965", KenmerkenList: [] }] },
        { KenmerkenList: [{ Id: "indeling-totalrooms", Value: "5 kamers (4 slaapkamers)" }, { Label: "x", KenmerkenList: [{ Id: "indeling-totalstories", Value: "3 woonlagen" }] }] },
      ],
      Media: { Photos: { MediaBaseUrl: "https://cloud.funda.nl/valentina_media/{id}.jpg", Items: [{ Id: "1/2/3" }] } },
    });
    expect(r.title).toBe("Karbindersdreef 49, 6216 PE Maastricht");
    expect(r.description).toBe("Ruime woning.");
    expect(r.facts).toEqual({
      price: "€ 349.000 k.k.",
      livingArea: "92 m²",
      plotArea: "167 m²",
      bedrooms: "4",
      energyLabel: "C",
      rooms: "5 kamers (4 slaapkamers)",
      stories: "3 woonlagen",
      buildYear: "1965",
      city: "Maastricht",
      neighborhood: "Belfort",
    });
  });
});
