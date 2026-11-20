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
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  ai: {
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('ai:setConfig', patch),
    chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
    ocr: (payload) => ipcRenderer.invoke('ai:ocr', payload),
    probe: (opts) => ipcRenderer.invoke('ai:probe', opts || {}),
    abort: () => ipcRenderer.invoke('ai:abort'),
    onEvent: (cb) => ipcRenderer.on('ai:event', (_e, ev) => cb(ev))
  },

  gallery: {
    import: (opts) => ipcRenderer.invoke('gallery:import', opts || {}),
    list: () => ipcRenderer.invoke('gallery:list'),
    remove: (id) => ipcRenderer.invoke('gallery:remove', id),
    openFolder: () => ipcRenderer.invoke('gallery:openFolder')
  },

  snapshot: (name) => ipcRenderer.invoke('docs:snapshot', name)
});
