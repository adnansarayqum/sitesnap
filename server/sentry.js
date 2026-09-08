// Optional error monitoring. Off by default — nothing here runs, and
// @sentry/node is never even initialized, unless SENTRY_DSN is set (see
// docs/error-monitoring.md for how to get one and wire it up on Railway).
import * as Sentry from "@sentry/node";

export const sentryEnabled = !!process.env.SENTRY_DSN;

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.DATABASE_URL ? "accounts" : "local"),
    // this is a low-traffic firm tool, not a high-volume consumer app —
    // every transaction, not a sample of them, is affordable and worth
    // having when something needs to be debugged
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1),
  });
}

// Every request-handling error in this app funnels through one place —
// the final Express error middleware in index.js — so that's the one spot
// this needs to be called from, rather than sprinkled through every route.
export function captureServerError(err, req) {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    if (req) {
      scope.setTag("route", `${req.method} ${req.route ? req.baseUrl + req.route.path : req.path}`);
      if (req.session && req.session.user_id) scope.setUser({ id: req.session.user_id });
    }
    Sentry.captureException(err);
  });
}

export function captureFatal(err) {
  if (!sentryEnabled) return Promise.resolve();
  Sentry.captureException(err);
  return Sentry.flush(2000).catch(() => {});
}
