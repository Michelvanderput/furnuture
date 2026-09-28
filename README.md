# furnuture

Inkoop- en verbouwingsplanner voor je nieuwe huis. Geef je woning een naam, plak de Funda-link en furnuture maakt de kamers aan; per kamer verzamel je wat je gaat kopen en wat er verbouwd moet worden, met prijzen, budget, offertes en planning.

Live: https://furnuture-nine.vercel.app

## Wat het doet

- **Woning uit Funda**: foto's, vraagprijs, m², slaapkamers, energielabel, bouwjaar en omschrijving. Een eerste indeling (woonkamer, keuken, het aantal slaapkamers, badkamer, tuin…) volgt uit de Funda-gegevens. Lukt ophalen niet: bookmarklet, paginabron plakken, of zonder Funda beginnen.
- **Lijst per kamer**: plak een link uit (bijna) elke webshop; titel, foto, prijs, maten en soort komen vanzelf. Meerdere links tegelijk, of plak een link ergens op de pagina. Ook "nog te vinden"-items met een richtprijs.
- **Status** per item: 💡 idee → 💚 gekozen → 📦 besteld → ✅ in huis. Aantal, must-have, notitie, maten.
- **Opties vergelijken**: zet alternatieven naast elkaar (prijsverschil, maten) en kies er één; alleen de gekozen versie telt mee.
- **Budget**: totaalbudget, slim verdeeld over de kamers, per kamer een voortgangsbalk (besteld / gepland / geschat).
- **Winkelen**: per winkel (alles bij IKEA in één keer bestellen), per status, en cijfers per kamer en per soort. Prijzen checken (prijsdalingen worden getoond), delen als tekst (WhatsApp), Excel (CSV), printen.
- **Verbouwing**: klussen per kamer en voor het hele huis, voorstellen op basis van m², bouwjaar en energielabel, offertes (ook uit een foto), een automatische planning vanaf de sleuteldatum en een waarschuwing als iets na de verhuisdag klaar is.
- **Woningen op naam**: je opent je woning met een naam (bijv. het adres). Met een database (Supabase, zie hieronder) staat alles online en open je dezelfde woning op elk apparaat; zonder database blijft alles op het apparaat. Het apparaat houdt altijd een kopie bij (IndexedDB), dus de app opent direct en werkt offline; wijzigingen gaan binnen twee seconden naar de database, alleen de rijen die veranderden. Deellink: `/?woning=<naam>`.
- Back-up en terugzetten. Werkt als app op het beginscherm; op Android kun je een link naar de app delen.

## Database (Supabase, optioneel)

Tabellen: `houses` (één rij per woning, met Funda-gegevens, budget, stijl en verbouwingsdata), `photos`, `rooms`, `items`, `tasks` en `quotes`, allemaal per woning (`house_id`, wordt meeverwijderd). Zie `supabase/migrations/`.

- De browser praat nooit direct met de database: alles gaat via `/api/houses` op de server, met de service role key. Row level security staat aan zonder policies, dus de publieke (anon) sleutel kan niets lezen.
- Toegang is op naam: wie de naam van een woning kent, kan hem openen. Kies dus iets unieks (adres met huisnummer en plaats).
- Gelijktijdig werken: bij terugkomen in de app en elke minuut kijkt de app of een ander apparaat iets opsloeg; wijzigingen worden per rij samengevoegd.

**Instellen:**
1. Tabellen aanmaken: via de Supabase-GitHub-koppeling worden de migraties in `supabase/migrations` uitgevoerd zodra ze op de productiebranch staan. Of plak het SQL-bestand in Supabase → SQL Editor → Run.
2. Vercel → project → Settings → Environment Variables: `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` (de Supabase-integratie van Vercel zet deze zelf; `NEXT_PUBLIC_SUPABASE_URL` en `SUPABASE_SECRET_KEY` werken ook). Daarna Redeploy.
3. Open de app: bestaande gegevens op een apparaat worden bij de eerste naam aangeboden om over te nemen.

## Meldingen (iPhone, iPad, Android, computer)

Met online opslag kan de app meldingen sturen:

- **Vraag om mee te kijken**: bij een product of klus; je partner krijgt "Sanne vraagt of je naar Hoekbank MOLLY wilt kijken" met je bericht, en de melding opent dat product.
- **Updates van je partner**: iets besteld, gekozen of binnen, een klus begonnen of klaar, een offerte gekozen, de planning verschoven, een nieuwe sleutel- of verhuisdatum. Eén melding per opslag, nooit over je eigen wijzigingen.
- **Planning van de dag** (8:00, Vercel Cron): wat je moet bestellen (een week, twee dagen en op de laatste dag), wat morgen bezorgd wordt, welke klus morgen begint, en de sleutel en verhuizing die eraan komen.
- Het belletje in de app toont de laatste meldingen, ook op apparaten zonder meldingen.

Op een iPhone/iPad werken meldingen alleen voor de app op het beginscherm (iOS 16.4+): Safari → Deel → Zet op beginscherm, open de app daar, ⚙︎ → Meldingen aanzetten.

**Instellen:** tabellen uit `supabase/migrations/…_notifications.sql`; in Vercel `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (bijv. `mailto:jij@voorbeeld.nl`) en `CRON_SECRET` (Vercel stuurt die mee naar `/api/cron/daily`, zie `vercel.json`). Sleutels maken: `npx web-push generate-vapid-keys`.

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

Next.js (App Router). API-routes: `/api/funda` (Funda-app-API en website), `/api/product` (webshoppagina's: JSON-LD, meta, maten), `/api/image` (afbeeldingsproxy), `/api/fal` (AI, sleutel blijft op de server), `/api/houses` (woningen in de database).

Lokaal met een database: zet `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (bijv. van `supabase start`).

Let op: de voorwaarden van Funda staan geautomatiseerd ophalen niet toe. Voor persoonlijk gebruik is de bookmarklet de netste route.
