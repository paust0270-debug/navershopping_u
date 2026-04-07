/** @typedef {import('../engine-config').EngineConfigFile} EngineConfigFile */

const DELAY_ROWS = [
  { label: "브라우저 로드", key: "browserLoad", range: true, defMin: 2500, defMax: 4000 },
  { label: "프록시 설정", key: "proxySetup", range: false, defMin: 3000 },
  { label: "브라우저 실행", key: "browserLaunch", range: false, defMin: 2000 },
  { label: "1차 검색 후", key: "afterFirstSearchLoad", range: true, defMin: 2000, defMax: 3000 },
  { label: "2차 검색 후", key: "afterSecondSearchLoad", range: true, defMin: 2000, defMax: 3000 },
  { label: "탐색 간격", key: "explorationBetweenScrolls", range: true, defMin: 300, defMax: 500 },
  { label: "체류(상품)", key: "stayOnProduct", range: true, defMin: 3000, defMax: 6000 },
  { label: "작업 간 휴식", key: "taskGapRest", range: true, defMin: 2000, defMax: 3000 },
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
let apiKeys = []; // [{name: string, key: string}]
let apiKeySelectedIdx = 0;
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

function extractMid(url) {
  const m = String(url || "").match(/\/products\/(\d+)/);
  return m ? m[1] : "";
}

function normalizeTaskRow(r) {
  const linkUrl = String(r?.linkUrl ?? "").trim();
  return {
    checked: r?.checked === true || r?.checked === "true",
    keyword: String(r?.keyword ?? "").trim(),
    linkUrl,
    keywordName: String(r?.keywordName ?? "").trim(),
    mid: extractMid(linkUrl),
    productTitle: String(r?.productTitle ?? "").trim(),
    currentRank: String(r?.currentRank ?? "").trim(),
    startRank: String(r?.startRank ?? "").trim(),
    reviewCount: String(r?.reviewCount ?? "").trim(),
    starRating: String(r?.starRating ?? "").trim(),
    targetCount: Math.max(0, Math.floor(Number(r?.targetCount) || 0)),
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
  DELAY_ROWS.forEach(({ label, key, range, defMin, defMax }) => {
    const lab = document.createElement("label");
    lab.textContent = label;
    root.appendChild(lab);
    const i1 = document.createElement("input");
    i1.type = "number";
    i1.dataset.delayKey = key;
    i1.dataset.part = "a";
    i1.placeholder = range ? `${defMin}` : `${defMin}`;
    root.appendChild(i1);
    const i2 = document.createElement("input");
    i2.type = "number";
    i2.dataset.delayKey = key;
    i2.dataset.part = "b";
    i2.placeholder = range ? `${defMax}` : "";
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
    proxy: existing.proxy || { enabled: false, rotatePerTask: true, entries: [] },
    search: {
      ...existing.search,
      maxScrollAttempts: Math.max(1, parseInt(document.getElementById("maxScroll").value, 10) || 4),
      searchFlowVersion: document.getElementById("searchFlowVersion").value,
    },
    airplaneMode: {
      toggleBeforeEachTask: document.getElementById("toggleUsbDataBeforeTask").checked,
      offOnCycles: Math.max(1, Number((existing.airplaneMode && existing.airplaneMode.offOnCycles) || 1)),
    },
    logging: { engineEvents: true },
    naverLoginEnabled: document.getElementById("naverLoginEnabled")?.checked || false,
    anthropicApiKeys: apiKeys.length > 0 ? apiKeys.map(k => ({ name: k.name, key: k.key })) : undefined,
    anthropicApiKeyIndex: apiKeys.length > 0 ? apiKeySelectedIdx : undefined,
  };
}

async function applyConfigToForm(cfg) {
  if (!cfg) return;
  applyDelaysToForm(cfg.delays || {});
  document.getElementById("maxScroll").value = cfg.search?.maxScrollAttempts ?? 4;
  const flow = cfg.search?.searchFlowVersion;
  document.getElementById("searchFlowVersion").value =
    ["A","B","C","D","E","F"].includes(flow) ? flow : "A";
  const wm = cfg.workMode || "mobile";
  document.getElementById("workMode").value =
    wm === "mobile" || wm === "desktop" || wm === "random" ? wm : "mobile";
  // 2차 키워드 헤더 동적 업데이트
  const thSec = document.getElementById("thSecondKeyword");
  if (thSec) {
    const labels = { A: "2차 키워드 (선택)", B: "2차 키워드 (미사용)", C: "2차 키워드 (필수)", D: "2차 키워드 (미사용)" };
    const activeFlow = document.getElementById("searchFlowVersion").value;
    thSec.textContent = labels[activeFlow] || "2차 키워드";
  }
  document.getElementById("uaDesktop").value = (cfg.userAgents?.desktop || []).join("\n");
  document.getElementById("uaMobile").value = (cfg.userAgents?.mobile || []).join("\n");
  const usbToggle = document.getElementById("toggleUsbDataBeforeTask");
  if (usbToggle) {
    usbToggle.checked = cfg.airplaneMode?.toggleBeforeEachTask === true;
  }
  const loginToggle = document.getElementById("naverLoginEnabled");
  if (loginToggle) loginToggle.checked = cfg.naverLoginEnabled === true;
  apiKeys = Array.isArray(cfg.anthropicApiKeys) ? cfg.anthropicApiKeys.map(k => ({ name: k.name || "", key: k.key || "" })) : [];
  apiKeySelectedIdx = typeof cfg.anthropicApiKeyIndex === "number" ? cfg.anthropicApiKeyIndex : 0;
  renderApiKeyList();
}

function renderApiKeyList() {
  const container = document.getElementById("apiKeyList");
  if (!container) return;
  container.innerHTML = "";
  apiKeys.forEach((entry, i) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;padding:4px 0;border-bottom:1px solid #444";

    // 윗줄: 이름 + 버튼들
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;gap:4px;align-items:center";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = entry.name;
    nameInput.placeholder = "이름 (예: 계정1)";
    nameInput.style.cssText = "flex:1;font-size:12px;padding:3px 6px";
    nameInput.oninput = () => { apiKeys[i].name = nameInput.value; };

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.textContent = i === apiKeySelectedIdx ? "✓ 사용중" : "선택";
    selectBtn.style.cssText = `font-size:11px;padding:3px 8px;white-space:nowrap;${i === apiKeySelectedIdx ? "font-weight:bold;color:#4fc3f7;border-color:#4fc3f7" : ""}`;
    selectBtn.onclick = () => { apiKeySelectedIdx = i; renderApiKeyList(); };

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "삭제";
    delBtn.style.cssText = "font-size:11px;padding:3px 8px;color:#ef9a9a;white-space:nowrap";
    delBtn.onclick = () => {
      apiKeys.splice(i, 1);
      if (apiKeySelectedIdx >= apiKeys.length) apiKeySelectedIdx = Math.max(0, apiKeys.length - 1);
      renderApiKeyList();
    };

    topRow.appendChild(nameInput);
    topRow.appendChild(selectBtn);
    topRow.appendChild(delBtn);

    // 아랫줄: 키 입력 (전체 너비)
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.value = entry.key;
    keyInput.placeholder = "sk-ant-api03-...";
    keyInput.style.cssText = "width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;padding:4px 6px";
    keyInput.oninput = () => { apiKeys[i].key = keyInput.value; };

    wrap.appendChild(topRow);
    wrap.appendChild(keyInput);
    container.appendChild(wrap);
  });
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
    const target = row.targetCount || 0;
    const done = target > 0 && tOk >= target;
    const progressText = target > 0 ? `${tOk}/${target}` : `${tOk}`;
    const midDisplay = row.mid || "—";
    tr.innerHTML = `
      <td style="text-align:center"><input type="checkbox" data-f="checked" ${row.checked ? 'checked' : ''} /></td>
      <td>${i + 1}</td>
      <td><input type="text" data-f="keyword" value="${escapeAttr(row.keyword)}" placeholder="검색어" /></td>
      <td><input type="text" data-f="linkUrl" value="${escapeAttr(row.linkUrl)}" placeholder="상품 URL" /></td>
      <td><input type="text" data-f="keywordName" value="${escapeAttr(row.keywordName)}" placeholder="선택" /></td>
      <td class="stat-cell" title="${midDisplay}" style="font-size:10px;color:#aaa">${midDisplay}</td>
      <td class="stat-cell" title="${escapeAttr(row.productTitle || '')}" style="font-size:10px;color:#ccc;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${row.productTitle || '—'}</td>
      <td class="stat-cell"><input type="number" data-f="targetCount" value="${target || ''}" placeholder="0" min="0" style="width:48px;text-align:center" title="일일 목표 (0=무제한)" /></td>
      <td class="stat-cell ${done ? 'target-done' : ''}" title="성공/목표">${progressText}</td>
      <td class="stat-cell">${tFail}</td>
      <td class="stat-cell rank-display">${curR || "—"}</td>
      <td class="stat-cell rank-display">${rev || "—"}</td>
      <td class="stat-cell rank-display">${star || "—"}</td>
    `;
    tr.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT") return;
      selectedTaskRow = i;
      renderTaskTable();
    });
    tr.querySelectorAll("input").forEach((inp) => {
      const sync = () => {
        const f = inp.dataset.f;
        if (!f) return;
        if (inp.type === "checkbox") {
          taskRows[i][f] = inp.checked;
        } else {
          taskRows[i][f] = inp.value;
          // linkUrl 변경 시 MID 자동 갱신
          if (f === "linkUrl") {
            taskRows[i].mid = extractMid(inp.value);
            renderTaskTable();
          }
        }
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
  return taskRows.filter((row) => row.checked && row.keyword?.trim() && row.linkUrl?.trim());
}

function validateCheckedRows() {
  syncAllTaskRowsFromDom();
  const checked = taskRows.filter((r) => r.checked);
  if (!checked.length) return "작업할 행을 체크하세요";
  for (const r of checked) {
    if (!r.keyword?.trim()) return `"${r.linkUrl || '빈 행'}": 검색 키워드를 입력하세요`;
    if (!r.linkUrl?.trim()) return `"${r.keyword}": 상품 URL을 입력하세요`;
    if (!extractMid(r.linkUrl)) return `"${r.keyword}": URL에서 MID를 추출할 수 없습니다 (/products/숫자 형식 필요)`;
  }
  const flow = document.getElementById("searchFlowVersion").value;
  if (flow !== "D") {
    const noTarget = checked.filter((r) => !r.targetCount || r.targetCount <= 0);
    if (noTarget.length) return `"${noTarget[0].keyword}": 목표 횟수를 입력하세요 (0=무제한은 불가)`;
  }
  return null;
}

function buildTaskFromRow(row) {
  return {
    keyword: row.keyword.trim(),
    linkUrl: row.linkUrl.trim(),
    slotSequence: 0,
    keywordName: row.keywordName?.trim() || undefined,
    // 순위체크에서 수집한 Catalog MID (쇼핑 검색결과 nv_mid= 매칭용)
    catalogMid: row.mid && row.mid !== extractMid(row.linkUrl) ? row.mid : undefined,
    // 순위체크에서 수집한 상품 풀네임 (2차 검색어로 사용)
    productTitle: row.productTitle || undefined,
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
  const resMid = (res.task?.mid || "").trim();
  if (!kw || !url) return;
  // URL 완전 일치 우선, 실패 시 MID로 폴백 매칭
  const row = taskRows.find((r) => r.keyword.trim() === kw && r.linkUrl.trim() === url)
    || (resMid ? taskRows.find((r) => r.keyword.trim() === kw && extractMid(r.linkUrl) === resMid) : null);
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
      // Catalog MID 수집 (검색용 실제 MID)
      if (res.catalogMid) {
        row.mid = res.catalogMid;
      }
      // 상품 제목 수집 (트래픽 2차 검색어로 사용)
      if (res.extractedProductTitle && !row.productTitle) {
        row.productTitle = res.extractedProductTitle.trim();
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
    logLine("실행할 작업이 없습니다. (키워드/URL 입력 필요)");
    return;
  }

  // 목표 미달성 행만 필터링
  const pendingRows = rows.filter((r) => {
    if (!r.targetCount || r.targetCount <= 0) return true; // 목표 0=무제한
    return (r.trafficOk || 0) < r.targetCount;
  });

  if (!pendingRows.length) {
    logLine("모든 작업이 일일 목표를 달성했습니다. 자동 중지합니다.");
    stopInfiniteRun();
    await window.engineApi.runnerStop();
    setStopped();
    return;
  }

  const idx = infiniteTaskIndex % pendingRows.length;
  infiniteTaskIndex += 1;
  const row = pendingRows[idx];
  const task = buildTaskFromRow(row);
  const target = row.targetCount > 0 ? `(${row.trafficOk || 0}/${row.targetCount})` : "";
  await saveConfigToDisk();
  await window.engineApi.writeTaskFile(task);
  logLine(`큐 등록 [${idx + 1}/${pendingRows.length}] ${target}: ${task.keyword.substring(0, 24)}`);
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

// ============ Auth ============
function showLoginOverlay() {
  const overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "flex";
  const emailInput = document.getElementById("loginEmail");
  if (emailInput) emailInput.focus();

  document.getElementById("btnLogin").onclick = handleLogin;
  document.getElementById("loginPassword").onkeydown = (e) => {
    if (e.key === "Enter") handleLogin();
  };
  document.getElementById("loginEmail").onkeydown = (e) => {
    if (e.key === "Enter") document.getElementById("loginPassword").focus();
  };
}

function hideLoginOverlay() {
  const overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "none";
}

async function handleLogin() {
  const btn = document.getElementById("btnLogin");
  const errEl = document.getElementById("loginError");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    errEl.textContent = "이메일과 비밀번호를 입력하세요";
    return;
  }

  btn.disabled = true;
  btn.textContent = "로그인 중...";
  errEl.textContent = "";

  try {
    const result = await window.engineApi.authLogin(email, password);
    if (result.ok) {
      hideLoginOverlay();
      logLine(`로그인 성공: ${result.user.email}`);
      await initApp();
    } else {
      errEl.textContent = result.error || "로그인 실패";
    }
  } catch (e) {
    errEl.textContent = "연결 오류: " + (e?.message || String(e));
  } finally {
    btn.disabled = false;
    btn.textContent = "로그인";
  }
}

async function init() {
  // Supabase 설정 여부 확인
  const authAvailable = await window.engineApi.isAuthAvailable();
  if (authAvailable) {
    // 매번 로그인 요구 (세션 미저장)
    showLoginOverlay();
    return;
  }
  // Supabase 미설정 시 인증 없이 진행
  await initApp();
}

async function initApp() {
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
    const err = validateCheckedRows();
    if (err) {
      logLine("시작 불가: " + err);
      return;
    }
    try {
      const flow = document.getElementById("searchFlowVersion").value;
      if (flow === "D") {
        await startRunner(true);
      } else {
        await startInfiniteRunner();
      }
    } catch (e) {
      logLine("시작 처리 오류: " + (e?.message || String(e)));
    }
  };

  // 전체 선택 체크박스
  document.getElementById("checkAll").addEventListener("change", (e) => {
    const checked = e.target.checked;
    taskRows.forEach((r) => { r.checked = checked; });
    renderTaskTable();
    document.getElementById("checkAll").checked = checked;
  });
  document.getElementById("btnStop").onclick = async () => {
    stopInfiniteRun(true);
    await window.engineApi.runnerStop();
    setStopped();
    logLine("중지 요청");
  };

  function updateSecondKeywordHeader() {
    const flow = document.getElementById("searchFlowVersion").value;
    const th = document.getElementById("thSecondKeyword");
    if (!th) return;
    const labels = { A: "2차 키워드 (선택)", B: "2차 키워드 (미사용)", C: "2차 키워드 (필수)", D: "2차 키워드 (미사용)" };
    th.textContent = labels[flow] || "2차 키워드 (선택)";
  }
  document.getElementById("searchFlowVersion").addEventListener("change", updateSecondKeywordHeader);
  updateSecondKeywordHeader();

  document.getElementById("btnAddApiKey").onclick = () => {
    apiKeys.push({ name: "", key: "" });
    if (apiKeys.length === 1) apiKeySelectedIdx = 0;
    renderApiKeyList();
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
