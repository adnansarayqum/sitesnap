import type { CapacitorConfig } from "@capacitor/cli";

// The native shell loads the LIVE deployed app over HTTPS, not a bundled
// copy of dist/ — SiteSnap in accounts mode depends on httpOnly session
// cookies that are same-origin only (SameSite=Lax); bundling the assets
// locally would put the WebView on a different origin (capacitor://
// localhost) than the API, and the browser would refuse to send those
// cookies at all. Loading the real origin keeps every security property
// already verified for the web app — CSP, HSTS, CSRF, sessions — completely
// unchanged, and the app's own service worker (public/sw.js) still gives it
// the same offline-shell behavior it has as an installed PWA, since Android
// and iOS's WebViews both support service workers for real https:// origins.
//
// Set this to the deployment's real public URL before running `cap sync` —
// see docs/app-store-submission.md.
const SERVER_URL = process.env.CAPACITOR_SERVER_URL || "https://sitesnap-production.up.railway.app";

const config: CapacitorConfig = {
  appId: "com.sitesnap.app",
  appName: "SiteSnap",
  webDir: "dist",
  server: {
    url: SERVER_URL,
    androidScheme: "https",
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      // held open until the app calls SplashScreen.hide() itself (see
      // src/native.js) once the first real frame has actually rendered,
      // rather than auto-hiding on a timer and risking a flash of blank
      // white in between
      launchAutoHide: false,
      backgroundColor: "#10352A",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#10352A",
    },
  },
};

export default config;
