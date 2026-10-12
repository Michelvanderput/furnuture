import Link from "next/link";

export const metadata = { title: "Privacyverklaring · furnuture" };

export default function PrivacyPage() {
  return (
    <main className="wrap" style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-6)", maxWidth: 760 }}>
      <div className="stack" style={{ gap: 4, marginBottom: "var(--space-5)" }}>
        <h1>Privacyverklaring</h1>
        <p className="tiny muted">
          Laatst bijgewerkt: 12 oktober 2026. Deze tekst is geschreven op basis van wat furnuture technisch doet; laat 'm vóór livegang nog kort door een
          jurist bevestigen, met name het onderdeel "Doorgifte buiten de EU" hieronder.
        </p>
      </div>
      <div className="stack">
        <section>
          <h2>Wie we zijn</h2>
          <p>
            furnuture is een planningstool voor mensen die een huis hebben gekocht en dat gaan inrichten en (ver)bouwen tussen de sleuteloverdracht en de
            verhuisdag. Verwerkingsverantwoordelijke is <em>(bedrijfsnaam, adres en KvK-nummer hier invullen)</em>, bereikbaar via{" "}
            <em>(zakelijk e-mailadres invullen)</em>.
          </p>
        </section>

        <section>
          <h2>Welke gegevens we verwerken, en waarom</h2>
          <p>furnuture is zo gebouwd dat een woning in principe zonder account te gebruiken is. We verwerken daarom alleen wat nodig is om de functie te leveren die je aanzet:</p>
          <ul>
            <li>
              <strong>De naam van je woning</strong> (vaak een adres) en, als je 'm importeert, de gegevens van Funda: foto's, vraagprijs, oppervlakte,
              indeling, bouwjaar, energielabel en omschrijving. Grondslag: uitvoering van de overeenkomst (art. 6 lid 1 sub b AVG) — zonder deze gegevens
              werkt de kernfunctie van de app niet.
            </li>
            <li>
              <strong>Wat je zelf toevoegt</strong>: budget, producten (titel, foto, prijs, winkel, link), klussen, offertes en planning. Zelfde grondslag.
            </li>
            <li>
              <strong>Als je meldingen aanzet</strong>: een willekeurig apparaat-id, de naam die je zelf invult ("Sanne"), je tijdzone en de technische
              gegevens om een pushbericht te kunnen afleveren (een push-subscriptie van je browser). Grondslag: uitvoering van de overeenkomst, voor het
              onderdeel van de dienst dat je zelf hebt aangezet.
            </li>
            <li>
              <strong>Als je Premium koopt</strong>: je e-mailadres (geverifieerd met een eenmalige code) en de betaalgegevens die Stripe namens ons
              verwerkt. We bewaren zelf alleen je e-mailadres en het moment van aankoop, nooit je kaart- of rekeninggegevens — die komen niet bij ons
              binnen. Grondslag: uitvoering van de overeenkomst en een wettelijke verplichting (administratie/facturatie, art. 6 lid 1 sub c AVG).
            </li>
            <li>
              <strong>Technische gegevens bij elk bezoek</strong>: foutmeldingen (als Sentry actief is) en geanonimiseerde paginabezoeken (als Plausible
              actief is) — zie "Cookies" hieronder. Grondslag: gerechtvaardigd belang (art. 6 lid 1 sub f AVG): de app werkend en storingsvrij houden.
            </li>
          </ul>
        </section>

        <section>
          <h2>Wie er toegang heeft tot een woning</h2>
          <p>
            Een gratis woning is toegankelijk voor iedereen die de naam ervan weet of raadt — er zit geen wachtwoord achter, zodat je 'm makkelijk met je
            partner kunt delen zonder eerst een account aan te maken. Kies dus een naam die niet makkelijk te raden is (bijv. het volledige adres met
            huisnummer), en deel 'm alleen met wie de woning mag zien. Pas bij het kopen van Premium verifiëren we een e-mailadres, en dat adres gebruiken
            we uitsluitend voor die woning, voor facturatie en support.
          </p>
        </section>

        <section>
          <h2>Hoe lang we gegevens bewaren</h2>
          <p>
            Zolang de woning bestaat. Je kunt op elk moment vragen om een woning (en alle bijbehorende gegevens) te laten verwijderen — zie "Contact"
            hieronder. Facturatiegegevens van een Premium-aankoop bewaren we zo lang de wet dat voorschrijft (in Nederland doorgaans 7 jaar, fiscale
            bewaarplicht), ook als de woning zelf al verwijderd is.
          </p>
        </section>

        <section>
          <h2>Met wie we gegevens delen (verwerkers)</h2>
          <p>We geven geen gegevens door om verkocht of voor reclame van anderen gebruikt te worden. De volgende partijen verwerken gegevens namens ons, met een verwerkersovereenkomst:</p>
          <ul>
            <li>
              <strong>Supabase</strong> — de database waarin je woning staat (op te geven regio, bij voorkeur EU).
            </li>
            <li>
              <strong>Vercel</strong> — host de website en de serverfuncties.
            </li>
            <li>
              <strong>Stripe</strong> — verwerkt een Premium-betaling; Stripe ontvangt je e-mailadres en betaalgegevens rechtstreeks, wij ontvangen alleen
              de bevestiging en het e-mailadres terug.
            </li>
            <li>
              <strong>Sentry</strong> (optioneel, alleen als ingesteld) — ontvangt technische foutmeldingen, zonder opzettelijk persoonsgegevens mee te
              sturen.
            </li>
            <li>
              <strong>Plausible</strong> (optioneel, alleen als ingesteld) — ontvangt geen persoonsgegevens: het telt bezoeken geaggregeerd, zonder
              cookies of een uniek apparaat-id.
            </li>
          </ul>
        </section>

        <section>
          <h2>Doorgifte buiten de EU</h2>
          <p>
            Stripe en Sentry zijn Amerikaanse bedrijven; zij kunnen gegevens buiten de EU verwerken op basis van EU-standaardcontractbepalingen (SCC's) of
            een vergelijkbaar mechanisme. <em>(Dit onderdeel vóór livegang laten bevestigen door een jurist: welke subverwerkers precies worden gebruikt en
            onder welk doorgiftemechanisme, kan tussentijds wijzigen.)</em>
          </p>
        </section>

        <section>
          <h2>Beveiliging</h2>
          <p>
            De database is alleen bereikbaar via onze server, nooit rechtstreeks vanuit je browser; toegang tot een woning via naam is, zoals hierboven
            uitgelegd, bewust eenvoudig gehouden maar betekent wel dat je de naam van je woning geheim moet houden. Een Premium-aankoop wordt pas verwerkt
            na verificatie van je e-mailadres met een eenmalige code. Al het verkeer loopt via HTTPS.
          </p>
        </section>

        <section>
          <h2>Cookies en vergelijkbare technieken</h2>
          <p>
            furnuture plaatst geen cookies. Wat je apparaat onthoudt (je naam, welke woning je laatst open had, je voorkeuren) staat lokaal op je apparaat
            (localStorage/IndexedDB), wordt niet naar ons verzonden en niet met anderen gedeeld. Plausible (indien actief) meet bezoeken zonder cookies of
            een uniek identificerend kenmerk. Omdat er geen cookies worden geplaatst die toestemming vereisen, tonen we geen cookiebanner.
          </p>
        </section>

        <section>
          <h2>Jouw rechten</h2>
          <p>Je hebt het recht op inzage, rectificatie, verwijdering en beperking van je gegevens, het recht om bezwaar te maken tegen verwerking op basis van gerechtvaardigd belang, en het recht op overdraagbaarheid van gegevens die je zelf hebt aangeleverd. Neem hiervoor contact op via onderstaand e-mailadres. Je kunt ook een klacht indienen bij de Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl).</p>
        </section>

        <section>
          <h2>Wijzigingen</h2>
          <p>We kunnen deze verklaring aanpassen als de app verandert. De datum bovenaan deze pagina geeft aan wanneer dat voor het laatst gebeurde.</p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Vragen over deze verklaring of over je gegevens? Mail naar <em>(zakelijk e-mailadres hier invullen)</em>.
          </p>
        </section>
      </div>
      <p className="tiny muted" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/">← Terug naar furnuture</Link> · <Link href="/terms">Algemene voorwaarden</Link>
      </p>
    </main>
  );
}
