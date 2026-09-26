'use strict';
// Regenerates build/icon.png from build/icon.svg using Electron's own
// Chromium renderer, so contributors don't need rsvg-convert/Inkscape/etc.
// Run with: npx electron scripts/render-icon.js

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZE = 512;
const SRC = path.join(__dirname, '..', 'build', 'icon.svg');
const OUT = path.join(__dirname, '..', 'build', 'icon.png');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SRC, 'utf-8');
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:${SIZE}px;height:${SIZE}px;}
    svg{width:${SIZE}px;height:${SIZE}px;display:block;}
  </style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    webPreferences: { offscreen: true }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 150));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUT, image.toPNG());
  console.log('Wrote ' + OUT);
  app.quit();
});
