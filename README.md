# furnuture

Richt je nieuwe huis in terwijl je op de sleutel wacht.

1. **Woning** – plak de Funda-link. De app haalt alle foto's op en zet ze per ruimte. Sorteren kan met gratis AI (CLIP, draait in je eigen browser) of door foto's te slepen.
2. **Producten** – plak links van webshops. De app haalt titel, productfoto('s) en prijs op en zet het product in een categorie (banken, vloeren, verf, verlichting…). Je markeert favorieten, wijst producten af en ziet het totaalbedrag van je favorieten.
3. **Visualiseren** – gum bestaande meubels weg, leg een vloer (ingebouwde vloersoorten of een vloer uit een webshoplink) in perspectief, verf muren en zet meubels in de kamer. Meubels kun je met vier losse hoeken schuin of de diepte in zetten.

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
| Achtergrond weghalen | Snel: flood fill vanaf de rand die stopt bij randen in de foto (instelbare gevoeligheid). Nauwkeurig: RMBG-1.4 in de browser | Optioneel, gratis |
| Meubels weggummen | Push-pull-invulling vanuit de omgeving (werkt goed op muren en vloeren) | Nee |
| Meubel in perspectief | Vier losse hoeken, homografie als CSS `matrix3d` | Nee |
| Vloer leggen | Ingebouwde vloersoorten (canvas, naadloos) of de productfoto van een vloerlink, in perspectief op de vier aangeklikte hoeken | Nee |
| Muur verven | Zelf getekend vlak met kleur, `mix-blend-mode: multiply` behoudt de schaduwen | Nee |

`/api/image` is een beeldproxy. Die is nodig omdat canvas en AI anders de pixels van externe afbeeldingen niet mogen lezen. De server-routes weigeren links naar interne netwerken (SSRF-bescherming).

### Bekende beperking: Funda blokkeert scrapers

De website van Funda heeft botbescherming, en die blokkeert servers zoals die van Vercel meestal. De app probeert daarom eerst de (niet-officiële) API van de Funda-app, zoals [pyfunda](https://github.com/0xMH/pyfunda) die gebruikt. Werkt dat ook niet, dan is er de knop **"📸 Foto's van Funda halen"**. Dat is een bookmarklet: je sleept hem naar je bladwijzerbalk en klikt erop op een Funda-woning. Hij draait in je eigen browser, dus de botbescherming speelt geen rol, en stuurt de foto's naar de app. Plakken van de paginabron of zelf uploaden kan ook nog.

Let op: de voorwaarden van Funda staan geautomatiseerd ophalen niet toe. Voor persoonlijk gebruik is de bookmarklet de netste route; voor een publieke app is dit een juridisch aandachtspunt.

## Kan het meubels in de foto's vervangen?

Kort antwoord: **zonder AI kun je al veel** (dat zit er nu in). **Met gratis AI kan het slimmer**, maar echt fotorealistisch meubels vervangen vraagt een GPU.

**Zonder AI (nu gebouwd)**
- Productfoto's als uitsnede op de kamerfoto slepen, schalen, draaien, spiegelen en met vier hoeken in perspectief zetten.
- Muren en vloeren aanwijzen door hoeken te klikken. Vloeren liggen in perspectief bij vier hoeken.
- Meubels van de vorige bewoners weggummen. Op effen muren en vloeren werkt dat goed, op drukke patronen wordt het wazig.
- Beperkingen: een meubelfoto blijft een platte foto (je ziet nooit de zijkant) en er zijn geen echte schaduwen.

**Met gratis AI in de browser (volgende stap, zonder serverkosten)**
- *Semantische segmentatie* (SegFormer ADE20K via transformers.js) herkent automatisch muur, vloer, plafond, bank, bed en kast. Dan klik je op "muur" in plaats van hem zelf te tekenen.
- *Achtergrond verwijderen* (RMBG-1.4): zit er nu in als optie "Weghalen met AI". RMBG-1.4 is gratis voor niet-commercieel gebruik; voor een commerciële app kies je BiRefNet (MIT).
- *Diepte-schatting* (Depth Anything) voor de juiste grootte en het perspectief van meubels en vloeren.
- *Object-verwijdering* (LaMa-inpainting) haalt de meubels van de vorige bewoners uit de foto.

**Met generatieve AI (open modellen, gratis te draaien, maar wel een GPU nodig)**
- Stable Diffusion XL / FLUX-inpainting met ControlNet (diepte) en IP-Adapter: het echte product fotorealistisch in de kamer, inclusief licht en schaduw ("virtual staging").
- Gratis testen kan via Hugging Face Spaces, met wachtrijen en limieten. In productie kost dit ongeveer €0,01–0,05 per beeld (bijvoorbeeld via Replicate of fal.ai), of je draait het zelf op een eigen GPU.
- Het resultaat lijkt op het product, maar is geen exacte kopie. Daarom is de aanpak van nu (echte productfoto's als laag) juist handig om keuzes te maken.

## Mogelijke volgende stappen

- [ ] SegFormer-segmentatie: klik op een muur of vloer in plaats van hem te tekenen
- [ ] AI-weggummen (LaMa) voor drukke achtergronden
- [ ] Visualisatie exporteren als afbeelding en een project delen met je partner
- [ ] Browserextensie of deel-knop op de telefoon ("Delen → furnuture") om producten toe te voegen
- [ ] Budget per ruimte en afmetingen van producten tegenover de plattegrond
