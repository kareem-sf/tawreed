# Tawreed: what is left before launch under QS Mind

Date: 2026-10-08. Read from the `tawreed` repo (`main`, 4e818ea), its `docs/`, and the company docs.

## Where it stands

- **The core works.** Drop BOQs (Excel, CSV, ODS, PDF, scans), the AI reads them, plans packages and places every
  item; the engineer approves at four gates; Tawreed publishes a master workbook and one per package, with formulas.
  A real BOQ (El Far, 15 sheets, 320 items) went all the way through, and the totals match the file to the cent.
- **Polished UI** in English and Arabic, light and dark, down to 380px wide. The Arabic name is already توريد.
- **Tests:** `npm run verify` passes on this Linux laptop today: typecheck, Ruff, Clippy, 124 service tests and
  49 interface tests.
- **Windows installer** builds. It has never been installed on a clean PC, and nothing has been released.
- README says "A QS Mind product." Nothing else in the app says QS Mind yet.

## What is left

### 1. Sign-in (you are on this)

What Tawreed needs:

- A sign-in screen before Home: "Sign in with QS Mind" opens the system browser (Google or email) and comes back
  to the app (deep link, loopback as fallback), as the database design says.
- The Python service holds the session. Refresh token in the OS keychain, never in `~/.tawreed`.
- An offline lease (14 to 30 days) so Tawreed works without internet. When it runs out, the app goes read-only and
  loses nothing.
- Settings gets an Account line: who is signed in, the plan, Sign out.
- On the database side: a `tawreed` product, its licence rule, and a device row per laptop.
- The sign-in screen says plainly: your account goes to QS Mind, your BOQs never do. This keeps the local-first
  promise, which is a selling point (Saudi government clients).

Three things to fix in the plans:

- **Order.** The plan builds the shared "QS Mind connect" code in Quantix first, then copies it to Tawreed.
  Tawreed is smaller and much closer to launch. I would build it in Tawreed first and copy it to Quantix. Either
  way the copy needs a written decision in `docs/`.
- **Required, not optional.** The database design says "optional sign-in" for the desktop apps. You now want it
  required everywhere. Update the design.
- **Free plan pause.** Supabase's free plan pauses a project after 7 days with no use. With required sign-in, a
  paused project locks out every *new* user (the offline lease only covers people already signed in). Fix with a
  daily keep-alive, or move to Pro before launch.

### 2. AI for the user (the biggest product gap)

- Today the user must paste their own API key (Anthropic, OpenAI, Google, xAI) or sign in to ChatGPT through Codex.
  The spec says users "should not need to know anything about AI models". Pasting keys breaks that for most QS
  engineers.
- **Options:** (a) keep "bring your own AI" for launch; (b) "QS Mind AI": Tawreed works out of the box through a
  QS Mind server that holds the keys, paid for by the plan. (b) is the real product, but BOQ content then passes
  through a QS Mind server on its way to the AI company, and the consent card must say so.
- **My view:** launch with (a), and make (b) the paid plan soon after. Decide now, because it sets the price.
- Not yet tested for real: Anthropic, OpenAI, Google and xAI keys. Only Codex has run real work. The spec's
  "done when" asks for every provider to pass its check.

### 3. Brand v2

- The app still shows the old gold "T" logo. Brand v2 says the QS Mind sphere with Tawreed's **Steel** face.
  The files are ready in `brand/tawreed/`. Swap the header mark, app icons, favicon and installer icon.
- Header: the "QS Mind | Tawreed" lockup.
- **Accent colour, your call.** Brand v2 says each product uses its metal as its single accent. Tawreed uses amber
  to mean "needs you". I would keep amber for that status and use Steel for the brand only.
- **Arabic headings, your call.** The company rule is Thmanyah Sans with swash letters. Tawreed uses Thmanyah Serif
  Display. Pick one.
- About page: add "A QS Mind product", the company name and a support contact. The spec also promises logs and
  updates there; neither exists yet.
- Installer: publisher "Tawreed" becomes "QS Mind"; copyright "MIT licence" becomes "© QS Mind".
- App ID `com.tawreed.desktop`: change it to something like `com.qsmind.tawreed` **before the first release**.
  Changing it later moves the user's log folder and breaks updates.

### 4. Licence

- The repo carries an MIT licence and the About page says MIT. That fits an open project, not a paid product behind
  sign-in. Change it to "all rights reserved" before release. Copies already taken stay MIT; that is fine.

### 5. Platforms

- Windows only (one installer type). The spec says Windows first; you work on Linux, and Tawreed runs fine here in
  development. OpenConKit already ships Windows, macOS and Linux.
- Decide: Windows only at launch, or add Linux (cheap) and macOS (needs Apple's $99 a year for signing).

### 6. Shipping and updates

- **No public download place.** The release script makes a draft GitHub Release, but the repo is private, so the
  public cannot download it. Needs a download page on the site with files in public storage, or a public releases
  repo.
- **No auto-updater.** Needed because the sign-in contract and the lease depend on people updating. OpenConKit has
  a signed updater; copy its pattern.
- **No code signing on Windows.** Users will see "Windows protected your PC / unknown publisher". Free option:
  accept it at launch. Paid option: a signing service (about $10 a month).
- **Never installed on a clean PC.** Do one full install test before launch.

### 7. Website

- The site already has the Tawreed chapter ("Procure") and early-access signup. Missing: a download page, a sign-up
  that creates the same QS Mind account, and pricing.

### 8. Pricing

- Free or paid is not decided for Tawreed. Billing is planned to arrive with Quanta's move to Supabase. If Tawreed
  launches free with sign-in, billing can wait. Decide together with point 2.

### 9. Smaller things

- The spec's "done when" names the real BOQ "Package 04 (Combined) R1". El Far was used instead. Run Package 04,
  or update the spec.
- GitHub has old Dependabot and backup branches. Tidy when convenient.

## Suggested order

1. **Your decisions:** AI (bring your own or QS Mind AI), free or paid, platforms, licence, accent and heading font.
2. **Brand v2, licence, app ID** (a day or two, no risk).
3. **Sign-in and offline lease**, alongside your current sign-in work.
4. **Updater, public download place, clean install test.**
5. **Real checks** with each AI provider; run Package 04.
6. **Site download page**, then launch.
