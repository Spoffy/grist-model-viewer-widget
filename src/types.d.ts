// TypeScript cannot resolve types for the dist bundle, which is the self-contained build with
// three.js inlined; the typed `lib` entry expects three.js as a separate dependency.
declare module '@google/model-viewer/dist/model-viewer.min.js';

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
};
