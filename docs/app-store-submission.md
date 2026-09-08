# Getting SiteSnap onto the App Store and Play Store

## How this actually works

SiteSnap is a web app (React + Express). To get onto either store it's
wrapped with [Capacitor](https://capacitorjs.com), which puts the app inside
a real native iOS/Android shell — a proper app icon, splash screen, native
status bar, and a WebView that loads the live app. This is the same pattern
a large share of published App Store/Play Store apps use; it isn't a hack.

**The shell loads the deployed app over HTTPS — it does not bundle a local
copy of the built files.** That's a deliberate choice, not an oversight:
SiteSnap's accounts mode depends on an httpOnly session cookie that only
gets sent same-origin. Bundling `dist/` locally would put the app on a
different origin (`capacitor://localhost`) than the API, and the browser
would refuse to send that cookie at all — silently breaking sign-in. Loading
the real origin keeps every security property already built and verified
for the web app (CSP, HSTS, CSRF, sessions, the OneDrive folder scoping)
completely unchanged, and the app's own service worker still gives it the
same offline-shell behavior it has as an installed PWA, since both
platforms' WebViews support service workers for real `https://` origins.

The trade-off: reviewers occasionally scrutinize a remote-URL wrapped app
more than a fully bundled one. This is mitigated by genuine native
integration (status bar theming, native splash screen, the Android
hardware-back handling) and by the app doing substantial real work — offline
capture, background sync — not just displaying a page. If a reviewer does
push back, the fallback is switching to a bundled build and re-plumbing the
accounts-mode API calls to hit the Railway origin directly with
`SameSite=None` cookies and explicit CORS — a real, larger piece of work,
not attempted here because it touches the session/cookie code this session
already hardened, and shouldn't be done speculatively.

## What's already done (code side)

- Capacitor added (`ios/`, `android/`, `capacitor.config.ts`), wired to load
  the live app over HTTPS.
- Native splash screen and status bar, themed to the app's own pine green.
- Android hardware back-button handled safely (double-press to exit, so a
  surveyor can't lose their place mid-inspection with one accidental tap —
  see `src/native.js`).
- App icon and splash images generated for both platforms from the app's
  existing icon (source master kept at `resources/icon.png` /
  `resources/splash.png` for regenerating later).
- Camera and microphone permission strings declared
  (`ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml`) —
  required by both platforms before the browser-level camera/mic prompts
  (already used by the app today) will work inside a native shell.
- A public privacy policy page (`public/privacy.html`, served at
  `/privacy.html` on your deployment) and a filled-in answer key for both
  stores' privacy questionnaires (`docs/app-privacy-answers.md`).
- CI workflows that build both platforms on every push
  (`.github/workflows/android-build.yml`,
  `.github/workflows/ios-build.yml`) — Android produces an installable debug
  APK today; iOS builds for the Simulator only (no Apple certificate is
  needed for that). Neither is store-submittable yet — see below.

## What only you can do from here

These need accounts, decisions, and (for iOS) hardware I don't have access
to. Roughly in the order you'd hit them:

### 1. Decide the app identity (do this first — it's permanent)

- **Bundle ID / package name**: currently set to the placeholder
  `com.sitesnap.app` in `capacitor.config.ts`. Once you submit a build to
  either store under a given ID, you cannot change it later without
  publishing as a brand-new app listing. Pick the real one now — typically
  reverse-domain based on whatever domain you control (e.g.
  `com.stonebridgesurveyors.sitesnap`, or your own company's domain).
  Changing it means updating `capacitor.config.ts`'s `appId` and re-running
  `npx cap sync`.
- **Production URL**: set the `CAPACITOR_SERVER_URL` environment variable
  (or edit the fallback directly in `capacitor.config.ts`) to your real
  Railway domain — or a custom domain if you set one up — before building
  for either store.
- **Privacy policy contact**: `public/privacy.html` has a placeholder email
  address marked `REPLACE-WITH-CONTACT-EMAIL`. Both stores check that this
  page is real and reachable — put a real, monitored address there before
  submitting.

### 2. Accounts you need

- **Apple Developer Program** — developer.apple.com, $99/year. Required to
  sign an iOS build and to publish on the App Store at all.
- **Google Play Console** — play.google.com/console, $25 one-time. Required
  to publish on the Play Store.

### 3. Android — the more finishable path from here

Android doesn't need a Mac. From a machine with Android Studio (or just the
command-line tools) installed:

1. Generate a signing keystore (do this once, keep it somewhere durable —
   losing it means you can never update the app again under the same
   listing):
   ```
   keytool -genkeypair -v -keystore sitesnap-release.keystore \
     -alias sitesnap -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Either build locally (`cd android && ./gradlew bundleRelease` with the
   keystore configured in `android/app/build.gradle`), or add the keystore
   as GitHub secrets and extend `.github/workflows/android-build.yml` with a
   signed `bundleRelease` job — ask me to wire that up once the keystore
   exists; I can't generate or hold the keystore itself.
3. Play Console → Create app → fill in the store listing (description,
   screenshots — phone and, ideally, tablet — feature graphic) → App content
   → Data safety (use `docs/app-privacy-answers.md`) → upload the signed
   `.aab` under a release (start with **Internal testing**, not Production,
   so you can try a real install before anyone else can) → submit for
   review.

### 4. iOS — needs a Mac

There's no way around this — Apple only allows building and signing iOS
apps from Xcode on macOS. Options: your own Mac, a colleague's, or a rented
one (e.g. MacinCloud) for the time it takes to do this once.

1. `npm run build && npx cap sync ios`, then open
   `ios/App/App.xcworkspace` in Xcode (not the `.xcodeproj` — Capacitor
   projects use CocoaPods, which needs the workspace file).
2. In Xcode: select the App target → Signing & Capabilities → sign in with
   your Apple Developer account → set the Team → Xcode will provision it
   automatically.
3. Product → Archive, then use the Organizer window's **Distribute App** →
   App Store Connect → Upload.
4. App Store Connect (appstoreconnect.apple.com) → create the app record
   (same bundle ID as step 1 above) → fill in App Privacy (use
   `docs/app-privacy-answers.md`) → add screenshots (required sizes: 6.7"
   and 5.5" iPhone at minimum) → attach the uploaded build → submit for
   review.

### 5. Store listing content (both platforms)

Neither store can be filled in from here — these are content/marketing
decisions:

- App description, keywords, support URL, marketing URL
- Screenshots (both stores have specific required device sizes)
- Age rating questionnaire
- Category (Business or Productivity fits SiteSnap)

## Honest open items — not blocking, worth knowing

- **The bundle ID and production URL are placeholders.** Nothing above will
  work correctly against a real store account until those are set.
- **No automated release-signing pipeline yet** for either platform — both
  need your accounts/certificates added before CI can produce a
  submittable, signed build rather than just a debug/simulator one.
- **The remote-URL review risk** described above is real, if small. If
  Apple rejects the first submission specifically citing "minimum
  functionality" (Guideline 4.2), the fix is the bundled-build rework
  mentioned earlier — come back and we'll do it properly rather than
  patching around it.
