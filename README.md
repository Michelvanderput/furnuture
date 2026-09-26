# furnuture

Richt je nieuwe huis in terwijl je op de sleutel wacht.

1. **Woning** – plak de Funda-link. De app haalt alle foto's op en zet ze per ruimte. Sorteren kan met gratis AI (CLIP, draait in je eigen browser) of door foto's te slepen.
2. **Producten** – plak links van webshops. De app haalt titel, productfoto('s) en prijs op en zet het product in een categorie (banken, vloeren, verf, verlichting…). Je markeert favorieten, wijst producten af en ziet het totaalbedrag van je favorieten.
3. **Visualiseren** – zet producten op je kamerfoto's. De witte achtergrond van een productfoto wordt automatisch weggehaald. Wijs een muur of vloer aan en geef die een verfkleur of een vloertextuur.

Alles wordt lokaal in je browser bewaard (IndexedDB). Er is geen account en geen database nodig.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # parsers en categorie-herkenning
npm run typecheck
```

## Hoe het werkt

| Onderdeel | Techniek | AI? |
|---|---|---|
| Funda-foto's ophalen | 1) De API van de Funda-app (`listing-detail-page.funda.io`, id uit de URL), 2) de website, 3) een bookmarklet die in je eigen browser draait | Nee |
| Foto's per ruimte | CLIP zero-shot (`Xenova/clip-vit-base-patch32`) via transformers.js in de browser, of handmatig slepen | Optioneel, gratis |
| Productlinks lezen | JSON-LD `Product`, Open Graph en `product:price`-metatags (bijna elke webshop heeft deze) | Nee |
| Categorie bepalen | Trefwoorden in titel, breadcrumbs en URL (NL + EN) | Nee |
| Achtergrond weghalen | Flood fill vanaf de rand op de hoekkleur (werkt goed bij packshots op wit) | Nee |
| Muur verven / vloer leggen | Zelf getekende polygoon met kleur of textuur, `mix-blend-mode: multiply` behoudt de schaduwen | Nee |

`/api/image` is een beeldproxy. Die is nodig omdat canvas en AI anders de pixels van externe afbeeldingen niet mogen lezen. De server-routes weigeren links naar interne netwerken (SSRF-bescherming).

### Bekende beperking: Funda blokkeert scrapers

De website van Funda heeft botbescherming, en die blokkeert servers zoals die van Vercel meestal. De app probeert daarom eerst de (niet-officiële) API van de Funda-app, zoals [pyfunda](https://github.com/0xMH/pyfunda) die gebruikt. Werkt dat ook niet, dan is er de knop **"📸 Foto's van Funda halen"**. Dat is een bookmarklet: je sleept hem naar je bladwijzerbalk en klikt erop op een Funda-woning. Hij draait in je eigen browser, dus de botbescherming speelt geen rol, en stuurt de foto's naar de app. Plakken van de paginabron of zelf uploaden kan ook nog.

Let op: de voorwaarden van Funda staan geautomatiseerd ophalen niet toe. Voor persoonlijk gebruik is de bookmarklet de netste route; voor een publieke app is dit een juridisch aandachtspunt.

## Kan het meubels in de foto's vervangen?

Kort antwoord: **zonder AI kun je al veel** (dat zit er nu in). **Met gratis AI kan het slimmer**, maar echt fotorealistisch meubels vervangen vraagt een GPU.

**Zonder AI (nu gebouwd)**
- Productfoto's als uitsnede op de kamerfoto slepen, schalen en spiegelen.
- Muren en vloeren aanwijzen door hoeken te klikken en ze vullen met een verfkleur of vloertextuur.
- Beperkingen: geen perspectief op vloerpatronen, geen echte schaduwen, en bestaande meubels van de vorige bewoners blijven zichtbaar.

**Met gratis AI in de browser (volgende stap, zonder serverkosten)**
- *Semantische segmentatie* (SegFormer ADE20K via transformers.js) herkent automatisch muur, vloer, plafond, bank, bed en kast. Dan klik je op "muur" in plaats van hem zelf te tekenen.
- *Achtergrond verwijderen* (RMBG-1.4 / BiRefNet) voor productfoto's die niet op wit staan.
- *Diepte-schatting* (Depth Anything) voor de juiste grootte en het perspectief van meubels en vloeren.
- *Object-verwijdering* (LaMa-inpainting) haalt de meubels van de vorige bewoners uit de foto.

**Met generatieve AI (open modellen, gratis te draaien, maar wel een GPU nodig)**
- Stable Diffusion XL / FLUX-inpainting met ControlNet (diepte) en IP-Adapter: het echte product fotorealistisch in de kamer, inclusief licht en schaduw ("virtual staging").
- Gratis testen kan via Hugging Face Spaces, met wachtrijen en limieten. In productie kost dit ongeveer €0,01–0,05 per beeld (bijvoorbeeld via Replicate of fal.ai), of je draait het zelf op een eigen GPU.
- Het resultaat lijkt op het product, maar is geen exacte kopie. Daarom is de aanpak van nu (echte productfoto's als laag) juist handig om keuzes te maken.

## Mogelijke volgende stappen

- [ ] SegFormer-segmentatie: klik op een muur of vloer in plaats van hem te tekenen
- [ ] Perspectief (vier hoekpunten) voor vloertexturen
- [ ] Visualisatie exporteren als afbeelding en een project delen met je partner
- [ ] Browserextensie of deel-knop op de telefoon ("Delen → furnuture") om producten toe te voegen
- [ ] Budget per ruimte en afmetingen van producten tegenover de plattegrond
