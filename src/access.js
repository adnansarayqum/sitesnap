// The server's access-key gate (server/access.js) answers protected routes
// with its own error codes. They mean "SiteSnap itself is locked", never
// "this OneDrive link / AI request is bad", so callers must not treat them
// as a provider failure.
export const ACCESS_MESSAGE = {
  access_required: "SiteSnap needs unlocking again — close and reopen the app, then enter the access key.",
  access_not_configured: "Online features are switched off on this server until its access key is set (SITESNAP_ACCESS_KEY in Railway).",
};

// The gate's error code for a response, or null when the response isn't one.
export async function accessProblem(r) {
  if (r.status !== 401 && r.status !== 503) return null;
  const j = await r.clone().json().catch(() => ({}));
  return ACCESS_MESSAGE[j.error] ? j.error : null;
}
