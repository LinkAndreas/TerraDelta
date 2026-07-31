# Changelog

All notable changes to TerraDelta are recorded here.

This file is the SINGLE SOURCE OF TRUTH for the in-app release notes — the app
parses it directly (see lib/changelog.ts), so nothing has to be regenerated and
nothing can drift out of date. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow the repository's release tags.

## When cutting a release

1. Move the items under `## [Unreleased]

_Nothing yet._

## [1.5.4] — 2026-07-31

- The deploy workflow can be triggered manually from the Actions tab.

## [1.5.3] — 2026-07-31

- In-app version badge in the footer, opening the release notes.
- DIM points: EPSG:25832 stays preselected instead of being overridden by the orthophoto's own coordinate system.
- DIM points: 500 m default search radius for imported and newly placed points.
- DIM points: long remarks in the point list are truncated on a line boundary instead of being cut through the text.

## [1.5.2] — 2026-07-30

- Improve DIM import and change detection

## [1.5.1] — 2026-07-30

- Improve PDF Export

## [1.5.0] — 2026-07-30

- Update dependencies
- Add DIM Point support

## [1.4.1] — 2026-07-25

- Invalid JSON

## [1.4.0] — 2026-07-25

- Improve change detection

## [1.3.9] — 2026-07-15

- Adjust token limit

## [1.3.8] — 2026-07-15

- Remove min and max constraints

## [1.3.7] — 2026-07-15

- Improve change detection

## [1.3.6] — 2026-07-15

- Make Grundaktualitaet the default selection

## [1.3.5] — 2026-07-15

- Improve change detection and enhance export options

## [1.3.4] — 2026-07-14

- Optimize mobile layout

## [1.3.3] — 2026-07-14

- Add option to start over
- Top bar button height

## [1.3.2] — 2026-07-14

- Implement improved token cost monitoring

## [1.3.1] — 2026-07-13

- Adjust change categories

## [1.3.0] — 2026-07-13

- Distinguish `Spitzen-` and `Grundaktualitaet`

## [1.2.7] — 2026-07-13

- Add model effort
- Improve search area and add api costs

## [1.2.6] — 2026-07-13

- Include image metadata

## [1.2.5] — 2026-07-13

- Improve UI/UX for analysis options

## [1.2.4] — 2026-07-12

- Add `search area` and `category` section

## [1.2.3] — 2026-07-03

- Use `checkout@v5`

## [1.2.2] — 2026-07-03

- Optimize change detection

## [1.2.1] — 2026-07-03

- Improve change detection

## [1.2.0] — 2026-07-03

- Fetch models from Anthropic API

## [1.1.0] — 2026-06-29

- Support tiled separate-planes TIFFs via geotiff.js fallback
- Remove: upscaling feature
- AI-driven upscaling, vertical PDF images, localized PDF categories
- Replace UTIF with server-side sharp for TIFF conversion
- Pre-analysis upscaling option (Off / 2× / 3× / 4×)
- Robust TIFF decode with dimension validation and error feedback
- TIFF preview by decoding with utif instead of native browser img
- Ignore tsconfig.tsbuildinfo build cache
- PDF export, confidence as %, broader image format support
- Remove arrow on comparison knob slider and swap previous and next image

## [1.0.5] — 2026-06-27

- Optimize for mobile
- Remove `Gemini` configuration option

## [1.0.4] — 2026-06-27

- Increase font size
- Remove `?` prefix

## [1.0.3] — 2026-06-27

- Update docker-compose and docs to use port 32771

## [1.0.2] — 2026-06-27

- Update README to reflect recent Next.js 16/React 19 upgrades and CI/CD workflow
- Update docker-compose and docs to use port 32771

## [1.0.1] — 2026-06-27

- Refactor deploy to use scp instead of git pull

## [1.0.0] — 2026-06-27

- Add TerraDelta branding logo to README
- Initial commit
- Add GitHub Action for Hostinger VPS deployment
