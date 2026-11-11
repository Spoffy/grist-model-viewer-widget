// Every <model-viewer> constructor re-reads window.ModelViewerElement, so this module must be
// evaluated before the model-viewer bundle is imported; assigning later silently leaves the
// transcoder pointing at the gstatic CDN.
//
// In dev this module is served from /src/, which resolves to /ktx2/ (public/ is served at the
// root); in the build the chunk lands in <base>/assets/, which resolves to <base>/ktx2/.
export const KTX2_TRANSCODER_LOCATION = new URL('../ktx2/', import.meta.url).href;

window.ModelViewerElement = {
  ...window.ModelViewerElement,
  ktx2TranscoderLocation: KTX2_TRANSCODER_LOCATION,
};
