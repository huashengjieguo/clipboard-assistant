const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipboardApp", {
  getState: () => ipcRenderer.invoke("get-state"),
  onStateUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state-updated", listener);
    return () => ipcRenderer.removeListener("state-updated", listener);
  },
  onNavigatePage: (callback) => {
    const listener = (_event, page) => callback(page);
    ipcRenderer.on("navigate-page", listener);
    return () => ipcRenderer.removeListener("navigate-page", listener);
  },
  copyHistoryItem: (id) => ipcRenderer.invoke("copy-history-item", id),
  deleteHistoryItem: (id) => ipcRenderer.invoke("delete-history-item", id),
  setFixedPosition: (id, position) => ipcRenderer.invoke("set-fixed-position", { id, position }),
  clearFixedPosition: (id) => ipcRenderer.invoke("clear-fixed-position", id),
  clearUnfixed: () => ipcRenderer.invoke("clear-unfixed"),
  importFile: () => ipcRenderer.invoke("import-file"),
  submitMultiline: (text) => ipcRenderer.invoke("submit-multiline", text),
  copyQueueItem: (id) => ipcRenderer.invoke("copy-queue-item", id),
  copyNextQueueItem: (mode) => ipcRenderer.invoke("copy-next-queue-item", mode),
  deleteQueueItem: (id) => ipcRenderer.invoke("delete-queue-item", id),
  updateSettings: (settings) => ipcRenderer.invoke("update-settings", settings),
  createGroupRecord: (payload) => ipcRenderer.invoke("create-group-record", payload),
  updateGroupRecord: (payload) => ipcRenderer.invoke("update-group-record", payload),
  deleteGroupRecord: (id) => ipcRenderer.invoke("delete-group-record", id),
  applyGroupRecord: (id) => ipcRenderer.invoke("apply-group-record", id),
  quitApp: () => ipcRenderer.invoke("quit-app")
});
