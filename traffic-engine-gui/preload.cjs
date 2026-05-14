const { contextBridge, ipcRenderer } = require("electron");

const _debugSkipAuth = process.argv.includes("--debug-skip-auth") || process.env.DEBUG_SKIP_AUTH === "1";

contextBridge.exposeInMainWorld("engineApi", {
  debugSkipAuth: _debugSkipAuth,
  getPaths: () => ipcRenderer.invoke("get-paths"),
  loadEngineConfig: () => ipcRenderer.invoke("load-engine-config"),
  saveEngineConfig: (data) => ipcRenderer.invoke("save-engine-config", data),
  saveNaverAccount: (data) => ipcRenderer.invoke("save-naver-account", data),
  loadNaverAccount: () => ipcRenderer.invoke("load-naver-account"),
  saveTaskRowsText: (rows) => ipcRenderer.invoke("save-task-rows-text", rows),
  loadTaskRowsText: () => ipcRenderer.invoke("load-task-rows-text"),
  pickImportTaskRows: () => ipcRenderer.invoke("pick-import-task-rows"),
  exportTaskKeywordsPreset: (data) => ipcRenderer.invoke("export-task-keywords-preset", data),
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
