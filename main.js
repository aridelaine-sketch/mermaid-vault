'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const SMOKE_TEST = process.env.MERMAID_VAULT_SMOKE_TEST === '1';

if (SMOKE_TEST && process.env.MERMAID_VAULT_SMOKE_USERDATA) {
  // Isolate test runs from any real library on the machine running the test.
  app.setPath('userData', process.env.MERMAID_VAULT_SMOKE_USERDATA);
}

const STORE_FILE = path.join(app.getPath('userData'), 'library.json');

const DEFAULT_LIBRARY = () => ({
  version: 1,
  // "All Diagrams" is a virtual view the renderer synthesizes on top of
  // this list — it is deliberately not a real folder here, so a fresh
  // library starts with zero user-visible folders to manage.
  folders: [],
  diagrams: []
});

let mainWindow = null;

/* ---------------------------------------------------------------------- *
 * Storage — a single JSON file under userData. No native modules, no
 * database engine to compile per-platform: this is what keeps the app a
 * pure-JS, trivially-portable AppImage/deb.
 * ---------------------------------------------------------------------- */

async function readLibrary() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.folders || !parsed.diagrams) throw new Error('malformed store');
    return parsed;
  } catch (err) {
    const fresh = DEFAULT_LIBRARY();
    await writeLibrary(fresh);
    return fresh;
  }
}

async function writeLibrary(data) {
  // Write to a temp file then rename, so a crash mid-write can never
  // corrupt the person's whole library.
  const tmp = STORE_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, STORE_FILE);
  return true;
}

/* ---------------------------------------------------------------------- *
 * Window
 * ---------------------------------------------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f1720',
    title: 'Mermaid Vault',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  Menu.setApplicationMenu(buildMenu());

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_evt, level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('render-process-gone', (_evt, details) => {
      console.error('[renderer-crash]', details);
    });
  }

  if (SMOKE_TEST) {
    mainWindow.webContents.once('did-finish-load', () => {
      runSmokeTestSequence(mainWindow).catch((err) => {
        console.error('SMOKE_TEST_FAIL', err);
        process.exitCode = 1;
      }).finally(() => app.quit());
    });
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Drives the actual renderer UI end-to-end (real clicks/inputs, not a
 * mocked test double) and captures screenshots + real export files at each
 * stage, so a build can be verified without a human at the keyboard.
 * Only ever runs when MERMAID_VAULT_SMOKE_TEST=1 is set by the test runner.
 */
async function runSmokeTestSequence(win) {
  const dir = process.env.MERMAID_VAULT_SMOKE_DIR || path.join(__dirname, 'smoke-out');
  const shots = path.join(dir, 'screenshots');
  fsSync.mkdirSync(shots, { recursive: true });

  const run = (js) => win.webContents.executeJavaScript(js, true);
  const snap = async (name) => {
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(shots, name), image.toPNG());
    console.log('SMOKE snap -> ' + name);
  };

  console.log('SMOKE step: empty library');
  await wait(300);
  await snap('01-empty-library.png');

  console.log('SMOKE step: open template gallery');
  await run(`document.querySelector('#new-diagram-btn').click(); true;`);
  await wait(150);
  await snap('02-template-gallery.png');

  console.log('SMOKE step: create flowchart diagram from template');
  await run(`document.querySelector('[data-template="flowchart"]').click(); true;`);
  await wait(500); // debounced live-preview render
  await snap('03-editor-live-preview.png');

  console.log('SMOKE step: exercise pan & zoom on the live preview');
  const panZoomResult = await run(`
    const preview = document.querySelector('#preview-render');
    const surface = document.querySelector('#preview-surface');
    const label = () => document.querySelector('#zoom-label').textContent;
    const t = () => preview.style.transform;
    const rect = surface.getBoundingClientRect();

    const initial = { t: t(), z: label() };

    document.querySelector('#zoom-in-btn').click();
    const afterZoomInBtn = { t: t(), z: label() };

    surface.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      bubbles: true, cancelable: true
    }));
    const afterWheel = { t: t(), z: label() };

    surface.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: rect.left + 60, clientY: rect.top + 60, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 150, clientY: rect.top + 110, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const afterPan = { t: t(), z: label() };

    JSON.stringify({ initial, afterZoomInBtn, afterWheel, afterPan });
  `);
  await wait(150);
  await snap('03b-panned-and-zoomed.png');

  const pz = JSON.parse(panZoomResult);
  console.log('SMOKE pan/zoom trace:', pz);
  const parsePct = (z) => parseInt(z, 10);
  if (parsePct(pz.afterZoomInBtn.z) <= parsePct(pz.initial.z)) throw new Error('Zoom-in button did not increase zoom%');
  if (pz.afterWheel.z === pz.afterZoomInBtn.z) throw new Error('Wheel event did not change zoom%');
  if (pz.afterPan.t === pz.afterWheel.t) throw new Error('Drag did not change the preview transform (pan had no effect)');

  await run(`document.querySelector('#zoom-fit-btn').click(); true;`);
  await wait(150);
  await snap('03c-fit-reset.png');
  const afterFit = await run(`document.querySelector('#zoom-label').textContent;`);
  console.log('SMOKE zoom after fit:', afterFit);

  console.log('SMOKE step: switch to Visual tab and verify the flowchart parsed');
  const visualEntry = await run(`
    document.querySelector('#tab-visual-btn').click();
    const nodeCount = document.querySelectorAll('#visual-canvas [data-node]').length;
    const edgeCount = document.querySelectorAll('#visual-canvas [data-edge]').length;
    const unsupportedShown = !document.querySelector('#visual-unsupported').classList.contains('hidden');
    JSON.stringify({ nodeCount, edgeCount, unsupportedShown });
  `);
  await wait(150);
  await snap('07-visual-tab-parsed.png');
  const ve = JSON.parse(visualEntry);
  console.log('SMOKE visual parse result:', ve);
  if (ve.unsupportedShown) throw new Error('Visual tab showed "unsupported" for our own flowchart template');
  if (ve.nodeCount !== 6) throw new Error('Expected 6 parsed nodes, got ' + ve.nodeCount);
  if (ve.edgeCount !== 7) throw new Error('Expected 7 parsed edges, got ' + ve.edgeCount);

  console.log('SMOKE step: add a node visually and connect it, then verify Mermaid regenerated');
  const addAndConnect = await run(`(async () => {
    const editor = document.querySelector('#visual-canvas');
    const wrapRect = editor.getBoundingClientRect();
    // Add a new node via double-click on empty canvas space, well clear of existing nodes.
    editor.dispatchEvent(new MouseEvent('dblclick', { clientX: wrapRect.left + 900, clientY: wrapRect.top + 120, bubbles: true }));
    await new Promise(r => setTimeout(r, 80));

    // Rename it via the floating label editor that should now be open.
    const input = document.querySelector('.visual-label-editor');
    const wasOpen = input && !input.classList.contains('hidden');
    if (input) {
      input.value = 'Notify team';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 80));

    // Connect the "Ship" node's handle to our new node by dragging.
    const shipHandle = document.querySelector('[data-handle="Ship"]');
    const newNodeGroup = Array.from(document.querySelectorAll('[data-node]')).pop();
    const handleRect = shipHandle.getBoundingClientRect();
    const targetRect = newNodeGroup.getBoundingClientRect();
    const startX = handleRect.left + handleRect.width / 2, startY = handleRect.top + handleRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2, endY = targetRect.top + targetRect.height / 2;
    shipHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: (startX+endX)/2, clientY: (startY+endY)/2, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: endX, clientY: endY, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: endX, clientY: endY, bubbles: true }));
    await new Promise(r => setTimeout(r, 80));

    return JSON.stringify({ wasOpen, code: document.querySelector('#code-input').value });
  })()`);
  await wait(150);
  await snap('08-visual-added-and-connected.png');
  const ac = JSON.parse(addAndConnect);
  console.log('SMOKE add+connect result, label editor was open:', ac.wasOpen);
  console.log('SMOKE regenerated code:\\n' + ac.code);
  if (!ac.wasOpen) throw new Error('Double-click on empty canvas did not open the label editor for the new node');
  if (!ac.code.includes('Notify team')) throw new Error('Regenerated Mermaid code does not contain the new node\u2019s label');
  if (!/Ship\([^)]*\)\s*-->\s*N\d+/.test(ac.code) && !ac.code.match(/Ship.*-->.*N\d+/)) {
    throw new Error('Regenerated Mermaid code does not show an edge from Ship to the new node:\\n' + ac.code);
  }

  console.log('SMOKE step: switch back to Source and confirm it matches');
  await run(`document.querySelector('#tab-source-btn').click(); true;`);
  await wait(100);
  await snap('09-back-to-source.png');

  console.log('SMOKE step: create a folder from inside the editor');
  await run(`document.querySelector('#add-folder-btn').click(); true;`);
  await wait(100);
  await run(`
    const input = document.querySelector('#folder-name-input');
    input.value = 'Architecture';
    document.querySelector('#folder-create-btn').click();
    true;
  `);
  await wait(150);

  console.log('SMOKE step: fill in title, description, tags, folder, favorite');
  await run(`
    const title = document.querySelector('#title-input');
    title.value = 'Order fulfillment flow';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector('#info-btn').click();

    const desc = document.querySelector('#desc-input');
    desc.value = 'How an order moves from cart to shipment. Added by the automated smoke test.';
    desc.dispatchEvent(new Event('input', { bubbles: true }));

    const opts = Array.from(document.querySelectorAll('#folder-select option')).filter(o => o.value);
    const folderSelect = document.querySelector('#folder-select');
    folderSelect.value = opts[opts.length - 1].value;
    folderSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const tagInput = document.querySelector('#tag-input');
    for (const tag of ['ops', 'reviewed']) {
      tagInput.value = tag;
      tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    document.querySelector('#favorite-btn').click();
    true;
  `);
  await wait(200);
  await snap('04-editor-with-details.png');

  console.log('SMOKE step: export PNG / SVG / PDF');
  const exportsDir = process.env.MERMAID_VAULT_SMOKE_EXPORTS;
  for (const format of ['png', 'svg', 'pdf']) {
    await run(`
      document.querySelector('#export-btn').click();
      document.querySelector('[data-format="${format}"]').click();
      true;
    `);
    await wait(format === 'pdf' ? 900 : 300);
  }

  console.log('SMOKE step: add two more diagrams for a populated library');
  for (const tplId of ['sequence', 'class']) {
    await run(`document.querySelector('#back-btn').click(); document.querySelector('#new-diagram-btn').click(); true;`);
    await wait(120);
    await run(`document.querySelector('[data-template="${tplId}"]').click(); true;`);
    await wait(400);
  }
  await run(`document.querySelector('#back-btn').click(); true;`);
  await wait(600); // let all three thumbnails finish rendering
  await snap('05-library-populated.png');

  console.log('SMOKE step: filter by tag');
  await run(`
    const item = Array.from(document.querySelectorAll('#tag-list [data-tag]')).find(x => x.dataset.tag === 'ops');
    if (item) item.click();
    true;
  `);
  await wait(200);
  await snap('06-tag-filtered.png');

  console.log('SMOKE step: verify exported files on disk');
  const fileList = fsSync.readdirSync(exportsDir);
  console.log('SMOKE exported files:', fileList);
  const png = fileList.find((f) => f.endsWith('.png'));
  const svg = fileList.find((f) => f.endsWith('.svg'));
  const pdf = fileList.find((f) => f.endsWith('.pdf'));
  if (!png || !svg || !pdf) throw new Error('One or more export formats did not produce a file: ' + JSON.stringify({ png, svg, pdf }));

  const pngHead = fsSync.readFileSync(path.join(exportsDir, png)).subarray(0, 8);
  if (pngHead[0] !== 0x89 || pngHead[1] !== 0x50) throw new Error('PNG file does not have a valid PNG signature');
  const svgText = fsSync.readFileSync(path.join(exportsDir, svg), 'utf-8');
  if (!svgText.includes('<svg')) throw new Error('SVG file does not contain an <svg> element');
  const pdfHead = fsSync.readFileSync(path.join(exportsDir, pdf)).subarray(0, 5).toString('latin1');
  if (pdfHead !== '%PDF-') throw new Error('PDF file does not have a valid PDF signature');

  console.log('SMOKE_TEST_OK all steps passed');
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Diagram', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu:new-diagram') },
        { type: 'separator' },
        { label: 'Export Library Backup (JSON)…', click: () => mainWindow.webContents.send('menu:export-library') },
        { label: 'Import Library Backup (JSON)…', click: () => mainWindow.webContents.send('menu:import-library') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Mermaid Syntax Reference',
          click: () => shell.openExternal('https://mermaid.js.org/intro/syntax-reference.html')
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

/* ---------------------------------------------------------------------- *
 * IPC — the only surface the renderer can reach (see preload.js)
 * ---------------------------------------------------------------------- */

ipcMain.handle('store:load', async () => readLibrary());
ipcMain.handle('store:save', async (_evt, data) => writeLibrary(data));

// In smoke-test mode there is no human to click through a native save
// dialog, so we resolve straight to a fixed export directory instead of
// calling dialog.showSaveDialog. Real end users never hit this branch.
const SMOKE_EXPORT_DIR = process.env.MERMAID_VAULT_SMOKE_EXPORTS;

async function resolveSavePath(defaultPath) {
  if (SMOKE_TEST && SMOKE_EXPORT_DIR) {
    return { canceled: false, filePath: path.join(SMOKE_EXPORT_DIR, path.basename(defaultPath)) };
  }
  return dialog.showSaveDialog(mainWindow, { defaultPath });
}

ipcMain.handle('dialog:save-text', async (_evt, { defaultPath, content }) => {
  const { canceled, filePath } = await resolveSavePath(defaultPath);
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, content, 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('dialog:save-binary', async (_evt, { defaultPath, buffer }) => {
  const { canceled, filePath } = await resolveSavePath(defaultPath);
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, Buffer.from(buffer));
  return { ok: true, filePath };
});

ipcMain.handle('dialog:open-json', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Mermaid Vault Backup', extensions: ['json'] }]
  });
  if (canceled || !filePaths[0]) return { ok: false };
  const content = await fs.readFile(filePaths[0], 'utf-8');
  return { ok: true, content };
});

/**
 * PNG export: mermaid diagrams (flowcharts especially) render labels via
 * <foreignObject> HTML, which taints a 2D <canvas> when rasterized in the
 * renderer (a Chromium security restriction, not a bug we can configure
 * away). So instead of canvas.toBlob(), we do what the PDF export already
 * does: lay the SVG out in a hidden window sized to the target resolution
 * and screenshot the compositor output directly.
 */
ipcMain.handle('export:png', async (_evt, { svgMarkup, width, height, defaultPath }) => {
  const scale = 2; // crisp on hi-dpi displays
  const w = Math.max(1, Math.round((width || 800) * scale));
  const h = Math.max(1, Math.round((height || 600) * scale));

  const shotWin = new BrowserWindow({
    show: false,
    width: w,
    height: h,
    useContentSize: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true }
  });

  const html = `<!doctype html><html><head><style>
    html, body { margin: 0; padding: 0; background: #f6f3ea; }
    .frame { width: ${w}px; height: ${h}px; display: flex; align-items: center; justify-content: center; }
    /* Mermaid embeds an inline style="max-width: ...px" on the root <svg>
       for responsive embedding elsewhere; !important is required here to
       override that inline style and actually render at export resolution. */
    svg { width: ${w}px !important; height: ${h}px !important; max-width: none !important; }
  </style></head><body><div class="frame">${svgMarkup}</div></body></html>`;

  try {
    await shotWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 100));
    const image = await shotWin.webContents.capturePage();

    const { canceled, filePath } = await resolveSavePath(defaultPath);
    if (canceled || !filePath) return { ok: false };
    await fs.writeFile(filePath, image.toPNG());
    return { ok: true, filePath };
  } finally {
    shotWin.destroy();
  }
});

/**
 * PDF export: mermaid's SVG has no notion of "pages", so we open a hidden
 * window with just the diagram laid out on a printable canvas, let Chromium
 * paginate it, and hand the resulting buffer back to the renderer to save.
 */
ipcMain.handle('export:pdf', async (_evt, { svgMarkup, title, defaultPath }) => {
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true }
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 18mm; }
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .frame { max-width: 100%; }
    svg { max-width: 100%; height: auto; }
    h1 { font: 600 16px/1.4 system-ui, sans-serif; color: #1f2e3a; text-align: center; }
  </style></head>
  <body><div class="frame"><h1>${escapeHtml(title)}</h1>${svgMarkup}</div></body></html>`;

  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: false
    });

    const { canceled, filePath } = await resolveSavePath(defaultPath);
    if (canceled || !filePath) return { ok: false };
    await fs.writeFile(filePath, pdfBuffer);
    return { ok: true, filePath };
  } finally {
    printWin.destroy();
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------------- *
 * App lifecycle
 * ---------------------------------------------------------------------- */

app.whenReady().then(() => {
  if (!fsSync.existsSync(app.getPath('userData'))) {
    fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
