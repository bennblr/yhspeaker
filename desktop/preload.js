'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('la2speak', {
  isDesktop: true,
  platform: process.platform,
  setPttKey: (accelerator) => ipcRenderer.invoke('ptt:set-key', accelerator),
  setMicMode: (mode) => ipcRenderer.invoke('mic:set-mode', mode),
  setMicState: (state) => ipcRenderer.send('mic:state', state),
  setOverlayState: (state) => ipcRenderer.send('overlay:set-state', state),
  getOverlayConfig: () => ipcRenderer.invoke('overlay:get-config'),
  setOverlayConfig: (patch) => ipcRenderer.invoke('overlay:set-config', patch),
  onOverlayConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('overlay:config', listener);
    return () => ipcRenderer.removeListener('overlay:config', listener);
  },
  onPtt: (callback) => {
    const listener = (_event, down) => callback(Boolean(down));
    ipcRenderer.on('ptt', listener);
    return () => ipcRenderer.removeListener('ptt', listener);
  },
  onMicToggle: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('mic:toggle', listener);
    return () => ipcRenderer.removeListener('mic:toggle', listener);
  },
  setBroadcastKeys: (bindings) => ipcRenderer.invoke('broadcast:set-keys', bindings),
  onBroadcastToggle: (callback) => {
    const listener = (_event, target) => callback(String(target));
    ipcRenderer.on('broadcast:toggle', listener);
    return () => ipcRenderer.removeListener('broadcast:toggle', listener);
  },
  onBroadcastState: (callback) => {
    const listener = (_event, event) => {
      if (!event || typeof event.target !== 'string') return;
      callback({ target: event.target, active: Boolean(event.active) });
    };
    ipcRenderer.on('broadcast:state', listener);
    return () => ipcRenderer.removeListener('broadcast:state', listener);
  },
  hotkeysAvailable: () => ipcRenderer.invoke('hotkeys:available'),
  changeServer: () => ipcRenderer.invoke('app:change-server'),
  listServers: () => ipcRenderer.invoke('app:list-servers'),
  switchServer: (url) => ipcRenderer.invoke('app:switch-server', url),
  setServerName: (name) => ipcRenderer.invoke('app:set-server-name', name),
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
  servers: () => ipcRenderer.invoke('launcher:servers'),
});
