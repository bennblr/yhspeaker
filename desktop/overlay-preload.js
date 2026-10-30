'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('overlay:state', listener);
    return () => ipcRenderer.removeListener('overlay:state', listener);
  },
});
