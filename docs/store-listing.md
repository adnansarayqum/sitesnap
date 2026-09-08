# Store listing content — SiteSnap

Ready-to-paste copy and assets for Google Play Console and App Store
Connect. Everything here describes what the app actually does today; keep
it that way when editing — both stores reject listings that promise
features the reviewer can't find.

Assets live in `store/`:

- `store/screenshots/apple-6.9in-1320x2868/` — App Store 6.9" iPhone slot
  (Apple scales these for the smaller slots; 6.9" is the only required one).
- `store/screenshots/play-phone-1080x2160/` — Play Store phone screenshots
  (Play needs 2–8; these are within its 16:9…9:16 / max-2:1 rule).
- `store/feature-graphic-1024x500.png` — Play Store feature graphic (required).
- `store/play-icon-512.png` — Play Store hi-res icon (full-bleed, no rounded
  corners — Play applies its own mask). iOS takes its icon from the Xcode
  asset catalog, already generated.

**The screenshot photos are synthetic placeholders** (a rendered plaster
texture with a damp patch), generated so the layouts read correctly. Before
submitting, re-run the capture with real, anonymised inspection photos, or
at minimum make sure nothing in them identifies a real address or person.
The addresses/references shown ("14 Elmfield Road", "SB-2247", "Lewisham
Homes") are invented.

---

## Identity

| Field | Value |
|---|---|
| App name | SiteSnap |
| Bundle ID / package name | `com.sitesnap.app` (set in `capacitor.config.ts`, `android/app/build.gradle`, and the Xcode project — all three agree) |
| Version | 2.1.0 (build 1) — matches `package.json`; Android `versionName`, iOS `MARKETING_VERSION` |
| Production URL the shell loads | `https://sitesnap-production-821d.up.railway.app` |
| Privacy policy URL | `https://sitesnap-production-821d.up.railway.app/privacy.html` — both stores load this page |
| Support / privacy contact | `hello@sitesnap.uk` |
| Category | Business (primary); Productivity (secondary, App Store only) |
| Price | Free (no in-app purchases — nothing is sold inside the app) |

> The bundle ID becomes permanent the moment a build is uploaded under it.
> `com.sitesnap.app` is a sensible default; if you'd rather it be under a
> domain you own (e.g. `com.stonebridgesurveyors.sitesnap`), change it in the
> three places above *before* the first upload.

---

## Google Play

**App name** (30 chars max)
> SiteSnap

**Short description** (80 chars max)
> Room-by-room inspection photos, filed and captioned before you leave site.

**Full description** (4000 chars max)

> SiteSnap is a field tool for surveyors carrying out property and housing
> disrepair inspections. Open it at the front door, walk the property room
> by room, and every photo is numbered, captioned and filed by the time the
> inspection is over — no sorting a camera roll into folders afterwards, no
> "which room was this?" at your desk.
>
> **Built for the walk**
> • A live camera that stays open between shots — tap, tap, tap.
> • Rate each room Good / Fair / Poor without leaving the viewfinder.
> • Swipe between rooms; the exhibit number restarts in each one.
> • Typed notes and voice notes per room, recorded on the phone.
> • Circle or arrow straight onto a photo to mark the defect.
> • Read a boiler or meter serial number off the photo into the caption — on
>   the device, no signal needed.
> • A high-contrast field mode for bright daylight.
> • A buzz when a photo lands, so you don't have to look at the screen.
>
> **Nothing depends on signal**
> Photos and notes are saved to the phone the instant they're taken. Filing
> to OneDrive and AI drafting happen when there's a connection, and retry on
> their own when signal comes back mid-property.
>
> **Filed where your firm already works**
> Connect the firm's OneDrive once and photos file themselves as you shoot,
> into /Inspections/<address>/<room>. Or export a PDF report and a ZIP of
> photos in the same folder structure from the phone.
>
> **Optional AI first draft — always yours to approve**
> Where a firm enables it, SiteSnap can draft a findings paragraph per room
> from the photos, notes and voice notes, citing the firm's own legal
> register and price book. Every draft is reviewed, edited and approved by
> the surveyor before it goes anywhere; the app never writes into a report
> on its own.
>
> **For firms**
> Sign in with a work email, Microsoft or Google account to share a case
> register across the team, so a colleague can see a case without the
> phone it was shot on. Works fully as a single-user app without an account
> too.
>
> SiteSnap is made for UK housing disrepair and property-condition work
> (damp, mould, structural defects) and is in daily use by working
> surveyors.

**App category:** Business
**Tags:** productivity, business, photography (utility)

**Contact details:** the privacy-policy email; a phone number is optional.

**Content rating questionnaire (IARC):** answer *No* to every content
question (no violence, sexual content, language, controlled substances,
gambling, user-generated content shared publicly, or user interaction). It
is a utility app; expect an "Everyone / PEGI 3" rating.

**Data safety:** copy from `docs/app-privacy-answers.md` (Google Play
section). Say *yes* to encryption in transit and *yes* to "users can request
deletion" (account deletion is via the support email; local-mode data is
deleted by uninstalling).

**Target audience:** 18+ (a professional tool). Not designed for children.

**Ads:** No.

**Release track to start on:** Internal testing → Closed testing →
Production. Note that Play requires a **personal developer account created
after 13 Nov 2023 to run a closed test with at least 12 testers opted in
for 14 continuous days** before it will let you publish to Production.
Stonebridge's team can be those testers.

---

## App Store (App Store Connect)

**Name** (30 chars) > SiteSnap
**Subtitle** (30 chars) > Inspection photos, filed on site
**Promotional text** (170 chars, editable without a new build)
> Walk the property, shoot room by room, and every photo is numbered,
> captioned and filed before you leave. Made for UK disrepair surveyors.

**Keywords** (100 chars, comma-separated, no spaces after commas)
> surveyor,inspection,disrepair,damp,mould,property,housing,site photos,report,evidence,snagging

**Description** — use the Play "Full description" above verbatim (Apple's
limit is also 4000 characters; it fits).

**Support URL** > your privacy/contact page.
**Marketing URL** > optional; leave blank or use the deployment URL.

**Age rating:** answer *None* to every question → 4+.

**App Privacy:** copy from `docs/app-privacy-answers.md` (Apple section).

**Sign-In information for the reviewer** — required, because in accounts
mode nothing is reachable without signing in:
> Provide a test account (email + a way to receive the sign-in code, or a
> pre-created password-less session flow) on a firm set up for review. Put
> a couple of demo cases in it so the reviewer sees populated screens.
> *Only you can create this — it needs a real deployment account.*

**App Review notes** — paste this, adjusted to what's true at submission:

> SiteSnap is a professional field-inspection tool used by surveying firms.
> It is not a general-consumer app.
>
> **Sign in with Apple (Guideline 4.8):** the app offers Microsoft and
> Google sign-in only as ways for a surveyor to sign in to *their firm's
> existing business account*; it does not offer public account creation.
> This falls under the enterprise/business exemption in 4.8 ("uses a
> third-party or social login service to set up or authenticate the user's
> existing business account"). Surveyors are onboarded by their firm's
> administrator via an invitation.
>
> **Camera / microphone:** used only when the surveyor takes an inspection
> photo or records a voice note. Nothing is captured in the background.
>
> **Remote content (Guideline 4.2):** the app loads its interface from our
> own server so the surveyor always has the current version of the firm's
> case register and AI reference material. It provides substantial native
> functionality beyond a web page — offline capture to on-device storage,
> a live in-app camera, on-device OCR, haptics, background sync to the
> firm's OneDrive, and a full inspection workflow — and works offline once
> installed.
>
> **Test account:** [email] / [how to get the code] — a demo firm with two
> sample cases is already set up on it.

---

## Screenshot captions (optional overlays — both stores accept plain shots)

If you later want captioned marketing screenshots, these pair with the
files in order:

| File | Caption |
|---|---|
| 00-home | Your cases, at a glance. |
| 01-case-overview | One case. Every room. Nothing lost. |
| 02-setup-rooms | Pick the rooms, then start shooting. |
| 03-room-kitchen | Photos numbered and captioned as you go. |
| 04-rooms | See what's covered before you leave. |
| 05-findings | An AI first draft — yours to approve. |
| 06-export | PDF, ZIP or straight to OneDrive. |
| 07-photo-lightbox | Mark the defect. Read the serial number. |
| 08-home-field-mode | Field mode for bright daylight. |
