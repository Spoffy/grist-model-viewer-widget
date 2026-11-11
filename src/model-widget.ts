// The transcoder location must be in place before the bundle defines the element - see mv-config.
import { KTX2_TRANSCODER_LOCATION } from './mv-config';
import '@google/model-viewer/dist/model-viewer.min.js';

const elementConstructor = customElements.get('model-viewer') as
  | (CustomElementConstructor & { ktx2TranscoderLocation?: string })
  | undefined;
if (elementConstructor) {
  elementConstructor.ktx2TranscoderLocation = KTX2_TRANSCODER_LOCATION;
}

export interface Annotation {
  id: string;
  position: [number, number, number];
  normal: [number, number, number];
  text: string;
}

export interface ManifestMaterial {
  baseColor?: string;
  normal?: string;
  metallicRoughness?: string;
  occlusion?: string;
  emissive?: string;
}

export interface Manifest {
  mesh: string;
  materials?: Record<string, ManifestMaterial>;
  annotations?: Annotation[];
}

export interface ModelWidgetOptions {
  /** Render the annotations a manifest declares. Default true. */
  manifestAnnotations?: boolean;
}

type Colorspace = 'srgb' | 'linear';

interface SlotSpec {
  key: keyof ManifestMaterial;
  colorspace: Colorspace;
  info(material: ModelViewerMaterial): ModelViewerTextureInfo;
}

// Swap order: the base colour carries most of the perceived detail, so it lands first.
const SLOTS: readonly SlotSpec[] = [
  {
    key: 'baseColor',
    colorspace: 'srgb',
    info: (material) => material.pbrMetallicRoughness.baseColorTexture,
  },
  {
    key: 'normal',
    colorspace: 'linear',
    info: (material) => material.normalTexture,
  },
  {
    key: 'metallicRoughness',
    colorspace: 'linear',
    info: (material) => material.pbrMetallicRoughness.metallicRoughnessTexture,
  },
  {
    key: 'occlusion',
    colorspace: 'linear',
    info: (material) => material.occlusionTexture,
  },
  {
    key: 'emissive',
    colorspace: 'srgb',
    info: (material) => material.emissiveTexture,
  },
];

interface Run {
  generation: number;
  manifest?: Manifest;
  manifestUrl?: string;
}

const DOT_STYLE =
  'width: 12px; height: 12px; border-radius: 50%; box-sizing: border-box;' +
  'background: #fff; border: 2px solid #333;';

const LABEL_STYLE =
  'position: absolute; left: 16px; top: -7px; max-width: 240px; overflow-wrap: break-word;' +
  'padding: 2px 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.72);' +
  'color: #fff; font: 16px/1.4 sans-serif;';

const REMOVE_STYLE =
  'margin: 0 -2px 0 6px; padding: 0; border: 0; background: none; color: inherit;' +
  'font: inherit; line-height: 1; cursor: pointer;';

const INPUT_STYLE =
  'width: 10em; padding: 0; border: 0; border-bottom: 1px solid currentColor;' +
  'background: none; color: inherit; font: inherit; outline: none;';

// Below this many pixels of travel a drag is a click, which must leave the annotation where it is.
const DRAG_THRESHOLD = 4;

function isManifestUrl(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0] ?? '';
  return pathname.toLowerCase().endsWith('.json');
}

function formatPosition(value: readonly [number, number, number]): string {
  return `${value[0]}m ${value[1]}m ${value[2]}m`;
}

function formatNormal(value: readonly [number, number, number]): string {
  return `${value[0]} ${value[1]} ${value[2]}`;
}

/**
 * Renders a model into a container, upgrading it from a low-resolution mesh to full-resolution
 * textures when the manifest describes them. Work is deferred until the container is near the
 * viewport.
 *
 * Dispatches on the container, bubbling and composed: `first-render` once pixels are on screen,
 * `texture-error` with `{slot, url}` per texture that could not be loaded, `full-resolution` with
 * `{failed}` once every texture has been applied or given up on, `annotation-add` with
 * `{position, normal}` when a click lands on the model in annotation mode, and `annotation-edit`,
 * `annotation-remove` and `annotation-move` when an externally supplied annotation is changed
 * through its hotspot.
 */
export class ModelWidget {
  private readonly container: HTMLElement;
  private element?: ModelViewerElement;
  private message?: HTMLElement;
  private observer?: IntersectionObserver;
  private url?: string;
  private activated = false;
  private destroyed = false;
  // Bumped by every reset so that a texture or manifest still in flight from a previous model
  // cannot apply itself to the current one.
  private generation = 0;
  private run?: Run;
  private userAnnotations = 0;
  private readonly manifestAnnotations: boolean;
  private externalAnnotations?: readonly Annotation[];
  private rendered = false;
  private editing = false;
  private visible = true;
  private pointerDown?: { x: number; y: number };
  private dragging = false;
  private closeEditor?: (commit: boolean) => void;

  constructor(container: HTMLElement, options?: ModelWidgetOptions) {
    this.container = container;
    this.manifestAnnotations = options?.manifestAnnotations ?? true;
  }

  /**
   * While true, a click on the model adds a hotspot and raises `annotation-add`, and every
   * externally supplied hotspot carries its editing controls. Setting it redraws those hotspots.
   */
  get annotationMode(): boolean {
    return this.editing;
  }

  set annotationMode(value: boolean) {
    if (value === this.editing) {
      return;
    }
    this.editing = value;
    if (this.rendered) {
      this.renderExternalHotspots();
    }
  }

  /**
   * While false, every hotspot is hidden, whatever its source, and hotspots drawn later stay
   * hidden too. Default true.
   */
  get annotationsVisible(): boolean {
    return this.visible;
  }

  set annotationsVisible(value: boolean) {
    if (value === this.visible) {
      return;
    }
    this.visible = value;
    for (const hotspot of this.element?.querySelectorAll('[slot^="hotspot"]') ?? []) {
      (hotspot as HTMLElement).style.display = value ? '' : 'none';
    }
  }

  /** Loads a .glb/.gltf URL or a manifest .json URL. Loading the current URL again is a no-op. */
  load(url: string): void {
    if (this.destroyed || url === this.url) {
      return;
    }
    this.url = url;
    this.generation += 1;
    this.run = undefined;
    this.userAnnotations = 0;
    this.externalAnnotations = undefined;
    this.rendered = false;
    this.clearMessage();
    this.removeHotspots();

    if (this.activated) {
      void this.start(this.generation);
    } else if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) {
            return;
          }
          this.observer?.disconnect();
          this.observer = undefined;
          this.activated = true;
          void this.start(this.generation);
        },
        { rootMargin: '200px' },
      );
      this.observer.observe(this.container);
    }
  }

  /**
   * Replaces every externally supplied annotation, and any hotspot a click has just added, with
   * hotspots for the given list. Taking effect does not depend on the model having loaded: a list
   * given before then is rendered once it has.
   */
  setAnnotations(annotations: readonly Annotation[]): void {
    this.externalAnnotations = annotations;
    if (this.rendered) {
      this.renderExternalAnnotations();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.generation += 1;
    this.rendered = false;
    this.observer?.disconnect();
    this.observer = undefined;
    // <model-viewer> disposes its scene and GPU resources when it leaves the DOM.
    this.element?.remove();
    this.element = undefined;
    this.clearMessage();
    this.run = undefined;
  }

  private stale(generation: number): boolean {
    return this.destroyed || generation !== this.generation;
  }

  private async start(generation: number): Promise<void> {
    const url = this.url;
    if (!url || this.stale(generation)) {
      return;
    }

    let manifest: Manifest | undefined;
    let manifestUrl: string | undefined;
    if (isManifestUrl(url)) {
      manifestUrl = new URL(url, document.baseURI).href;
      try {
        const response = await fetch(manifestUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        manifest = (await response.json()) as Manifest;
      } catch (error) {
        if (this.stale(generation)) {
          return;
        }
        console.warn(`Could not load manifest ${manifestUrl}`, error);
        // Dropping the URL is what leaves the failure retryable - loading the same one again
        // would otherwise be taken for a no-op.
        this.url = undefined;
        this.showMessage('Could not load the model manifest');
        return;
      }
      if (this.stale(generation)) {
        return;
      }
    }

    const element = this.ensureElement();
    this.run = { generation, manifest, manifestUrl };
    element.setAttribute('src', manifest ? new URL(manifest.mesh, manifestUrl).href : url);
  }

  private ensureElement(): ModelViewerElement {
    if (this.element) {
      return this.element;
    }
    const element = document.createElement('model-viewer') as ModelViewerElement;
    element.setAttribute('camera-controls', '');
    element.style.width = '100%';
    element.style.height = '100%';
    element.addEventListener('load', this.handleLoad);
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('click', this.handleClick);
    this.container.append(element);
    this.element = element;
    return element;
  }

  private handleLoad = (): void => {
    const run = this.run;
    if (!run || this.stale(run.generation)) {
      return;
    }
    this.rendered = true;
    this.dispatch('first-render');
    if (this.manifestAnnotations) {
      for (const annotation of run.manifest?.annotations ?? []) {
        this.addHotspot(
          annotation.id,
          formatPosition(annotation.position),
          formatNormal(annotation.normal),
          annotation.text,
        );
      }
    }
    this.renderExternalAnnotations();
    if (!run.manifest) {
      this.dispatch('full-resolution', { failed: 0 });
      return;
    }
    void this.swapTextures(run);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private handleClick = (event: MouseEvent): void => {
    if (!this.editing || !this.element) {
      return;
    }
    // The browser fires a click at the end of an orbit drag as well as on a tap, and the camera
    // controls do not suppress it, so travel since pointerdown is all that separates the two.
    const down = this.pointerDown;
    if (
      down &&
      (Math.abs(event.clientX - down.x) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - down.y) > DRAG_THRESHOLD)
    ) {
      return;
    }
    // positionAndNormalFromPoint takes client coordinates, not page or element-relative ones.
    const hit = this.element.positionAndNormalFromPoint(event.clientX, event.clientY);
    if (!hit) {
      return;
    }
    this.userAnnotations += 1;
    const index = this.userAnnotations;
    this.addHotspot(
      `user-${index}`,
      hit.position.toString(),
      hit.normal.toString(),
      `Annotation ${index}`,
    );
    this.dispatch('annotation-add', {
      position: { x: hit.position.x, y: hit.position.y, z: hit.position.z },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    });
  };

  private async swapTextures(run: Run): Promise<void> {
    const element = this.element;
    if (!element) {
      return;
    }
    const materials = run.manifest?.materials ?? {};
    // setTexture mutates the underlying three texture's colorspace globally, so one created
    // instance may be shared only between slots of the same colorspace class. Keying the cache by
    // class as well as URL means a file used by both classes is created twice, which the HTTP
    // cache makes cheap.
    const textures = new Map<string, ModelViewerTexture | null>();
    let failed = 0;

    for (const [name, slots] of Object.entries(materials)) {
      const material = element.model?.getMaterialByName(name);
      if (!material) {
        console.warn(`Manifest names material "${name}", which the model does not have.`);
        continue;
      }
      for (const slot of SLOTS) {
        const path = slots[slot.key];
        if (!path) {
          continue;
        }
        const url = new URL(path, run.manifestUrl).href;
        const key = `${slot.colorspace}\n${url}`;
        let texture = textures.get(key);
        if (texture === undefined) {
          try {
            texture = await element.createTexture(url);
          } catch (error) {
            console.warn(`Could not load texture ${url}`, error);
            texture = null;
          }
          if (this.stale(run.generation)) {
            return;
          }
          textures.set(key, texture);
        }
        if (texture === null) {
          failed += 1;
          this.dispatch('texture-error', { slot: slot.key, url });
          continue;
        }
        slot.info(material).setTexture(texture);
      }
    }

    if (this.stale(run.generation)) {
      return;
    }
    this.dispatch('full-resolution', { failed });
  }

  /**
   * Draws one hotspot. `externalId` marks it as backed by a row in the caller's own store, which
   * is what the editing controls report changes against; hotspots without one are never editable.
   */
  private addHotspot(
    id: string,
    position: string,
    normal: string,
    text: string,
    externalId?: string,
  ): void {
    if (!this.element) {
      return;
    }
    const hotspot = document.createElement('div');
    hotspot.slot = `hotspot-${id}`;
    hotspot.dataset.position = position;
    hotspot.dataset.normal = normal;
    hotspot.style.cssText = DOT_STYLE;
    if (!this.visible) {
      hotspot.style.display = 'none';
    }
    // The hotspot sits over the canvas and its events reach <model-viewer> by bubbling, where they
    // would orbit the camera and, in annotation mode, stack a new annotation behind this one.
    hotspot.addEventListener('pointerdown', (event) => event.stopPropagation());
    hotspot.addEventListener('click', (event) => event.stopPropagation());

    const label = document.createElement('div');
    label.style.cssText = LABEL_STYLE;
    const caption = document.createElement('span');
    caption.textContent = text;
    label.append(caption);
    hotspot.append(label);

    if (externalId !== undefined && this.editing) {
      caption.style.cursor = 'text';
      caption.addEventListener('click', () => this.edit(label, text, externalId));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Delete';
      remove.textContent = '×';
      remove.style.cssText = REMOVE_STYLE;
      remove.addEventListener('click', () => {
        this.dispatch('annotation-remove', { id: externalId });
      });
      label.append(remove);

      hotspot.style.cursor = 'move';
      hotspot.addEventListener('pointerdown', (event) => {
        // Only the dot is the drag handle; the label carries its own controls.
        if (event.button === 0 && event.target === hotspot) {
          this.drag(hotspot, externalId, event);
        }
      });
    }

    this.element.append(hotspot);
  }

  private edit(label: HTMLElement, text: string, externalId: string): void {
    const hidden = [...label.children] as HTMLElement[];
    const input = document.createElement('input');
    input.value = text;
    input.style.cssText = INPUT_STYLE;
    for (const child of hidden) {
      child.style.display = 'none';
    }
    label.append(input);
    input.focus();
    input.select();

    let closed = false;
    const close = (commit: boolean): void => {
      if (closed) {
        return;
      }
      closed = true;
      if (this.closeEditor === close) {
        this.closeEditor = undefined;
      }
      const value = input.value;
      input.remove();
      for (const child of hidden) {
        child.style.display = '';
      }
      if (commit && value !== text) {
        this.dispatch('annotation-edit', { id: externalId, text: value });
      }
    };

    input.addEventListener('keydown', (event) => {
      // <model-viewer> steers the camera with the arrow keys, which belong to the field here.
      event.stopPropagation();
      if (event.key === 'Enter') {
        close(true);
      } else if (event.key === 'Escape') {
        close(false);
      }
    });
    input.addEventListener('blur', () => close(true));
    this.closeEditor = close;
  }

  private drag(hotspot: HTMLElement, externalId: string, start: PointerEvent): void {
    // A second pointer landing on another hotspot would otherwise run a second drag whose
    // listeners answer to the same pointer events as this one.
    if (this.dragging) {
      return;
    }
    this.dragging = true;
    const slot = hotspot.slot;
    const origin = {
      position: hotspot.dataset.position ?? '',
      normal: hotspot.dataset.normal ?? '',
    };
    let hit: ModelViewerHit | undefined;
    let moved = false;

    const move = (event: PointerEvent): void => {
      if (
        Math.abs(event.clientX - start.clientX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - start.clientY) > DRAG_THRESHOLD
      ) {
        moved = true;
      }
      const point = this.element?.positionAndNormalFromPoint(event.clientX, event.clientY);
      // A pointer that has wandered off the mesh holds the hotspot at the last point that was on
      // it, rather than sending it somewhere no surface reaches.
      if (!point) {
        return;
      }
      hit = point;
      this.element?.updateHotspot({
        name: slot,
        position: point.position.toString(),
        normal: point.normal.toString(),
      });
    };

    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      this.dragging = false;
      if (hotspot.hasPointerCapture(start.pointerId)) {
        hotspot.releasePointerCapture(start.pointerId);
      }
      if (!commit || !moved || !hit) {
        // Slot names are reused across redraws, so once this hotspot is gone the slot belongs to
        // whichever hotspot replaced it and must not be moved to this drag's origin.
        if (hotspot.isConnected) {
          this.element?.updateHotspot({ name: slot, ...origin });
        }
        return;
      }
      hotspot.dataset.position = hit.position.toString();
      hotspot.dataset.normal = hit.normal.toString();
      this.dispatch('annotation-move', {
        id: externalId,
        position: { x: hit.position.x, y: hit.position.y, z: hit.position.z },
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      });
    };

    const up = (): void => finish(true);
    const cancel = (): void => finish(false);
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        finish(false);
      }
    };

    // Removing an element releases its pointer capture implicitly and without firing
    // pointercancel, so listeners on the hotspot itself would never hear the gesture end if a
    // redraw took the hotspot away mid-drag. The capture is still wanted - it keeps the gesture
    // from being stolen by scrolling or by another element.
    hotspot.setPointerCapture(start.pointerId);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  }

  private renderExternalAnnotations(): void {
    for (const hotspot of this.element?.querySelectorAll('[slot^="hotspot-user-"]') ?? []) {
      hotspot.remove();
    }
    this.renderExternalHotspots();
  }

  private renderExternalHotspots(): void {
    // Whether removing a focused input commits or discards its value is left to the browser, so a
    // redraw discards an open edit itself rather than letting the removal decide.
    this.closeEditor?.(false);
    for (const hotspot of this.element?.querySelectorAll('[slot^="hotspot-ext-"]') ?? []) {
      hotspot.remove();
    }
    for (const annotation of this.externalAnnotations ?? []) {
      this.addHotspot(
        `ext-${annotation.id}`,
        formatPosition(annotation.position),
        formatNormal(annotation.normal),
        annotation.text,
        annotation.id,
      );
    }
  }

  private removeHotspots(): void {
    this.closeEditor?.(false);
    for (const hotspot of this.element?.querySelectorAll('[slot^="hotspot"]') ?? []) {
      hotspot.remove();
    }
  }

  private showMessage(text: string): void {
    if (!this.message) {
      this.message = document.createElement('div');
      this.message.style.cssText =
        'display: grid; place-items: center; width: 100%; height: 100%;' +
        'font: 14px sans-serif;';
      this.container.append(this.message);
    }
    this.message.textContent = text;
  }

  private clearMessage(): void {
    this.message?.remove();
    this.message = undefined;
  }

  private dispatch(type: string, detail?: unknown): void {
    this.container.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }
}
