// A short buzz when a photo lands, a rating is tapped, or a voice note
// starts/stops — confidence the app registered the tap without having to
// look at the screen, useful when a surveyor's eyes are on the room, not
// the phone. Native builds get Capacitor's real haptic engine; the browser
// PWA falls back to the Vibration API where the device offers one. Always
// best-effort — a missing or blocked haptic should never break the action
// it's layered onto.
import { Capacitor } from "@capacitor/core";

let hapticsMod; // undefined = not checked yet, false = unavailable
async function loadHaptics() {
  if (hapticsMod !== undefined) return hapticsMod;
  if (Capacitor.isNativePlatform()) {
    try { hapticsMod = await import("@capacitor/haptics"); } catch { hapticsMod = false; }
  } else {
    hapticsMod = false;
  }
  return hapticsMod;
}

const VIBRATE_MS = { light: 10, medium: 18, heavy: 30 };

export async function tapFeedback(style = "light") {
  try {
    const mod = await loadHaptics();
    if (mod && mod.Haptics) {
      const { Haptics, ImpactStyle } = mod;
      const impact = style === "heavy" ? ImpactStyle.Heavy : style === "medium" ? ImpactStyle.Medium : ImpactStyle.Light;
      await Haptics.impact({ style: impact });
      return;
    }
  } catch { /* best effort only */ }
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(VIBRATE_MS[style] || VIBRATE_MS.light);
  } catch { /* best effort only */ }
}
