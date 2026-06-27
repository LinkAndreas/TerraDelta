<div align="center">

# TerraDelta

**AI-powered semantic change detection for aerial orthophotos.**

*Terra* (the earth, from above) + *Delta* (Δ — the symbol for change).

[![License: MIT](https://img.shields.io/badge/License-MIT-e08a5a.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Docker ready](https://img.shields.io/badge/Docker-ready-2496ed.svg)](#-run-with-docker)

</div>

---

TerraDelta compares two aerial **orthophotos** of the same area taken at different
dates (e.g. 2021 vs 2025) and reports the **semantic, real-world changes** —
buildings, houses, roads, bridges, plots and land development that were **added,
removed or modified** — while deliberately ignoring season, lighting, shadows and
crop cycles. Changes are highlighted on an interactive comparison view and listed
in a filterable, exportable report.

> **Bring your own key:** the app needs **no server-side secrets**. Each user
> enters their own Anthropic or Google Gemini API key in the in-app settings; it
> is stored only in their browser. This makes deployment trivial and keeps keys
> out of the codebase.

## ✨ Features

- **Two AI providers** — Anthropic **Claude** and Google **Gemini**, with model selection.
- **In-browser image co-registration** — ORB feature matching + RANSAC homography (OpenCV.js, no server GPU).
- **Tiled, high-resolution analysis** — the scene is split into overlapping tiles and analyzed region by region for high recall and precise boxes, then de-duplicated.
- **Precision-focused prompt** — ignores lighting/season/shadows/crop changes; flags only genuine structural & land-use changes.
- **Interactive comparison** — Earlier / Later / draggable **Slider** / **Side-by-side**, with colored overlays, a spotlight mode and numbered chips synced to the report.
- **Filterable report** — by change type and confidence, with CSV export.
- **Bilingual** — English & **German** (default), including translated model output.
- **Light / dark themes**, tooltips, and a guided onboarding flow.

## 🧠 How it works

1. Both images are **co-registered** in the browser (ORB + RANSAC homography), warping the later image onto the earlier one's frame.
2. The aligned pair is split into **overlapping high-resolution tiles** plus one overview pass.
3. Each region is sent to a **vision model** (Claude or Gemini) that reasons about genuine structural / land-use changes.
4. Detections are mapped back to global coordinates, **de-duplicated**, highlighted and listed.

Only aligned, downscaled tiles ever leave the browser; the API key is used
server-side and never exposed to the client bundle.

## 🚀 Quick start (local)

**Prerequisites:** Node.js 20+.

```bash
git clone https://github.com/<your-username>/terradelta.git
cd terradelta
npm install
npm run dev
```

Open <http://localhost:3000>, click **⚙**, choose a provider and paste your API key,
upload an earlier and a later image, then **Detect changes**.

*(Optional)* to provide a server-side fallback key for local dev, copy
`.env.example` to `.env.local` and fill it in.

## 🐳 Run with Docker

The app builds to a self-contained Next.js standalone server.

**Docker Compose (recommended):**

```bash
docker compose up -d --build
# → http://localhost:3000
```

**Plain Docker:**

```bash
docker build -t terradelta .
docker run -d -p 3000:3000 --name terradelta terradelta
```

API keys are **optional** at the container level — pass them only if you want a
server fallback:

```bash
docker run -d -p 3000:3000 \
  -e ANTHROPIC_API_KEY=... \
  -e GEMINI_API_KEY=... \
  terradelta
```

## ☁️ Deploy to Hostinger

The recommended path is a **Hostinger VPS with Docker** (full Next.js + API route
support). Because keys are entered in the UI, **no secrets are required on the
server**.

1. **Create a VPS** in hPanel and choose the **Docker / Ubuntu** template (or
   install Docker manually: `curl -fsSL https://get.docker.com | sh`).
2. **SSH in** and clone the repo:
   ```bash
   git clone https://github.com/<your-username>/terradelta.git
   cd terradelta
   docker compose up -d --build
   ```
   The app now listens on port **3000**.
3. **Point your domain & add HTTPS.** Put a reverse proxy in front (Hostinger's
   panel, or Nginx + Certbot) mapping your domain to `127.0.0.1:3000`. Minimal
   Nginx site:
   ```nginx
   server {
     server_name terradelta.example.com;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   Then issue a certificate with `certbot --nginx`.
4. **Update later** with `git pull && docker compose up -d --build`.

> **Alternative (no Docker):** on any Node 20+ host run
> `npm ci && npm run build && npm start` (optionally under `pm2`). The standalone
> server also works via `node .next/standalone/server.js` after a build.

## ⚙️ Configuration

| Variable            | Required | Description                                                       |
| ------------------- | -------- | ----------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | No       | Server fallback key for Claude. Users can supply their own in-app. |
| `GEMINI_API_KEY`    | No       | Server fallback key for Gemini. `GOOGLE_API_KEY` also works.       |
| `PORT`              | No       | Port the server listens on (default `3000`).                      |

All AI provider/model/key selection is also available at runtime in the app's
settings (⚙), stored per-browser in `localStorage`.

## 🗂️ Project structure

```
app/                 Next.js App Router (UI page, layout, /api/analyze route, favicon)
components/          React components (CompareView, ReportTable, Settings modal, Onboarding, …)
lib/                 align.ts (OpenCV), tiles.ts, prompt.ts, claude.ts, gemini.ts, detect.ts, i18n.ts, theme.ts
Dockerfile           Multi-stage production image (standalone)
docker-compose.yml   One-command run
```

## 🛠️ Tech stack

Next.js 14 (App Router) · React 18 · TypeScript · OpenCV.js (WASM/asm.js) ·
Anthropic SDK · Google Gemini REST.

## 🔒 Security

- **No real API keys are committed.** `.env*` files are gitignored; the only keys
  the app uses come from the UI (browser `localStorage`) or optional server env vars.
- Keys are sanitized (trimmed, dash-normalized, ASCII-validated) before use.
- The API key is only ever used server-side and never shipped in the client bundle.

## 🤝 Contributing

Issues and pull requests are welcome. Please run `npm run build` (and
`npm run lint`) before submitting.

## 📄 License

[MIT](LICENSE) © 2026 Andreas Link
