# Ironclad

A local-first Progressive Web App for logging live gym sessions — sets, weight, reps, RPE, rest, and how each set felt — installable straight to your phone's home screen, fully usable with no signal at the gym.

**[Live app →](LINK_GOES_HERE)**

---

## What it does

- **Live set logging** — Start/Stop per set, automatically timing the set itself and the rest before the next one
- **Weight, reps, RPE, notes** — carried forward between sets so you're not retyping the same numbers
- **Focus mode** — the current exercise expanded full-screen, the rest of the day collapsed into a tappable strip below
- **Progress history** — per-exercise sparkline charts and a full session log, all stored on-device
- **Fully editable program** — add/remove days and exercises, set targets via dropdowns, optional how-to cues per exercise
- **Share a program** — hand a starting program to a training partner via a downloadable file or a scannable QR code
- **Backup/restore** — export and re-import your full data as JSON
- **Offline-first** — installable PWA with a service worker; once loaded, it works with the phone in airplane mode
- **Optional live heart rate** — via a Bluetooth-broadcasting source (parked for now, the hook is there)

## Tech

Vanilla HTML/CSS/JS, no framework, no build step. All data lives in the browser's `localStorage` — there's no backend and no accounts. Hosted as a static site via GitHub Pages.

```
ironclad/
  index.html
  styles.css
  app.js
  manifest.json
  service-worker.js
  icons/
```

## Running it locally

It's just static files — any local web server works (a service worker needs `http://`, not `file://`):

```
npx serve .
```
or
```
python3 -m http.server 8000
```
Then open the printed `localhost` address in Chrome.

## Installing on your phone

Open the live link above, then:
- **Android (Chrome):** ⋮ menu → "Add to Home screen"
- **iPhone (Safari):** Share icon → "Add to Home Screen"

Full walkthrough for new users (and friends you share this with): see `ironclad-getting-started.md`.

## Data & privacy

Everything logged stays in `localStorage` on the device it's installed on. Nothing is sent anywhere — there's no server component at all. Exporting/sharing data is always an explicit, manual action (a file download or a QR code you choose to show someone).

## License

Personal project — no license currently applied. Ask before reusing.
