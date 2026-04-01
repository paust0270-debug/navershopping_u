const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engineApi", {
  getPaths: () => ipcRenderer.invoke("get-paths"),
  loadEngineConfig: () => ipcRenderer.invoke("load-engine-config"),
  saveEngineConfig: (data) => ipcRenderer.invoke("save-engine-config", data),
  saveTaskRowsText: (rows) => ipcRenderer.invoke("save-task-rows-text", rows),
  loadTaskRowsText: () => ipcRenderer.invoke("load-task-rows-text"),
  writeTaskFile: (task) => ipcRenderer.invoke("write-task-file", task),
  readLastResult: () => ipcRenderer.invoke("read-last-result"),
  saveResultsTable: (rows) => ipcRenderer.invoke("save-results-table", rows),
  taskFileExists: () => ipcRenderer.invoke("task-file-exists"),
  runnerStart: (opts) => ipcRenderer.invoke("runner-start", opts),
  runnerStop: () => ipcRenderer.invoke("runner-stop"),
  runnerStatus: () => ipcRenderer.invoke("runner-status"),
  onRunnerLog: (fn) => {
    ipcRenderer.on("runner-log", (_e, p) => fn(p));
  },
  onRunnerExit: (fn) => {
    ipcRenderer.on("runner-exit", (_e, p) => fn(p));
  },
  // Auth
  authLogin: (email, password) => ipcRenderer.invoke("auth-login", { email, password }),
  authLogout: () => ipcRenderer.invoke("auth-logout"),
  getAuthUser: () => ipcRenderer.invoke("auth-check"),
  isAuthAvailable: () => ipcRenderer.invoke("auth-available"),
});
