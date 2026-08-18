# House of Pinash — Atelier Studio

A simple, single-user tool: upload 1 to 3 casual phone photos of a garment
(any angles you have — laid flat, on a hanger, or worn, no professional
shoot needed), and generate 4 new professional model photos of that same
garment. Images are generated and shown for direct download — nothing is
stored or synced anywhere (no database, no Shopify).

## How it works

1. Log in with the one shared studio password.
2. Drop in 1 to 3 photos of the garment — regular camera clicks, whatever
   angles you happen to have. Front + back is a good baseline; adding a
   close-up of any embroidery/print gives the most accurate results.
3. Optionally add a line of direction (skin tone, lighting, pose, mood).
4. Generate — the app calls Gemini's image model 4 times, once per shot type:
   full front look, full back look, three-quarter angle, and a close-up
   detail shot. Every call sees all of your reference photos together, so
   details from one photo (e.g. a close-up) inform the others, and the
   garment's embroidery/print/fabric — and its true length and proportions —
   carry over as closely as possible. Any part of the garment not visible in
   any of your photos is inferred consistently with the fabric and design
   shown.
5. Download each image in HD, share it straight to WhatsApp, download all 4
   together as a ZIP, or hit **Regenerate** on any single shot that didn't
   come out right — it re-runs just that one, leaving the other 3 untouched.
   "Regenerate all 4 shots" re-runs the whole set.

## Chained generation (for colour/length consistency)

Shots now generate one after another instead of all at once: the front shot
is generated first, then used as an extra reference image for the back,
three-quarter, and detail shots — so the model has something concrete to
match pants/top colour and fabric against, instead of four independent
guesses from your original phone photos. This makes generation take longer
(roughly 3-4x a single shot, since it's now sequential) but should noticeably
improve colour consistency across the set. Regenerating a single non-front
shot does the same thing, using whichever front shot is currently on screen
as the anchor.

## HD output & WhatsApp sharing

- Every generation now requests **2K resolution** from the model (configurable
  via `GEMINI_IMAGE_SIZE` env var — `1K`, `2K`, or `4K`). Not every model in
  the fallback chain honours this equally well, but `gemini-3-pro-image`
  (Nano Banana Pro) respects it fully.
- **Share to WhatsApp** uses the phone/browser's native share sheet (Web
  Share API) — on mobile this opens the normal share menu with WhatsApp as
  one of the options. On desktop browsers, which don't support sharing files
  this way, it falls back to downloading the image and opening WhatsApp Web
  so you can attach it manually.
- **Download all 4 (ZIP)** bundles whichever shots generated successfully
  into one `.zip` for a quick single download.

## Model fallback

Every shot is tried against a chain of models in order — if the primary
model errors out or returns no image, the app automatically retries with the
next one:

1. `gemini-2.5-flash-image` (fast, default primary)
2. `gemini-3-pro-image` (Nano Banana Pro — higher accuracy, used as fallback)
3. `gemini-3.1-flash-image` (final fallback)

Override the first two via `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` in your
env if you'd rather flip the order — e.g. set `GEMINI_MODEL=gemini-3-pro-image`
to make the higher-accuracy Pro model the primary one, since it supports more
reference images and better brand/detail consistency (at higher cost and
slightly slower generation).

## Local setup

```bash
npm install
cp .env.example .env.local
# edit .env.local: set APP_PASSWORD and GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000 — it will redirect to /login first.

- **APP_PASSWORD** — whatever password you want to gate the app with (single
  shared user, no accounts/signup).
- **GEMINI_API_KEY** — get one from Google AI Studio
  (https://aistudio.google.com/apikey). The app uses the
  `gemini-2.5-flash-image` model.

## Deploying later (not done yet, on request)

- **Frontend + API routes**: Vercel. Set `APP_PASSWORD` and `GEMINI_API_KEY`
  as environment variables in the Vercel project settings.
- A separate Railway backend is not needed for this version — the two API
  routes (`/api/login`, `/api/generate`) run fine as Vercel serverless
  functions. Add a Railway service later only if this grows into something
  that needs a persistent server (queues, storage, long-running jobs).

## Notes on the current version

- No database — generated images live only in the browser tab until you
  download them. Refreshing the page clears them.
- Single user — one shared password, no per-user accounts.
- Works on both mobile and desktop browsers (responsive layout); this is a
  responsive web app, not a native/store app.
