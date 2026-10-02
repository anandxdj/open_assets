# OpenAssets — Assets, Unpacked

A complete 40-second product motion graphics showcase built with Remotion. 1920 × 1080, 30 fps, H.264 MP4 with an original synthesized stereo soundtrack and UI sound effects.

## Run

```sh
npm ci
npm run prepare-assets
npm run studio
npm run render
```

The source archive includes the soundtrack and logo. The GitHub branch keeps generated media out of Git; its `prepare-assets` command copies the repository logo and generates the audio. For that step, install Python 3 and NumPy. To regenerate the soundtrack directly, run `python3 make_audio.py` from the project directory.

## Storyboard

| Time | Scene | What the viewer sees |
|---|---|---|
| 0–5 s | One image. Every asset. | A packed sheet opens into six independent assets. |
| 5–10 s | Drop it in. | A sheet lands in the upload interface. |
| 10–17 s | Detected. Refined. | Detection boxes appear; a cursor adjusts a crop. |
| 17–24 s | AI naming | Generic filenames become semantic filenames; transparency is illustrated. |
| 24–31 s | One ZIP | Selected assets assemble into a downloadable pack. |
| 31–35 s | Collections | Assets appear in a published collection; access surfaces are listed. |
| 35–40 s | Less slicing. More creating. | Brand close and the actual public repository URL. |

## Product grounding and representation

Repository: https://github.com/anandxdj/open_assets

Inspected source commit: `af1229dbe623edc2621af20d4982aa5b4ebe6e5b`.

This is an animated workflow demonstration based on the repository, not a recording of a live extraction session. Scene timing is editorial pacing, not a performance benchmark. The six illustrated RPG assets are product demo items, not guaranteed detection results.

The original OA logo comes from `frontend/public/assets/logo.png`. The six SVG paths, colors, and example filenames come from `frontend/src/components/landing/DashboardSimulator.tsx`. Black/white and orange accents follow the current interface code. Upload/editor/export labels are grounded in `UploadCleanConsole.tsx`, `AssetPanel.tsx`, and the README.

Transparent PNGs and semantic naming depict the Smart AI Export path. Raw Export preserves the original background and skips cloud naming. AI background removal/upscale require configured provider access and may incur provider charges. The video makes no speed, price, or quality guarantees. Features marked as coming soon are excluded.

The closing call to action uses the verified repository URL. Web app, Chrome extension, and REST API are documented and implemented access surfaces; their presence is not an uptime or live-service availability guarantee.

## Editable files

- `src/video.tsx`: layouts, shapes, motion, scene duration, and copy.
- `src/styles.css`: locally bundled fonts.
- `src/index.tsx`: video dimensions, frame rate, and total duration.
- `render.mjs`: still previews and final H.264 render.
- `make_audio.py`: deterministic original music and sound effects.
- `public/`: original logo and generated audio.

Typography is Inter and IBM Plex Mono, installed through Fontsource; see their bundled open-font licenses. Product logo ownership remains with the product owner. Product source-derived demo shapes retain applicable upstream rights.
