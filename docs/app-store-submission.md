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

### 1. Confirm the app identity (do this first — it's permanent)

- **Bundle ID / package name**: `com.sitesnap.app`, set consistently in
  `capacitor.config.ts`, `android/app/build.gradle` (`applicationId` and
  `namespace`) and the Xcode project (`PRODUCT_BUNDLE_IDENTIFIER`). It is a
  sensible default and needs no change — but once a build is uploaded to
  either store under an ID, it can never be changed without publishing a
  brand-new listing. If you'd rather it sit under a domain you own (e.g.
  `com.stonebridgesurveyors.sitesnap`), change it in those three places
  *before* the first upload, then re-run `npx cap sync`.
- **Production URL**: the shell loads
  `https://sitesnap-production-821d.up.railway.app` — the live deployment,
  already the default in `capacitor.config.ts`. Only change it (via the
  `CAPACITOR_SERVER_URL` env var or the fallback in the file) if you move to
  a custom domain.
- **Version**: 2.1.0 (build 1) on both platforms, matching `package.json`.
  Bump `versionCode`/`CURRENT_PROJECT_VERSION` for every store upload.
- **Privacy policy contact**: `hello@sitesnap.uk`, set in
  `public/privacy.html`. Both stores load that page and expect the address
  to be monitored — make sure the mailbox exists and someone reads it.

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
   `ios/App/App.xcodeproj` in Xcode. (This project uses Swift Package
   Manager for Capacitor's plugins, not CocoaPods — there is no Podfile or
   `.xcworkspace`, and the iOS CI workflow builds the `.xcodeproj` directly.)
2. In Xcode: select the App target → Signing & Capabilities → sign in with
   your Apple Developer account → set the Team → Xcode will provision it
   automatically.
3. Product → Archive, then use the Organizer window's **Distribute App** →
   App Store Connect → Upload.
4. App Store Connect (appstoreconnect.apple.com) → create the app record
   (same bundle ID as step 1 above) → fill in App Privacy (use
   `docs/app-privacy-answers.md`) → add screenshots (the 6.9" iPhone set in
   `store/screenshots/apple-6.9in-1320x2868/` covers the only required
   slot) → paste the review notes and test-account details from
   `docs/store-listing.md` → attach the uploaded build → submit for review.

### 5. Store listing content (both platforms)

Drafted and ready to paste — see **`docs/store-listing.md`** for the
descriptions, keywords, category, content-rating answers, the Sign in with
Apple exemption note and App Review notes, plus the assets in `store/`
(phone screenshots at both stores' required sizes, the Play feature graphic
and hi-res icon). Two things there still need you:

- **Real photos in the screenshots.** The captured screens use rendered
  placeholder "damp wall" images so the layouts read correctly. Re-capture
  with real, anonymised inspection photos before submitting (the capture
  script is trivially re-runnable — ask).
- **A reviewer test account** on a firm with a couple of demo cases. In
  accounts mode nothing is reachable without signing in, and Apple rejects
  outright ("unable to test") if none is provided.

## Honest open items — not blocking, worth knowing

- **Play's new-developer rule.** A personal Play developer account created
  after 13 Nov 2023 must run a closed test with at least 12 opted-in
  testers for 14 continuous days before Production is unlocked. Plan for
  that fortnight — Stonebridge's team can be the testers.
- **Sign in with Apple (Guideline 4.8).** Because the app offers Microsoft
  and Google sign-in, Apple normally requires Sign in with Apple too. The
  app qualifies for the business-account exemption (surveyors sign in to
  their firm's existing account; there is no public sign-up), but the
  reviewer won't assume that — the note in `docs/store-listing.md` states
  it explicitly. If Apple pushes back anyway, adding Sign in with Apple as a
  third provider is a contained piece of server work, not a rebuild.
- **No automated release-signing pipeline yet** for either platform — both
  need your accounts/certificates added before CI can produce a
  submittable, signed build rather than just a debug/simulator one.
- **The remote-URL review risk** described above is real, if small. If
  Apple rejects the first submission specifically citing "minimum
  functionality" (Guideline 4.2), the fix is the bundled-build rework
  mentioned earlier — come back and we'll do it properly rather than
  patching around it.
