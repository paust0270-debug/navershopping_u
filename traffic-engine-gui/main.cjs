const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

// ============ Supabase Auth ============
function loadEnvFile() {
  const candidates = [
    path.join(__dirname, "..", ".env.local"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, ".env"),
    "C:\\turafic\\.env",
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
}
loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

// ============ HWID ============
const { execSync } = require("child_process");
let cachedHwid = null;

function getHwid() {
  if (cachedHwid) return cachedHwid;
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"',
      { encoding: "utf8", timeout: 10000, windowsHide: true }
    );
    cachedHwid = raw.trim();
  } catch {
    cachedHwid = "UNKNOWN";
  }
  return cachedHwid;
}

/**
 * HWID 검증: 최초 로그인 시 등록, 이후 불일치 시 차단
 * @returns {{ ok: boolean, error?: string }}
 */
async function verifyHwid(userId) {
  const hwid = getHwid();
  if (hwid === "UNKNOWN") return { ok: true }; // HWID 추출 실패 시 통과

  // 기존 등록 확인
  const { data, error } = await supabase
    .from("user_devices")
    .select("hwid")
    .eq("user_id", userId)
    .single();

  if (error && error.code === "PGRST116") {
    // 미등록 → 최초 등록
    const { error: insertErr } = await supabase
      .from("user_devices")
      .insert({ user_id: userId, hwid });
    if (insertErr) return { ok: false, error: "기기 등록 실패: " + insertErr.message };
    return { ok: true };
  }

  if (error) return { ok: false, error: "기기 확인 실패: " + error.message };

  // 등록된 HWID와 비교
  if (data.hwid !== hwid) {
    return { ok: false, error: "다른 PC에서 등록된 계정입니다. 관리자에게 문의하세요." };
  }
  return { ok: true };
}

/** 개발: 저장소 루트 / 배포: resources/runner (electron-builder extraResources) */
const RUNNER_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "runner")
  : path.join(__dirname, "..");
/** 배포 모드에서 설정/작업/결과 JSON은 실행파일 폴더에 고정 저장 (재시작 후 유지) */
const DATA_ROOT = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath("userData"), "naver-traffic-data")
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
    title: "네이버 트래픽 자동화",
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
    "검색 키워드\t상품 URL\t2차 키워드\t목표\t상품명\t현재순위\t시작순위\t트래픽성공\t트래픽실패\t어제성공\t어제실패\t리뷰수\t별점";
  const lines = safeRows.map((r) => {
    const keyword = String(r?.keyword ?? "").replace(/\r?\n/g, " ").trim();
    const linkUrl = String(r?.linkUrl ?? "").replace(/\r?\n/g, " ").trim();
    const keywordName = String(r?.keywordName ?? "").replace(/\r?\n/g, " ").trim();
    const targetCount = Math.max(0, Math.floor(Number(r?.targetCount) || 0));
    const productTitle = String(r?.productTitle ?? "").replace(/\r?\n/g, " ").trim();
    const currentRank = String(r?.currentRank ?? "").replace(/\r?\n/g, " ").trim();
    const startRank = String(r?.startRank ?? "").replace(/\r?\n/g, " ").trim();
    const tOk = Math.max(0, Math.floor(Number(r?.trafficOk) || 0));
    const tFail = Math.max(0, Math.floor(Number(r?.trafficFail) || 0));
    const yOk = Math.max(0, Math.floor(Number(r?.yesterdayOk) || 0));
    const yFail = Math.max(0, Math.floor(Number(r?.yesterdayFail) || 0));
    const reviewCount = String(r?.reviewCount ?? "").replace(/\r?\n/g, " ").trim();
    const starRating = String(r?.starRating ?? "").replace(/\r?\n/g, " ").trim();
    return `${keyword}\t${linkUrl}\t${keywordName}\t${targetCount}\t${productTitle}\t${currentRank}\t${startRank}\t${tOk}\t${tFail}\t${yOk}\t${yFail}\t${reviewCount}\t${starRating}`;
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
    // 신 포맷 v2 (14컬럼): keyword url kw2 target productTitle curRank startRank ok fail yOk yFail review star
    if (p.length >= 14) {
      return {
        keyword, linkUrl, keywordName,
        targetCount: Math.max(0, Math.floor(Number(p[3]) || 0)),
        productTitle: p[4] ?? "",
        currentRank: p[5] ?? "",
        startRank: p[6] ?? "",
        trafficOk: Math.max(0, Math.floor(Number(p[7]) || 0)),
        trafficFail: Math.max(0, Math.floor(Number(p[8]) || 0)),
        yesterdayOk: Math.max(0, Math.floor(Number(p[9]) || 0)),
        yesterdayFail: Math.max(0, Math.floor(Number(p[10]) || 0)),
        reviewCount: p[11] ?? "",
        starRating: p[12] ?? "",
      };
    }
    // 신 포맷 v1 (13컬럼): keyword url kw2 target curRank startRank ok fail yOk yFail review star
    if (p.length >= 13) {
      return {
        keyword, linkUrl, keywordName,
        targetCount: Math.max(0, Math.floor(Number(p[3]) || 0)),
        productTitle: "",
        currentRank: p[4] ?? "",
        startRank: p[5] ?? "",
        trafficOk: Math.max(0, Math.floor(Number(p[6]) || 0)),
        trafficFail: Math.max(0, Math.floor(Number(p[7]) || 0)),
        yesterdayOk: Math.max(0, Math.floor(Number(p[8]) || 0)),
        yesterdayFail: Math.max(0, Math.floor(Number(p[9]) || 0)),
        reviewCount: p[10] ?? "",
        starRating: p[11] ?? "",
      };
    }
    // 구 포맷 (11~12컬럼): keyword url kw2 curRank startRank ok fail yOk yFail review star
    if (p.length >= 11) {
      return {
        keyword, linkUrl, keywordName,
        targetCount: 0,
        currentRank: p[3] ?? "",
        startRank: p[4] ?? "",
        trafficOk: Math.max(0, Math.floor(Number(p[5]) || 0)),
        trafficFail: Math.max(0, Math.floor(Number(p[6]) || 0)),
        yesterdayOk: Math.max(0, Math.floor(Number(p[7]) || 0)),
        yesterdayFail: Math.max(0, Math.floor(Number(p[8]) || 0)),
        reviewCount: p[9] ?? "",
        starRating: p[10] ?? "",
      };
    }
    return {
      keyword, linkUrl, keywordName,
      targetCount: 0,
      currentRank: "",
      startRank: "",
      trafficOk: 0,
      trafficFail: 0,
      yesterdayOk: 0,
      yesterdayFail: 0,
      reviewCount: "",
      starRating: "",
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
  const header =
    "순번\t검색키워드\t상품 URL\t2차 키워드\t현재순위\t시작순위\t트래픽\t어제\t리뷰수\t별점";
  const lines = safeRows.map((r, i) => {
    const keyword = String(r?.keyword ?? "").replace(/\r?\n/g, " ").trim();
    const linkUrl = String(r?.linkUrl ?? "").replace(/\r?\n/g, " ").trim();
    const keywordName = String(r?.keywordName ?? "").replace(/\r?\n/g, " ").trim();
    const currentRank = String(r?.currentRank ?? "").replace(/\r?\n/g, " ").trim();
    const startRank = String(r?.startRank ?? "").replace(/\r?\n/g, " ").trim();
    const tOk = Math.max(0, Math.floor(Number(r?.trafficOk) || 0));
    const tFail = Math.max(0, Math.floor(Number(r?.trafficFail) || 0));
    const yOk = Math.max(0, Math.floor(Number(r?.yesterdayOk) || 0));
    const yFail = Math.max(0, Math.floor(Number(r?.yesterdayFail) || 0));
    const reviewCount = String(r?.reviewCount ?? "").replace(/\r?\n/g, " ").trim();
    const starRating = String(r?.starRating ?? "").replace(/\r?\n/g, " ").trim();
    const traffic = `${tOk} / ${tFail}`;
    const yesterday = `${yOk} / ${yFail}`;
    return `${i + 1}\t${keyword}\t${linkUrl}\t${keywordName}\t${currentRank}\t${startRank}\t${traffic}\t${yesterday}\t${reviewCount}\t${starRating}`;
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
  const bundledRunner = path.join(RUNNER_ROOT, "worker-runner.js");
  /** 포터블 EXE는 %TEMP% 아래에 풀리므로, 러너 스크립트는 실행 파일 옆 traffic-engine-data 로 매번 복사해 두고 NODE_PATH 로 패치라이트 해석 */
  const dataRunner = path.join(DATA_ROOT, "worker-runner.js");
  let runnerJs = app.isPackaged ? dataRunner : bundledRunner;
  let cmd;
  let args;
  let shell = false;
  let env = { ...process.env, FORCE_COLOR: "0" };

  if (app.isPackaged) {
    if (!fs.existsSync(bundledRunner)) {
      return {
        ok: false,
        error: `worker-runner.js 없음: ${bundledRunner} — 빌드 시 번들 누락`,
      };
    }
    try {
      fs.mkdirSync(DATA_ROOT, { recursive: true });
      fs.copyFileSync(bundledRunner, dataRunner);
    } catch (e) {
      return {
        ok: false,
        error: `worker-runner 복사 실패: ${e?.message || e}`,
      };
    }
    cmd = process.execPath;
    args = [runnerJs, ...(once ? ["--once"] : [])];
    const runnerMods = path.join(RUNNER_ROOT, "node_modules");
    env = {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      SKIP_GIT_UPDATE_CHECK: "1",
      NODE_PATH: [runnerMods, env.NODE_PATH].filter(Boolean).join(path.delimiter),
    };
  } else {
    cmd = isWin ? "npx.cmd" : "npx";
    args = ["tsx", "unified-runner.ts", ...(once ? ["--once"] : [])];
    shell = isWin;
  }

  const cfg = safeReadJson(paths().config) || {};
  const _apiKeys = Array.isArray(cfg.anthropicApiKeys) ? cfg.anthropicApiKeys : [];
  const _apiIdx = typeof cfg.anthropicApiKeyIndex === "number" ? cfg.anthropicApiKeyIndex : 0;
  const anthropicKey =
    _apiKeys[_apiIdx]?.key?.trim() ||
    cfg.anthropicApiKey ||
    process.env.ANTHROPIC_API_KEY ||
    "";

  runnerChild = spawn(cmd, args, {
    cwd: DATA_ROOT,
    shell,
    env: {
      ...env,
      ENGINE_TASK_FILE: paths().task,
      ENGINE_RESULT_FILE: paths().result,
      ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
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
    // 1단계: 프로세스 트리 즉시 종료
    try {
      require("child_process").execSync(
        `taskkill /pid ${pid} /T /F`,
        { stdio: "ignore", timeout: 5000, windowsHide: true }
      );
    } catch { /* ignore */ }
    // 2단계: PRB가 띄운 user-data-dir 기반 Chrome도 정리
    setTimeout(() => {
      try {
        require("child_process").execSync(
          `taskkill /F /IM chrome.exe /FI "WINDOWTITLE eq *prb-rank*"`,
          { stdio: "ignore", timeout: 5000, windowsHide: true }
        );
      } catch { /* ignore */ }
    }, 500);
  }
  return { ok: true };
});

ipcMain.handle("runner-status", () => ({ running: !!runnerChild }));

// ============ Auth IPC Handlers ============
ipcMain.handle("auth-login", async (_e, { email, password }) => {
  if (!supabase) {
    return { ok: false, error: "SUPABASE_URL / SUPABASE_ANON_KEY 미설정" };
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };

    // HWID 검증
    const hwidResult = await verifyHwid(data.user.id);
    if (!hwidResult.ok) {
      await supabase.auth.signOut();
      return { ok: false, error: hwidResult.error };
    }

    return { ok: true, user: { email: data.user.email, id: data.user.id } };
  } catch (e) {
    return { ok: false, error: e.message || "로그인 실패" };
  }
});

ipcMain.handle("auth-logout", async () => {
  if (!supabase) return { ok: true };
  try {
    await supabase.auth.signOut();
  } catch { /* ignore */ }
  return { ok: true };
});

ipcMain.handle("auth-check", async () => {
  if (!supabase) return null; // Supabase 미설정 시 인증 건너뜀
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) return { email: data.user.email, id: data.user.id };
  } catch { /* ignore */ }
  return null;
});

ipcMain.handle("auth-available", () => !!supabase);
