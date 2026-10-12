/** Server/edge error monitoring. No-ops when SENTRY_DSN is unset (nothing breaks without it). */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  }
}

export const onRequestError = async (...args: Parameters<NonNullable<Awaited<typeof import("@sentry/nextjs")>["captureRequestError"]>>) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
