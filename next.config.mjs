import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Wraps the build for error monitoring. Without SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN
// (source-map upload credentials) this just skips that upload step — it never fails the build.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
