// Optional client-side error monitoring. Off by default — nothing here
// runs, and @sentry/react is never initialized, unless VITE_SENTRY_DSN is
// set at build time (see docs/error-monitoring.md).
import * as Sentry from "@sentry/react";

export const sentryEnabled = !!import.meta.env.VITE_SENTRY_DSN;

if (sentryEnabled) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || (import.meta.env.PROD ? "production" : "development"),
    // a surveyor's phone, not a high-volume consumer app — full sampling
    // is affordable and worth having when something needs to be debugged
    tracesSampleRate: 1,
  });
}

export { Sentry };
