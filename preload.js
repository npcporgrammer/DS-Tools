'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  root: () => ipcRenderer.invoke('docs:root'),
  listDocs: () => ipcRenderer.invoke('docs:list'),
  readDoc: (name) => ipcRenderer.invoke('docs:read', name),
  writeDoc: (payload) => ipcRenderer.invoke('docs:write', payload),
  createDoc: (payload) => ipcRenderer.invoke('docs:create', payload),
  renameDoc: (payload) => ipcRenderer.invoke('docs:rename', payload),
  removeDoc: (name) => ipcRenderer.invoke('docs:remove', name),
  openDocsFolder: () => ipcRenderer.invoke('docs:openFolder'),
  openExportsFolder: () => ipcRenderer.invoke('exports:openFolder'),
  openPathRaw: (p) => ipcRenderer.invoke('shell:openPathRaw', p),
  exportPdf: (payload) => ipcRenderer.invoke('pdf:export', payload),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p)
});
