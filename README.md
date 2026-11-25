# IDFrame — React + Python FastAPI + Cloudflare Workers AI

A complete three-service IDFrame project, with an AI photo Studio and printable PDF photo sheets.

## What each service does

- `frontend/`: React + Vite + TypeScript, responsive Studio, photo upload, crop, background tools, download and PDF export.
- `backend/`: Python + FastAPI, file validation, image quality analysis and mild image enhancement. **Python does not generate formal clothing**. Frontend falls back to browser analysis when Python is offline.
- `cloudflare-worker/`: Cloudflare Workers AI image editing with FLUX.2 Klein 4B and FLUX.2 Dev (availability depends on your Cloudflare account); 10 successful generations per visitor per UTC day, 24 daily attempts, and a studio-wide daily cap of 50 successful generations using a Durable Object.

## Setup on Windows (three terminals)

**1. React frontend**

```bat
cd frontend
copy .env.example .env.local
npm install
npm run dev
```

Open `frontend/.env.local` and set:

```env
VITE_CLOUDFLARE_WORKER_URL=http://localhost:8787
VITE_PYTHON_API_URL=http://localhost:8000
VITE_TURNSTILE_SITE_KEY=
```

**2. Python backend (Python 3.13 or 3.11)**

```bat
cd backend
py -3.13 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Test at `http://localhost:8000/health`. The Python server is used for the **Enhance with Python** button under Studio > Adjust and for quality analysis. Professional attire generation still uses Cloudflare.

**3. Cloudflare Worker**

```bat
cd cloudflare-worker
npm install
copy .dev.vars.example .dev.vars
npx wrangler login
npx wrangler dev
```

Edit `.dev.vars` and set a unique long random `RATE_LIMIT_SALT`. The Worker configuration includes the remote AI binding. `DEV_SKIP_TURNSTILE=true` is set only in the local `.dev.vars` file, never in the deployed Worker configuration. To check the Worker, use `http://localhost:8787/health` (the root URL does not have a webpage).

The Worker currently allows `http://localhost:5173` during local development. It will use your Cloudflare Workers AI quota. If you have already exhausted your daily quota, the AI button will remain limited by Cloudflare even when everything else works.

## Studio features

- Generate studio-style portraits using Cloudflare FLUX.2 Klein 4B or Dev
- Outfit choices: business suit, smart business casual, or original
- Background choices, crop, zoom, face centering, local background removal
- Quality analysis (Python if reachable, otherwise browser fallback)
- Non-generative **Enhance with Python** control under Adjust
- Download single PNG/JPG and 4x6-inch PDF sheets: 4 copies at 2x2 inches, or 8 copies at 1x1 inch
- Desktop Studio layout with independent settings-panel scrolling; mobile scrolls vertically
- Original and last generated photo session restored on reload (browser IndexedDB)

## Deploy publicly

1. Push this repository to GitHub, but **never** commit `.env.local`, `.dev.vars`, or API secrets.
2. Deploy `frontend/` as Cloudflare Pages (root `frontend`, build `npm run build`, output `dist`). Set `VITE_CLOUDFLARE_WORKER_URL`, `VITE_PYTHON_API_URL`, and `VITE_TURNSTILE_SITE_KEY` in Pages build settings. These VITE variables are public client configuration; never put secrets there.
3. Deploy `backend/` on Render from `backend/render.yaml` or create a Python web service with root `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `FRONTEND_ORIGINS` to your actual Pages URL, not `*`. Free Render resources are limited and may sleep.
4. Set `ALLOWED_ORIGIN` in `cloudflare-worker/wrangler.toml` to your exact Pages origin. Set `DEV_SKIP_TURNSTILE` to `false` for production. Create Cloudflare Turnstile keys, set frontend site key, then configure `TURNSTILE_SECRET` and `RATE_LIMIT_SALT` using `npx wrangler secret put ...`. Never expose these to React.
5. Deploy the Worker with `cd cloudflare-worker && npx wrangler deploy`. The Durable Object binding and SQLite counter migration are included in `wrangler.toml`. Set the Pages `VITE_CLOUDFLARE_WORKER_URL` to your deployed Worker URL and redeploy the frontend.
6. Test status, Turnstile, error handling, five-generation limit, and PDF print dimensions from the deployed frontend.

## Security and limitations

The Worker rate limit is IP-derived, not account-based; shared connections may share an allowance, while network changes can bypass it. The studio-wide cap helps protect Cloudflare quota. Cloudflare Turnstile must be enabled on any public site. The Python API validates upload type, bytes, and dimensions, but it is a publicly callable API and may need independent rate limiting or Cloudflare WAF rules when exposed online. Uploaded photo bytes are not intentionally stored server-side by Python.

Cloudflare model availability and free Neuron quotas vary, and image-to-image results can alter facial features. AI-generated photos are **not guaranteed** suitable for government IDs. The background-removal package has licensing conditions; review before production use. Print PDFs should be printed at 100%/Actual Size.

## Tests

```bat
cd frontend
npm run build
npm run lint

cd ..\backend
python -m pytest tests

cd ..\cloudflare-worker
npm test
```

The backend's tests may need `pip install pytest httpx` if not included in your environment.

## Windows shortcuts
After installing dependencies, you can open `scripts/start-frontend.bat`, `scripts/start-backend.bat`, and `scripts/start-worker.bat` in separate terminals or Command Prompt windows. They run the same commands described above.

## Daily usage indicator troubleshooting

If the Studio shows **Daily usage unavailable** instead of a count, verify `frontend/.env.local` contains `VITE_CLOUDFLARE_WORKER_URL=http://localhost:8787`, then restart Vite. Check that `ALLOWED_ORIGIN` in the Worker matches the actual browser origin (for example, `http://localhost:5173`). The Studio now logs the underlying request error in DevTools and provides a refresh control instead of staying on `checking…` after an error.


## Formal ID Portrait (fixed style, Cloudflare)

This edition fixes the Cloudflare Worker generation prompt to **front-facing, centered, both shoulders square, black business suit, white dress shirt, black necktie, white background**. The old attire and backdrop dropdowns are removed from the Generate panel. The Worker ignores submitted outfit/background values, so the style remains fixed. You can still choose FLUX.2 Klein 4B or Dev, subject to availability on your Cloudflare account.

The React client creates a face-centered **480×480 reference crop** before requesting AI generation to reduce foreground selfie hands and background distractions. For best results, choose a photograph with a clearly visible face; a frontal input is still preferable. Prompting and cropping **cannot guarantee** a front-facing result or exact identity preservation, especially from dramatically angled selfies. These images may not meet official ID photo rules.

Your existing local config still belongs in `frontend/.env.local`:

```env
VITE_CLOUDFLARE_WORKER_URL=http://localhost:8787
VITE_PYTHON_API_URL=http://localhost:8000
```

Keep your existing `cloudflare-worker/.dev.vars` secrets and `frontend/.env.local` when updating. Restart Wrangler and Vite after replacing code. Previously generated portraits may be restored from local browser storage; use **Return to original** before generating again.

## Generation limits (updated)

The Cloudflare Worker permits **10 successful generations per visitor per UTC day** with up to **24 attempts per visitor per day**, and a configurable **50 daily global generations** cap. In `cloudflare-worker/wrangler.toml`, set `GLOBAL_DAILY_LIMIT = "50"`. The limit is separate from Cloudflare Workers AI Neurons. A failed generation normally refunds generation reservations, but still consumes an attempt and may consume Cloudflare Neurons. Local changes require a Wrangler restart; production changes require a Worker redeploy. The frontend reads `/api/usage` and displays the current allowance without a hardcoded count.
