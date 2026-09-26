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
| Meubels weggummen | Content-aware fill (PatchMatch): kopieert passende stukjes textuur uit de rest van de foto, met een aparte doorrekening voor de vloer in perspectief | Nee |
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

**Geheugen in de app zelf:**

- Uitgeknipte productfoto's, vloertexturen en de gegumde foto zijn blob-URL's (bytes buiten de JavaScript-heap) in plaats van data-URL-strings van meerdere MB. Wat geen enkele foto of plattegrond meer gebruikt (een oude gevoeligheid, een verwijderde laag), wordt vrijgegeven.
- De gevoeligheid-schuif start pas een nieuwe uitsnede als je even stopt met schuiven.
- Maskers voor het aantikken blijven op hun eigen formaat (± 480 px) in een begrensde cache; ze werden eerder op fotoformaat gedecodeerd en nooit opgeruimd.
- Gummen verwerkt alleen de nieuwe laag (de vorige uitkomst wordt hergebruikt), op maximaal 2048 px, en de snelle gum rekent alleen rond het gat.
- Herkenningen van kamers worden voor de laatste 6 foto's bewaard.

**WebGPU:** op computers met WebGPU draaien de transformers.js-modellen op de videokaart: veel sneller, en de gewichten staan niet in het WebAssembly-geheugen. Lukt dat niet, dan doet de app dezelfde taak op de processor en onthoudt hij dat voor dit apparaat. In lichte modus en op iPad/iPhone blijft alles op de processor.

**Sterkere modellen, met terugval:** kamers sorteren gebruikt CLIP ViT-B/16 (was B/32, even groot), tik-om-te-selecteren SlimSAM-50 (was 77), en kamerherkenning op een videokaart met half-precision SegFormer-B5 op 640 px (was B2). Kan een model niet laden, dan valt de app terug op het vorige model.

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

## Plattegrond: één model voor het hele huis

De plattegrond is het centrale model. Meubels staan op de plattegrond op ware grootte, en elke gekoppelde foto laat ze in zijn eigen perspectief zien.

1. **Plattegrond kiezen** (tab 🗺️ Plattegrond): een foto die bij Woning op "Plattegrond" staat. Meerdere verdiepingen kunnen.
2. **Schaal**: tik een bekende maat aan (bijvoorbeeld "5,00 m" bij de woonkamer). Is een gekoppelde foto al gemeten, dan volgt de schaal daaruit, en omgekeerd krijgt een gekoppelde foto automatisch een meetlat.
3. **Kamers**: tik in een kamer. Plattegronden zijn lijntekeningen, dus een vulling over de lichte pixels stopt bij de muren (geen AI nodig). Loopt de vulling over (een open doorgang), dan tik je de hoeken aan. Hoekpunten zijn te verslepen.
4. **Foto koppelen** (Inrichten → 🗺️ Koppelen): de app zoekt de vloer in de foto en markeert de twee verre hoeken met **L** en **R**. Tik waar die op de plattegrond liggen (kamerhoeken snappen). Daaruit volgt de volledige camera:
   - de homografie plattegrond → foto via de vier vloerhoeken, met de diepte uit de echte vloerverhouding (`linkFromPoints`);
   - de brandpuntsafstand uit de homografie (Zhang: `r1 ⟂ r2`, `|r1| = |r2|`), daarna `R` en `t`;
   - de camera en het kijkveld worden op de plattegrond getekend. Klopt het niet, dan versleep je de punten.
   Getest met een nagebootste camera: de positie van de fotograaf klopt tot op enkele centimeters en 3D-punten tot op ± 1,5 pixel.
5. **Meubels plaatsen**: op de plattegrond (B × D × H in cm, draaien, dupliceren) of in een gekoppelde foto. In elke gekoppelde foto wordt de voorkant van het meubel op de juiste plek, hoogte en hoek geprojecteerd, met de voetafdruk als schaduw en de verste meubels eerst. Zie je het meubel van achteren, dan wordt de voorkant gespiegeld getoond. Slepen in een foto verplaatst het meubel op de plattegrond.
6. **Wat er nu staat**: herkende meubels in een gekoppelde foto (waar ze de vloer raken) verschijnen als grijze contouren op de plattegrond.

Grenzen: een productfoto laat één kant zien, dus de zijkant van een meubel wordt niet getekend. Welke foto bij welke kamer hoort en vanuit welke hoek hij genomen is, kost één handeling per foto (L en R aantikken). Volledig automatisch kan dat niet betrouwbaar met gratis AI in de browser.

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
- **Betere herkenning**: overal SegFormer-B2; kussens en plaids worden bij de bank of het bed gevoegd, stukken van één meubel samengevoegd en gaten gedicht. Kleine spullen die duidelijk ergens op staan (een vaas, een fles, een dienblad op een tafel of kast) gaan ook mee: weg je de tafel, dan verdwijnt de vaas niet zwevend achter — die was namelijk het bekende, onrealistische resultaat zonder deze koppeling. Ook herkent de app nu oven, magnetron, vaatwasser, openhaard en bar als meubel-achtige objecten.
- **Crash-vangnet**: loopt een tabblad vast op een AI-taak (iPad met te weinig geheugen), dan meldt de app dat bij de volgende start en zet hij de **lichte AI-modus** aan (kleinere modellen en beelden). In het Project-menu aan en uit te zetten.

### Weggummen zonder AI: wat het wel en niet goed kan

Geen AI beschikbaar (download geblokkeerd, te weinig geheugen, of "Snel weghalen" gekozen)?
Dan vult content-aware fill het gat met stukjes die het elders in de foto vindt — geen
vage waas, maar (bijvoorbeeld) echt doorlopende plankenvloer. Getest tegen een gefotografeerde
kamer (niet alleen gemaakte testbeelden):

- **Met een vloer aangegeven** (getekend, of via "✨ Herken meubels, muren & vloer"): de
  vloer wordt in bovenaanzicht rechtgetrokken vóór het invullen, zodat planken en tegels
  ook in perspectief kloppend doorlopen. Dit geeft duidelijk het beste resultaat.
- **Zonder vloer, op een rommelige plek** (bijvoorbeeld een meubel dat deels op een vloerkleed
  en deels op de vloer staat): zonder enig houvast over wat waar hoort, kan de invulling
  vervagen tot een vlakke, weinig overtuigende vlek — een bekende, inherente grens van deze
  aanpak zonder AI op een drukke, echte foto. AI-gum (MI-GAN) is hier sterker; geef anders
  eerst de vloer aan of herken de kamer voordat je gumt.

## Gebruiksgemak en snelheid

- **Ongedaan maken / opnieuw** (↶ ↷, ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z) per foto; slepen en schuifjes tellen als één stap.
- **Sneltoetsen**: Delete verwijdert, ⌘/Ctrl+D dupliceert, pijltjes verschuiven (Shift = grotere stap), Esc annuleert, Enter maakt een vlak af.
- **📷 Opslaan / delen**: het ontwerp als foto, op iPad/iPhone via het deelmenu (Foto's, AirDrop, WhatsApp). Perspectief, maskers, schaduwen en licht worden in een canvas nagetekend, identiek aan het scherm.
- **Verfkleuren en vloersoorten** direct in de zijbalk, zonder eerst een link te plakken.
- **Budget per ruimte** en een **boodschappenlijst** (kopiëren of als Excel/CSV), filter op favorieten, prijs zelf invullen als een shop die niet meegeeft, dubbele links worden herkend.
- **Plakknoppen** voor links (handig op iPad), **back-up** downloaden/terugzetten via het Project-menu, installeerbaar als app (**Zet op beginscherm**).
- **Snelheid**: tijdens slepen wordt alleen de visualizer bijgewerkt (één keer per schermverversing) en pas bij loslaten opgeslagen; foto's komen direct van Funda/de shop (de server is alleen reserve) en in overzichten in kleinere maten; beelden via de server worden door Vercel's CDN bewaard; vloertexturen worden gemaakt als de browser niets te doen heeft; de tabbladen Producten en Inrichten laden pas als je ze opent; opslaan gebeurt ook direct als je de app verlaat, en de app vraagt de browser om de gegevens te bewaren.

## Inrichten met meubels van internet

- **Link plakken in Inrichten**: plak een productlink rechtsboven; het product wordt opgehaald, bij Producten gezet (met de ruimte van de foto) en meteen in de kamer gezet. Een vloer, verf of behang wordt als vlak toegepast. Een link die er al is, wordt hergebruikt.
- **In dit ontwerp**: welke producten in deze foto staan, hoe vaak, met prijs, een link naar de winkel en het totaal. Verf en vloeren tellen één keer. Met "Alles favoriet" komen ze op je boodschappenlijst.
- **Zoeken en per ruimte**: bij meer dan 6 meubels een zoekveld; producten voor deze ruimte eerst, of alleen die.
- **Eigen productfoto**: blokkeert een webshop het ophalen, of is de foto een sfeerfoto, kies dan een eigen foto of screenshot op de productkaart (📷).
- **Automatisch AI-uitknippen**: vindt de snelle uitsnede geen effen achtergrond, dan knipt de AI het meubel uit (niet op iPad/iPhone).

## Opslaan en AI zonder crashes

- **Opslaan per onderdeel**: woning, producten, plattegronden en het ontwerp van elke foto zijn losse records. Alleen wat veranderde wordt geschreven, als de browser even niets te doen heeft (en direct bij het verlaten van de app). Oude opslag wordt bij de eerste keer omgezet.
- **AI-uitkomsten worden bewaard**: uitsnedes, gegumde foto's en kamerherkenningen staan in een eigen cache (maximaal 300 stuks / 250 MB, de oudste gaan eerst). Een foto die je opnieuw opent, toont zijn herkende objecten en gegumde versie direct, zonder AI.
- **Eén AI-taak tegelijk**: taken wachten op elkaar in plaats van tegelijk modellen te laden. Opeenvolgende taken van dezelfde soort (drie uitsnedes) delen één geladen model; bij een andere soort, of kort na de laatste, wordt de worker gesloten zodat het geheugen echt vrijkomt. Op iPad wordt ook de selecteer-AI gesloten voordat een ander model start.

## Mogelijke volgende stappen

- [ ] Visualisatie exporteren als afbeelding en een project delen met je partner
- [ ] Browserextensie of deel-knop op de telefoon ("Delen → furnuture") om producten toe te voegen
- [ ] Maten van de kamer uit de Funda-plattegrond halen als meetlat
- [ ] Budget per ruimte en afmetingen van producten tegenover de plattegrond
