"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ShieldCheck } from "@phosphor-icons/react";
import { currentHouse, type HouseRef } from "@/lib/houses";

const FREE_FEATURES = ["1 woning", "Links plakken en lijst per kamer", "Budget en status bijhouden", "Delen als tekst/WhatsApp, CSV-export"];
const PREMIUM_FEATURES = [
  "Automatische inkoop- en verbouwplanning",
  "Meldingen (push naar jou én je partner, 'kijk even'-vragen, dagplanning)",
  "Agenda-koppeling (ICS, auto-bijwerkend in je eigen agenda-app)",
  "Voorrang bij support",
];
const SOON_FEATURES = ["Meerdere woningen tegelijk"];

type Step = "idle" | "code" | "paying";

export default function PremiumPage() {
  const [house, setHouse] = useState<HouseRef | null | undefined>(undefined);
  const [premium, setPremium] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = currentHouse();
    setHouse(h);
    if (h?.id)
      fetch(`/api/houses/${h.id}/premium`)
        .then((r) => r.json())
        .then((d) => setPremium(!!d.premium))
        .catch(() => setPremium(null));
  }, []);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Versturen mislukt");
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!house?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/houses/${house.id}/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Betalen starten mislukt");
      setStep("paying");
      location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="wrap" style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-6)" }}>
      <div className="stack" style={{ gap: 4, marginBottom: "var(--space-6)" }}>
        <h1>furnuture Premium</h1>
        <p className="muted">Eenmalig, voor deze verhuizing — geen abonnement.</p>
      </div>

      {house === undefined ? null : !house?.id ? (
        <p className="advice small">
          Open eerst een online bewaarde woning in <Link href="/">furnuture</Link> voordat je upgradet.
        </p>
      ) : premium ? (
        <div className="upsell">
          <ShieldCheck size={22} weight="fill" />
          <span>
            <strong>{house.name}</strong> heeft al Premium.
          </span>
          <Link href="/" className="btn">
            Terug naar de app
          </Link>
        </div>
      ) : (
        <>
          <div className="plans" style={{ marginBottom: "var(--space-6)" }}>
            <div className="plan">
              <span className="plan-name">Gratis</span>
              <span className="plan-tagline">Om te beginnen</span>
              <span className="plan-price">
                <span className="amount">€0</span>
              </span>
              <ul className="plan-features">
                {FREE_FEATURES.map((f) => (
                  <li key={f}>
                    <Check size={18} weight="bold" /> {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="plan featured">
              <span className="plan-badge">Meest gekozen</span>
              <span className="plan-name">Premium</span>
              <span className="plan-tagline">Voor {house.name}</span>
              <span className="plan-price">
                <span className="amount">€49</span>
                <span className="period">eenmalig</span>
              </span>
              <ul className="plan-features">
                {PREMIUM_FEATURES.map((f) => (
                  <li key={f}>
                    <Check size={18} weight="bold" /> {f}
                  </li>
                ))}
                {SOON_FEATURES.map((f) => (
                  <li key={f} className="soon">
                    <Check size={18} weight="bold" /> {f} (binnenkort)
                  </li>
                ))}
              </ul>
              {step !== "code" ? (
                <form className="stack tight" onSubmit={requestCode}>
                  <label className="field">
                    E-mailadres
                    <input type="email" required placeholder="jij@voorbeeld.nl" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <button className="accent" disabled={busy}>
                    {busy ? <span className="spinner" /> : "Stuur inlogcode"}
                  </button>
                </form>
              ) : (
                <form className="stack tight" onSubmit={pay}>
                  <p className="tiny muted">We stuurden een code naar {email}.</p>
                  <label className="field">
                    Code uit je e-mail
                    <input inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <button className="accent" disabled={busy}>
                    {busy ? <span className="spinner" /> : "Bevestig en betaal €49"}
                  </button>
                </form>
              )}
              {error && (
                <p className="small error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          <p className="tiny muted">
            Je e-mailadres wordt eerst geverifieerd (een code), daarna ga je naar Stripe om te betalen. Prijs kan afwijken; zie de betaalpagina voor het definitieve bedrag.
          </p>
        </>
      )}
    </main>
  );
}
