// Sandboxed preload for the Mareo sign-in screen. It only exposes a single
// "submit this token" call to the page; validation and storage happen in the
// main process, so the renderer never touches the gateway directly.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mareo', {
  signIn: (token) => ipcRenderer.invoke('mareo:sign-in', token),
})
