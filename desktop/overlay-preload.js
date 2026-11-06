'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('overlay:state', listener);
    return () => ipcRenderer.removeListener('overlay:state', listener);
  },
  onEdit: (callback) => {
    const listener = (_event, editing) => callback(Boolean(editing));
    ipcRenderer.on('overlay:edit', listener);
    return () => ipcRenderer.removeListener('overlay:edit', listener);
  },
  endEdit: () => ipcRenderer.send('overlay:end-edit'),
});
