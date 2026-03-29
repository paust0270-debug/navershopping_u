/** @typedef {import('../engine-config').EngineConfigFile} EngineConfigFile */

const DELAY_ROWS = [
  { label: "브라우저 로드", key: "browserLoad", range: true },
  { label: "프록시 설정", key: "proxySetup", range: false },
  { label: "브라우저 실행", key: "browserLaunch", range: false },
  { label: "1차 검색 후", key: "afterFirstSearchLoad", range: true },
  { label: "2차 검색 후", key: "afterSecondSearchLoad", range: true },
  { label: "탐색 간격", key: "explorationBetweenScrolls", range: true },
  { label: "체류(상품)", key: "stayOnProduct", range: true },
  { label: "작업 간 휴식", key: "taskGapRest", range: true },
];

let selectedTaskRow = 0;
let taskRows = [
  {
    keyword: "",
    linkUrl: "",
    keywordName: "",
    trafficOk: 0,
    trafficFail: 0,
    yesterdayOk: 0,
    yesterdayFail: 0,
  },
];
let taskRowsStatsDate = "";
let infiniteRunEnabled = false;
let infiniteRunTimer = null;
let infiniteTaskIndex = 0;
let lastProcessedFinishedAt = null;
let resultPollTimer = null;
let midnightCheckTimer = null;

function localDateYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeTaskRow(r) {
  return {
    keyword: String(r?.keyword ?? "").trim(),
    linkUrl: String(r?.linkUrl ?? "").trim(),
    keywordName: String(r?.keywordName ?? "").trim(),
    trafficOk: Math.max(0, Math.floor(Number(r?.trafficOk) || 0)),
    trafficFail: Math.max(0, Math.floor(Number(r?.trafficFail) || 0)),
    yesterdayOk: Math.max(0, Math.floor(Number(r?.yesterdayOk) || 0)),
    yesterdayFail: Math.max(0, Math.floor(Number(r?.yesterdayFail) || 0)),
  };
}

function rolloverStatsIfNeeded() {
  const today = localDateYmd();
  if (!taskRowsStatsDate) {
    taskRowsStatsDate = today;
    return false;
  }
  if (taskRowsStatsDate < today) {
    taskRows.forEach((row) => {
      row.yesterdayOk = row.trafficOk || 0;
      row.yesterdayFail = row.trafficFail || 0;
      row.trafficOk = 0;
      row.trafficFail = 0;
    });
    taskRowsStatsDate = today;
    return true;
  }
  return false;
}

async function persistTasksFileOnly() {
  if (!taskRowsStatsDate) taskRowsStatsDate = localDateYmd();
  await window.engineApi.saveTaskRowsText({
    rows: taskRows,
    statsDate: taskRowsStatsDate,
  });
}

function syncAllTaskRowsFromDom() {
  const trs = document.querySelectorAll("#taskBody tr");
  trs.forEach((tr, i) => {
    if (!taskRows[i]) {
      taskRows[i] = normalizeTaskRow({});
    }
    tr.querySelectorAll("input[data-f]").forEach((inp) => {
      const f = inp.dataset.f;
      if (f) taskRows[i][f] = inp.value;
    });
  });
}

function logLine(msg) {
  const el = document.getElementById("logArea");
  const t = new Date().toLocaleTimeString("ko-KR");
  el.value += `[${t}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function getSpec(d, key) {
  const v = d?.[key];
  if (v == null) return { a: "", b: "" };
  if (typeof v === "number") return { a: String(v), b: String(v) };
  return { a: String(v.min ?? ""), b: String(v.max ?? "") };
}

function parseSpec(a, b, range) {
  const na = parseInt(String(a).trim(), 10);
  const nb = parseInt(String(b).trim(), 10);
  if (!Number.isFinite(na)) return null;
  if (!range || !Number.isFinite(nb) || na === nb) return na;
  return { min: Math.min(na, nb), max: Math.max(na, nb) };
}

function buildDelaySection() {
  const root = document.getElementById("delayGrid");
  root.innerHTML = "";
  DELAY_ROWS.forEach(({ label, key, range }) => {
    const lab = document.createElement("label");
    lab.textContent = label;
    root.appendChild(lab);
    const i1 = document.createElement("input");
    i1.type = "number";
    i1.dataset.delayKey = key;
    i1.dataset.part = "a";
    i1.placeholder = range ? "min" : "ms";
    root.appendChild(i1);
    const i2 = document.createElement("input");
    i2.type = "number";
    i2.dataset.delayKey = key;
    i2.dataset.part = "b";
    i2.placeholder = range ? "max" : "";
    i2.disabled = !range;
    if (!range) {
      i2.style.opacity = "0.35";
      i2.title = "단일 값";
    }
    root.appendChild(i2);
  });
}

function applyDelaysToForm(delays) {
  DELAY_ROWS.forEach(({ key, range }) => {
    const { a, b } = getSpec(delays, key);
    const i1 = document.querySelector(`input[data-delay-key="${key}"][data-part="a"]`);
    const i2 = document.querySelector(`input[data-delay-key="${key}"][data-part="b"]`);
    if (i1) i1.value = a;
    if (i2) i2.value = range ? b : "";
  });
}

function readDelaysFromForm() {
  const delays = {};
  DELAY_ROWS.forEach(({ key, range }) => {
    const i1 = document.querySelector(`input[data-delay-key="${key}"][data-part="a"]`);
    const i2 = document.querySelector(`input[data-delay-key="${key}"][data-part="b"]`);
    const spec = parseSpec(i1?.value, range ? i2?.value : i1?.value, range);
    if (spec != null) delays[key] = spec;
  });
  return delays;
}

async function buildConfigObject() {
  const proxyText = document.getElementById("proxyList").value;
  const entries = proxyText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^https?:\/\//i.test(line)) return { server: line };
      const m = line.match(/^([^:]+):(\d+)$/);
      if (m) return { server: `http://${m[1]}:${m[2]}` };
      return { server: line.startsWith("http") ? line : `http://${line}` };
    });

  const desk = document
    .getElementById("uaDesktop")
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const mob = document
    .getElementById("uaMobile")
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const existing = (await window.engineApi.loadEngineConfig()) || {};

  return {
    ...existing,
    taskSource: {
      ...existing.taskSource,
      taskFilePath: "engine-next-task.json",
      resultFilePath: "engine-last-result.json",
    },
    delays: { ...(existing.delays || {}), ...readDelaysFromForm() },
    workMode: document.getElementById("workMode").value,
    userAgents: { desktop: desk.length ? desk : undefined, mobile: mob.length ? mob : undefined },
    proxy: {
      enabled: document.getElementById("proxyEnabled").checked && entries.length > 0,
      rotatePerTask: true,
      entries,
    },
    search: {
      ...existing.search,
      maxScrollAttempts: Math.max(1, parseInt(document.getElementById("maxScroll").value, 10) || 20),
    },
    airplaneMode: {
      toggleBeforeEachTask: true,
      offOnCycles: 1,
    },
    logging: { engineEvents: true },
  };
}

async function applyConfigToForm(cfg) {
  if (!cfg) return;
  applyDelaysToForm(cfg.delays || {});
  document.getElementById("maxScroll").value = cfg.search?.maxScrollAttempts ?? 20;
  document.getElementById("workMode").value = cfg.workMode || "mobile";
  document.getElementById("proxyEnabled").checked = !!cfg.proxy?.enabled;
  document.getElementById("proxyList").value = (cfg.proxy?.entries || [])
    .map((e) => e.server)
    .join("\n");
  document.getElementById("uaDesktop").value = (cfg.userAgents?.desktop || []).join("\n");
  document.getElementById("uaMobile").value = (cfg.userAgents?.mobile || []).join("\n");
}

function renderTaskTable() {
  const tb = document.getElementById("taskBody");
  tb.innerHTML = "";
  taskRows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (i === selectedTaskRow) tr.classList.add("selected");
    const tOk = row.trafficOk ?? 0;
    const tFail = row.trafficFail ?? 0;
    const yOk = row.yesterdayOk ?? 0;
    const yFail = row.yesterdayFail ?? 0;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input type="text" data-f="keyword" value="${escapeAttr(row.keyword)}" /></td>
      <td><input type="text" data-f="linkUrl" value="${escapeAttr(row.linkUrl)}" /></td>
      <td><input type="text" data-f="keywordName" value="${escapeAttr(row.keywordName)}" /></td>
      <td class="stat-cell">${tOk} / ${tFail}</td>
      <td class="stat-cell">${yOk} / ${yFail}</td>
    `;
    tr.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT") return;
      selectedTaskRow = i;
      renderTaskTable();
    });
    tr.querySelectorAll("input").forEach((inp) => {
      const sync = () => {
        const f = inp.dataset.f;
        if (f) taskRows[i][f] = inp.value;
      };
      inp.addEventListener("input", sync);
      inp.addEventListener("change", sync);
    });
    tb.appendChild(tr);
  });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function getSelectedTask() {
  syncAllTaskRowsFromDom();
  return taskRows[selectedTaskRow];
}

function getRunnableRows() {
  syncAllTaskRowsFromDom();
  return taskRows.filter((row) => row.keyword?.trim() && row.linkUrl?.trim());
}

function buildTaskFromRow(row) {
  return {
    keyword: row.keyword.trim(),
    linkUrl: row.linkUrl.trim(),
    slotSequence: 0,
    keywordName: row.keywordName?.trim() || undefined,
  };
}

async function saveConfigToDisk() {
  rolloverStatsIfNeeded();
  const cfg = await buildConfigObject();
  if (cfg.userAgents && !cfg.userAgents.desktop?.length) delete cfg.userAgents.desktop;
  if (cfg.userAgents && !cfg.userAgents.mobile?.length) delete cfg.userAgents.mobile;
  if (cfg.userAgents && Object.keys(cfg.userAgents).length === 0) delete cfg.userAgents;
  syncAllTaskRowsFromDom();
  await window.engineApi.saveEngineConfig(cfg);
  if (!taskRowsStatsDate) taskRowsStatsDate = localDateYmd();
  const saveTaskRes = await window.engineApi.saveTaskRowsText({
    rows: taskRows,
    statsDate: taskRowsStatsDate,
  });
  logLine("engine-config.json 저장됨");
  if (saveTaskRes?.path) {
    logLine(`작업 키워드 저장됨: ${saveTaskRes.path}`);
  }
}

async function processNewResultIfAny() {
  rolloverStatsIfNeeded();
  const res = await window.engineApi.readLastResult();
  if (!res || !res.finishedAt) return;
  if (res.finishedAt === lastProcessedFinishedAt) return;
  lastProcessedFinishedAt = res.finishedAt;
  const kw = (res.task?.keyword || "").trim();
  const url = (res.task?.linkUrl || "").trim();
  if (!kw || !url) return;
  const row = taskRows.find((r) => r.keyword.trim() === kw && r.linkUrl.trim() === url);
  if (!row) return;
  if (res.ok === true) {
    row.trafficOk = (Number(row.trafficOk) || 0) + 1;
  } else {
    row.trafficFail = (Number(row.trafficFail) || 0) + 1;
  }
  renderTaskTable();
  await persistTasksFileOnly();
}

async function startRunner(once) {
  if (!window.engineApi) {
    logLine("내부 오류: engineApi 없음(프리로드 실패). 앱을 다시 실행하세요.");
    return;
  }
  logLine(once ? "1건 실행 준비 중…" : "대기 모드 준비 중…");
  const st = await window.engineApi.runnerStatus();
  if (st.running) {
    logLine("이미 러너가 실행 중입니다.");
    return;
  }
  const row = getSelectedTask();
  if (!row.keyword?.trim() || !row.linkUrl?.trim()) {
    logLine("검색 키워드와 상품 URL 필수");
    return;
  }

  await saveConfigToDisk();
  const task = buildTaskFromRow(row);
  await window.engineApi.writeTaskFile(task);

  let r;
  try {
    r = await window.engineApi.runnerStart({ once });
  } catch (e) {
    logLine("시작 IPC 오류: " + (e?.message || String(e)));
    return;
  }
  if (!r.ok) {
    logLine("시작 실패: " + (r.error || ""));
    return;
  }
  document.getElementById("runnerStatus").textContent = once ? "실행 중 (1건)" : "실행 중 (무제한)";
  logLine(once ? "러너 프로세스 시작됨 (--once). 로그가 없으면 stderr를 확인하세요." : "러너 대기 모드 프로세스 시작됨.");
}

function setStopped() {
  document.getElementById("runnerStatus").textContent = "대기 중";
}

function stopInfiniteRun(silent = false) {
  infiniteRunEnabled = false;
  if (infiniteRunTimer) {
    clearInterval(infiniteRunTimer);
    infiniteRunTimer = null;
  }
  if (!silent) logLine("무제한 실행 루프 중지");
}

async function feedNextInfiniteTask() {
  if (!infiniteRunEnabled) return;
  const st = await window.engineApi.runnerStatus();
  if (!st.running) return;

  const taskExists = await window.engineApi.taskFileExists();
  if (taskExists) return;

  const rows = getRunnableRows();
  if (!rows.length) {
    logLine("무제한 실행할 작업이 없습니다. (키워드/URL 입력 필요)");
    return;
  }

  const idx = infiniteTaskIndex % rows.length;
  const row = rows[idx];
  const task = buildTaskFromRow(row);
  await saveConfigToDisk();
  await window.engineApi.writeTaskFile(task);
  infiniteTaskIndex += 1;
  logLine(`무제한 큐 등록 [${idx + 1}/${rows.length}]: ${task.keyword.substring(0, 24)}...`);
}

async function startInfiniteRunner() {
  if (!window.engineApi) {
    logLine("내부 오류: engineApi 없음(프리로드 실패). 앱을 다시 실행하세요.");
    return;
  }
  const rows = getRunnableRows();
  if (!rows.length) {
    logLine("무제한 실행할 작업이 없습니다. (키워드/URL 입력 필요)");
    return;
  }

  const st = await window.engineApi.runnerStatus();
  if (!st.running) {
    const r = await window.engineApi.runnerStart({ once: false });
    if (!r.ok) {
      logLine("무제한 실행 시작 실패: " + (r.error || ""));
      return;
    }
    logLine("러너 무제한 모드 시작");
  }

  infiniteRunEnabled = true;
  infiniteTaskIndex = 0;
  if (infiniteRunTimer) clearInterval(infiniteRunTimer);
  infiniteRunTimer = setInterval(() => {
    feedNextInfiniteTask().catch((e) => logLine("무제한 큐 오류: " + (e?.message || String(e))));
  }, 1200);

  document.getElementById("runnerStatus").textContent = "실행 중 (무제한)";
  logLine(`무제한 실행 활성화 — 1번부터 순서대로 반복 (${rows.length}개)`);
  await feedNextInfiniteTask();
}

async function init() {
  buildDelaySection();
  const cfg = await window.engineApi.loadEngineConfig();
  await applyConfigToForm(cfg);
  const rowsRes = await window.engineApi.loadTaskRowsText();
  if (rowsRes?.ok && Array.isArray(rowsRes.rows) && rowsRes.rows.length > 0) {
    taskRows = rowsRes.rows.map(normalizeTaskRow);
    taskRowsStatsDate = rowsRes.statsDate || localDateYmd();
    selectedTaskRow = 0;
    logLine(`작업 키워드 불러옴: ${rowsRes.rows.length}개`);
    if (rowsRes.path) logLine(`작업 파일: ${rowsRes.path}`);
    if (rolloverStatsIfNeeded()) {
      await persistTasksFileOnly();
      logLine("날짜 변경: 트래픽 → 어제로 이월 후 오늘 0/0");
    }
  } else {
    taskRowsStatsDate = localDateYmd();
  }
  renderTaskTable();

  const paths = await window.engineApi.getPaths();
  logLine(`프로젝트: ${paths.projectRoot}`);

  const bootRes = await window.engineApi.readLastResult();
  if (bootRes?.finishedAt) lastProcessedFinishedAt = bootRes.finishedAt;

  resultPollTimer = setInterval(() => {
    processNewResultIfAny().catch(() => {});
  }, 2000);
  midnightCheckTimer = setInterval(() => {
    if (rolloverStatsIfNeeded()) {
      renderTaskTable();
      persistTasksFileOnly().catch(() => {});
      logLine("자정 기준: 트래픽 → 어제로 이월, 오늘 0/0");
    }
  }, 60_000);

  document.getElementById("btnAddRow").onclick = () => {
    taskRows.push(normalizeTaskRow({}));
    selectedTaskRow = taskRows.length - 1;
    renderTaskTable();
  };
  document.getElementById("btnDelRow").onclick = () => {
    if (taskRows.length <= 1) return;
    taskRows.splice(selectedTaskRow, 1);
    selectedTaskRow = Math.max(0, selectedTaskRow - 1);
    renderTaskTable();
  };
  document.getElementById("btnClearAllRows").onclick = async () => {
    if (
      !confirm(
        "모든 작업 행을 삭제하고 검색 키워드·URL·2차 키워드를 비운 빈 행 1개만 남길까요?"
      )
    ) {
      return;
    }
    syncAllTaskRowsFromDom();
    taskRows = [normalizeTaskRow({})];
    selectedTaskRow = 0;
    if (!taskRowsStatsDate) taskRowsStatsDate = localDateYmd();
    renderTaskTable();
    await persistTasksFileOnly();
    logLine("전체 삭제: 작업 키워드 표를 초기화하고 tasks.txt 반영함");
  };
  document.getElementById("btnResetStats").onclick = async () => {
    if (!confirm("모든 행의 트래픽·어제 카운터를 0으로 초기화할까요?")) {
      return;
    }
    rolloverStatsIfNeeded();
    syncAllTaskRowsFromDom();
    taskRows.forEach((row) => {
      row.trafficOk = 0;
      row.trafficFail = 0;
      row.yesterdayOk = 0;
      row.yesterdayFail = 0;
    });
    if (!taskRowsStatsDate) taskRowsStatsDate = localDateYmd();
    renderTaskTable();
    await persistTasksFileOnly();
    logLine("초기화: 트래픽·어제 카운터 0/0으로 저장함");
  };
  document.getElementById("btnSaveConfig").onclick = async () => {
    await saveConfigToDisk();
  };
  document.getElementById("btnSaveResults").onclick = async () => {
    try {
      rolloverStatsIfNeeded();
      syncAllTaskRowsFromDom();
      const rows = taskRows.map(normalizeTaskRow);
      const r = await window.engineApi.saveResultsTable(rows);
      if (r?.path) logLine(`결과 저장 완료: ${r.path}`);
      else logLine("결과 저장 실패");
    } catch (e) {
      logLine("결과 저장 오류: " + (e?.message || String(e)));
    }
  };
  document.getElementById("btnStart").onclick = async () => {
    try {
      await startInfiniteRunner();
    } catch (e) {
      logLine("시작 처리 오류: " + (e?.message || String(e)));
    }
  };
  document.getElementById("btnStop").onclick = async () => {
    stopInfiniteRun(true);
    await window.engineApi.runnerStop();
    setStopped();
    logLine("중지 요청");
  };

  window.engineApi.onRunnerLog(({ line, stream }) => {
    logLine(stream === "stderr" ? "[err] " + line : line);
  });
  window.engineApi.onRunnerExit(({ code, error }) => {
    stopInfiniteRun(true);
    setStopped();
    logLine(error ? `종료 오류: ${error}` : `프로세스 종료 코드 ${code}`);
  });
}

init().catch((e) => console.error(e));
