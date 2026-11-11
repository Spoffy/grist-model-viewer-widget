import '@google/model-viewer/dist/model-viewer.min.js';

const message = document.getElementById('message') as HTMLElement;

let viewer: HTMLElement | undefined;

function showMessage(text: string): void {
  message.textContent = text;
  viewer?.removeAttribute('src');
}

function showModel(url: string): void {
  if (!viewer) {
    viewer = document.createElement('model-viewer');
    viewer.setAttribute('camera-controls', '');
    document.body.append(viewer);
  }
  message.textContent = '';
  viewer.setAttribute('src', url);
}

grist.ready({
  requiredAccess: 'read table',
  columns: [
    {
      name: 'ModelURL',
      title: 'Model URL',
      type: 'Text',
      description: 'URL of a .glb model to display',
    },
  ],
});

grist.onRecord((record) => {
  // mapColumnNames returns null while the declared columns are not all mapped.
  const mapped = grist.mapColumnNames(record);
  if (!mapped) {
    showMessage('Map the Model URL column');
    return;
  }
  const url = mapped.ModelURL;
  if (typeof url !== 'string' || !url) {
    showMessage('No model URL in this row');
    return;
  }
  showModel(url);
});
