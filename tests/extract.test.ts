import { describe, expect, it } from "vitest";
import { guessCategory } from "@/lib/categories";
import { extractFundaPhotos, fundaListingId, isFundaUrl, parseFunda, parseFundaApi, parseProduct } from "@/lib/extract";

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
