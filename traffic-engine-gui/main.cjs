const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

/** 개발: 저장소 루트 / 배포: resources/runner (electron-builder extraResources) */
const RUNNER_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "runner")
  : path.join(__dirname, "..");
/** 배포 모드에서 설정/작업/결과 JSON은 실행파일 폴더에 고정 저장 (재시작 후 유지) */
const DATA_ROOT = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath("userData"), "traffic-engine-data")
  : RUNNER_ROOT;
const TASKS_TEXT_PATH = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath("userData"), "tasks.txt")
  : path.join(RUNNER_ROOT, "traffic-engine-gui", "tasks.txt");
const RESULTS_SAVE_PATH = path.join(path.dirname(TASKS_TEXT_PATH), "results-save.txt");

let mainWindow = null;
let runnerChild = null;

function paths() {
  const cfg = safeReadJson(path.join(DATA_ROOT, "engine-config.json")) || {};
  const ts = cfg.taskSource || {};
  const taskRel = ts.taskFilePath || "engine-next-task.json";
  const resultRel = ts.resultFilePath || "engine-last-result.json";
  return {
    config: path.join(DATA_ROOT, "engine-config.json"),
    task: path.isAbsolute(taskRel) ? taskRel : path.join(DATA_ROOT, taskRel),
    result: path.isAbsolute(resultRel) ? resultRel : path.join(DATA_ROOT, resultRel),
  };
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function ymdToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function createWindow() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "트래픽 엔진",
    backgroundColor: "#3a3a3a",
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-paths", () => ({ projectRoot: RUNNER_ROOT, dataRoot: DATA_ROOT, ...paths() }));

ipcMain.handle("load-engine-config", () => safeReadJson(paths().config) || {});

ipcMain.handle("save-engine-config", (_e, data) => {
  fs.writeFileSync(paths().config, JSON.stringify(data, null, 2), "utf-8");
  return { ok: true };
});

ipcMain.handle("save-task-rows-text", (_e, payload) => {
  const safeRows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [];
  const statsDate =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof payload.statsDate === "string" &&
    payload.statsDate.trim()
      ? payload.statsDate.trim()
      : ymdToday();
  const header =
    "검색 키워드\t상품 URL\t2차 키워드\t트래픽성공\t트래픽실패\t어제성공\t어제실패";
  const lines = safeRows.map((r) => {
    const keyword = String(r?.keyword ?? "").replace(/\r?\n/g, " ").trim();
    const linkUrl = String(r?.linkUrl ?? "").replace(/\r?\n/g, " ").trim();
    const keywordName = String(r?.keywordName ?? "").replace(/\r?\n/g, " ").trim();
    const tOk = Math.max(0, Math.floor(Number(r?.trafficOk) || 0));
    const tFail = Math.max(0, Math.floor(Number(r?.trafficFail) || 0));
    const yOk = Math.max(0, Math.floor(Number(r?.yesterdayOk) || 0));
    const yFail = Math.max(0, Math.floor(Number(r?.yesterdayFail) || 0));
    return `${keyword}\t${linkUrl}\t${keywordName}\t${tOk}\t${tFail}\t${yOk}\t${yFail}`;
  });
  const body = [`#date\t${statsDate}`, header, ...lines].join("\n");
  fs.writeFileSync(TASKS_TEXT_PATH, body, "utf-8");
  return { ok: true, path: TASKS_TEXT_PATH };
});

ipcMain.handle("load-task-rows-text", () => {
  if (!fs.existsSync(TASKS_TEXT_PATH)) {
    return { ok: true, rows: [], statsDate: ymdToday() };
  }
  const raw = fs.readFileSync(TASKS_TEXT_PATH, "utf-8");
  let lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return { ok: true, rows: [], statsDate: ymdToday() };

  let statsDate = ymdToday();
  if (lines[0].startsWith("#date\t")) {
    const parts = lines[0].split("\t");
    if (parts[1]) statsDate = parts[1].trim();
    lines = lines.slice(1);
  }
  if (lines[0]?.includes("검색 키워드")) lines = lines.slice(1);

  const rows = lines.map((line) => {
    const p = line.split("\t");
    const keyword = p[0] ?? "";
    const linkUrl = p[1] ?? "";
    const keywordName = p[2] ?? "";
    if (p.length >= 7) {
      return {
        keyword,
        linkUrl,
        keywordName,
        trafficOk: Math.max(0, Math.floor(Number(p[3]) || 0)),
        trafficFail: Math.max(0, Math.floor(Number(p[4]) || 0)),
        yesterdayOk: Math.max(0, Math.floor(Number(p[5]) || 0)),
        yesterdayFail: Math.max(0, Math.floor(Number(p[6]) || 0)),
      };
    }
    return {
      keyword,
      linkUrl,
      keywordName,
      trafficOk: 0,
      trafficFail: 0,
      yesterdayOk: 0,
      yesterdayFail: 0,
    };
  });
  return { ok: true, rows, statsDate, path: TASKS_TEXT_PATH };
});

ipcMain.handle("write-task-file", (_e, taskObj) => {
  const { task } = paths();
  fs.writeFileSync(task, JSON.stringify(taskObj, null, 2), "utf-8");
  return { ok: true, path: task };
});

ipcMain.handle("read-last-result", () => safeReadJson(paths().result));

ipcMain.handle("save-results-table", (_e, rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const header = "순번\t검색키워드\t상품 URL\t2차 키워드\t트래픽\t어제";
  const lines = safeRows.map((r, i) => {
    const keyword = String(r?.keyword ?? "").replace(/\r?\n/g, " ").trim();
    const linkUrl = String(r?.linkUrl ?? "").replace(/\r?\n/g, " ").trim();
    const keywordName = String(r?.keywordName ?? "").replace(/\r?\n/g, " ").trim();
    const tOk = Math.max(0, Math.floor(Number(r?.trafficOk) || 0));
    const tFail = Math.max(0, Math.floor(Number(r?.trafficFail) || 0));
    const yOk = Math.max(0, Math.floor(Number(r?.yesterdayOk) || 0));
    const yFail = Math.max(0, Math.floor(Number(r?.yesterdayFail) || 0));
    const traffic = `${tOk} / ${tFail}`;
    const yesterday = `${yOk} / ${yFail}`;
    return `${i + 1}\t${keyword}\t${linkUrl}\t${keywordName}\t${traffic}\t${yesterday}`;
  });
  const body = [header, ...lines].join("\n");
  fs.writeFileSync(RESULTS_SAVE_PATH, `\uFEFF${body}`, "utf-8");
  return { ok: true, path: RESULTS_SAVE_PATH };
});
ipcMain.handle("task-file-exists", () => {
  const { task } = paths();
  return fs.existsSync(task);
});

ipcMain.handle("runner-start", (_e, { once }) => {
  if (runnerChild) {
    return { ok: false, error: "이미 실행 중" };
  }
  const isWin = process.platform === "win32";
  const runnerJs = path.join(RUNNER_ROOT, "worker-runner.js");
  let cmd;
  let args;
  let shell = false;
  let env = { ...process.env, FORCE_COLOR: "0" };

  if (app.isPackaged) {
    if (!fs.existsSync(runnerJs)) {
      return {
        ok: false,
        error: `worker-runner.js 없음: ${runnerJs} — 빌드 시 번들 누락`,
      };
    }
    cmd = process.execPath;
    args = [runnerJs, ...(once ? ["--once"] : [])];
    env = {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      SKIP_GIT_UPDATE_CHECK: "1",
    };
  } else {
    cmd = isWin ? "npx.cmd" : "npx";
    args = ["tsx", "unified-runner.ts", ...(once ? ["--once"] : [])];
    shell = isWin;
  }

  runnerChild = spawn(cmd, args, {
    cwd: DATA_ROOT,
    shell,
    env: {
      ...env,
      ENGINE_TASK_FILE: paths().task,
      ENGINE_RESULT_FILE: paths().result,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const send = (line, stream) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("runner-log", { line, stream });
    }
  };

  const child = runnerChild;
  child.on("close", (code) => {
    if (runnerChild === child) runnerChild = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("runner-exit", { code });
    }
  });
  child.on("error", (err) => {
    if (runnerChild === child) runnerChild = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("runner-exit", { code: -1, error: err.message });
    }
  });

  child.stdout?.on("data", (buf) => {
    buf
      .toString("utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => send(line, "stdout"));
  });
  child.stderr?.on("data", (buf) => {
    buf
      .toString("utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => send(line, "stderr"));
  });

  if (app.isPackaged) {
    send(
      `[GUI] 러너 cwd=${DATA_ROOT} 스크립트=${path.basename(runnerJs)}`,
      "stdout"
    );
  }

  return { ok: true };
});

ipcMain.handle("runner-stop", () => {
  if (!runnerChild) return { ok: true };
  const pid = runnerChild.pid;
  try {
    runnerChild.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  runnerChild = null;
  if (process.platform === "win32" && pid) {
    setTimeout(() => {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        shell: true,
        stdio: "ignore",
      }).unref();
    }, 500);
  }
  return { ok: true };
});

ipcMain.handle("runner-status", () => ({ running: !!runnerChild }));
