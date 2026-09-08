// Native-shell polish — every call here is a no-op in the browser/PWA build.
// Capacitor.isNativePlatform() is false there, so this whole module does
// nothing but import cleanly; none of it runs unless the app is actually
// inside the Capacitor wrapper (see capacitor.config.ts).
import { Capacitor } from "@capacitor/core";

export async function initNativeShell() {
  if (!Capacitor.isNativePlatform()) return;

  const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import("@capacitor/status-bar"),
    import("@capacitor/splash-screen"),
  ]);
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  await StatusBar.setBackgroundColor({ color: "#10352A" }).catch(() => {});
  // the web app's own loading state (App.jsx's "loading" screen) takes over
  // the instant this resolves, so there's no blank gap between the two
  await SplashScreen.hide().catch(() => {});

  if (Capacitor.getPlatform() === "android") {
    const { App } = await import("@capacitor/app");
    // The app has its own in-memory screen stack (App.jsx's `screen` state),
    // not real browser history, so Android's default hardware-back behavior
    // — call the WebView's history back, or exit if there's none — would
    // exit the whole app on the very first back-press, mid-inspection, with
    // no warning. A firm's surveyor losing their place because a hardware
    // button did something the web app never asked for is worse than the
    // app not fully honoring back — so this makes back a deliberate,
    // two-press action instead of an accidental one-press exit.
    let lastBackPress = 0;
    App.addListener("backButton", () => {
      const now = Date.now();
      if (now - lastBackPress < 2000) App.exitApp();
      else lastBackPress = now;
    });
  }
}
