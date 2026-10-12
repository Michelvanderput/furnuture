import Link from "next/link";

export const metadata = { title: "Algemene voorwaarden · furnuture" };

export default function TermsPage() {
  return (
    <main className="wrap" style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-6)", maxWidth: 760 }}>
      <div className="stack" style={{ gap: 4, marginBottom: "var(--space-5)" }}>
        <h1>Algemene voorwaarden</h1>
        <p className="tiny muted">
          Laatst bijgewerkt: 12 oktober 2026. Geschreven voor furnuture specifiek; laat met name "Herroepingsrecht" en "Aansprakelijkheid" hieronder vóór
          livegang nog kort bevestigen door een jurist.
        </p>
      </div>
      <div className="stack">
        <section>
          <h2>1. Wie deze voorwaarden gebruikt</h2>
          <p>
            Deze voorwaarden gelden voor ieder gebruik van furnuture, de planningstool voor inrichting en verbouwing van een nieuw huis, aangeboden door{" "}
            <em>(bedrijfsnaam, adres en KvK-nummer hier invullen)</em> ("wij"). Door furnuture te gebruiken ga je hiermee akkoord.
          </p>
        </section>

        <section>
          <h2>2. Gratis gebruik en Premium</h2>
          <p>
            Je kunt furnuture gratis gebruiken: een woning aanmaken, Funda-gegevens importeren, per kamer een lijst bijhouden, budget volgen en delen als
            tekst of CSV. Premium is een <strong>eenmalige aankoop per woning</strong>, geen abonnement: je betaalt één keer (via Stripe) en krijgt daarmee
            blijvend toegang tot meldingen, de agenda-koppeling en voorrang bij support voor die woning, zolang furnuture bestaat. Er wordt nooit
            automatisch een vervolgbedrag afgeschreven. De actuele prijs staat op de betaalpagina vóórdat je akkoord gaat; wijzigingen in de prijs gelden
            niet voor woningen die al Premium hebben.
          </p>
        </section>

        <section>
          <h2>3. Account en toegang</h2>
          <p>
            Voor gratis gebruik is geen account nodig: een woning is bereikbaar via zijn naam. Je bent zelf verantwoordelijk voor het geheimhouden van die
            naam als je niet wilt dat anderen de woning kunnen zien of wijzigen. Voor Premium verifiëren we je e-mailadres met een eenmalige code vóór de
            betaling; zorg dat dit adres klopt, want daar sturen we facturatie- en supportberichten naartoe.
          </p>
        </section>

        <section>
          <h2>4. Herroepingsrecht</h2>
          <p>
            Premium is digitale inhoud die direct na betaling wordt geleverd (de functies worden meteen vrijgeschakeld). Volgens de wet (art. 6:230p BW)
            vervalt het wettelijke herroepingsrecht van 14 dagen zodra je hiermee instemt en erkent dat je daarmee je herroepingsrecht verliest — dat
            vragen we expliciet vóór de betaling. Werkt Premium niet zoals hier beschreven, dan betalen we sowieso binnen 14 dagen terug als je contact
            opneemt; dat is geen wettelijke verplichting maar ons eigen, ruimere beleid.
          </p>
        </section>

        <section>
          <h2>5. Wat je wel en niet mag</h2>
          <p>
            Je gebruikt furnuture alleen voor je eigen woning(en) en op een manier die anderen niet schaadt: geen pogingen om de beveiliging te omzeilen,
            geen geautomatiseerd massaal aanmaken van woningen, geen gegevens van anderen zonder toestemming invoeren.
          </p>
        </section>

        <section>
          <h2>6. Gegevens van derden (Funda)</h2>
          <p>
            Het importeren van een woning vanaf Funda gebeurt bij voorkeur via de bladwijzer die in je eigen browser draait, niet via onze server. Funda's
            eigen gebruiksvoorwaarden blijven onverkort gelden voor hoe jij Funda gebruikt; wij zijn geen partij bij jouw account op Funda en geven geen
            garantie dat geïmporteerde gegevens compleet of actueel zijn.
          </p>
        </section>

        <section>
          <h2>7. Beschikbaarheid</h2>
          <p>
            We doen ons best om furnuture goed te laten werken, maar geven geen garantie op ononderbroken beschikbaarheid. De actuele status van de
            belangrijkste onderdelen staat op <Link href="/status">de statuspagina</Link>.
          </p>
        </section>

        <section>
          <h2>8. Aansprakelijkheid</h2>
          <p>
            furnuture is een hulpmiddel bij het plannen van je inrichting en verbouwing, geen advies van een aannemer, makelaar, financieel adviseur of
            jurist. Controleer bedragen, levertijden, klusplanningen en wettelijke termijnen altijd zelf. Onze aansprakelijkheid voor schade die voortkomt
            uit het gebruik van furnuture is beperkt tot het bedrag dat je voor Premium hebt betaald voor de desbetreffende woning, behalve bij opzet of
            bewuste roekeloosheid onzerzijds, en voor zover dwingend recht een verdere beperking niet toestaat.
          </p>
        </section>

        <section>
          <h2>9. Einde van de overeenkomst</h2>
          <p>
            Je kunt een woning op elk moment zelf verwijderen (Instellingen binnen de app) of ons vragen dit voor je te doen. Een eenmalige Premium-aankoop
            wordt niet terugbetaald bij verwijdering, behalve binnen de 14-dagen-regeling uit artikel 4.
          </p>
        </section>

        <section>
          <h2>10. Wijzigingen van deze voorwaarden</h2>
          <p>We kunnen deze voorwaarden aanpassen; een nieuwe versie geldt vanaf publicatie op deze pagina, met de datum bovenaan als bewijs van wanneer.</p>
        </section>

        <section>
          <h2>11. Toepasselijk recht en geschillen</h2>
          <p>
            Op deze voorwaarden is Nederlands recht van toepassing. Een geschil leggen we eerst voor aan elkaar voordat we naar de rechter stappen; bij
            gebrek aan overeenstemming is de Nederlandse rechter bevoegd die bevoegd zou zijn volgens de wettelijke regels, tenzij dwingend consumentenrecht
            anders bepaalt.
          </p>
        </section>

        <section>
          <h2>12. Contact</h2>
          <p>
            Vragen over deze voorwaarden? Mail naar <em>(zakelijk e-mailadres hier invullen)</em>.
          </p>
        </section>
      </div>
      <p className="tiny muted" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/">← Terug naar furnuture</Link> · <Link href="/privacy">Privacyverklaring</Link>
      </p>
    </main>
  );
}
