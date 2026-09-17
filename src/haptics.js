// A short buzz when a photo lands, a rating is tapped, or a voice note
// starts/stops — confidence the app registered the tap without having to
// look at the screen, useful when a surveyor's eyes are on the room, not
// the phone. Uses the browser's own Vibration API; not every device offers
// one (notably iOS Safari), so this is always best-effort — a missing or
// blocked haptic should never break the action it's layered onto.
const VIBRATE_MS = { light: 10, medium: 18, heavy: 30 };

export async function tapFeedback(style = "light") {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(VIBRATE_MS[style] || VIBRATE_MS.light);
  } catch { /* best effort only */ }
}
