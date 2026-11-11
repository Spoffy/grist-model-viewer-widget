# grist-model-viewer-widget

> **Important note**: This repository was created using AI, and has not been curated or carefully reviewed. Please treat this widget as the experimental tool it is, and do not rely on it in documents where the data or workflow is critical. Thanks, and have fun!

A Grist custom widget that renders a 3D model from a URL held in a mapped column, and the
`ModelWidget` class it is built on, which is usable on its own in any page. Rendering is
[`<model-viewer>`](https://modelviewer.dev/) 4.4.0.

- A URL may point at a model or at a manifest. A manifest adds progressive loading: a small mesh
  renders first, then full-resolution textures replace its low-resolution ones one file at a time.
- The build is path-relative (`base: './'`), so `dist/` runs from any subdirectory, GitHub Pages
  included. A push to `main` deploys `dist/` to Pages through Actions - the repository's Pages
  source has to be set to **GitHub Actions** once.
- The widget makes no third-party request at runtime: `grist-plugin-api.js` is vendored and the
  Basis transcoder is self-hosted.

## Commands

| Command | Does |
| --- | --- |
| `npm install` | Installs `@google/model-viewer` 4.4.0, TypeScript and Vite. three.js is a declared devDependency and supplies the Basis transcoder. |
| `./scripts/fetch-fixtures.sh` | Populates `demo/fixtures/lamp/`. Needs `curl` and `npx`. |
| `npm run dev` | `predev` copies the transcoder, then Vite serves on `http://localhost:5173`. |
| `npm run build` | `prebuild` copies the transcoder, then `tsc --noEmit && vite build` writes `dist/`. The one entry is `index.html`. |
| `npm run preview` | Serves the existing `dist/`. Does not rebuild and does not copy the transcoder. |

Developed on Linux and macOS - `fetch-fixtures.sh` needs bash, so on Windows run it under WSL or
Git Bash.

`fetch-fixtures.sh` downloads `AnisotropyBarnLamp.glb` and three `.ktx2` textures from
glTF-Sample-Assets, derives `low.glb` from the glb with `@gltf-transform/cli@4.5.1`, and rewrites
`manifest.json` and `manifest-broken.json` on every run. Existing downloads are kept; the whole
directory is gitignored.

The demo page is `http://localhost:5173/demo/index.html`. It runs two widgets side by side - one
on `manifest.json`, one on `manifest-broken.json`, whose normal map is missing - each with an
annotation-mode toggle, over a log of the seven events. The build does not include it - it is
served by the dev server only, and `demo/fixtures/` is not under `public/` either.

## URL handling

The URL is split at the first `?` or `#`. If what remains ends in `.json`, case-insensitively, it
is fetched as a manifest. Anything else is passed to `<model-viewer>` as `src` unchanged, so any
format it accepts works.

Assets not served from the widget's own origin must send `Access-Control-Allow-Origin`. This
covers the manifest, the mesh and every texture.

## Manifest

```json
{
  "mesh": "low.glb",
  "materials": {
    "Lamp Metal": {
      "baseColor": "basecolor.ktx2",
      "normal": "normalbump.ktx2",
      "metallicRoughness": "occlusionroughnessmetal.ktx2",
      "occlusion": "occlusionroughnessmetal.ktx2",
      "emissive": "emissive.ktx2"
    }
  },
  "annotations": [
    { "id": "a1", "position": [0, 0.0569, 0.0008], "normal": [0, 0.576, -0.817],
      "text": "Sample annotation" }
  ]
}
```

- `mesh` is required. `materials` and `annotations` are optional.
- Every path, `mesh` included, resolves against the manifest's own URL.
- Material keys are exact glTF material names. All five slots are optional.
- A material the manifest does not name keeps the textures the mesh shipped with.
- A name the mesh does not have is skipped with a console warning.
- An annotation needs `id`, `position`, `normal` and `text`. `position` and `normal` are
  `[x, y, z]` in model space.

Swapping runs material by material, and within each material in slot order: `baseColor`, `normal`,
`metallicRoughness`, `occlusion`, `emissive` - one file at a time, each awaited before the next
starts. A texture that fails to load leaves the low-resolution one in place and raises
`texture-error`.

Slots fall into two colourspace classes: `baseColor` and `emissive` are sRGB, the other three are
linear. A file is fetched once per class it is used in, so the same file across two slots of one
class costs one request, and across both classes costs two (the second served from the HTTP cache).

## Events

Dispatched on the container element, bubbling and composed.

| Event | Detail | Fires |
| --- | --- | --- |
| `first-render` | - | The mesh has loaded and is on screen, before any texture swap. |
| `full-resolution` | `{failed}` | Every listed texture has been applied or given up on. For a non-manifest URL it follows `first-render` immediately with `failed: 0`. |
| `texture-error` | `{slot, url}` | Once per material slot whose texture could not be loaded. `slot` is the manifest key. |
| `annotation-add` | `{position, normal}` | A click in annotation mode hit the model. Both are `{x, y, z}` in model space. |
| `annotation-edit` | `{id, text}` | A hotspot's label was edited to a different value. `id` is the one the annotation was given to `setAnnotations`. |
| `annotation-remove` | `{id}` | A hotspot's delete button was pressed. |
| `annotation-move` | `{id, position, normal}` | A hotspot was dragged to a new point on the surface. Both are `{x, y, z}` in model space. |

The last three fire only for hotspots `setAnnotations` drew, never for a manifest's own or one a
click has just added. The widget does not apply them: an edited label and a deleted hotspot are
left as they were, and a dragged hotspot stays where it was dropped. The caller owns the
annotations and is expected to answer with `setAnnotations`.

## ModelWidget

`src/model-widget.ts`, no dependency on Grist.

| Member | Behaviour |
| --- | --- |
| `new ModelWidget(container, options?)` | `options.manifestAnnotations` (default `true`) controls whether a manifest's own annotations are drawn. |
| `load(url)` | Loads a model or manifest URL. Loading the current URL again is a no-op. Work is deferred until the container comes within 200px of the viewport. |
| `setAnnotations(list)` | Replaces every externally supplied hotspot, and any a click has just added, with hotspots for `list`. A list given before the model has loaded is drawn once it has. |
| `annotationMode` | Writable boolean. While true, a click on the model adds a hotspot and raises `annotation-add`, and every hotspot `setAnnotations` drew carries its editing controls: click its label to retype it, press its `×` to delete it, drag its dot across the surface to move it. Setting it redraws those hotspots, so the controls come and go at once. |
| `annotationsVisible` | Writable boolean, default `true`. While false every hotspot is hidden, whatever its source, and hotspots drawn later stay hidden too. Nothing else changes: the lists `load` and `setAnnotations` hold are untouched. |
| `destroy()` | Removes the `<model-viewer>` element, which releases its scene and GPU resources. The instance is dead afterwards. |

```ts
import { ModelWidget } from './src/model-widget';

const container = document.getElementById('viewer') as HTMLElement;
const widget = new ModelWidget(container);

container.addEventListener('full-resolution', (event) => {
  console.log((event as CustomEvent<{ failed: number }>).detail.failed);
});

widget.annotationMode = true;
widget.load('fixtures/lamp/manifest.json');
```

`demo/demo.ts` is a worked example.

## Grist

Add a widget to a page, choose *Custom*, select **Custom URL**, and enter the URL serving
`index.html`. In the creator panel map **Model URL** to the text column holding model or manifest
URLs.

The widget declares `requiredAccess: 'full'`. It writes to the `Annotations` table, which is not
the table it is mapped to, and per-table access does not reach it. Grist prompts on first load.

The widget reads and writes a table named `Annotations` but does not create it. Required columns:

| Column | Type | Holds |
| --- | --- | --- |
| `Model` | Ref to the model table | The row the annotation belongs to |
| `X`, `Y`, `Z` | Numeric | Position in model space |
| `NX`, `NY`, `NZ` | Numeric | Surface normal at that point |
| `Text` | Text | The label |

Set `Text` to a trigger formula applied to new records only, `f"Annotation {$id}"`. It names each
annotation as the row is created; because it does not run on updates, a label retyped afterwards
stays.

Untick **Show annotations** in the top-left corner to hide every hotspot and leave a plain viewer;
editing is disabled until it is ticked again.

Tick **Edit annotations** below it. The checkbox governs every editing affordance at
once - untick it and the widget is a plain viewer whose hotspots take no input.

| Gesture | Does |
| --- | --- |
| Click the model | Draws a hotspot immediately, then creates a row with the position and normal. `Text` is left to the trigger formula. |
| Click a hotspot's label | Opens a field on it. Enter or clicking away writes `Text`; Escape abandons the change, and so does leaving the text as it was. |
| Press a hotspot's `×` | Deletes the row. |
| Drag a hotspot's dot | Moves it over the surface and writes the new position and normal on release. A pointer that strays off the mesh holds it at the last point that was on it. A drag of a few pixels counts as a click and moves nothing, and Escape mid-drag puts it back. |

Each gesture is one Grist action, so one undo reverses one of them. After each, the widget re-reads
the table and redraws from it; a write that failed is logged to the console and the redraw happens
regardless, putting back what the table still holds.

A manifest's own annotations are not rendered in Grist; the table is the only source. Editing an
annotation's text in the grid, or deleting a row, does not re-render, because the plugin API only
pushes changes for the widget's mapped table. The change appears when the row selection changes or
when another annotation is edited in the viewer.

## Using your own assets

A plain model needs no manifest. Put the file in `public/`, where it is served at the root in dev
and copied into `dist/`, or on any host that sends `Access-Control-Allow-Origin`; then put its URL
in a row of the mapped column. Files elsewhere in the project are served at their path by the dev
server but are not copied into the build.

For progressive loading, build a low-resolution mesh and standalone full-resolution textures.
The mesh, as `fetch-fixtures.sh` does it:

```sh
npx -y @gltf-transform/cli@4.5.1 resize model.glb resized.glb --width 512 --height 512
npx -y @gltf-transform/cli@4.5.1 webp resized.glb low.glb
```

`resize` and `webp` are separate subcommands, hence the intermediate file. Pin the version: the
output is otherwise not reproducible across machines.

The textures, as UASTC with Zstd supercompression. The colourspace must match the slot - sRGB for
`baseColor` and `emissive`, linear for `normal`, `metallicRoughness` and `occlusion`:

```sh
toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap \
  --assign_oetf srgb basecolor.ktx2 basecolor.png
toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap \
  --assign_oetf linear normalbump.ktx2 normalbump.png
```

`toktx` ships in KTX-Software. On nix: `nix shell nixpkgs#ktx-tools`.

Write the manifest beside the files. Material names must match the glTF exactly - read them from
`npx @gltf-transform/cli inspect model.glb`. When a swap does not happen, listen for
`texture-error` and read the console: an unmatched material name and a texture that failed to load
are both warned about by name.

## KTX2 transcoder

`<model-viewer>` fetches the Basis transcoder from a Google CDN by default.
`scripts/copy-transcoders.mjs`, run by `predev` and `prebuild`, copies it out of the installed
three.js into `public/ktx2/` instead. `src/mv-config.ts` points the element at that copy; it must
be imported before the `<model-viewer>` bundle, because every constructor re-reads
`window.ModelViewerElement` and a later assignment silently leaves the CDN location in place. The
URL is derived from `import.meta.url`, so it follows the relative base.

The Draco decoder location is left at its default, so a Draco-compressed model would still fetch a
decoder from `gstatic.com`. Nothing in this repository is Draco-compressed.

## grist-plugin-api.js

`public/grist-plugin-api.js` is a vendored copy of Grist's plugin API (Apache-2.0), taken from the
`@gristlabs/grist-widget` npm package - the same bundle a Grist host serves at
`/grist-plugin-api.js`. Serving it from the widget's own origin means the widget works against any
Grist host, self-hosted included, with no third-party request at runtime. The `grist-plugin-api`
package on npm is not it: that is 0.0.1, published in 2018, predating the custom widget API.

Vendored on 2026-11-11 from `@gristlabs/grist-widget@0.0.7`, byte-identical to
`dist/plugins/grist-bundled/archive/docs.getgrist.com/grist-plugin-api.js` in that package.
sha256 `0f31ce5073f5fc7b521938fcb4afb1746a20e3ce03c8549d621655447d1d9d5c`.

The bundle calls `eval()`, as the build upstream ships does. Any Content-Security-Policy later put
on the widget's origin has to allow `'unsafe-eval'`.

## Sample model

AnisotropyBarnLamp from [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets),
CC BY 4.0, (c) 2023 Wayfair, model and textures by Eric Chadwick.
