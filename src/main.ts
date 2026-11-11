import { type Annotation, ModelWidget } from './model-widget';

interface Vector {
  x: number;
  y: number;
  z: number;
}

interface AnnotationAddDetail {
  position: Vector;
  normal: Vector;
}

interface AnnotationEditDetail {
  id: string;
  text: string;
}

interface AnnotationRemoveDetail {
  id: string;
}

interface AnnotationMoveDetail {
  id: string;
  position: Vector;
  normal: Vector;
}

const message = document.getElementById('message') as HTMLElement;
const viewer = document.getElementById('viewer') as HTMLElement;
const annotateLabel = document.getElementById('annotate-label') as HTMLElement;
const annotate = document.getElementById('annotate') as HTMLInputElement;
const showLabel = document.getElementById('show-label') as HTMLElement;
const show = document.getElementById('show') as HTMLInputElement;

let widget: ModelWidget | undefined;
let modelRowId: number | undefined;
let refreshTicket = 0;

/**
 * Applies both checkboxes to the widget. Editing hidden annotations means working blind, so while
 * they are hidden annotation mode is off and the editing checkbox is disabled at whatever it was
 * left; showing them again restores it.
 */
function applyAnnotationState(): void {
  annotate.disabled = !show.checked;
  if (!widget) {
    return;
  }
  widget.annotationsVisible = show.checked;
  widget.annotationMode = show.checked && annotate.checked;
}

function showMessage(text: string): void {
  message.textContent = text;
  showLabel.hidden = true;
  annotateLabel.hidden = true;
  widget?.destroy();
  widget = undefined;
  modelRowId = undefined;
}

function showModel(url: string): void {
  message.textContent = '';
  showLabel.hidden = false;
  annotateLabel.hidden = false;
  // In Grist the Annotations table is the only source of annotations, so a manifest's own are
  // left unrendered.
  widget ??= new ModelWidget(viewer, { manifestAnnotations: false });
  applyAnnotationState();
  widget.load(url);
}

function number(column: unknown[] | undefined, index: number): number {
  const value = column?.[index];
  return typeof value === 'number' ? value : 0;
}

function annotationsOf(table: Record<string, unknown[]>, rowId: number): Annotation[] {
  const annotations: Annotation[] = [];
  const ids = table.id ?? [];
  for (let index = 0; index < ids.length; index += 1) {
    if (table.Model?.[index] !== rowId) {
      continue;
    }
    const text = table.Text?.[index];
    annotations.push({
      id: String(ids[index]),
      position: [
        number(table.X, index),
        number(table.Y, index),
        number(table.Z, index),
      ],
      normal: [
        number(table.NX, index),
        number(table.NY, index),
        number(table.NZ, index),
      ],
      text: typeof text === 'string' ? text : '',
    });
  }
  return annotations;
}

async function refreshAnnotations(rowId: number): Promise<void> {
  refreshTicket += 1;
  const ticket = refreshTicket;
  let table: Record<string, unknown[]>;
  try {
    table = await grist.docApi.fetchTable('Annotations');
  } catch (error) {
    console.warn('Could not read the Annotations table', error);
    return;
  }
  // The fetch races with the cursor moving on, and with every other fetch in flight: a result
  // that arrives after the selection has changed describes the wrong model, and two fetches can
  // resolve in either order, so only the newest one issued may draw.
  if (ticket !== refreshTicket || rowId !== modelRowId || !widget) {
    return;
  }
  widget.setAnnotations(annotationsOf(table, rowId));
}

/**
 * Runs one write against the Annotations table and redraws from the table afterwards. The table is
 * the only source of truth, so a write that failed is redrawn over too, dropping whatever the
 * hotspot had already shown.
 */
async function writeAnnotation(
  failure: string,
  write: (rowId: number) => Promise<unknown>,
): Promise<void> {
  const rowId = modelRowId;
  if (rowId === undefined) {
    return;
  }
  try {
    await write(rowId);
  } catch (error) {
    console.warn(failure, error);
  }
  await refreshAnnotations(rowId);
}

show.addEventListener('change', applyAnnotationState);
annotate.addEventListener('change', applyAnnotationState);

viewer.addEventListener('annotation-add', (event) => {
  const detail = (event as CustomEvent<AnnotationAddDetail>).detail;
  void writeAnnotation('Could not save the annotation', (rowId) =>
    // Text is left out: a trigger formula on the column fills it when the row is created.
    grist.getTable('Annotations').create({
      fields: {
        Model: rowId,
        X: detail.position.x,
        Y: detail.position.y,
        Z: detail.position.z,
        NX: detail.normal.x,
        NY: detail.normal.y,
        NZ: detail.normal.z,
      },
    }),
  );
});

viewer.addEventListener('annotation-edit', (event) => {
  const detail = (event as CustomEvent<AnnotationEditDetail>).detail;
  void writeAnnotation('Could not save the annotation text', () =>
    grist.getTable('Annotations').update({
      id: Number(detail.id),
      fields: { Text: detail.text },
    }),
  );
});

viewer.addEventListener('annotation-remove', (event) => {
  const detail = (event as CustomEvent<AnnotationRemoveDetail>).detail;
  void writeAnnotation('Could not delete the annotation', () =>
    grist.getTable('Annotations').destroy(Number(detail.id)),
  );
});

viewer.addEventListener('annotation-move', (event) => {
  const detail = (event as CustomEvent<AnnotationMoveDetail>).detail;
  void writeAnnotation('Could not move the annotation', () =>
    grist.getTable('Annotations').update({
      id: Number(detail.id),
      fields: {
        X: detail.position.x,
        Y: detail.position.y,
        Z: detail.position.z,
        NX: detail.normal.x,
        NY: detail.normal.y,
        NZ: detail.normal.z,
      },
    }),
  );
});

grist.ready({
  // Writing to the Annotations table, which is not the table the widget is mapped to, needs
  // access to the whole document.
  requiredAccess: 'full',
  columns: [
    {
      name: 'ModelURL',
      title: 'Model URL',
      type: 'Text',
      description: 'URL of a .glb/.gltf model, or of a manifest .json describing one',
    },
  ],
});

grist.onRecord((record) => {
  // mapColumnNames returns null while the declared columns are not all mapped, and returns the
  // record unmapped while it has no column list at all - records can arrive before the ready
  // handshake has delivered one.
  const mapped = grist.mapColumnNames(record);
  if (!mapped || !('ModelURL' in mapped)) {
    showMessage('Map the Model URL column');
    return;
  }
  const url = mapped.ModelURL;
  if (typeof url !== 'string' || !url) {
    showMessage('No model URL in this row');
    return;
  }
  const switched = record.id !== modelRowId;
  modelRowId = record.id;
  showModel(url);
  // Two rows can name the same model, which makes the load a no-op and leaves the hotspots of the
  // row we came from standing - and the refresh below is not guaranteed to return a list.
  if (switched) {
    widget?.setAnnotations([]);
  }
  void refreshAnnotations(record.id);
});
