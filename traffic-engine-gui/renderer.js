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
    currentRank: "",
    startRank: "",
    reviewCount: "",
    starRating: "",
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
let infiniteFeedInProgress = false;
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
    currentRank: String(r?.currentRank ?? "").trim(),
    startRank: String(r?.startRank ?? "").trim(),
    reviewCount: String(r?.reviewCount ?? "").trim(),
    starRating: String(r?.starRating ?? "").trim(),
    trafficOk: Math.max(0, Math.floor(Number(r?.trafficOk) || 0)),
    trafficFail: Math.max(0, Math.floor(Number(r?.trafficFail) || 0)),
    yesterdayOk: Math.max(0, Math.floor(Number(r?.yesterdayOk) || 0)),
    yesterdayFail: Math.max(0, Math.floor(Number(r?.yesterdayFail) || 0)),
    // D순위 미발견(-1) 연속 횟수: 10회 누적 시에만 현재순위를 "-"로 갱신
    rankMissStreak: Math.max(0, Math.floor(Number(r?.rankMissStreak) || 0)),
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
      searchFlowVersion: document.getElementById("searchFlowVersion").value,
    },
    airplaneMode: {
      toggleBeforeEachTask: document.getElementById("toggleUsbDataBeforeTask").checked,
      offOnCycles: Math.max(1, Number((existing.airplaneMode && existing.airplaneMode.offOnCycles) || 1)),
    },
    logging: { engineEvents: true },
  };
}

async function applyConfigToForm(cfg) {
  if (!cfg) return;
  applyDelaysToForm(cfg.delays || {});
  document.getElementById("maxScroll").value = cfg.search?.maxScrollAttempts ?? 20;
  const flow = cfg.search?.searchFlowVersion;
  document.getElementById("searchFlowVersion").value =
    flow === "B" || flow === "C" || flow === "D" ? flow : "A";
  const wm = cfg.workMode || "mobile";
  document.getElementById("workMode").value =
    wm === "mobile" || wm === "desktop" || wm === "random" ? wm : "mobile";
  document.getElementById("proxyEnabled").checked = !!cfg.proxy?.enabled;
  document.getElementById("proxyList").value = (cfg.proxy?.entries || [])
    .map((e) => e.server)
    .join("\n");
  document.getElementById("uaDesktop").value = (cfg.userAgents?.desktop || []).join("\n");
  document.getElementById("uaMobile").value = (cfg.userAgents?.mobile || []).join("\n");
  const usbToggle = document.getElementById("toggleUsbDataBeforeTask");
  if (usbToggle) {
    usbToggle.checked = cfg.airplaneMode?.toggleBeforeEachTask !== false;
  }
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
    const curR = escapeHtml(row.currentRank ?? "");
    const stR = escapeHtml(row.startRank ?? "");
    const rev = escapeHtml(row.reviewCount ?? "");
    const star = escapeHtml(row.starRating ?? "");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input type="text" data-f="keyword" value="${escapeAttr(row.keyword)}" /></td>
      <td><input type="text" data-f="linkUrl" value="${escapeAttr(row.linkUrl)}" /></td>
      <td><input type="text" data-f="keywordName" value="${escapeAttr(row.keywordName)}" /></td>
      <td class="stat-cell rank-display" title="D순위체크 결과">${curR || "—"}</td>
      <td class="stat-cell rank-display" title="기준 순위(비우면 첫 성공 시 현재순위로 자동)">${stR || "—"}</td>
      <td class="stat-cell">${tOk} / ${tFail}</td>
      <td class="stat-cell">${yOk} / ${yFail}</td>
      <td class="stat-cell rank-display" title="D순위체크 리뷰 수">${rev || "—"}</td>
      <td class="stat-cell rank-display" title="D순위체크 별점">${star || "—"}</td>
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

async function persistEngineConfigFromForm() {
  const cfg = await buildConfigObject();
  if (cfg.userAgents && !cfg.userAgents.desktop?.length) delete cfg.userAgents.desktop;
  if (cfg.userAgents && !cfg.userAgents.mobile?.length) delete cfg.userAgents.mobile;
  if (cfg.userAgents && Object.keys(cfg.userAgents).length === 0) delete cfg.userAgents;
  await window.engineApi.saveEngineConfig(cfg);
  return cfg;
}

/** 딜레이 패널·작업 선택(A/B)·최대 스크롤·워크 모드·UA·프록시까지 engine-config.json만 저장 (tasks.txt는 건드리지 않음) */
async function saveEngineConfigOnly() {
  await persistEngineConfigFromForm();
  logLine("engine-config.json 저장됨 (작업 딜레이·검색 버전·기타 설정)");
}

/** 프록시·USB 토글만 저장하는 UX (실제로는 폼 전체를 engine-config.json에 반영) */
async function saveProxyAirplaneSection() {
  await persistEngineConfigFromForm();
  logLine("engine-config.json 저장됨 (프록시·비행기모드·USB 토글)");
}

async function saveConfigToDisk() {
  rolloverStatsIfNeeded();
  await persistEngineConfigFromForm();
  syncAllTaskRowsFromDom();
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

  if (res.mode === "rankCheck") {
    const rankNum = res.shoppingRank;
    if (res.ok === true && rankNum != null && Number(rankNum) > 0) {
      row.currentRank = String(rankNum);
      row.rankMissStreak = 0;
      if (!String(row.startRank || "").trim()) {
        row.startRank = String(rankNum);
      }
      row.reviewCount = res.reviewCount != null ? String(res.reviewCount) : "";
      row.starRating = res.starRating != null ? String(res.starRating) : "";
      const title = (res.extractedProductTitle || "").trim();
      if (title && !String(row.keywordName || "").trim()) {
        row.keywordName = title;
      }
    } else {
      const noRankDetected =
        Number(rankNum) === -1 ||
        res.failReason === "NO_MID_MATCH" ||
        String(res.error || "").includes("순위권_미발견");

      if (noRankDetected) {
        row.rankMissStreak = Math.max(0, Number(row.rankMissStreak) || 0) + 1;
        if (row.rankMissStreak >= 10) {
          row.currentRank = "-";
          row.reviewCount = "-";
          row.starRating = "-";
        }
      } else {
        // 타임아웃/기타 오류는 연속 미발견 카운트에서 제외하고, 기존 순위를 유지
        row.rankMissStreak = 0;
      }
    }
    renderTaskTable();
    await persistTasksFileOnly();
    return;
  }

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
  const flow = document.getElementById("searchFlowVersion").value;
  if (flow === "C" && !row.keywordName?.trim()) {
    logLine("C버전(제목풀)은 2차 키워드 필수");
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
  if (infiniteFeedInProgress) return;
  infiniteFeedInProgress = true;
  try {
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

  // 인덱스를 먼저 선점해 중복 등록(레이스) 방지
  const idx = infiniteTaskIndex % rows.length;
  infiniteTaskIndex += 1;
  const row = rows[idx];
  const task = buildTaskFromRow(row);
  await saveConfigToDisk();
  await window.engineApi.writeTaskFile(task);
  logLine(`무제한 큐 등록 [${idx + 1}/${rows.length}]: ${task.keyword.substring(0, 24)}...`);
  } finally {
    infiniteFeedInProgress = false;
  }
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
  document.getElementById("btnSaveDelays").onclick = async () => {
    try {
      await saveEngineConfigOnly();
    } catch (e) {
      logLine("설정 저장 오류: " + (e?.message || String(e)));
    }
  };
  document.getElementById("btnSaveProxyAirplane").onclick = async () => {
    try {
      await saveProxyAirplaneSection();
    } catch (e) {
      logLine("프록시·비행기모드 저장 오류: " + (e?.message || String(e)));
    }
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
