# IDFrame Studio | React + Render Python + Cloudflare Workers AI

This version has **two browser routes** (`/` and `/studiopage`), two studio tabs (Generate / Export), the light-first teal/cyan theme based on the IDFrame Studio SVG, and the existing logo + BETA header.

## Features

- **Generate:** Choose **Suit & tie** (black suit, white shirt, black tie) or **Women's blazer** (black blazer and white collared blouse, no tie). These are **outfit styles, not automatic gender detection**. The Worker uses a different fixed server-side prompt for each, to avoid untrusted arbitrary prompts. Generated facial identity may differ from the original.
- **Internal face preparation**: MediaPipe attempts to detect the face while generating and automatically creates a face-centered reference for Cloudflare. There is no separate Align Face button, and no extra Worker AI generation is used.
- **Generate** attempts Python enhancement first, then Cloudflare FLUX.2 generation. If Python enhance fails, original input is sent directly to Cloudflare; the user is notified by the final result status. A successful image alone does **not** prove Python ran; inspect Render logs.
- Manual crop/zoom, single PNG/JPG and one 8 × 11 inch PDF sheet with **4 copies of 2×2 plus 6 copies of 1×1**, black cut borders and IDFrame Studio header/footer remain.
- Daily Worker limits: 10 successful generations per visitor, 50 for the entire studio, 24 attempts per visitor, resetting at UTC midnight.

## Local development

Open **three** CMD terminals. From the project root:

Frontend:

```bat
cd frontend
copy .env.example .env.local
npm install
npm run dev
```

In `frontend/.env.local` use:

```env
VITE_CLOUDFLARE_WORKER_URL=http://localhost:8787
VITE_PYTHON_API_URL=http://localhost:8000
VITE_TURNSTILE_SITE_KEY=
```

Python 3.13 backend:

```bat
cd backend
py -3.13 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Worker:

```bat
cd cloudflare-worker
npm install
copy .dev.vars.example .dev.vars
npx wrangler dev
```

Configure a long unique `RATE_LIMIT_SALT` in `.dev.vars` for local development. `DEV_SKIP_TURNSTILE=true` is permitted **only locally**. For deployed Workers, set real Turnstile keys and disable development bypass.

## Production deployment

1. **Render**: existing Python Web Service, root `backend`; build `pip install -r requirements.txt`; start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; `PYTHON_VERSION=3.13.3`; `FRONTEND_ORIGINS=https://idframe-studio-web.pages.dev` (replace with your actual public Pages origin). **Redeploy Render** after pushing this version to remove the previous heavy `rembg` dependency and preserve photo enhancement.
2. **Worker**: `cloudflare-worker/wrangler.toml` uses the existing production Worker name `idframe-studio`, AI and Durable Object bindings, and `ALLOWED_ORIGIN=https://idframe-studio-web.pages.dev`; confirm the exact Pages origin. Set production Worker secrets `RATE_LIMIT_SALT` and `TURNSTILE_SECRET` with `npx wrangler secret put ...` if missing, then run `cd cloudflare-worker && npx wrangler deploy`. **Redeploy the Worker** after the change because it handles `outfit` on `/api/generate` (already supported in the previous version).
3. **Cloudflare Pages**: connect repo with root `frontend`, `npm run build`, output `dist`. Configure `VITE_CLOUDFLARE_WORKER_URL=https://idframe-studio.idframe.workers.dev`, `VITE_PYTHON_API_URL=<actual Render URL>`, and `VITE_TURNSTILE_SITE_KEY=<public Turnstile Site Key>`. New GitHub pushes deploy Pages if automatic deployments are enabled.
4. Turnstile widget's allowed hostname must match the Pages hostname, **not** the Worker hostname. The frontend URL must also match Render's `FRONTEND_ORIGINS` and Worker's `ALLOWED_ORIGIN`. Never put private Worker secrets in `VITE_` variables or GitHub.

## Export notes

- Generated portraits cannot be guaranteed to satisfy government ID/passport rules. Confirm all printed dimensions on actual printouts at 100% scale. **8×11 is a custom size**; conventional US Letter / short bond paper is 8.5×11.

## Checks

```bat
cd backend
python -m pytest -q tests

cd ..\cloudflare-worker
npm test

cd ..\frontend
npm install
npm run build
```

API health endpoints: Render `<your Render URL>/health`; Worker `https://idframe-studio.idframe.workers.dev/health`. Pages frontend lives at the Pages domain and does **not** have a `/health` API.

### Simplified generation
The Align Face and Remove Background buttons and Python segmentation endpoint have been removed. The React frontend still uses MediaPipe face detection **internally** in `frontend/src/lib/cloudflarePhoto.ts` before generation to crop a face-centered AI reference. Python (`/api/enhance`) still enhances image contrast, color, and sharpness. Generated portraits retain manual crop/zoom and PNG/PDF exports.


## Branding (Nov 2026)
- The supplied IDFrame Studio teal/silver logo is in `frontend/public/idframe-studio-logo.svg`.
- The matching icon-only SVG is in `frontend/public/idframe-icon.svg` (header, footer); full SVG used as the favicon.
- Light mode is the first-visit default; visitors can switch to dark mode, persisted in localStorage.
- No changes to the Worker, Python routes, or generation quota are required for this visual update.


Homepage URL: `/` (legacy `/homepage` redirects to `/`). Studio URL: `/studiopage`.
The PDF header and footer retain brand labels without extra explanatory text.


## UI update: Generate and New Photo

- Studio Generate button is labeled **Generate Portrait**.
- **New photo** opens the system file picker directly from the Studio. Canceling keeps the existing photo; selecting a valid JPG, PNG, or WebP image resets the editor to the new photo without navigating away.
- Homepage Before / After image examples display **Illustrative Photos Only** below the four images.
