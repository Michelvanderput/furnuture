# furnuture

Inkoopplanner voor je nieuwe huis. Plak de Funda-link en furnuture maakt de kamers aan; per kamer verzamel je wat je gaat kopen, met prijzen, budget en een overzicht per winkel.

Live: https://furnuture-nine.vercel.app

## Wat het doet

- **Woning uit Funda**: foto's, vraagprijs, m², slaapkamers, energielabel, bouwjaar en omschrijving. Een eerste indeling (woonkamer, keuken, het aantal slaapkamers, badkamer, tuin…) volgt uit de Funda-gegevens. Lukt ophalen niet: bookmarklet, paginabron plakken, of zonder Funda beginnen.
- **Lijst per kamer**: plak een link uit (bijna) elke webshop; titel, foto, prijs, maten en soort komen vanzelf. Meerdere links tegelijk, of plak een link ergens op de pagina. Ook "nog te vinden"-items met een richtprijs.
- **Status** per item: 💡 idee → 💚 gekozen → 📦 besteld → ✅ in huis. Aantal, must-have, notitie, maten.
- **Opties vergelijken**: zet alternatieven naast elkaar (prijsverschil, maten) en kies er één; alleen de gekozen versie telt mee.
- **Budget**: totaalbudget, slim verdeeld over de kamers, per kamer een voortgangsbalk (besteld / gepland / geschat).
- **Winkelen**: per winkel (alles bij IKEA in één keer bestellen), per status, en cijfers per kamer en per soort. Prijzen checken (prijsdalingen worden getoond), delen als tekst (WhatsApp), Excel (CSV), printen.
- Back-up en terugzetten (ander apparaat, partner). Alles wordt lokaal bewaard (IndexedDB). Werkt als app op het beginscherm; op Android kun je een link naar de app delen.

## ✨ AI (fal.ai, optioneel)

Met een fal.ai-sleutel komen er slimme knoppen bij. Het model is Gemini 2.5 Flash via fal (`openrouter/router/vision`): snel en goedkoop.

| Functie | Wat | Kosten |
|---|---|---|
| Kamers herkennen | leest plattegrond, omschrijving en foto's: kamers, m², verdieping, welke foto bij welke kamer | ± 1–2 cent |
| Wat mis ik nog? | tips per kamer met richtprijs, rekening houdend met maat, budget, stijl en je lijst | < 1 cent |
| Screenshot lezen | product uit een screenshot (als een webshop ophalen blokkeert) | < 1 cent |
| Alternatieven zoeken | zoekt op internet naar vergelijkbare producten bij Nederlandse winkels | ± 1–3 cent |
| Stijlcheck | passen de gekozen producten bij elkaar? Score, kleurenpalet en tips | < 1 cent |

**Kosten in de hand:** elk antwoord wordt bewaard (dezelfde vraag opnieuw is gratis), de werkelijke kosten worden bijgehouden, daglimiet in de app (standaard € 2, ⚙︎ Instellingen) en op de server (`FAL_DAILY_LIMIT_USD`, standaard $3, max. 20 vragen per minuut). De server staat alleen dit ene model toe, met een maximum aan foto's en tekst per vraag. Tegoed op of sleutel fout: de app stopt met AI voor die sessie.

**Instellen:** fal.ai → Billing (tegoed, auto top-up uit) → Keys → nieuwe sleutel. Vercel → project → Settings → Environment Variables: `FAL_KEY` (Production en Preview), aanrader `AI_ACCESS_CODE` (vul die code in de app in bij ⚙︎). Daarna Redeploy.

## Ontwikkelen

```
npm install
npm run dev
npm test
```

Next.js (App Router). API-routes: `/api/funda` (Funda-app-API en website), `/api/product` (webshoppagina's: JSON-LD, meta, maten), `/api/image` (afbeeldingsproxy), `/api/fal` (AI, sleutel blijft op de server).

Let op: de voorwaarden van Funda staan geautomatiseerd ophalen niet toe. Voor persoonlijk gebruik is de bookmarklet de netste route.
