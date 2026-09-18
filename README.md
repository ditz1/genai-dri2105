# Hello world — ASCII in 3D

A Next.js App Router page with extruded Three.js text and a GPU ASCII postprocessing shader. The scene is rendered to a low-resolution texture, then each sampled brightness value selects a character from a generated glyph atlas.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. The page shows only the ASCII 3D text on a plain dark background. Move your pointer to tilt the text. Reduced-motion preferences are respected.

## Production

```sh
npm run build
npm start
```

Vercel uses the Next.js framework setting in `vercel.json`. The font is bundled locally with Three.js; the page makes no third-party asset requests.
