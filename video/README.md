# Open Inventory product film

22 seconds · 1920 × 1080 · 30 fps · German · H.264 MP4 with stereo audio.

The film combines real captures of the local application with frame-driven cursor movement, hover outlines, clicks, camera zooms and CSS perspective. The 3D segment is a recording of the application's room viewer, with two inventory entries placed in a furnished synthetic demo room. The QR card is an animated presentation of the demo entry, using the application's real QR encoder.

## Preview and render

From `video/`:

```sh
npm ci
npm run dev
npm run render
npm run still
```

Studio opens on port 3120. The final file is `out/open-inventory-product-fast.mp4`; `out/` is ignored by Git. Rendering only needs the files in this project, not a running app or database.

## Scenes

| Time | Content |
| --- | --- |
| 0–1 s | Brief logo and product name |
| 1–6.5 s | Inventory cards, cursor hover, zoom and item details |
| 6.5–11 s | Stock overview and coverage zoom |
| 11–15 s | QR label and scan effect |
| 15–20.5 s | Actual 3D room viewer at 1.45× speed |
| 20.5–22 s | Product name and repository link |

The fast cut removes explanatory subtitles, cursor labels, promotional callouts and footer navigation. Each feature has just one short heading. The original 42-second MP4 remains in `out/open-inventory-product.mp4`.

All animation timing lives in `src/ProductFilm.tsx`. Source screenshots and the trimmed room recording are in `public/screens/`. The original browser captures are in the repository's ignored `output/playwright/product-video/` directory.

## Local demo content

The authorized local demo is additive and isolated as **Werkstatt Nord** at `/video-demo/inventory`. It contains the eight workshop seed records, stock history, a loan, a purchase order and a label layout, plus **Studio Nord** with two placed inventory entries. Existing organizations are not modified.

`npm run demo:seed` uses the parent application's `.env.local` and fails if the database or app is remote. It creates only its own fixed demo identities and does not reset existing demo edits. The capture account has a random password and belongs only to this demo. The credentials and browser state are saved with owner-only permissions in `../output/playwright/product-video/`; do not publish that directory. `VIDEO_APP_URL` defaults to `http://127.0.0.1:3105`.

## Assets and provenance

- `public/photos/`: three photos generated with the built-in Imagegen tool. Exact prompts are in [IMAGE-PROMPTS.md](IMAGE-PROMPTS.md). They depict synthetic sample contents. Some item cards use context photos containing several items.
- `public/audio/product-score-fast.wav`: original locally synthesized electronic score, including transition sweeps and click sounds. Rebuild with `npm run audio`; no third-party music samples are used.
- `public/fonts/Manrope.ttf`: Manrope variable font from the Google Fonts repository, with its SIL Open Font License in `public/fonts/OFL.txt`.
- `public/logo.svg`: the application's existing Open Inventory mark.
- `src/LabelCodes.tsx`: copy of the app's QR/Code 128 encoder from `components/label-codes.tsx`, kept inside the video package to avoid loading a second React runtime. Parent repository license applies.
- `public/demo-room.json`: synthetic room geometry from the application's existing lighting preview, also seeded into the local demo organization. This is sample data, not a claimed real LiDAR capture.

Remotion's MCP was not exposed in this session. This project uses Remotion 4.0.521 directly via its CLI and the installed Remotion skill.

The local app required a routing fix before capture: `proxy.ts` now retains the canonical organization path on a second internal rewrite pass. Regression coverage is in `../tests/proxy-rewrite-context.test.mjs`.
