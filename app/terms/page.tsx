import Link from "next/link";

export const metadata = { title: "Algemene voorwaarden · furnuture" };

export default function TermsPage() {
  return (
    <main className="wrap" style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-6)", maxWidth: 760 }}>
      <div className="stack" style={{ gap: 4, marginBottom: "var(--space-5)" }}>
        <h1>Algemene voorwaarden</h1>
        <p className="upsell" style={{ background: "var(--accent-tint)" }}>
          <strong>Concept — nog niet juridisch gecontroleerd.</strong> Laat deze tekst vóór livegang nalopen door een jurist.
        </p>
      </div>
      <div className="stack">
        <section>
          <h2>De dienst</h2>
          <p>
            furnuture is een hulpmiddel om je verhuizing en verbouwing te plannen. We doen ons best om de app betrouwbaar te laten werken, maar kunnen
            beschikbaarheid niet garanderen (zie onze <Link href="/status">statuspagina</Link>).
          </p>
        </section>
        <section>
          <h2>Gratis en Premium</h2>
          <p>
            Een deel van de functies is gratis. Premium is een eenmalige aankoop per woning, geen abonnement: na betaling (via Stripe) blijft de Premium-functionaliteit
            bij die woning horen. Er wordt niet automatisch iets afgeschreven.
          </p>
        </section>
        <section>
          <h2>Terugbetaling</h2>
          <p>
            Als Premium niet werkt zoals beschreven, neem binnen 14 dagen contact op voor terugbetaling (herroepingsrecht voor consumenten bij digitale
            diensten — definitieve tekst volgt bij de juridische check).
          </p>
        </section>
        <section>
          <h2>Gegevens van derden (Funda)</h2>
          <p>
            Het importeren van een woning vanaf Funda gebeurt bij voorkeur via de bladwijzer in je eigen browser. Je bent zelf verantwoordelijk voor hoe je
            de app gebruikt in relatie tot de voorwaarden van de websites waarvan je gegevens importeert.
          </p>
        </section>
        <section>
          <h2>Aansprakelijkheid</h2>
          <p>
            furnuture is een planningshulpmiddel, geen advies van een aannemer, makelaar of financieel adviseur. Controleer bedragen, levertijden en
            klusplanningen altijd zelf.
          </p>
        </section>
        <section>
          <h2>Wijzigingen</h2>
          <p>We kunnen deze voorwaarden aanpassen; een nieuwe versie geldt vanaf publicatie op deze pagina.</p>
        </section>
      </div>
      <p className="tiny muted" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/">← Terug naar furnuture</Link> · <Link href="/privacy">Privacyverklaring</Link>
      </p>
    </main>
  );
}
