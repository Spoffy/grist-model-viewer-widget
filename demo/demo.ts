import { ModelWidget } from '../src/model-widget';

const EVENTS = [
  'first-render',
  'full-resolution',
  'texture-error',
  'annotation-add',
  'annotation-edit',
  'annotation-remove',
  'annotation-move',
];

const log = document.getElementById('log') as HTMLElement;

function stamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}`;
}

function append(side: string, type: string, detail: unknown): void {
  const payload = detail === null || detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  log.textContent += `[${stamp()}] ${side} ${type}${payload}\n`;
  log.scrollTop = log.scrollHeight;
}

function setUp(side: string, url: string): void {
  const container = document.getElementById(side) as HTMLElement;
  const toggle = document.getElementById(`${side}-annotate`) as HTMLInputElement;
  const widget = new ModelWidget(container);

  for (const type of EVENTS) {
    container.addEventListener(type, (event) => {
      append(side, type, (event as CustomEvent<unknown>).detail);
    });
  }
  toggle.addEventListener('change', () => {
    widget.annotationMode = toggle.checked;
  });
  widget.load(url);
}

setUp('left', 'fixtures/lamp/manifest.json');
setUp('right', 'fixtures/lamp/manifest-broken.json');
