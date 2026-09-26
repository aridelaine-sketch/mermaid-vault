'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vault', {
  // Library persistence
  loadLibrary: () => ipcRenderer.invoke('store:load'),
  saveLibrary: (data) => ipcRenderer.invoke('store:save', data),

  // File dialogs / export
  saveText: (opts) => ipcRenderer.invoke('dialog:save-text', opts),
  saveBinary: (opts) => ipcRenderer.invoke('dialog:save-binary', opts),
  openJson: () => ipcRenderer.invoke('dialog:open-json'),
  exportPng: (opts) => ipcRenderer.invoke('export:png', opts),
  exportPdf: (opts) => ipcRenderer.invoke('export:pdf', opts),

  // Menu -> renderer events
  onMenu: (channel, cb) => {
    const allowed = ['menu:new-diagram', 'menu:export-library', 'menu:import-library'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, cb);
  }
});
