# grist-3d-widget

A Grist custom widget that renders a GLB model with [`<model-viewer>`](https://modelviewer.dev/).
It reads a URL from a mapped text column on the selected row and displays that model with camera
controls. The build is path-relative, so the `dist/` output can be served from any subdirectory,
such as GitHub Pages.

## Setup

```sh
npm install
npm run dev          # Dev server
npm run build        # Type-check and build into dist/
./scripts/fetch-fixtures.sh   # Download the sample model into demo/fixtures/
```

With the dev server running, the sample model is served at
`http://localhost:5173/demo/fixtures/lamp/AnisotropyBarnLamp.glb`.

## Adding it in Grist

1. Add a widget to a page, choose *Custom*, and select **Custom URL**.
2. Enter the URL the widget is served from (the page hosting `index.html`).
3. In the creator panel, map the **Model URL** column to the text column holding your `.glb` URLs.
4. Grant the widget read access to the table when prompted.

## grist-plugin-api.js

`public/grist-plugin-api.js` is a vendored copy of Grist's plugin API (Apache-2.0), taken from the
`@gristlabs/grist-widget` npm package. It is served from the widget's own origin so the widget
works against any Grist host, self-hosted included, with no third-party request at runtime. The
`grist-plugin-api` package on npm predates the custom widget API and does not provide it.

## Sample model

AnisotropyBarnLamp from [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets),
CC BY 4.0, (c) 2023 Wayfair, model and textures by Eric Chadwick.
