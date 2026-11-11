// TypeScript cannot resolve types for the dist bundle, which is the self-contained build with
// three.js inlined; the typed `lib` entry expects three.js as a separate dependency.
declare module '@google/model-viewer/dist/model-viewer.min.js';

// Hand-written subset of <model-viewer>'s scene-graph and hit-testing API, covering only what this
// widget calls.

/** Opaque handle returned by createTexture and accepted by TextureInfo.setTexture. */
interface ModelViewerTexture {
  readonly name: string;
}

interface ModelViewerTextureInfo {
  setTexture(texture: ModelViewerTexture | null): void;
}

interface ModelViewerMaterial {
  readonly name: string;
  readonly pbrMetallicRoughness: {
    readonly baseColorTexture: ModelViewerTextureInfo;
    readonly metallicRoughnessTexture: ModelViewerTextureInfo;
  };
  readonly normalTexture: ModelViewerTextureInfo;
  readonly occlusionTexture: ModelViewerTextureInfo;
  readonly emissiveTexture: ModelViewerTextureInfo;
}

interface ModelViewerVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  // Emits "Xm Ym Zm", the format data-position and data-normal parse.
  toString(): string;
}

interface ModelViewerHit {
  readonly position: ModelViewerVector3;
  readonly normal: ModelViewerVector3;
}

interface ModelViewerHotspotConfiguration {
  /** The full slot name, as in `hotspot-a1`. */
  name: string;
  position?: string;
  normal?: string;
}

interface ModelViewerElement extends HTMLElement {
  /** Undefined until a model has loaded. */
  readonly model?: {
    getMaterialByName(name: string): ModelViewerMaterial | null;
  };
  createTexture(uri: string): Promise<ModelViewerTexture>;
  positionAndNormalFromPoint(clientX: number, clientY: number): ModelViewerHit | null;
  /** data-position and data-normal are not observed, so a hotspot moves only through this. */
  updateHotspot(config: ModelViewerHotspotConfiguration): void;
}

interface Window {
  ModelViewerElement?: { ktx2TranscoderLocation?: string };
}

interface GristColumnSpec {
  name: string;
  title?: string;
  type?: string;
  description?: string;
  optional?: boolean;
  allowMultiple?: boolean;
}

interface GristReadySettings {
  requiredAccess?: 'none' | 'read table' | 'full';
  columns?: GristColumnSpec[];
}

type GristRecord = Record<string, unknown> & { id: number };

// Hand-written subset of the `grist` global exposed by grist-plugin-api.js, covering only the
// calls this widget makes.
declare const grist: {
  ready(settings: GristReadySettings): void;
  onRecord(callback: (record: GristRecord) => void): void;
  mapColumnNames(record: GristRecord): Record<string, unknown> | null;
  docApi: {
    /** Column-oriented: a parallel array per column, plus `id`. */
    fetchTable(tableId: string): Promise<Record<string, unknown[]>>;
  };
  getTable(tableId: string): {
    create(record: { fields: Record<string, number> }): Promise<{ id: number }>;
    update(record: { id: number; fields: Record<string, number | string> }): Promise<void>;
    destroy(recordId: number): Promise<void>;
  };
};
