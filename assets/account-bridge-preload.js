// Preload for the window that hosts the DSH web UI. It exposes a tiny,
// namespaced account bridge that the DSH-side "Account" settings section uses.
// All gateway traffic happens in the main process, which holds the token; the
// renderer never sees credentials.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__mareoAccount', {
  getProfile: () => ipcRenderer.invoke('mareo:account:get'),
  updateName: (displayName) => ipcRenderer.invoke('mareo:account:update-name', displayName),
  signOut: () => ipcRenderer.invoke('mareo:account:sign-out'),
})

// The anonymous-statistics switch lives in the same settings section.
contextBridge.exposeInMainWorld('__mareoTelemetry', {
  get: () => ipcRenderer.invoke('mareo:telemetry:get'),
  set: (enabled) => ipcRenderer.invoke('mareo:telemetry:set', enabled),
})
