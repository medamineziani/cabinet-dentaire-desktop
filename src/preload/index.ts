import { contextBridge, ipcRenderer } from "electron";

// Seul pont entre l'interface et le système : un unique canal, aucune API Node exposée.
contextBridge.exposeInMainWorld("cabinet", {
  call: (path: string, input: unknown) => ipcRenderer.invoke("rpc", String(path), input),
});
