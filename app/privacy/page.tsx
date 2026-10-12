import Link from "next/link";

export const metadata = { title: "Privacyverklaring · furnuture" };

export default function PrivacyPage() {
  return (
    <main className="wrap" style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-6)", maxWidth: 760 }}>
      <div className="stack" style={{ gap: 4, marginBottom: "var(--space-5)" }}>
        <h1>Privacyverklaring</h1>
        <p className="upsell" style={{ background: "var(--accent-tint)" }}>
          <strong>Concept — nog niet juridisch gecontroleerd.</strong> Deze tekst beschrijft naar eer en geweten wat de app technisch doet. Laat 'm vóór
          livegang nalopen door een jurist (bijv. via de Kamer van Koophandel of ICTRecht) voordat je 'm als definitief publiceert.
        </p>
      </div>
      <div className="stack">
        <section>
          <h2>Wie we zijn</h2>
          <p>furnuture helpt je je nieuwe huis in te richten en te verbouwen tussen de sleuteloverdracht en de verhuisdag.</p>
        </section>
        <section>
          <h2>Welke gegevens we verwerken</h2>
          <ul>
            <li>De naam die je aan je woning geeft, en (als je 'm invult) het adres/de Funda-link.</li>
            <li>Foto's van de woning, je budget, de kamers, producten en klussen die je toevoegt.</li>
            <li>Als je meldingen aanzet: je apparaat-id, de naam die je invult, en de technische gegevens om een melding te kunnen sturen (push-subscriptie).</li>
            <li>Als je Premium koopt: je e-mailadres (voor de betaling en voor support), via Supabase en Stripe.</li>
          </ul>
        </section>
        <section>
          <h2>Waarom (grondslag)</h2>
          <p>Om de functionaliteit te leveren die je gebruikt (uitvoering van de overeenkomst), en — bij Premium — om te kunnen factureren en support te bieden.</p>
        </section>
        <section>
          <h2>Wie er bij kan</h2>
          <p>
            Een woning is op dit moment toegankelijk voor iedereen die de naam ervan weet of raadt — er zit geen wachtwoord of account achter, behalve bij
            het kopen van Premium (daar verifiëren we je e-mailadres met een code). Deel de naam van je woning dus alleen met wie 'm mag zien.
          </p>
        </section>
        <section>
          <h2>Bewaartermijn</h2>
          <p>Zolang je de woning niet verwijdert. Neem contact op als je al je gegevens wilt laten verwijderen.</p>
        </section>
        <section>
          <h2>Derde partijen</h2>
          <ul>
            <li>Supabase (database, in de EU te hosten) — voor de opslag van je woning.</li>
            <li>Stripe — voor het verwerken van een Premium-betaling.</li>
            <li>Vercel — voor het hosten van de app.</li>
          </ul>
        </section>
        <section>
          <h2>Cookies</h2>
          <p>
            Deze app gebruikt geen cookies: wat je apparaat onthoudt (je naam, welke woning je laatst open had) staat lokaal op je apparaat
            (localStorage), niet in een cookie, en wordt niet gedeeld. Daarom is er geen cookiebanner.
          </p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>
            Vragen over je gegevens? Mail naar <em>(zakelijk e-mailadres hier invullen)</em>.
          </p>
        </section>
      </div>
      <p className="tiny muted" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/">← Terug naar furnuture</Link> · <Link href="/terms">Algemene voorwaarden</Link>
      </p>
    </main>
  );
}
