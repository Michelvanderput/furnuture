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

## AI in de visualizer

Alles hieronder draait gratis in de browser van de gebruiker (geen server, geen API-sleutel). Modellen worden één keer gedownload en daarna door de browser bewaard.

| Functie | Model | Download | Licentie |
|---|---|---|---|
| Meubels, muren en vloer herkennen | SegFormer-B2 (ADE20K) via transformers.js; op iPad/iPhone SegFormer-B0 | ± 30 MB (B0: ± 4 MB) | NVIDIA SegFormer-licentie (onderzoek/niet-commercieel) |
| Meubels weggummen | MI-GAN (gemaakt voor telefoons) via onnxruntime-web | ± 27 MB | MIT |
| Achtergrond van productfoto weghalen | RMBG-1.4 via transformers.js (niet op iPad: te zwaar) | ± 45 MB | Niet-commercieel |
| Foto's per ruimte sorteren | CLIP ViT-B/32 via transformers.js | ± 90 MB | MIT |

**Geheugen (iPad/Safari):** elk AI-model draait in een eigen Web Worker die na de taak wordt afgesloten. WebAssembly-geheugen wordt anders nooit teruggegeven, en Safari op iPad sluit een tabblad dat te veel geheugen gebruikt. De modellen krijgen alleen een verkleinde foto (512 px), het resultaat wordt op 480 px verwerkt, en op iPad/iPhone worden de lichtste modellen gebruikt.

Zo werkt het:

1. **✨ Herken meubels, muren & vloer**: elke pixel krijgt een klasse (bank, stoel, muur, vloer…). Meubels en muren worden losse objecten die je aanklikt.
2. **Weghalen met AI**: MI-GAN vult het object op met wat erachter hoort. Omdat het werkt op een uitsnede rond het object, blijft de kwaliteit hoog. Lukt de AI niet (download geblokkeerd, te weinig geheugen), dan valt hij terug op de snelle gum.
3. **Nieuwe vloer / verven**: uit het vloer- of muurmasker wordt automatisch een perspectiefvlak berekend. Randen die door meubels verborgen zijn, tellen niet mee. De textuur loopt mee met de diepte; de oranje hoekjes stellen het vlak bij. Een nieuwe vloer of muur bedekt ook de plek waar weggegumde meubels stonden.
4. **Meubels op de vloer**: staat er een vloer in de foto, dan wordt een nieuw meubel erop gezet. Schuif je het naar achteren, dan wordt het vanzelf kleiner; met "Draaien op de vloer" zet je het schuin, bijvoorbeeld in een hoek.

### Echter zonder betaalde AI

De app blijft volledig gratis: geen API-sleutels, geen proefperiodes. Om meubels toch natuurlijk te laten ogen:

- **Contactschaduw**: een zachte schaduw onder het meubel, op een herkende vloer in perspectief en mee met het draaien.
- **Licht en warmte**: productfoto's zijn fel en neutraal (studiolicht). Bij het plaatsen wordt het meubel gedimd en opgewarmd op basis van de gemiddelde helderheid en kleur van de kamerfoto; bij te stellen met de schuiven Licht en Warmte.

Wat gratis in de browser niet kan: een productfoto blijft een foto van één kant, dus schuin zetten laat nooit de zijkant zien. Dat vraagt generatieve beeld-AI. Die kan gratis draaien op een eigen pc met een flinke videokaart (bijvoorbeeld ComfyUI met FLUX of Stable Diffusion), maar niet in de browser.

## Afmetingen: meten en ware grootte

- **Productmaten** (breedte × diepte × hoogte) worden uit de webshoppagina gehaald: JSON-LD (`width`/`depth`/`height`), specificaties ("Breedte: 220 cm") of de titel ("220x95x80 cm", "160 x 200"). Aan te passen op de productkaart.
- **📏 Meten**: tik twee punten op de vloer en vul één keer in hoe lang dat is (bijvoorbeeld de kamerbreedte uit de Funda-plattegrond, of een deur van 83 cm). Daarna toont elke meetlijn direct zijn lengte, ook in de diepte.
  - Hoe: de vloer is een rechthoek in perspectief. De brandpuntsafstand van de camera wordt geschat uit de twee verdwijnpunten van de vloerranden (of een gangbare groothoek van 75° als die niet zichtbaar zijn). Daarmee is de echte verhouding van de vloer bekend (`K⁻¹H = λ[sx·r1, sy·r2, t]`), en één bekende lijn geeft de schaal. Getest met een nagebootste camera.
  - Er is geen herkende vloer? Dan tik je de 4 hoeken van een stuk vloer aan; dat vlak blijft onzichtbaar en dient alleen om te meten.
- **Ware grootte**: op een gemeten vloer krijgt een meubel met bekende breedte automatisch zijn echte maat, ook als je het naar achteren schuift of draait.
- **Past het?**: bij een geselecteerd meubel zie je de voetafdruk (breedte × diepte) op de vloer.
- **Vloeren op echte maat**: planken en tegels van de ingebouwde vloersoorten krijgen op een gemeten vloer hun werkelijke formaat (planken van 20 cm, tegels van 60 × 60 cm…).
- Meetlijnen staan ook op de foto die je opslaat of deelt.

## Selecteren en stabiliteit

- **Tik op een meubel**: SlimSAM (een lichte "Segment Anything", ± 15 MB) omlijnt precies wat je aantikt; met ➕/➖ tik je stukken erbij of eraf. De foto wordt één keer geanalyseerd, daarna is elke tik snel. Het werkproces sluit zichzelf na 90 seconden zonder gebruik.
- **Betere herkenning**: overal SegFormer-B2; kussens en plaids worden bij de bank of het bed gevoegd, stukken van één meubel samengevoegd en gaten gedicht.
- **Crash-vangnet**: loopt een tabblad vast op een AI-taak (iPad met te weinig geheugen), dan meldt de app dat bij de volgende start en zet hij de **lichte AI-modus** aan (kleinere modellen en beelden). In het Project-menu aan en uit te zetten.

## Gebruiksgemak en snelheid

- **Ongedaan maken / opnieuw** (↶ ↷, ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z) per foto; slepen en schuifjes tellen als één stap.
- **Sneltoetsen**: Delete verwijdert, ⌘/Ctrl+D dupliceert, pijltjes verschuiven (Shift = grotere stap), Esc annuleert, Enter maakt een vlak af.
- **📷 Opslaan / delen**: het ontwerp als foto, op iPad/iPhone via het deelmenu (Foto's, AirDrop, WhatsApp). Perspectief, maskers, schaduwen en licht worden in een canvas nagetekend, identiek aan het scherm.
- **Verfkleuren en vloersoorten** direct in de zijbalk, zonder eerst een link te plakken.
- **Budget per ruimte** en een **boodschappenlijst** (kopiëren of als Excel/CSV), filter op favorieten, prijs zelf invullen als een shop die niet meegeeft, dubbele links worden herkend.
- **Plakknoppen** voor links (handig op iPad), **back-up** downloaden/terugzetten via het Project-menu, installeerbaar als app (**Zet op beginscherm**).
- **Snelheid**: tijdens slepen wordt alleen de visualizer bijgewerkt (één keer per schermverversing) en pas bij loslaten opgeslagen; foto's komen direct van Funda/de shop (de server is alleen reserve) en in overzichten in kleinere maten; beelden via de server worden door Vercel's CDN bewaard; vloertexturen worden gemaakt als de browser niets te doen heeft; de tabbladen Producten en Inrichten laden pas als je ze opent; opslaan gebeurt ook direct als je de app verlaat, en de app vraagt de browser om de gegevens te bewaren.

## Mogelijke volgende stappen

- [ ] Visualisatie exporteren als afbeelding en een project delen met je partner
- [ ] Browserextensie of deel-knop op de telefoon ("Delen → furnuture") om producten toe te voegen
- [ ] Maten van de kamer uit de Funda-plattegrond halen als meetlat
- [ ] Budget per ruimte en afmetingen van producten tegenover de plattegrond
