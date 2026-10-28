'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('la2speak', {
  isDesktop: true,
  platform: process.platform,
  setPttKey: (accelerator) => ipcRenderer.invoke('ptt:set-key', accelerator),
  onPtt: (callback) => {
    const listener = (_event, down) => callback(Boolean(down));
    ipcRenderer.on('ptt', listener);
    return () => ipcRenderer.removeListener('ptt', listener);
  },
  setBroadcastKeys: (bindings) => ipcRenderer.invoke('broadcast:set-keys', bindings),
  onBroadcastToggle: (callback) => {
    const listener = (_event, target) => callback(String(target));
    ipcRenderer.on('broadcast:toggle', listener);
    return () => ipcRenderer.removeListener('broadcast:toggle', listener);
  },
  hotkeysAvailable: () => ipcRenderer.invoke('hotkeys:available'),
  changeServer: () => ipcRenderer.invoke('app:change-server'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (callback) => {
      const listener = (_event, maximized) => callback(Boolean(maximized));
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
});

contextBridge.exposeInMainWorld('launcher', {
  connect: (url) => ipcRenderer.invoke('launcher:connect', url),
  quit: () => ipcRenderer.invoke('launcher:quit'),
  currentUrl: () => ipcRenderer.invoke('launcher:current-url'),
  defaultDomain: () => ipcRenderer.invoke('launcher:default-domain'),
});
