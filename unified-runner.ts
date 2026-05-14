/**
 * Unified Runner - Patchright + 외부 엔진 파일 연동 (DB/Supabase 없음)
 *
 * 실행: npx tsx unified-runner.ts [--once]
 *
 * 워크플로우:
 * 1. (선택) USB ADB 모바일 데이터 OFF→ON — STARTUP_MOBILE_DATA_TOGGLE=false
 * 2. 엔진이 두는 JSON(engine-next-task.json) 1건 소비 → 브라우저 자동화
 * 3. 완료 시 결과를 engine-last-result.json(설정 가능)에 기록 → 엔진에서 표시
 * 4. (선택) naver-account.txt → nid 로그인 후 m.naver.com 검색 플로우
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";

// Chrome/Puppeteer Temp 폴더 설정
// D 드라이브 있으면 D:\temp, 없으면 C:\turafic\temp 사용
const getDriveLetter = () => {
  try {
    if (fs.existsSync('D:\\')) {
      return 'D:\\temp';
    }
  } catch (e) {}
  // D 드라이브 없으면 C:\turafic\temp 사용
  return 'C:\\turafic\\temp';
};

const TEMP_DIR = getDriveLetter();
try {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  process.env.TEMP = TEMP_DIR;
  process.env.TMP = TEMP_DIR;
  process.env.TMPDIR = TEMP_DIR;
  console.log(`[TEMP] Using: ${TEMP_DIR}`);
} catch (e: any) {
  console.error(`[TEMP] Failed to create temp dir: ${e.message}`);
  console.error(`[TEMP] Using system default temp dir`);
}

// .env 로드 (place_all 쇼핑트레픽과 동일: .env.local 우선, 루트 .env fallback)
const envPaths = [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env'),
  'C:\\turafic\\.env',
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}

import "./pw-version-override";
import { chromium, type Page, type Browser, type BrowserContext, type Locator } from "patchright";
import { getCurrentIP, toggleAdbMobileDataOffOn } from "./ipRotation";
import {
  loadEngineConfig,
  buildEngineRuntime,
  resolveMobileForTask,
  pickUserAgent,
  pickProxyConfig,
  buildBrowserContextOptions,
  type EngineRuntime,
  type SearchFlowVersion,
} from "./engine-config";
import { connect } from "puppeteer-real-browser";
import { ReceiptCaptchaSolverPRB } from "./captcha/ReceiptCaptchaSolverPRB";
import { applyMobileStealth } from "./shared/mobile-stealth";
import { type RankCheckPage, collectVisibleSearchMidDebug } from "./rank-check-shopping";
import { runRankCheckFlow } from "./flows/flow-d-rank-check";
import { prepareTrafficSearchFlow } from "./flows/traffic-search-flow";
import {
  loadStrategyFile,
  normalizeStrategy,
  validateStrategy,
  type NormalizedStrategyTask,
  type NormalizedStrategyFile,
} from "./strategy-sync";

// ================================================================
//  탐지 우회 계층 구조 (Detection Bypass Layers)
// ================================================================
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  1. 네트워크 계층 (Network Layer)                           │
//  │     - 외부 IP 확인 (Heartbeat/로그용)                        │
//  ├─────────────────────────────────────────────────────────────┤
//  │  2. 브라우저 계층 (Browser Layer)                           │
//  │     - Patchright (Playwright fork, 봇 탐지 우회)            │
//  │     - 브라우저 창 위치/크기, 멀티 인스턴스                   │
//  ├─────────────────────────────────────────────────────────────┤
//  │  3. 디바이스 계층 (Device Layer)                            │
//  │     - UserAgent, Viewport, 핑거프린트                       │
//  │     - channel: 'chrome' 으로 시스템 Chrome 사용             │
//  ├─────────────────────────────────────────────────────────────┤
//  │  4. 세션/쿠키 계층 (Session/Cookie Layer)                   │
//  │     - 프로필 관리 (profiles/*.json)                         │
//  │     - 매번 새 context로 깨끗한 세션                         │
//  ├─────────────────────────────────────────────────────────────┤
//  │  5. 행동 계층 (Behavior Layer)                              │
//  │     - 베지어 곡선 마우스 (cubicBezier, bezierMouseMove)     │
//  │     - 인간화 타이핑 (humanizedType)                         │
//  │     - 자연스러운 스크롤 (humanScroll)                       │
//  │     - 랜덤 체류 시간                                         │
//  └─────────────────────────────────────────────────────────────┘
//
// ================================================================

// ============ 설정 ============
const PARALLEL_BROWSERS = Math.max(1, parseInt(process.env.PARALLEL_BROWSERS || "1", 10));  // 동시 실행 워커 수 (환경변수로 오버라이드, 기본 1)
const ONCE_MODE = process.argv.includes("--once");  // 통합 러너에서 1건만 처리 후 종료

// --strategy <path>: 전략 파일 직접 실행 모드
const STRATEGY_ARG = (() => {
  const idx = process.argv.indexOf("--strategy");
  return idx !== -1 ? process.argv[idx + 1] : undefined;
})();

// 브라우저 창 위치 (4분할 배치 - 모바일 사이트용 좁은 창)
const BROWSER_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: 0 },      // Worker 1: 좌상단
  { x: 560, y: 0 },    // Worker 2: 우상단
  { x: 0, y: 760 },    // Worker 3: 좌하단
  { x: 560, y: 760 },  // Worker 4: 우하단
];
const BROWSER_WIDTH = 560;   // 브라우저 너비 (모바일 사이트용)
const BROWSER_HEIGHT = 760;  // 브라우저 높이

/** 엔진 설정 — engine-config.json 또는 --strategy 런타임으로 초기화 */
let ENGINE = loadEngineConfig();

// ============ 상품(mid)별 2차 검색 "조합 키워드" 블랙리스트 (1차+중간단어+판매/추천 등 3단 조합 전체 문자열) ============
type BlacklistItem = { mid: string; secondCombo?: string; keyword?: string; addedAt: string };

interface KeywordBlacklistFile {
  version: number;
  items: BlacklistItem[];
}

function normalizeComboForBlacklist(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function secondComboEntryKey(mid: string, combo: string): string {
  return `${mid}\x1f${normalizeComboForBlacklist(combo)}`;
}

function storedComboFromItem(e: BlacklistItem): string {
  return normalizeComboForBlacklist(e.secondCombo || e.keyword || "");
}

function readKeywordBlacklistItems(filePath: string): BlacklistItem[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const j = JSON.parse(raw) as KeywordBlacklistFile;
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

function isSecondComboBlacklisted(runtime: EngineRuntime, mid: string, secondSearchPhrase: string): boolean {
  if (!runtime.keywordBlacklistEnabled) return false;
  const key = secondComboEntryKey(mid, secondSearchPhrase);
  const items = readKeywordBlacklistItems(runtime.keywordBlacklistPath);
  return items.some((e) => secondComboEntryKey(e.mid, storedComboFromItem(e)) === key);
}

function countBlacklistedSecondCombosForMid(runtime: EngineRuntime, mid: string): number {
  if (!runtime.keywordBlacklistEnabled) return 0;
  const targetMid = (mid || "").trim();
  if (!targetMid) return 0;
  const items = readKeywordBlacklistItems(runtime.keywordBlacklistPath);
  return items.filter((e) => (e.mid || "").trim() === targetMid).length;
}

async function appendSecondComboBlacklistEntry(
  runtime: EngineRuntime,
  mid: string,
  secondSearchPhrase: string
): Promise<void> {
  if (!runtime.keywordBlacklistEnabled) return;
  const norm = normalizeComboForBlacklist(secondSearchPhrase);
  if (!mid || !norm) return;
  const filePath = runtime.keywordBlacklistPath;
  const dir = path.dirname(filePath);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const items = readKeywordBlacklistItems(filePath);
      if (
        items.some(
          (e) => secondComboEntryKey(e.mid, storedComboFromItem(e)) === secondComboEntryKey(mid, norm)
        )
      ) {
        return;
      }
      const next: KeywordBlacklistFile = {
        version: 2,
        items: [
          ...items,
          { mid, secondCombo: norm, addedAt: new Date().toISOString() },
        ],
      };
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
      log(
        `[KeywordBlacklist] 2차 조합 등록: mid=${mid} combo="${norm.substring(0, 48)}${norm.length > 48 ? "..." : ""}" → ${filePath}`
      );
      return;
    } catch (e: any) {
      await sleep(30 + Math.floor(Math.random() * 40));
      if (attempt === 9) {
        log(`[KeywordBlacklist] 파일 저장 실패: ${e?.message ?? e}`, "warn");
      }
    }
  }
}

// ============ 타입 정의 ============
interface WorkItem {
  taskId: number;
  slotSequence: number;
  keyword: string;
  productName: string;
  mid: string;
  linkUrl: string;
  /** 2차 검색어 조합·링크 매칭용: 2차 키워드 */
  keywordName?: string;
  /** JSON에 2차 키워드가 비어 있지 않을 때만 — C모드 단일 검색어 */
  secondKeywordRaw?: string;
  /** 순위체크로 수집한 Catalog MID (nv_mid= 링크 매칭용) */
  catalogMid?: string;
  /** 순위체크로 수집한 상품 풀네임 (2차 검색어로 사용) */
  productTitle?: string;
}

interface Profile {
  name: string;
  prb_options?: {
    headless?: boolean;
    turnstile?: boolean;
  };
}

interface RunContext {
  log: (event: string, data?: any) => void;
  profile: Profile;
  login: boolean;
}


// ============ 전역 통계 ============
let totalRuns = 0;
let totalSuccess = 0;
let totalCaptcha = 0;
let totalFailed = 0;
let sessionStartTime = Date.now();
let currentIP = "";

// ============ 작업 큐 락 (동시 접근 방지) ============
let isClaimingTask = false; // 엔진 파일 수신 경합 방지

// ============ Git 업데이트 체크 ============
const GIT_CHECK_INTERVAL = 3 * 60 * 1000; // 3분마다 체크
let lastCommitHash = "";

function getCurrentCommitHash(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function checkForUpdates(): boolean {
  try {
    // fetch만 (pull 안 함). Git 진행 메시지는 사용자 로그로 노출하지 않는다.
    execSync("git fetch --quiet origin main", {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const remoteHash = execSync("git rev-parse origin/main", { encoding: "utf8", timeout: 5000 }).trim();
    const localHash = getCurrentCommitHash();

    if (remoteHash && localHash && remoteHash !== localHash) {
      return true; // 업데이트 있음
    }
    return false;
  } catch {
    return false;
  }
}

function startGitUpdateChecker(): void {
  if (process.env.SKIP_GIT_UPDATE_CHECK === "1") {
    return;
  }
  // 현재 커밋 해시 저장
  lastCommitHash = getCurrentCommitHash();

  setInterval(() => {
    if (checkForUpdates()) {
      // 런처가 재시작해줌
      process.exit(0);
    }
  }, GIT_CHECK_INTERVAL);
}

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg: string, level: "info" | "warn" | "error" = "info") {
  const time = new Date().toISOString().substring(11, 19);
  const prefix = { info: "[INFO]", warn: "[WARN]", error: "[ERROR]" }[level];
  console.log(`[${time}] ${prefix} ${msg}`);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function isMobileBrowserPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent || "";
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
    const width = Math.min(
      window.innerWidth || Number.MAX_SAFE_INTEGER,
      document.documentElement?.clientWidth || Number.MAX_SAFE_INTEGER,
      screen.width || Number.MAX_SAFE_INTEGER
    );
    return uaMobile || (navigator.maxTouchPoints > 0 && width <= 768);
  }).catch(() => false);
}

function randomKeyDelay(): number {
  return 30 + Math.random() * 30;
}

// ============ [행동 계층] 베지어 곡선 마우스 ============
// 봇 탐지 우회: 직선이 아닌 자연스러운 곡선으로 마우스 이동
interface Point { x: number; y: number; }

function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
  };
}

function generateBezierPath(start: Point, end: Point, steps: number): Point[] {
  const path: Point[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(distance * 0.3, 100);

  const cp1: Point = {
    x: start.x + dx * 0.25 + (Math.random() - 0.5) * curvature,
    y: start.y + dy * 0.1 + (Math.random() - 0.5) * curvature
  };
  const cp2: Point = {
    x: start.x + dx * 0.75 + (Math.random() - 0.5) * curvature,
    y: start.y + dy * 0.9 + (Math.random() - 0.5) * curvature
  };

  for (let i = 0; i <= steps; i++) {
    let t = i / steps;
    t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const point = cubicBezier(t, start, cp1, cp2, end);
    point.x += (Math.random() - 0.5) * 2;
    point.y += (Math.random() - 0.5) * 2;
    path.push(point);
  }
  return path;
}

async function bezierMouseMove(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
  const steps = Math.floor(Math.min(40, Math.max(20, distance / 10)));
  const path = generateBezierPath({ x: fromX, y: fromY }, { x: toX, y: toY }, steps);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await sleep(randomBetween(2, 8));
  }
}

// CDP 세션 캐시
const cdpSessions = new Map<Page, any>();

async function getCDPSession(page: Page): Promise<any> {
  if (!cdpSessions.has(page)) {
    const client = await page.context().newCDPSession(page);
    cdpSessions.set(page, client);
  }
  return cdpSessions.get(page)!;
}

// ============ [행동 계층] 인간화 스크롤 (모바일 터치 제스처) ============
// 봇 탐지 우회: CDP synthesizeScrollGesture로 진짜 터치 스크롤 시뮬레이션
async function humanScroll(page: Page, targetY: number): Promise<void> {
  const viewport = page.viewportSize();

  // viewport가 없거나 너무 작으면 폴백: 일반 스크롤
  if (!viewport || viewport.width < 100 || viewport.height < 100) {
    await page.evaluate((y) => window.scrollBy(0, y), targetY).catch(() => {});
    await sleep(500);
    return;
  }

  const client = await getCDPSession(page);
  // x, y는 최소 50 이상 보장 (CDP 파라미터 범위 에러 방지)
  const x = Math.max(50, Math.floor(viewport.width / 2));
  const y = Math.max(50, Math.floor(viewport.height / 2));

  let scrolled = 0;
  while (scrolled < targetY) {
    const step = 100 + Math.random() * 150;

    try {
      // CDP로 모바일 터치 스크롤 제스처 시뮬레이션
      await client.send('Input.synthesizeScrollGesture', {
        x: x,
        y: y,
        yDistance: -Math.floor(step),  // 음수 = 아래로 스크롤
        xDistance: 0,
        speed: Math.min(1200, Math.max(600, Math.floor(randomBetween(800, 1200)))),  // 600~1200 범위 제한
        gestureSourceType: 'touch',
        repeatCount: 1,
        repeatDelayMs: 0,
      });
    } catch (e: any) {
      // CDP 실패 시 폴백: 일반 스크롤
      await page.evaluate((s) => window.scrollBy(0, s), step).catch(() => {});
    }

    scrolled += step;
    await sleep(80 + Math.random() * 60);
  }
}

/** 모바일 통합검색(m.search): 쇼핑 블록이 아래에 있을 때 window가 아닌 #ct 등이 스크롤된다. */
async function scrollIntegratedSearchPageDown(page: Page, deltaY: number): Promise<void> {
  await page
    .evaluate((dy) => {
      const hints = ["#ct", "#content", "#main_pack", ".api_subject_bx", ".sc_new", "#wrap", "main"];
      for (const sel of hints) {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement) {
          const sh = el.scrollHeight;
          const ch = el.clientHeight;
          if (sh > ch + 50) {
            const max = sh - ch;
            el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + dy));
            return true;
          }
        }
      }
      let best: HTMLElement | null = null;
      let bestExcess = 0;
      for (const el of document.body.querySelectorAll("div")) {
        if (!(el instanceof HTMLElement)) continue;
        const st = getComputedStyle(el);
        if (st.overflowY !== "scroll" && st.overflowY !== "auto") continue;
        const excess = el.scrollHeight - el.clientHeight;
        if (excess > bestExcess && excess > 100) {
          bestExcess = excess;
          best = el;
        }
      }
      if (best) {
        const max = best.scrollHeight - best.clientHeight;
        best.scrollTop = Math.min(max, Math.max(0, best.scrollTop + dy));
        return true;
      }
      window.scrollBy(0, dy);
      return true;
    }, deltaY)
    .catch(() => {});
  await sleep(120 + Math.floor(Math.random() * 120));
}

/**
 * 스마트스토어/브랜드 모바일 상세는 window가 아니라 내부 overflow 영역이 스크롤된다.
 * CDP synthesizeScrollGesture만으로는 움직임이 없는 경우가 많아 scrollTop + mouse.wheel 병행.
 */
async function scrollSmartstoreDetailBy(page: Page, deltaY: number): Promise<void> {
  const applied = await page
    .evaluate((dy) => {
      const pickScrollTarget = (): Element => {
        const hints = ["#wrap", "main", "#content", "#__next", '[id*="layout"]', ".container"];
        for (const sel of hints) {
          const el = document.querySelector(sel);
          if (el instanceof HTMLElement) {
            const sh = el.scrollHeight;
            const ch = el.clientHeight;
            if (sh > ch + 60) return el;
          }
        }
        let best: HTMLElement | null = null;
        let bestExcess = 0;
        const nodes = document.body.querySelectorAll("div, main, section, article");
        for (const el of nodes) {
          if (!(el instanceof HTMLElement)) continue;
          const st = getComputedStyle(el);
          if (st.overflowY !== "scroll" && st.overflowY !== "auto") continue;
          const excess = el.scrollHeight - el.clientHeight;
          if (excess > bestExcess && excess > 100) {
            bestExcess = excess;
            best = el;
          }
        }
        return best || (document.scrollingElement as Element) || document.documentElement;
      };

      const target = pickScrollTarget();
      const docEl = document.documentElement;
      const body = document.body;
      if (target === docEl || target === body || target === document.scrollingElement) {
        window.scrollBy(0, dy);
        return true;
      }
      if (target instanceof HTMLElement) {
        const max = target.scrollHeight - target.clientHeight;
        const next = Math.max(0, Math.min(max, target.scrollTop + dy));
        if (next !== target.scrollTop) {
          target.scrollTop = next;
          return true;
        }
      }
      window.scrollBy(0, dy);
      return true;
    }, deltaY)
    .catch(() => false);
  if (!applied) {
    await page.evaluate((dy) => window.scrollBy(0, dy), deltaY).catch(() => {});
  }
  await sleep(160 + Math.floor(Math.random() * 140));
}

/** G모드 상세: 메인 스크롤 컨테이너 + 뷰포트 휠로 아래→위→아래 */
async function gModeDetailPageOscillateScroll(page: Page, engine: EngineRuntime): Promise<void> {
  const base = Math.min(520, Math.max(220, engine.explorationScrollPixels));
  const down1 = Math.floor(base * 0.55);
  const up = -Math.floor(base * 0.38);
  const down2 = Math.floor(base * 0.3);

  await scrollSmartstoreDetailBy(page, down1);
  await sleep(engine.delay("explorationBetweenScrolls"));
  await scrollSmartstoreDetailBy(page, up);
  await sleep(engine.delay("explorationBetweenScrolls"));
  await scrollSmartstoreDetailBy(page, down2);

  const vp = page.viewportSize();
  if (vp && vp.width > 80 && vp.height > 80) {
    const cx = Math.max(20, Math.floor(vp.width / 2));
    const cy = Math.max(20, Math.floor(vp.height * 0.45));
    try {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, 340);
      await sleep(220 + Math.floor(Math.random() * 120));
      await page.mouse.wheel(0, -200);
      await sleep(200 + Math.floor(Math.random() * 100));
      await page.mouse.wheel(0, 140);
    } catch {
      /* 휠 미지원 환경 등 */
    }
  }

  await sleep(200 + Math.floor(Math.random() * 160));
}

// ============ [행동 계층] 인간화 타이핑 ============
// 봇 탐지 우회: 랜덤한 키 입력 딜레이 (30~60ms)
async function humanizedType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await sleep(randomBetween(250, 600));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomKeyDelay() });
  }
}

// ============ 네이버 계정 파일 자동 로그인 (선택) ============
// naver-account.txt: 1줄 아이디, 2줄 비밀번호 (# 으로 시작하는 줄은 주석)
const NAVER_LOGIN_URL =
  "https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com/";

const NAVER_ACCOUNT_PATHS = [
  path.join(process.cwd(), "naver-account.txt"),
  path.join(__dirname, "naver-account.txt"),
];

type NaverAccountRead =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "ok"; id: string; pw: string };

function getNaverLoginStorageStatePaths(profileName: string): string[] {
  return [
    path.join(process.cwd(), "profiles", `${profileName}.storage-state.json`),
    path.join(__dirname, "profiles", `${profileName}.storage-state.json`),
  ];
}

function resolveExistingNaverLoginStorageStatePath(profileName: string): string | null {
  for (const p of getNaverLoginStorageStatePaths(profileName)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveWritableNaverLoginStorageStatePath(profileName: string): string {
  return getNaverLoginStorageStatePaths(profileName)[0];
}

function readNaverAccountFile(): NaverAccountRead {
  let found: string | null = null;
  for (const p of NAVER_ACCOUNT_PATHS) {
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
  }
  if (!found) return { status: "absent" };

  const raw = fs.readFileSync(found, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    log("[NaverLogin] naver-account.txt: 아이디·비밀번호 2줄 필요", "warn");
    return { status: "invalid" };
  }
  return { status: "ok", id: lines[0], pw: lines[1] };
}

async function typeNaverLoginField(page: Page, fieldSelector: string, value: string): Promise<void> {
  await page.locator(fieldSelector).click({ force: true });
  await sleep(randomBetween(200, 400));
  await page.keyboard.press("Control+a");
  await sleep(40);
  await page.keyboard.press("Backspace");
  await sleep(80);
  for (const char of value) {
    await page.keyboard.type(char, { delay: randomKeyDelay() });
  }
}

async function waitForNaverLoginCompletion(
  page: Page | any,
  workerId: number,
  label: string,
  timeoutMs = 45000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!page.url().includes("nidlogin.login")) {
      await sleep(randomBetween(1500, 2500));
      log(`[Worker ${workerId}] 네이버 로그인 완료${label ? ` (${label})` : ""}`);
      return true;
    }
  }

  log(
    `[Worker ${workerId}] 네이버 로그인 타임아웃${label ? ` (${label})` : ""} (로그인 페이지 이탈 없음)`,
    "warn"
  );
  return false;
}

async function persistNaverLoginStorageState(
  context: BrowserContext | null,
  profileName: string,
  workerId: number
): Promise<void> {
  if (!context) return;
  const targetPath = resolveWritableNaverLoginStorageStatePath(profileName);
  const dir = path.dirname(targetPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await context.storageState({ path: targetPath });
    log(`[Worker ${workerId}] 네이버 세션 저장 완료: ${targetPath}`);
  } catch (e: any) {
    log(`[Worker ${workerId}] 네이버 세션 저장 실패: ${e?.message ?? e}`, "warn");
  }
}

/** naver-account.txt 없으면 true. 있으면 로그인 성공 시 true, 형식 오류·로그인 실패 시 false */
async function ensureNaverLoginIfConfigured(
  page: Page,
  workerId: number,
  context: BrowserContext | null,
  profileName: string,
  ignoreStoredSession = false
): Promise<boolean> {
  const storedPath = resolveExistingNaverLoginStorageStatePath(profileName);
  if (storedPath && !ignoreStoredSession) {
    log(`[Worker ${workerId}] 네이버 저장 세션 사용: ${storedPath}`);
    return true;
  }

  const r = readNaverAccountFile();
  if (r.status === "absent") return true;
  if (r.status === "invalid") return false;

  const acc = r;
  const masked =
    acc.id.length <= 4 ? "****" : `${acc.id.slice(0, 2)}…${acc.id.slice(-2)}`;
  log(`[Worker ${workerId}] 네이버 로그인 (${masked})`);

  try {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(randomBetween(1000, 1800));

    await page.locator("#id").waitFor({ state: "visible", timeout: 20000 });
    await typeNaverLoginField(page, "#id", acc.id);
    await sleep(randomBetween(400, 700));
    await typeNaverLoginField(page, "#pw", acc.pw);
    await sleep(randomBetween(500, 900));

    const loginBtn = page
      .locator("#log\\.login")
      .or(page.locator('button[type="submit"]'))
      .first();
    await loginBtn.click();
    const ok = await waitForNaverLoginCompletion(page, workerId, "자동");
    if (ok) {
      await persistNaverLoginStorageState(context, profileName, workerId);
    }
    return ok;
  } catch (e: any) {
    log(`[Worker ${workerId}] 네이버 로그인 예외: ${e.message}`, "warn");
    return false;
  }
}

async function ensureNaverLoginManually(
  page: Page,
  workerId: number,
  context: BrowserContext | null,
  profileName: string
): Promise<boolean> {
  try {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(randomBetween(1000, 1800));
    await page.locator("#id").waitFor({ state: "visible", timeout: 20000 });
    log(`[Worker ${workerId}] 네이버 수동 로그인 대기 중 - 브라우저에서 직접 로그인하세요.`);
    const ok = await waitForNaverLoginCompletion(page, workerId, "수동", 5 * 60 * 1000);
    if (ok) {
      await persistNaverLoginStorageState(context, profileName, workerId);
    }
    return ok;
  } catch (e: any) {
    log(`[Worker ${workerId}] 네이버 수동 로그인 예외: ${e.message}`, "warn");
    return false;
  }
}

/** D모드(start.bat=puppeteer-real-browser) 전용 로그인 — Playwright locator 미사용 */
async function ensureNaverLoginPrbPage(page: any, workerId: number): Promise<boolean> {
  const r = readNaverAccountFile();
  if (r.status === "absent") return true;
  if (r.status === "invalid") return false;

  const acc = r;
  const masked =
    acc.id.length <= 4 ? "****" : `${acc.id.slice(0, 2)}…${acc.id.slice(-2)}`;
  log(`[Worker ${workerId}] 네이버 로그인 PRB (${masked})`);

  try {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(randomBetween(1000, 1800));

    await page.waitForSelector("#id", { visible: true, timeout: 20000 });
    await page.click("#id", { clickCount: 3 });
    await page.keyboard.type(acc.id, { delay: randomKeyDelay() });
    await sleep(randomBetween(400, 700));

    await page.waitForSelector("#pw", { visible: true, timeout: 10000 });
    await page.click("#pw", { clickCount: 3 });
    await page.keyboard.type(acc.pw, { delay: randomKeyDelay() });
    await sleep(randomBetween(500, 900));

    const loginClicked = await page.evaluate(() => {
      const el = document.getElementById("log.login");
      if (el) {
        el.click();
        return true;
      }
      const s = document.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (s) {
        s.click();
        return true;
      }
      return false;
    });

    if (!loginClicked) {
      log(`[Worker ${workerId}] 로그인 버튼 없음(PRb)`, "warn");
      return false;
    }
    return await waitForNaverLoginCompletion(page, workerId, "PRb", 45000);
  } catch (e: any) {
    log(`[Worker ${workerId}] 네이버 로그인 예외(PRb): ${e.message}`, "warn");
    return false;
  }
}

// ============ [행동 계층] 상품명 단어 셔플 ============
// 봇 탐지 우회: 검색 패턴 다변화
function shuffleWords(productName: string): string {
  const cleaned = productName
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return cleaned;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(' ');
}

// ============ Chrome Temp 폴더 정리 (D드라이브) ============
function cleanupChromeTempFolders(): void {
  const tempDirs = ['D:\\temp', 'D:\\tmp'];
  let totalCleaned = 0;

  for (const tempDir of tempDirs) {
    if (!fs.existsSync(tempDir)) continue;

    try {
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });

      for (const entry of entries) {
        // Chrome/Puppeteer 관련 임시 폴더 패턴
        if (entry.isDirectory() && (
          entry.name.startsWith('puppeteer_') ||
          entry.name.startsWith('lighthouse') ||
          entry.name.startsWith('chrome_') ||
          entry.name.startsWith('.org.chromium.') ||
          entry.name.startsWith('scoped_dir')
        )) {
          const folderPath = path.join(tempDir, entry.name);
          try {
            fs.rmSync(folderPath, { recursive: true, force: true });
            totalCleaned++;
          } catch {
            // 사용 중인 폴더는 무시
          }
        }
      }
    } catch {
      // 폴더 접근 실패 무시
    }
  }

  if (totalCleaned > 0) {
    log(`Temp 폴더 정리: ${totalCleaned}개 삭제`);
  }
}

// ============ [세션 계층] 프로필 로드 ============
// 세션 관리: 프로필별 브라우저 설정 로드
function loadProfile(profileName: string): Profile {
  const profilePath = path.join(__dirname, 'profiles', `${profileName}.json`);
  if (fs.existsSync(profilePath)) {
    const content = fs.readFileSync(profilePath, 'utf-8');
    return JSON.parse(content);
  }
  // 기본 프로필
  return {
    name: profileName,
    prb_options: {
      headless: false,
      turnstile: true
    }
  };
}

// ============ link_url에서 상품 MID 추출 (smartstore/brand /products/숫자) ============
function extractMidFromLinkUrl(linkUrl: string | null | undefined): string | null {
  if (!linkUrl || typeof linkUrl !== "string") return null;
  const m = linkUrl.match(/\/products\/(\d+)/);
  return m ? m[1] : null;
}

// ============ 풀제목 → 조합형 키워드 (당일 1번 식별용: 공백 제거) ============
function toCombinedKeyword(fullTitle: string): string {
  return (fullTitle || "").replace(/\s+/g, "").trim() || "상품";
}

// ============ 2차 검색용: 띄어쓰기 기준 단어 셔플 (당일 미사용 조합용) ============
function shuffleWordsForSearch(fullTitle: string): string {
  const trimmed = (fullTitle || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "상품";
  const words = trimmed.split(" ").filter(Boolean);
  if (words.length <= 1) return trimmed;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(" ");
}

// 1차 검색용 인기 키워드 (사용자가 검색할 만한 키워드만, 뷁 같은 비검색형 제외)
// data/popular-search-keywords.json 에서 로드, 없으면 내장 fallback 사용 (최대 1만개 확장 가능)
let POPULAR_SEARCH_KEYWORDS: string[] = [];
function loadPopularSearchKeywords(): string[] {
  if (POPULAR_SEARCH_KEYWORDS.length > 0) return POPULAR_SEARCH_KEYWORDS;
  const jsonPath = path.join(process.cwd(), "data", "popular-search-keywords.json");
  try {
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr) && arr.length > 0) {
        POPULAR_SEARCH_KEYWORDS = arr.filter((k) => typeof k === "string" && k.trim().length > 0);
        return POPULAR_SEARCH_KEYWORDS;
      }
    }
  } catch (e) {}
  // fallback: 검색 가능한 인기 키워드
  POPULAR_SEARCH_KEYWORDS = [
    "쇼핑", "노트북", "무선이어폰", "마스크", "키보드", "원피스", "패딩", "운동화", "백팩", "화장품",
    "선크림", "샴푸", "TV", "휴대폰", "이불", "노트", "충전기", "의자", "선풍기", "에어프라이어",
    "세탁기", "드라이기", "보조배터리", "케이스", "스마트워치", "레깅스", "맨투맨", "니트", "청바지",
    "가방", "지갑", "시계", "목걸이", "캠핑", "텐트", "등산", "자전거", "골프", "요가", "다이어트",
    "과자", "커피", "건강식품", "홍삼", "비타민", "반려동물", "사료", "유아옷", "침대", "소파",
    "커튼", "정원", "공구", "드릴", "화분", "선물", "도서", "문구", "필기구", "인테리어"
  ];
  return POPULAR_SEARCH_KEYWORDS;
}
function getRandomFirstSearchKeyword(): string {
  const list = loadPopularSearchKeywords();
  return list[Math.floor(Math.random() * list.length)] || "쇼핑";
}

// 2차 검색(조합형) 당일 1번만 작업: 사용한 조합형 키워드 집합, 00시 리셋
let usedCombinedKeywordsToday = new Set<string>();
// Fisher–Yates 셔플 결과(단어 조합) 당일 중복 방지: 사용한 2차 검색어 조합 집합, 00시 리셋
let usedShuffledPhrasesToday = new Set<string>();
let lastUsedDate = ""; // YYYY-MM-DD
function resetUsedKeywordsIfNewDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (lastUsedDate !== today) {
    usedCombinedKeywordsToday.clear();
    usedShuffledPhrasesToday.clear();
    lastUsedDate = today;
  }
}
function isCombinedKeywordUsedToday(combined: string): boolean {
  return usedCombinedKeywordsToday.has(combined);
}
function markCombinedKeywordUsedToday(combined: string): void {
  usedCombinedKeywordsToday.add(combined);
}
// 당일 아직 사용하지 않은 셔플 조합만 반환. 00시가 되면 다시 사용 가능.
function getShuffleForSearchNotUsedToday(fullTitle: string): string {
  const trimmed = (fullTitle || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "상품";
  const words = trimmed.split(" ").filter(Boolean);
  if (words.length <= 1) return trimmed;
  const maxTries = 100;
  for (let tryCount = 0; tryCount < maxTries; tryCount++) {
    const shuffled = [...words];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const phrase = shuffled.join(" ");
    if (!usedShuffledPhrasesToday.has(phrase)) {
      usedShuffledPhrasesToday.add(phrase);
      return phrase;
    }
  }
  const fallback = shuffleWordsForSearch(fullTitle);
  usedShuffledPhrasesToday.add(fallback);
  return fallback;
}

// ============ 외부 엔진용: JSON 파일 1건 큐잉 (rename으로 원자적 소비) ============
/** engine-next-task.json 등 — 스키마는 engine-next-task.example.json 참고 */
interface EngineTaskJsonFile {
  keyword?: string;
  linkUrl?: string;
  link_url?: string;
  url?: string;
  slotSequence?: number;
  slot_sequence?: number;
  keywordName?: string;
  keyword_name?: string;
  secondKeyword?: string;
  second_keyword?: string;
  /** 1차 키워드 추가 후보 (블랙이면 순서대로 시도) */
}

function tryClaimWorkItemFromEngineFile(): WorkItem | null {
  const filePath = ENGINE.engineTaskFilePath;
  const processingPath = `${filePath}.processing`;

  try {
    fs.renameSync(filePath, processingPath);
  } catch {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(processingPath, "utf-8");
  } catch {
    try {
      fs.unlinkSync(processingPath);
    } catch {}
    return null;
  }

  let data: EngineTaskJsonFile;
  try {
    data = JSON.parse(raw) as EngineTaskJsonFile;
  } catch {
    log(`[EngineFile] JSON 파싱 실패: ${processingPath}`, "warn");
    try {
      fs.unlinkSync(processingPath);
    } catch {}
    return null;
  }

  const keyword = (data.keyword || "").trim();
  const linkUrl = (data.linkUrl || data.link_url || data.url || "").trim();
  const slotSequence = Math.floor(Number(data.slotSequence ?? data.slot_sequence ?? 0));
  const keywordNameRaw = (
    data.secondKeyword ??
    data.second_keyword ??
    data.keywordName ??
    data.keyword_name ??
    ""
  ).trim();

  if (!keyword || !linkUrl) {
    log(`[EngineFile] keyword·linkUrl 필수 — 처리본 삭제`, "warn");
    try {
      fs.unlinkSync(processingPath);
    } catch {}
    return null;
  }

  const mid = extractMidFromLinkUrl(linkUrl);
  if (!mid) {
    log(`[EngineFile] linkUrl에서 mid 추출 불가 — ${linkUrl}`, "warn");
    try {
      fs.unlinkSync(processingPath);
    } catch {}
    return null;
  }

  const keywordName = keywordNameRaw || keyword;
  const productName = keywordName;

  if (!keywordNameRaw) {
    log(`[EngineFile] 2차 키워드 생략 — 매칭·2차 검색에 keyword 사용`, "warn");
  }

  // 무제한 실행 GUI에서는 동일 작업 반복이 기본 동작이므로
  // 일일 조합형 중복 차단은 기본 비활성화한다.
  // 필요 시 ENGINE_BLOCK_DAILY_COMBINED=1 로 기존 차단 로직을 다시 켤 수 있다.
  if (process.env.ENGINE_BLOCK_DAILY_COMBINED === "1") {
    resetUsedKeywordsIfNewDay();
    const combined = toCombinedKeyword(productName);
    if (isCombinedKeywordUsedToday(combined)) {
      log(
        `[EngineFile] 당일 동일 조합형 이미 처리됨 — 파일 복구 후 스킵: ${combined.substring(0, 36)}...`,
        "warn"
      );
      try {
        fs.renameSync(processingPath, filePath);
      } catch {
        try {
          fs.unlinkSync(processingPath);
        } catch {}
      }
      return null;
    }
    markCombinedKeywordUsedToday(combined);
  }
  try {
    fs.unlinkSync(processingPath);
  } catch {}

  const taskId = Date.now();
  log(
    `[EngineFile] 작업 수락: 1차="${keyword.substring(0, 24)}..." slot_sequence=${slotSequence || 0} mid=${mid}`
  );

  const catalogMid = ((data as any).catalogMid || "").trim() || undefined;

  return {
    taskId,
    slotSequence,
    keyword,
    productName,
    mid,
    linkUrl,
    keywordName,
    secondKeywordRaw: keywordNameRaw.length > 0 ? keywordNameRaw : undefined,
    catalogMid,
  };
}

// ============ 전략 파일 직접 실행 큐 ============
interface StrategyQueue {
  tasks: NormalizedStrategyTask[];
  runCounts: Map<string, number>; // mid -> 실행 시작 횟수
  cursor: number;
  done: boolean;
}

let strategyQueue: StrategyQueue | null = null;

function buildBrowserChannelCandidates(): Array<string | undefined> {
  const explicit = process.env.PLAYWRIGHT_BROWSER_CHANNEL || process.env.BROWSER_CHANNEL;
  if (explicit && explicit.trim()) return [explicit.trim()];
  return ["chrome", "msedge", undefined];
}

async function launchChromiumWithChannelFallback(browserLaunchOptions: any): Promise<Browser> {
  let lastError: unknown;
  for (const channel of buildBrowserChannelCandidates()) {
    const options = { ...browserLaunchOptions };
    if (channel) options.channel = channel;
    else delete options.channel;
    try {
      return await chromium.launch(options);
    } catch (e) {
      lastError = e;
      const msg = String((e as any)?.message || e || "");
      if (!/Executable doesn't exist|Failed to launch|channel/i.test(msg)) throw e;
    }
  }
  throw lastError ?? new Error("chromium launch failed");
}

function reloadEngineConfigForNextClaim(): void {
  const previous = ENGINE;
  const next = loadEngineConfig();
  ENGINE = next;

  if (
    previous.searchFlowVersion !== next.searchFlowVersion ||
    previous.workMode !== next.workMode ||
    previous.proxyEnabled !== next.proxyEnabled ||
    previous.engineTaskFilePath !== next.engineTaskFilePath ||
    previous.engineResultFilePath !== next.engineResultFilePath
  ) {
    log(
      `[EngineConfig] 설정 재로드: 검색모드 ${previous.searchFlowVersion}→${next.searchFlowVersion}, ` +
        `workMode ${previous.workMode}→${next.workMode}, proxy ${previous.proxyEnabled}→${next.proxyEnabled}`
    );
  }
}

function createStrategyQueue(strategy: NormalizedStrategyFile): StrategyQueue {
  const tasks = strategy.tasks.filter((t) => t.checked);
  if (tasks.length === 0) {
    throw new Error("[Strategy] checked 작업이 없습니다. tasks에 checked:true 항목을 추가하세요.");
  }
  return { tasks, runCounts: new Map(), cursor: 0, done: false };
}

function buildWorkItemFromStrategyTask(task: NormalizedStrategyTask): WorkItem {
  return {
    taskId: Date.now(),
    slotSequence: 0,
    keyword: task.keyword,
    productName: task.keywordName || task.keyword,
    mid: task.mid,
    linkUrl: task.linkUrl,
    keywordName: task.keywordName || task.keyword,
    secondKeywordRaw: task.keywordName || undefined,
    catalogMid: undefined,
  };
}

function claimFromStrategyQueue(): WorkItem | null {
  const q = strategyQueue!;
  for (let i = 0; i < q.tasks.length; i++) {
    const idx = (q.cursor + i) % q.tasks.length;
    const task = q.tasks[idx];
    const done = q.runCounts.get(task.mid) ?? 0;
    if (task.targetCount <= 0 || done < task.targetCount) {
      const next = done + 1;
      q.runCounts.set(task.mid, next);
      if (task.targetCount > 0) {
        log(`[Strategy] ${task.mid} 실행 ${next}/${task.targetCount}`);
      }
      q.cursor = (idx + 1) % q.tasks.length;
      return buildWorkItemFromStrategyTask(task);
    }
  }
  q.done = true;
  return null;
}

// ============ 작업 1개 — 엔진 JSON 파일 또는 전략 큐 ============
async function claimWorkItem(): Promise<WorkItem | null> {
  if (strategyQueue) {
    return claimFromStrategyQueue();
  }

  while (isClaimingTask) {
    await sleep(100);
  }
  isClaimingTask = true;

  try {
    reloadEngineConfigForNextClaim();
    return tryClaimWorkItemFromEngineFile();
  } catch (e: any) {
    log(`[CLAIM ERROR] ${e.message}`, "error");
    return null;
  } finally {
    isClaimingTask = false;
  }
}

// ============ [브라우저 계층] Patchright 엔진 실행 ============
// Patchright: Playwright 포크로 봇 탐지 우회 내장
// - navigator.webdriver 속성 제거
// - Chrome DevTools Protocol 탐지 우회
// - 자동화 플래그 숨김

type FailReason =
  | 'NO_MID_MATCH'
  | 'DETAIL_NOT_REACHED'
  | 'CAPTCHA_UNSOLVED'
  | 'PAGE_NOT_LOADED'
  | 'PRODUCT_DELETED'
  | 'TIMEOUT'
  | 'IP_BLOCKED'
  | 'LOGIN_FAILED'
  | 'INVALID_TASK'
  | 'PRODUCT_NOT_FOUND';

interface EngineResult {
  productPageEntered: boolean;
  captchaDetected: boolean;
  captchaSolved: boolean;
  midMatched: boolean;
  failReason?: FailReason;
  error?: string;
  /** 2차 검색에 실제 입력한 3단 조합 전체 (블랙리스트·결과 JSON용) */
  secondSearchPhraseUsed?: string;
  /** D모드: 쇼핑 통검 순위 체크 */
  rankCheckMode?: boolean;
  rankCheckOk?: boolean;
  shoppingRank?: number | null;
  reviewCount?: number | null;
  starRating?: number | null;
  /** D모드: 상세페이지에서 추출한 상품명 → GUI에서 2차 키워드 비었을 때만 채움 */
  extractedProductTitle?: string | null;
  catalogMid?: string | null;
}

async function detectNaverShoppingAccessBlocked(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const titleText = document.title || "";
      const merged = `${titleText}\n${bodyText}`;
      return (
        merged.includes("비정상적인 접근") ||
        merged.includes("자동화된 접근") ||
        merged.includes("접근이 제한") ||
        merged.includes("접속이 제한") ||
        merged.includes("쇼핑 서비스 접속이 일시적으로 제한") ||
        merged.includes("이용이 제한") ||
        merged.includes("비정상적인 요청") ||
        merged.includes("잠시 후 다시")
      );
    })
    .catch(() => false);
}

/** 스마트스토어/브랜드 상세 미도달이면서, 해당 2차 조합이 실패 원인일 때만 조합 블랙리스트 (캡차/IP/타임아웃 등 제외) */
function shouldBlacklistSecondComboAfterRun(r: EngineResult): boolean {
  if (r.productPageEntered) return false;
  return r.failReason === "NO_MID_MATCH" || r.failReason === "DETAIL_NOT_REACHED";
}

/** A: 상세 미진입·MID불일치 시 블랙리스트. G: 2차 통합검색에서 상품 미노출(PRODUCT_NOT_FOUND) 시 제외키워드(동일 파일) 누적 */
function shouldAppendSecondComboBlacklistAfterRun(flow: SearchFlowVersion, r: EngineResult): boolean {
  if (flow === "G" && r.failReason === "PRODUCT_NOT_FOUND" && (r.secondSearchPhraseUsed || "").trim()) {
    return true;
  }
  return flow === "A" && shouldBlacklistSecondComboAfterRun(r);
}

/** 외부 엔진이 읽을 처리 결과 — engine-last-result.json (경로는 ENGINE_RESULT_FILE / engine-config) */
function writeEngineTaskResult(work: WorkItem, result: EngineResult): void {
  const okTraffic = result.productPageEntered;
  const okRank = !!result.rankCheckOk;
  const payload = {
    ok: result.rankCheckMode ? okRank : okTraffic,
    finishedAt: new Date().toISOString(),
    mode: result.rankCheckMode ? "rankCheck" : "traffic",
    task: {
      taskId: work.taskId,
      keyword: work.keyword,
      linkUrl: work.linkUrl,
      slotSequence: work.slotSequence,
      keywordName: work.keywordName ?? null,
      productName: work.productName,
      mid: work.mid,
    },
    secondSearchPhraseUsed: result.secondSearchPhraseUsed ?? null,
    productPageEntered: result.productPageEntered,
    captchaDetected: result.captchaDetected,
    captchaSolved: result.captchaSolved,
    midMatched: result.midMatched,
    failReason: result.failReason ?? null,
    error: result.error ?? null,
    rankCheckMode: !!result.rankCheckMode,
    rankCheckOk: !!result.rankCheckOk,
    shoppingRank: result.shoppingRank ?? null,
    reviewCount: result.reviewCount ?? null,
    starRating: result.starRating ?? null,
    extractedProductTitle: result.extractedProductTitle ?? null,
    catalogMid: result.catalogMid ?? null,
  };
  try {
    fs.writeFileSync(ENGINE.engineResultFilePath, JSON.stringify(payload, null, 2), "utf-8");
    log(`[EngineFile] 결과 저장: ${ENGINE.engineResultFilePath} ok=${payload.ok}`);
  } catch (e: any) {
    log(`[EngineFile] 결과 파일 기록 실패: ${e.message}`, "warn");
  }
}

/** 1차 검색어: 한글 안정적으로 클립보드 + Ctrl+V (실패 시 fill 폴백) */
async function pasteFirstSearchKeywordIntoPortal(
  page: Page,
  context: BrowserContext,
  portalSearchInput: Locator,
  firstKeyword: string,
  workerId: number,
  engine: EngineRuntime
): Promise<void> {
  try {
    await portalSearchInput.click({ force: true });
  } catch {
    await portalSearchInput.evaluate((el) => {
      try {
        (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
        (el as HTMLElement).focus();
      } catch {
        /* ignore */
      }
    }).catch(() => {});
  }
  await sleep(engine.delay("beforeFirstKeyword"));
  await page.keyboard.press("Control+a");
  await sleep(40);
  await page.keyboard.press("Backspace");
  await sleep(50);
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://m.naver.com",
    });
  } catch {
    /* 일부 환경에서 무시 */
  }
  try {
    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t);
    }, firstKeyword);
    await page.keyboard.press("Control+v");
  } catch (e: any) {
    log(`[Worker ${workerId}] 1차 클립보드 붙여넣기 실패 → fill 폴백: ${e?.message ?? e}`, "warn");
  }
  await sleep(engine.delay("afterFirstKeywordType"));
  let q = (await portalSearchInput.inputValue().catch(() => "")).trim();
  if (!q && firstKeyword.trim()) {
    log(`[Worker ${workerId}] 1차 붙여넣기 후 비어 있음 — fill`, "warn");
    try {
    await portalSearchInput.click({ force: true });
  } catch {
    await portalSearchInput.evaluate((el) => {
      try {
        (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
        (el as HTMLElement).focus();
      } catch {
        /* ignore */
      }
    }).catch(() => {});
  }
    await sleep(80);
    await portalSearchInput.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, firstKeyword).catch(() => {});
    await sleep(engine.delay("afterFirstKeywordType"));
    q = (await portalSearchInput.inputValue().catch(() => "")).trim();
  }
  if (!q && firstKeyword.trim()) {
    log(`[Worker ${workerId}] 1차 검색어 입력 후에도 비어 있음`, "warn");
  }
}

async function collectSearchDomDiagnostics(page: Page, mid: string, catalogMid?: string): Promise<string> {
  try {
    const diag = await page.evaluate(({ mid, catalogMid }) => {
      const bodyText = document.body?.innerText || "";
      const title = document.title || "";
      const targetId = `nstore_productId_${mid}`;
      const targetCatalogId = catalogMid ? `nstore_productId_${catalogMid}` : "";
      const count = (sel: string) => document.querySelectorAll(sel).length;
      const has = (sel: string) => !!document.querySelector(sel);
      const errorHints = ["보안 확인", "자동입력방지", "Too Many Requests", "에러페이지", "시스템오류", "접속이 불가합니다"].filter((t) =>
        `${title} ${bodyText}`.includes(t)
      );
      const targetSelectors = [
        `#${targetId}`,
        `a[aria-labelledby=\"${targetId}\"]`,
        `a[href*=\"/products/${mid}\"]`,
        `a[href*=\"main/products/${mid}\"]`,
        `a[href*=\"nv_mid=${mid}\"]`,
      ];
      if (catalogMid) {
        targetSelectors.unshift(`#nstore_productId_${catalogMid}`);
        targetSelectors.unshift(`a[data-shp-contents-id=\"${catalogMid}\"]`);
      }
      return {
        url: location.href,
        readyState: document.readyState,
        title,
        slogVisibleCount: count("li._slog_visible"),
        slogContentCount: count("[data-slog-content]"),
        targetIdVisible: has(`#${targetId}`),
        targetCatalogVisible: catalogMid ? has(`#nstore_productId_${catalogMid}`) : false,
        targetSelectors: targetSelectors.filter((sel) => has(sel)),
        errorHints,
        bodySnippet: bodyText.slice(0, 220).replace(/\s+/g, " ").trim(),
      };
    }, { mid, catalogMid: catalogMid ?? null });
    return `[DOM] url=${diag.url} readyState=${diag.readyState} title=${JSON.stringify(diag.title)} slogVisible=${diag.slogVisibleCount} dataSlog=${diag.slogContentCount} targetId=${diag.targetIdVisible} catalogId=${diag.targetCatalogVisible} matched=${diag.targetSelectors.join(",") || "-"} errors=${diag.errorHints.join(",") || "-"} body=${JSON.stringify(diag.bodySnippet)}`;
  } catch (e: any) {
    return `[DOM] diagnostics unavailable: ${e?.message || String(e)}`;
  }
}

async function inspectDetailSystemError(page: Page): Promise<{ detected: boolean; reason: string; title: string; snippet: string }> {
  try {
    return await page.evaluate(() => {
      const clean = (value: unknown): string => String(value || "").replace(/\s+/g, " ").trim();
      const title = clean(document.title);
      const body = clean(document.body?.innerText || "");
      const haystack = `${title} ${body}`;
      const patterns = [
        "시스템오류",
        "시스템 오류",
        "에러페이지",
        "현재 서비스 접속이 불가합니다",
        "일시적인 서비스 장애",
        "Too Many Requests",
        "접속이 불가합니다",
      ];
      const reason = patterns.find((pattern) => haystack.includes(pattern)) || "";
      return {
        detected: Boolean(reason),
        reason,
        title,
        snippet: body.substring(0, 160),
      };
    });
  } catch (e: any) {
    return {
      detected: false,
      reason: "",
      title: "",
      snippet: `detail error inspection failed: ${e?.message || e}`,
    };
  }
}

async function findTrafficMidLink(
  page: Page,
  mid: string,
  catalogMid?: string,
  expectedProductName?: string,
  expectedStoreAlias?: string,
  expectedKeyword?: string
): Promise<{ link: any; method: string; hrefSnippet: string } | null> {
  const linkHandle = await page.evaluateHandle(({ mid, catalogMid, expectedProductName, expectedStoreAlias, expectedKeyword }) => {
    const mids = [catalogMid, mid].filter(Boolean) as string[];
    const isAdAnchor = (anchor: HTMLAnchorElement): boolean => {
      const inventory =
        anchor.getAttribute("data-shp-inventory") ||
        anchor.closest("[data-shp-inventory]")?.getAttribute("data-shp-inventory") ||
        "";
      return /lst\*(A|P|D)/.test(inventory);
    };
    const directProductHref = (href: string, targetMid: string): boolean => {
      return (
        href.includes(`/products/${targetMid}`) ||
        href.includes(`smartstore.naver.com/main/products/${targetMid}`) ||
        href.includes(`m.smartstore.naver.com/main/products/${targetMid}`)
      );
    };
    const trackedSearchHref = (href: string, targetMid: string): boolean => {
      return (
        href.includes(targetMid) &&
        (
          href.includes("/p/crd/rd") ||
          href.includes("cr.shopping") ||
          href.includes("cr2.shopping") ||
          href.includes("cr3.shopping") ||
          href.includes("/bridge/searchGate") ||
          href.includes("searchGate")
        )
      );
    };
    const normalize = (s: string): string =>
      String(s || "")
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[^\wㄱ-ㅎㅏ-ㅣ가-힣]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const normProduct = normalize(expectedProductName || "");
    const productTokens = normProduct.split(" ").filter((t) => t.length >= 2);
    const normStoreAlias = normalize(expectedStoreAlias || "");
    const normKeyword = normalize(expectedKeyword || "");
    const hasStoreAlias = (text: string): boolean => {
      if (!normStoreAlias) return false;
      return normalize(text).includes(normStoreAlias);
    };
    const collectAnchorContextText = (anchor: HTMLAnchorElement): string => {
      const chunks: string[] = [];
      const own = (anchor.textContent || "").trim();
      if (own) chunks.push(own);
      const card =
        anchor.closest("[data-shp-contents-id]") ||
        anchor.closest("li") ||
        anchor.closest("article") ||
        anchor.closest("div");
      if (card) {
        const cardText = (card.textContent || "").trim();
        if (cardText) chunks.push(cardText.slice(0, 700));
      }
      const aria = `${anchor.getAttribute("aria-label") || ""} ${anchor.getAttribute("title") || ""}`.trim();
      if (aria) chunks.push(aria);
      return chunks.join(" ");
    };
    const isTitleStoreFallbackMatch = (anchor: HTMLAnchorElement): boolean => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      if (!(href.includes("searchGate") || href.includes("nv_mid="))) return false;
      if (isAdAnchor(anchor)) return false;
      const contextText = collectAnchorContextText(anchor);
      const normContext = normalize(contextText);
      let hit = 0;
      for (const token of productTokens) {
        if (normContext.includes(token)) hit++;
      }
      const ratio = productTokens.length > 0 ? hit / productTokens.length : 0;
      const keywordMatched = normKeyword && normKeyword.length >= 2 ? normContext.includes(normKeyword) : false;

      // 1) 스토어 별칭이 맞을 때는 느슨하게 통과 (통검 노출 상호와 링크 도메인이 일치하는 일반 케이스)
      if (normStoreAlias && hasStoreAlias(contextText)) {
        if (keywordMatched) return true;
        if (productTokens.length === 0) return true;
        if (productTokens.length <= 2) return hit >= 1;
        if (productTokens.length <= 4) return hit >= 2;
        return hit >= 2 && ratio >= 0.45;
      }

      // 2) 스토어 별칭이 다르게 노출되는 케이스(예: flower-eshop vs 메인 플라워)는
      //    상품명 강일치일 때만 통과
      if (productTokens.length >= 5) {
        return hit >= 4 && ratio >= 0.65;
      }
      if (productTokens.length >= 3) {
        return hit >= 3 && ratio >= 0.75;
      }
      return false;
    };
    const scoreAnchor = (anchor: HTMLAnchorElement): { score: number; method: string } | null => {
      if (isAdAnchor(anchor)) return null;
      const href = anchor.href || anchor.getAttribute("href") || "";
      const contentId = anchor.getAttribute("data-shp-contents-id") || "";
      const labelledBy = anchor.getAttribute("aria-labelledby") || "";
      const dataset = JSON.stringify(anchor.dataset || {});

      for (const targetMid of mids) {
        if (trackedSearchHref(href, targetMid)) return { score: 0, method: "tracked-search-gate" };
      }
      for (const targetMid of mids) {
        if (href.includes(`nv_mid=${targetMid}`)) return { score: 1, method: "nv_mid" };
      }
      for (const targetMid of mids) {
        if (href.includes("searchGate") && href.includes(targetMid)) return { score: 2, method: "searchGate" };
      }
      for (const targetMid of mids) {
        if (contentId === targetMid) return { score: 3, method: "data-shp-contents-id" };
      }
      for (const targetMid of mids) {
        if (labelledBy.includes(`nstore_productId_${targetMid}`)) return { score: 4, method: "aria-product-id" };
      }
      for (const targetMid of mids) {
        if (dataset.includes(targetMid)) return { score: 5, method: "data-attr-mid" };
      }
      for (const targetMid of mids) {
        if (directProductHref(href, targetMid)) return { score: 6, method: "direct-product" };
      }
      if (isTitleStoreFallbackMatch(anchor)) {
        return { score: 7, method: "title-store-fallback" };
      }
      return null;
    };

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
    const ranked = anchors
      .map((anchor, index) => {
        const scored = scoreAnchor(anchor);
        return scored ? { anchor, index, ...scored } : null;
      })
      .filter((item): item is { anchor: HTMLAnchorElement; index: number; score: number; method: string } => Boolean(item))
      .sort((a, b) => a.score - b.score || a.index - b.index);

    const clipHref = (anchor: HTMLAnchorElement): string => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      return href.substring(0, 180);
    };

    if (ranked.length > 0) {
      return { link: ranked[0].anchor, method: ranked[0].method, hrefSnippet: clipHref(ranked[0].anchor) };
    }

    for (const targetMid of mids) {
      const marker = document.getElementById(`nstore_productId_${targetMid}`);
      if (!marker) continue;
      let cur: Element | null = marker;
      while (cur) {
        const anchor = cur.matches("a") ? cur : cur.querySelector("a");
        if (anchor instanceof HTMLAnchorElement && !isAdAnchor(anchor)) {
          return { link: anchor, method: "product-id-container", hrefSnippet: clipHref(anchor) };
        }
        cur = cur.parentElement;
      }
      let sibling = marker.previousElementSibling;
      while (sibling) {
        if (sibling instanceof HTMLAnchorElement && !isAdAnchor(sibling)) {
          return { link: sibling, method: "product-id-sibling", hrefSnippet: clipHref(sibling) };
        }
        const anchor = sibling.querySelector("a");
        if (anchor instanceof HTMLAnchorElement && !isAdAnchor(anchor)) {
          return { link: anchor, method: "product-id-sibling", hrefSnippet: clipHref(anchor) };
        }
        sibling = sibling.previousElementSibling;
      }
    }

    return { link: null, method: "", hrefSnippet: "" };
  }, {
    mid,
    catalogMid: catalogMid ?? null,
    expectedProductName: expectedProductName ?? null,
    expectedStoreAlias: expectedStoreAlias ?? null,
    expectedKeyword: expectedKeyword ?? null,
  });

  const props = await linkHandle.getProperties();
  const link = props.get("link")?.asElement();
  const method = await props.get("method")?.jsonValue().catch(() => "");
  const hrefSnippet = await props.get("hrefSnippet")?.jsonValue().catch(() => "");
  await linkHandle.dispose().catch(() => {});
  return link ? { link, method: String(method || "unknown"), hrefSnippet: String(hrefSnippet || "") } : null;
}

function extractStoreAliasFromLinkUrl(linkUrl?: string): string {
  const raw = (linkUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (!/smartstore\.naver\.com$/i.test(u.hostname)) return "";
    const seg = (u.pathname || "/").split("/").filter(Boolean);
    if (seg.length > 0) return seg[0] || "";
    return "";
  } catch {
    return "";
  }
}

async function clickTrafficMidLink(page: Page, link: any, workerId: number, method: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const failures: string[] = [];
    try {
      if (typeof link.scrollIntoViewIfNeeded === "function") {
        await link.scrollIntoViewIfNeeded().catch(() => {});
      }
      await link.evaluate((el: HTMLAnchorElement) => {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
        el.removeAttribute("target");
      });
      await sleep(randomBetween(300, 600));
      const box = await link.boundingBox().catch(() => null);
      let clickedBy = "";
      if (box && box.width > 0 && box.height > 0) {
        const clickX = box.x + box.width / 2 + randomBetween(-Math.min(8, box.width / 4), Math.min(8, box.width / 4));
        const clickY = box.y + box.height / 2 + randomBetween(-Math.min(5, box.height / 4), Math.min(5, box.height / 4));
        const useTouch = await isMobileBrowserPage(page);

        if (useTouch && (page as any).touchscreen?.tap) {
          try {
            await (page as any).touchscreen.tap(clickX, clickY);
            clickedBy = "touchscreen.tap";
          } catch (e: any) {
            failures.push(`touchscreen.tap=${e?.message || e}`);
          }
        }

        if (!clickedBy) {
          try {
            await page.mouse.move(clickX + randomBetween(-20, 20), clickY + randomBetween(-15, 15)).catch(() => {});
            await sleep(randomBetween(80, 180));
            await page.mouse.click(clickX, clickY, { delay: randomBetween(35, 85) });
            clickedBy = "mouse.click";
          } catch (e: any) {
            failures.push(`mouse.click=${e?.message || e}`);
          }
        }
      } else {
        failures.push("boundingBox=missing");
      }

      if (!clickedBy) {
        try {
          await link.click({ timeout: 5000 });
          clickedBy = "element.click";
        } catch (e: any) {
          failures.push(`element.click=${e?.message || e}`);
        }
      }

      if (!clickedBy) {
        try {
          const domClicked = await link.evaluate((el: HTMLAnchorElement) => {
            el.removeAttribute("target");
            el.click();
            return true;
          });
          if (domClicked) clickedBy = "dom.click";
        } catch (e: any) {
          failures.push(`dom.click=${e?.message || e}`);
        }
      }

      if (clickedBy) {
        log(`[Worker ${workerId}] MID 링크 클릭 성공 (${method}, ${clickedBy}, attempt ${attempt})`);
        return true;
      }

      log(`[Worker ${workerId}] MID 링크 클릭 실패 (${method}, attempt ${attempt}): ${failures.join(" | ") || "unknown"}`, "warn");
    } catch (e: any) {
      failures.push(`prepare=${e?.message || e}`);
      try {
        const domClicked = await link.evaluate((el: HTMLAnchorElement) => {
          el.removeAttribute("target");
          el.click();
          return true;
        });
        if (domClicked) {
          log(`[Worker ${workerId}] MID 링크 클릭 성공 (${method}, dom.click-after-prepare-fail, attempt ${attempt})`);
          return true;
        } else {
          failures.push("dom.click-after-prepare-fail=false");
        }
      } catch (fallbackError: any) {
        failures.push(`dom.click-after-prepare-fail=${fallbackError?.message || fallbackError}`);
      }
      log(`[Worker ${workerId}] MID 링크 클릭 실패 (${method}, attempt ${attempt}): ${failures.join(" | ")}`, "warn");
      await sleep(500);
    }
  }
  return false;
}

const INTEGRATED_SHOP_PAGE_LIMIT = 5;
const INTEGRATED_SHOP_PAGE_SETTLE_MS = 900;
const PAGE_EVALUATE_NAME_POLYFILL = "window.__name = window.__name || ((fn) => fn);";

async function ensurePageEvaluateNamePolyfill(page: Page): Promise<void> {
  await page.evaluate(PAGE_EVALUATE_NAME_POLYFILL).catch(() => {});
}

async function clickIntegratedShoppingCarouselNext(page: Page, maxCarouselPage = INTEGRATED_SHOP_PAGE_LIMIT): Promise<{
  clicked: boolean;
  current?: number;
  total?: number;
  label?: string;
  reachedEnd?: boolean;
  reason?: string;
}> {
  await ensurePageEvaluateNamePolyfill(page);
  return page.evaluate((maxCarouselPage: number) => {
    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };

    const readPaging = (text: string): { current: number; total: number } | null => {
      const slash = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (slash) {
        return { current: Number(slash[1]), total: Number(slash[2]) };
      }
      const a11y = text.match(/현재\s*(\d+)\s*전체\s*(\d+)/);
      if (a11y) {
        return { current: Number(a11y[1]), total: Number(a11y[2]) };
      }
      return null;
    };

    const readPagingFromRoot = (root: Element | null): { current: number; total: number } | null => {
      if (!root) return null;
      const currentText =
        root.querySelector("._current, .cmm_npgs_now")?.textContent ||
        root.querySelector("[aria-current='page']")?.textContent ||
        "";
      const totalText = root.querySelector("._total")?.textContent || "";
      const current = Number((currentText.match(/\d+/) || [])[0]);
      const total = Number((totalText.match(/\d+/) || [])[0]);
      if (Number.isFinite(current) && Number.isFinite(total) && current > 0 && total > 0) {
        return { current, total };
      }
      return readPaging((root.textContent || "").replace(/\s+/g, " ").trim());
    };

    const shopLike = (text: string): boolean => /(플러스스토어|가격비교|쇼핑|상품|스토어|상품판매)/.test(text);
    const findShopContainer = (from: HTMLElement): HTMLElement | null => {
      let cur: HTMLElement | null = from;
      for (let depth = 0; cur && depth < 16; depth++) {
        const text = cur.innerText || "";
        const hasCards =
          !!cur.querySelector("a.gift_link, a[data-shp-contents-id], [data-shp-contents-id], [class*='product_item'], [class*='product_title']");
        if (shopLike(text) && (readPaging(text) || hasCards)) return cur;
        cur = cur.parentElement;
      }
      return null;
    };

    const directCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          "a.cmm_pg_next._next.on",
          "button.cmm_pg_next._next.on",
          ".pagination_wrap._page_root a.cmm_pg_next._next.on",
          ".pagination_wrap._page_root button.cmm_pg_next._next.on",
          "a._next.on",
          "button._next.on",
          "a[class*='pg_next'].on",
          "button[class*='pg_next'].on",
          "a[class*='btn_next']",
          "button[class*='btn_next']",
        ].join(",")
      )
    ).filter((el, idx, arr) => arr.indexOf(el) === idx);

    let lastPagingCurrent: number | undefined;
    let lastPagingTotal: number | undefined;

    for (const next of directCandidates) {
      if (!isVisible(next)) continue;
      const cls = `${next.className || ""}`;
      const aria = `${next.getAttribute("aria-label") || ""} ${next.getAttribute("title") || ""} ${next.textContent || ""}`;
      if (/이전|prev|previous|left/i.test(`${aria} ${cls}`)) continue;
      const disabled =
        next.getAttribute("aria-disabled") === "true" ||
        next.hasAttribute("disabled") ||
        /disabled|_off|inactive/i.test(cls);
      if (disabled) continue;

      const container = findShopContainer(next);
      const pagingRoot = next.closest(".pagination_wrap._page_root, .pagination_wrap, .cmm_pgs");
      const pageText = container?.innerText || document.body?.innerText || "";
      if (!container && !shopLike(pageText)) continue;
      const paging = readPagingFromRoot(pagingRoot) || readPaging(pageText);
      if (paging) {
        lastPagingCurrent = paging.current;
        lastPagingTotal = paging.total;
        const pageLimit = Math.min(paging.total, maxCarouselPage);
        if (!Number.isFinite(paging.current) || !Number.isFinite(paging.total) || paging.current >= pageLimit) {
          return {
            clicked: false,
            current: paging.current,
            total: paging.total,
            reachedEnd: true,
            reason: `pageLimitReached=${paging.current}/${paging.total}`,
          };
        }
      }

      next.scrollIntoView({ block: "center", inline: "center" });
      next.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      next.click();
      return {
        clicked: true,
        current: paging?.current,
        total: paging?.total,
        label: paging ? `${paging.current + 1}/${paging.total}` : undefined,
      };
    }

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          "section._root_shp_lis",
          "section._root_shs_lis",
          "section._sp_nshop_gift",
          "section.sp_shop_gift",
          "section[class*='sp_shop']",
          "section[class*='shop_gift']",
          "section[class*='shop_product']",
          'section[class*="_root_shp"]',
          'section[class*="_root_shs"]',
          "section",
        ].join(",")
      )
    ).filter((section, idx, arr) => arr.indexOf(section) === idx);

    for (const section of sections) {
      const text = section.innerText || "";
      if (!/(플러스스토어|쇼핑|상품|스토어)/.test(text)) continue;
      const paging = readPaging(text);
      if (!paging) continue;

      const { current, total } = paging;
      const pageLimit = Math.min(total, maxCarouselPage);
      if (!Number.isFinite(current) || !Number.isFinite(total) || current >= pageLimit) {
        return {
          clicked: false,
          current,
          total,
          reachedEnd: true,
          reason: `pageLimitReached=${current}/${total}`,
        };
      }

      const sectionRect = section.getBoundingClientRect();
      const directNext = section.querySelector<HTMLElement>(
        "a.cmm_pg_next._next.on, button.cmm_pg_next._next.on, a._next.on, button._next.on, a[class*='pg_next'].on, button[class*='pg_next'].on"
      );
      const buttons = [
        ...(directNext ? [directNext] : []),
        ...Array.from(section.querySelectorAll<HTMLElement>("button,a,[role='button']")),
      ]
        .filter((el) => isVisible(el))
        .filter((el) => {
          const aria = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.textContent || ""}`;
          const cls = `${el.className || ""}`;
          const rect = el.getBoundingClientRect();
          const disabled =
            el.getAttribute("aria-disabled") === "true" ||
            el.hasAttribute("disabled") ||
            /disabled|_off|inactive/i.test(cls);
          if (disabled) return false;
          if (/이전|prev|previous|left/i.test(`${aria} ${cls}`)) return false;
          if (/다음|next|right|btn_next|pg_next|cmm_pg_next|pagination_next|_next/i.test(`${aria} ${cls}`)) return true;
          return rect.left > sectionRect.left + sectionRect.width / 2 && rect.width >= 18 && rect.width <= 90 && rect.height >= 18 && rect.height <= 90;
        })
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

      const next = buttons[0];
      if (!next) continue;
      next.scrollIntoView({ block: "center", inline: "center" });
      next.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      next.click();
      return { clicked: true, current, total, label: `${current + 1}/${total}` };
    }

    return {
      clicked: false,
      current: lastPagingCurrent,
      total: lastPagingTotal,
      reason: `nextCandidates=${directCandidates.length}`,
    };
  }, maxCarouselPage).catch((e: any) => ({ clicked: false, reason: e?.message || String(e) }));
}

async function waitForIntegratedShoppingPageSettle(page: Page, expectedCurrent?: number): Promise<void> {
  if (expectedCurrent) {
    await page.waitForFunction(
      (expected) => {
        const currentText =
          document.querySelector(".pagination_wrap._page_root ._current, .pagination_wrap._page_root .cmm_npgs_now")?.textContent ||
          "";
        return Number((currentText.match(/\d+/) || [])[0]) === expected;
      },
      expectedCurrent,
      { timeout: 2500 }
    ).catch(() => {});
  }
  await sleep(INTEGRATED_SHOP_PAGE_SETTLE_MS);
}

async function getIntegratedShoppingPagingState(page: Page): Promise<{ current?: number; total?: number } | null> {
  await ensurePageEvaluateNamePolyfill(page);
  return page.evaluate(() => {
    const root = document.querySelector(".pagination_wrap._page_root, .pagination_wrap, .cmm_pgs");
    if (!root) return null;
    const readNumber = (selector: string): number | undefined => {
      const text = root.querySelector(selector)?.textContent || "";
      const n = Number((text.match(/\d+/) || [])[0]);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const current = readNumber("._current, .cmm_npgs_now, [aria-current='page']");
    const total = readNumber("._total");
    return { current, total };
  }).catch(() => null);
}

async function waitForDomReady(page: Page, timeoutMs = 30000): Promise<boolean> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
    return true;
  } catch {
    try {
      await page.waitForFunction(
        () => document.readyState === "interactive" || document.readyState === "complete",
        { timeout: 5000 }
      );
      return true;
    } catch {
      return false;
    }
  }
}

async function hasCaptchaChallenge(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    if (
      bodyText.includes("보안 확인") ||
      bodyText.includes("자동입력방지") ||
      bodyText.includes("자동 입력 방지") ||
      bodyText.includes("보안문자") ||
      bodyText.includes("영수증") ||
      bodyText.includes("가상으로 제작") ||
      bodyText.includes("무엇입니까") ||
      bodyText.includes("빈 칸을 채워주세요") ||
      bodyText.includes("번째 숫자") ||
      bodyText.includes("번째 글자") ||
      bodyText.includes("CAPTCHA")
    ) {
      return true;
    }

    return !!document.querySelector(
      [
        ".captcha_img",
        ".captcha_img_cover img",
        ".captcha_area",
        "[class*='captcha']",
        "img[src*='captcha']",
        "#captcha_image",
        "#captcha_answer",
      ].join(",")
    );
  }).catch(() => false);
}

async function waitForCaptchaChallenge(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasCaptchaChallenge(page)) return true;
    await sleep(500);
  }
  return await hasCaptchaChallenge(page);
}

async function solveCaptchaIfPresent(
  page: Page,
  solver: ReceiptCaptchaSolverPRB,
  result: EngineResult,
  workerId: number,
  scopeLabel: string,
  mid: string,
  catalogMid?: string,
  waitForAppearMs = 0
): Promise<boolean> {
  const detected = waitForAppearMs > 0
    ? await waitForCaptchaChallenge(page, waitForAppearMs)
    : await hasCaptchaChallenge(page);
  if (!detected) {
    log(`[Worker ${workerId}] ${scopeLabel} CAPTCHA 미감지`);
    return true;
  }

  log(`[Worker ${workerId}] ${scopeLabel} CAPTCHA 감지 - 해결 시도...`);
  result.captchaDetected = true;
  const solved = await solver.solve(page).catch(() => false);
  await waitForDomReady(page, 15000);
  await sleep(500);

  if (solved && !(await hasCaptchaChallenge(page))) {
    log(`[Worker ${workerId}] ${scopeLabel} CAPTCHA 해결 성공!`);
    result.captchaSolved = true;
    result.captchaDetected = false;
    return true;
  }

  log(`[Worker ${workerId}] ${scopeLabel} CAPTCHA 해결 실패`, "warn");
  log(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
  result.failReason = "CAPTCHA_UNSOLVED";
  return false;
}

async function runPatchrightEngine(
  page: Page,
  mid: string,
  productName: string,
  keyword: string,
  workerId: number,
  engine: EngineRuntime,
  keywordName?: string,
  secondKeywordRaw?: string,
  catalogMid?: string,
  linkUrl?: string
): Promise<EngineResult> {
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(`[Worker ${workerId}] ${msg}`));

  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };

  try {
    const searchSetup = await prepareTrafficSearchFlow({
      page,
      mid,
      productName,
      keyword,
      workerId,
      engine,
      keywordName,
      secondKeywordRaw,
      catalogMid,
    }, {
      log,
      sleep,
      isSecondComboBlacklisted,
      countBlacklistedSecondCombosForMid,
    });
    if (!searchSetup.ok) {
      result.failReason = searchSetup.failReason;
      result.error = searchSetup.error;
      return result;
    }
    if (searchSetup.secondSearchPhraseUsed) {
      result.secondSearchPhraseUsed = searchSetup.secondSearchPhraseUsed;
    }

    // IP 차단 체크
    const isBlocked = await detectNaverShoppingAccessBlocked(page);

    if (isBlocked) {
      log(`[Worker ${workerId}] IP 차단 감지!`, "warn");
      log(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
      result.failReason = 'IP_BLOCKED';
      result.error = 'Blocked';
      return result;
    }

    if (!(await solveCaptchaIfPresent(page, captchaSolver, result, workerId, "검색", mid, catalogMid))) {
      return result;
    }

    // G: 2차 검색 직후 쇼핑 카드가 접힌 영역 아래에 있는 경우가 많아, MID 탐색 전에 먼저 아래로 밀어 올린다.
    if (engine.searchFlowVersion === "G") {
      log(`[Worker ${workerId}] G모드 2차 검색 직후 쇼핑 영역까지 페이지 스크롤(선탐색)`);
      const step = Math.max(280, Math.floor(engine.explorationScrollPixels * 0.95));
      for (let s = 0; s < 4; s++) {
        await scrollIntegratedSearchPageDown(page, step);
        await sleep(engine.delay("explorationBetweenScrolls"));
      }
      const vp0 = page.viewportSize();
      if (vp0 && vp0.width > 80) {
        try {
          await page.mouse.move(Math.floor(vp0.width / 2), Math.floor(vp0.height * 0.38));
          await page.mouse.wheel(0, 420);
          await sleep(280);
          await page.mouse.wheel(0, 320);
        } catch {
          /* ignore */
        }
      }
      await sleep(450);
    }

    // 8. 통합검색 컴포넌트 페이지네이션: 현재 페이지 MID 확인 → 없으면 다음 컴포넌트 페이지
    const MAX_SCROLL = Math.max(engine.maxScrollAttempts, INTEGRATED_SHOP_PAGE_LIMIT);
    let linkClicked = false;
    const fallbackProductTitle = productName;

    for (let i = 0; i < MAX_SCROLL && !linkClicked; i++) {
      const blockedDuringPaging = await detectNaverShoppingAccessBlocked(page);
      if (blockedDuringPaging) {
        log(`[Worker ${workerId}] 통합검색/쇼핑 접근 제한 감지(페이지네이션 중단)`, "warn");
        log(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
        result.failReason = "IP_BLOCKED";
        result.error = "ShoppingAccessTemporarilyRestricted";
        return result;
      }
      const pagingState = await getIntegratedShoppingPagingState(page);
      const pagingLabel = pagingState?.current && pagingState?.total
        ? `컴포넌트 ${pagingState.current}/${pagingState.total}페이지`
        : `탐색 ${i + 1}/${MAX_SCROLL}`;
      log(`[Worker ${workerId}] 통합검색 ${pagingLabel} MID(${catalogMid || mid}) 확인`);

      // D 전략 제외 트래픽 진입: 광고 제외 후 data-shp/nv_mid/searchGate를 직접 상품 URL보다 우선 클릭
      let midLink = await findTrafficMidLink(
        page,
        mid,
        catalogMid,
        productName,
        extractStoreAliasFromLinkUrl(linkUrl),
        keyword
      );

      if (!midLink) {
        const probeSteps = engine.searchFlowVersion === "G" ? 3 : 1;
        const probeStepPx = Math.max(220, Math.floor(engine.explorationScrollPixels * (engine.searchFlowVersion === "G" ? 0.8 : 0.55)));
        log(
          `[Worker ${workerId}] MID(${catalogMid || mid}) 1차 미발견 → 페이지 스크롤 재탐색 ${probeSteps}회`,
          "warn"
        );
        for (let probe = 0; probe < probeSteps && !midLink; probe++) {
          await scrollIntegratedSearchPageDown(page, probeStepPx);
          await sleep(engine.delay("explorationBetweenScrolls"));
          midLink = await findTrafficMidLink(
            page,
            mid,
            catalogMid,
            productName,
            extractStoreAliasFromLinkUrl(linkUrl),
            keyword
          );
          if (midLink) {
            log(
              `[Worker ${workerId}] MID(${catalogMid || mid}) 스크롤 재탐색 ${probe + 1}/${probeSteps}에서 발견`,
              "warn"
            );
          }
        }
      }

      if (midLink) {
        try {
          await midLink.link.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
          await midLink.link.evaluate((el: Element) => {
            if (el instanceof HTMLElement) {
              el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
            }
          });
        } catch {
          /* ignore */
        }
        await sleep(320 + Math.floor(Math.random() * 220));
        const isVisible = await midLink.link.isVisible().catch(() => false);
        if (!isVisible) {
          log(
            `[Worker ${workerId}] MID 링크 DOM 존재·스크롤 정렬 후에도 비표시 — 추가 스크롤 후 재시도`,
            "warn"
          );
          await scrollIntegratedSearchPageDown(page, Math.floor(engine.explorationScrollPixels * 0.75));
          await sleep(engine.delay("explorationBetweenScrolls"));
        }
        const isVisible2 = await midLink.link.isVisible().catch(() => false);
        if (isVisible2) {
          log(`[Worker ${workerId}] MID(${mid}) 링크 발견 (${midLink.method}) → 클릭 | href=${midLink.hrefSnippet || "-"}`);
          const clicked = await clickTrafficMidLink(page, midLink.link, workerId, midLink.method);
          if (!clicked) {
            log(`[Worker ${workerId}] MID를 찾았지만 클릭 실패`, "warn");
            result.failReason = "NO_MID_MATCH";
            result.error = "ClickFailed";
            return result;
          }
          const detailDomReady = await waitForDomReady(page, 30000);
          await sleep(engine.delay("afterProductClick"));

          if (!detailDomReady) {
            log(`[Worker ${workerId}] 상세페이지 DOM 로드 확인 실패`, "warn");
            log(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
            result.failReason = "PAGE_NOT_LOADED";
            result.error = "DetailDomNotLoaded";
            return result;
          }
          log(`[Worker ${workerId}] 상세페이지 DOM 로드 확인 완료`);

          log(`[Worker ${workerId}] 상세페이지 CAPTCHA 표시 대기 중...`);
          if (!(await solveCaptchaIfPresent(page, captchaSolver, result, workerId, "상세페이지", mid, catalogMid, 12000))) {
            return result;
          }

          const currentPageUrl = page.url();
          log(`[Worker ${workerId}] 페이지: ${currentPageUrl.substring(0, 80)}...`);

          linkClicked = true;
          result.midMatched = true;

          if (currentPageUrl.includes('smartstore.naver.com') || currentPageUrl.includes('brand.naver.com')) {
            let detailError = await inspectDetailSystemError(page);
            if (detailError.detected) {
              log(
                `[Worker ${workerId}] 상세페이지 시스템 오류 감지(${detailError.reason}) — 1회 새로고침 후 재확인`,
                "warn"
              );
              await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch((e: any) => {
                log(`[Worker ${workerId}] 상세페이지 새로고침 실패: ${e?.message || e}`, "warn");
              });
              await sleep(engine.delay("afterProductClick"));
              detailError = await inspectDetailSystemError(page);
            }

            if (detailError.detected) {
              log(
                `[Worker ${workerId}] 상세페이지 시스템 오류 유지: title=${JSON.stringify(detailError.title)} body=${JSON.stringify(detailError.snippet)}`,
                "warn"
              );
              result.failReason = "DETAIL_NOT_REACHED";
              result.error = `DetailSystemError:${detailError.reason || "unknown"}`;
              return result;
            }

            result.productPageEntered = true;
            try {
              const pageTitle = await page.evaluate(() => {
                const clean = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
                const stripSuffix = (value: string): string => {
                  let text = clean(value);
                  text = text.replace(/\s*(?:\||·|:|\-|—)\s*(?:네이버.*|Naver.*|SmartStore.*)$/i, '').trim();
                  text = text.replace(/\s*\|\s*$/, '').trim();
                  return text;
                };
                const seen = new Set<string>();
                const candidates: string[] = [];
                const push = (value: unknown) => {
                  const text = stripSuffix(String(value || ''));
                  if (!text || seen.has(text)) return;
                  seen.add(text);
                  candidates.push(text);
                };
                const bodyText = clean(document.body?.innerText || '');
                const isErrorPage = /에러페이지|시스템오류|현재 서비스 접속이 불가합니다|Too Many Requests|접속이 불가합니다/i.test(
                  `${document.title} ${bodyText}`
                );
                push(document.querySelector('meta[property="og:title"]')?.getAttribute('content'));
                push(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'));
                push(document.querySelector('meta[name="title"]')?.getAttribute('content'));
                for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
                  const raw = script.textContent?.trim();
                  if (!raw) continue;
                  try {
                    const parsed = JSON.parse(raw);
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    for (const item of items) {
                      if (!item || typeof item !== 'object') continue;
                      const anyItem = item as any;
                      push(anyItem.name);
                      push(anyItem.headline);
                      push(anyItem.title);
                    }
                  } catch {}
                }
                push(document.title);
                for (const sel of ['h1', 'h2', 'h3', 'strong', "[itemprop='name']"]) {
                  document.querySelectorAll(sel).forEach((el) => push(el.textContent));
                }
                if (isErrorPage) return null;
                return candidates.find((t) => t.length >= 4) || null;
              });
              if (pageTitle) result.extractedProductTitle = pageTitle;
              if (!result.extractedProductTitle && fallbackProductTitle) {
                result.extractedProductTitle = fallbackProductTitle;
              }
            } catch {
              if (!result.extractedProductTitle && fallbackProductTitle) {
                result.extractedProductTitle = fallbackProductTitle;
              }
              /* title extraction is best-effort */
            }
          } else {
            log(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
            result.failReason = "DETAIL_NOT_REACHED";
            result.error = "StoreDetailUrlMismatch";
          }

          if (result.productPageEntered && engine.searchFlowVersion === "G") {
            log(`[Worker ${workerId}] G모드 상세 스크롤 왔다갔다`);
            await gModeDetailPageOscillateScroll(page, engine);
          }
          const dwellTime =
            result.productPageEntered && engine.searchFlowVersion === "G"
              ? 4000
              : engine.delay("stayOnProduct");
          log(`[Worker ${workerId}] 체류 ${(dwellTime / 1000).toFixed(1)}초...`);
          await sleep(dwellTime);
          break;
        }
      }

      if (midLink && !linkClicked) {
        const stillHidden = !(await midLink.link.isVisible().catch(() => false));
        if (stillHidden) {
          log(`[Worker ${workerId}] MID 링크가 뷰포트 밖으로 추정 — 통합검색 스크롤로 노출 시도`, "warn");
          await scrollIntegratedSearchPageDown(page, Math.floor(engine.explorationScrollPixels));
          await sleep(engine.delay("explorationBetweenScrolls"));
        }
      }

      if (!linkClicked && process.env.NAVERSHOPPING_DEBUG_VISIBLE_MIDS === "1") {
        const debug = await collectVisibleSearchMidDebug(page, 8).catch(() => null);
        if (debug) {
          log(
            `[DEBUG] visible mids attempt ${i + 1}/${MAX_SCROLL}: ${debug.mids.length ? debug.mids.join(", ") : "(none)"}`,
            "warn"
          );
          debug.cards.slice(0, 6).forEach((card, idx) => {
            log(
              `[DEBUG] card ${idx + 1}: tag=${card.tag} ids=${card.ids.join("|") || "-"} title=${card.title || "-"}`,
              "warn"
            );
          });
        }
      }

      const carouselNext = await clickIntegratedShoppingCarouselNext(page, INTEGRATED_SHOP_PAGE_LIMIT);
      if (carouselNext.clicked) {
        log(
          `[Worker ${workerId}] 통합검색 쇼핑 캐러셀 다음 페이지 클릭` +
            (carouselNext.label ? ` (${carouselNext.label})` : "")
        );
        await waitForIntegratedShoppingPageSettle(page, carouselNext.current ? carouselNext.current + 1 : undefined);
        await sleep(engine.delay("explorationBetweenScrolls"));
        continue;
      } else if (carouselNext.reachedEnd) {
        log(
          `[Worker ${workerId}] 통합검색 쇼핑 캐러셀 페이지 한도 도달` +
            (carouselNext.current && carouselNext.total ? ` (${carouselNext.current}/${carouselNext.total})` : "")
        );
        break;
      } else if (carouselNext.reason) {
        log(`[Worker ${workerId}] 통합검색 쇼핑 캐러셀 다음 버튼 미클릭: ${carouselNext.reason}`, "warn");
      }

      log(`[Worker ${workerId}] 통합검색 컴포넌트 다음 페이지 없음 — 스크롤로 추가 로딩 확인`);
      if (engine.searchFlowVersion === "G") {
        await scrollIntegratedSearchPageDown(page, engine.explorationScrollPixels);
        const vp1 = page.viewportSize();
        if (vp1 && vp1.width > 80) {
          try {
            await page.mouse.move(Math.floor(vp1.width / 2), Math.floor(vp1.height * 0.42));
            await page.mouse.wheel(0, Math.floor(engine.explorationScrollPixels * 0.9));
          } catch {
            /* ignore */
          }
        }
      }
      await humanScroll(page, Math.floor(engine.explorationScrollPixels * (engine.searchFlowVersion === "G" ? 0.45 : 1)));
      await sleep(engine.delay("explorationBetweenScrolls"));
    }

    if (!linkClicked) {
      log(`[Worker ${workerId}] 통합검색 컴포넌트 페이지네이션 내 상품 미발견`, "warn");
      log(`[Worker ${workerId}] 쇼핑 더보기 폴백 없이 통합검색 컴포넌트 탐색에서 종료`, "warn");
    }

    if (!linkClicked) {
      log(`[Worker ${workerId}] 상품이 존재하지 않음 — MID(${mid}) 통합검색 컴포넌트 페이지네이션 내 미노출`, "warn");
      log(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
      result.error = '상품이 존재하지 않음';
      result.failReason = 'PRODUCT_NOT_FOUND';
      result.midMatched = false;
      return result;
    }

    return result;

  } catch (e: any) {
    if (e.message?.includes('Timeout') || e.message?.includes('timeout') || e.name === 'TimeoutError') {
      result.error = 'Timeout';
      result.failReason = 'TIMEOUT';
    } else {
      result.error = e.message || 'Unknown';
    }
    return result;
  }
}

/** D순위: rank_1 start.bat → `ParallelRankChecker` 의 prb-rank-worker-{id} 와 동일 */
function getPrbRankUserDataDir(workerId: number): string {
  const dir = path.join(os.tmpdir(), `prb-rank-worker-${workerId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 비정상 종료 등으로 남은 Chromium Singleton 잠금 제거.
 * 동일 userDataDir 재실행 시 "프로필 읽는 중 중복" 완화 (실행 중 다른 프로세스가 있으면 unlink 실패로 무시).
 */
function removeStaleChromiumProfileLocks(userDataDir: string): void {
  if (process.env.PRB_KEEP_PROFILE_LOCKS === "1") return;
  const names = ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"];
  const bases = [userDataDir, path.join(userDataDir, "Default")];
  for (const base of bases) {
    try {
      if (!fs.existsSync(base)) continue;
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(base, name);
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* 사용 중이면 유지 */
      }
    }
  }
}

/** 작업 1건 종료 직후: 컨텍스트 쿠키 + CDP로 HTTP 캐시·쿠키 스토어 비우기 (브라우저 close 전) */
async function clearBrowserContextCookiesAndCache(
  context: BrowserContext,
  workerId: number
): Promise<void> {
  try {
    await context.clearCookies();
  } catch {
    /* 종료 직전 실패 무시 */
  }
  for (const p of context.pages()) {
    try {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Network.clearBrowserCache");
      await cdp.send("Network.clearBrowserCookies");
    } catch {
      /* 페이지/세션 이미 끊김 등 */
    }
  }
  log(`[Worker ${workerId}] 쿠키·HTTP 캐시 초기화 완료`);
}

// ============ [독립 워커] 무한 루프로 작업 처리 ============
// 각 워커가 독립적으로 작업 가져오기 → 실행 → 다음 작업
async function runIndependentWorker(workerId: number, profile: Profile, onceMode = false): Promise<void> {
  log(`[Worker ${workerId}] 시작${onceMode ? " (1건 처리 후 종료)" : ""}`);

  while (true) {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let rankPrbBrowser: any = null;

    try {
      // 1. 작업 가져오기
      const work = await claimWorkItem();

      if (!work) {
        if (strategyQueue?.done) {
          log(`[Worker ${workerId}] 전략 완료 - 모든 작업 실행 횟수 달성`);
          printStats();
          process.exit(0);
        }
        if (onceMode) {
          log(`[Worker ${workerId}] 작업 없음 - 종료`);
          process.exit(0);
        }
        await sleep(ENGINE.emptyQueueWaitMs);
        continue;
      }

      const productShort = work.productName.substring(0, 30);
      log(`[Worker ${workerId}] 작업: ${productShort}... (mid=${work.mid}) [IP: ${currentIP}]`);

      const isRankD = ENGINE.searchFlowVersion === "D";
      // D순위(start.bat 기준)는 작업 전 ADB 데이터 토글을 하지 않음
      if (!isRankD && ENGINE.airplaneBeforeTask) {
        await toggleAdbMobileDataOffOn(`Worker ${workerId} 작업 전`, ENGINE.airplaneCycles);
      }

      const winW = isRankD ? 1280 : BROWSER_WIDTH;
      const winH = isRankD ? 880 : BROWSER_HEIGHT;
      const pos = BROWSER_POSITIONS[(workerId - 1) % BROWSER_POSITIONS.length];

      const isMobileTask = isRankD ? false : resolveMobileForTask(ENGINE);
      const ua = pickUserAgent(ENGINE, isMobileTask);
      const proxy = pickProxyConfig(ENGINE);
      const profileName = profile.name;
      const manualNaverLogin =
        (process.env.NAVER_LOGIN_MODE || "").toLowerCase() === "manual" ||
        process.env.NAVER_MANUAL_LOGIN === "1";
      const guiNaverLogin = (process.env.NAVER_LOGIN_MODE || "").toLowerCase() === "gui";
      const storedNaverStatePath = resolveExistingNaverLoginStorageStatePath(profileName);
      const forceRefreshNaverState = process.env.NAVER_LOGIN_FORCE_REFRESH === "1";
      const useStoredNaverState = !!storedNaverStatePath && !forceRefreshNaverState && !manualNaverLogin && !guiNaverLogin;
      if (ENGINE.logEngineEvents) {
        log(
          `[Engine] Worker ${workerId} mode=${isRankD ? "rankCheck(start.bat·puppeteer-real-browser)" : isMobileTask ? "mobile" : "desktop"} proxy=${proxy ? proxy.server : "none"}`
        );
      }

      let page: Page | RankCheckPage;

      // 2. D모드 = rank_1 start.bat → ParallelRankChecker (puppeteer-real-browser connect)
      if (isRankD && process.env.HEADLESS === "1") {
        const browserLaunchOptions: any = {
          headless: true,
          args: [
            `--window-position=${pos.x},${pos.y}`,
            `--window-size=${winW},${winH}`,
          ],
        };
        browser = await launchChromiumWithChannelFallback(browserLaunchOptions);
        const ctxOpts = buildBrowserContextOptions(false, ua);
        context = await browser.newContext({
          ...ctxOpts,
          ...(proxy ? { proxy } : {}),
        });
        page = context.pages().length > 0 ? context.pages()[0]! : await context.newPage();
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
      } else if (isRankD) {
        const userDataDir = getPrbRankUserDataDir(workerId);
        removeStaleChromiumProfileLocks(userDataDir);
        if (ENGINE.logEngineEvents) {
          log(`[Engine] Worker ${workerId} 순위 PRB 프로필: ${userDataDir}`);
        }
        // rank_1 start.bat(check-batch-worker-pool.ts)와 동일 옵션만 사용
        const connectOpts: any = {
          headless: process.env.HEADLESS === "1",
          turnstile: true,
          fingerprint: true,
          disableXvfb: process.env.HEADLESS === "1",
          customConfig: { userDataDir },
        };
        const conn = await connect(connectOpts);
        rankPrbBrowser = conn.browser;
        page = conn.page as RankCheckPage;
        await page.setViewport?.({ width: 1920, height: 1080 });
        await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => {});
        try {
          const tabPages = await rankPrbBrowser.pages();
          for (const p of tabPages) {
            if (p !== page && p.url() === "about:blank") await p.close().catch(() => {});
          }
        } catch {
          /* ignore */
        }
        page.setDefaultTimeout?.(60000);
        page.setDefaultNavigationTimeout?.(60000);
        browser = null;
        context = null;
      } else {
        const browserLaunchOptions: any = {
          headless: process.env.HEADLESS === "1",
          args: [
            `--window-position=${pos.x},${pos.y}`,
            `--window-size=${winW},${winH}`,
          ],
        };
        browser = await launchChromiumWithChannelFallback(browserLaunchOptions);
        const ctxOpts = buildBrowserContextOptions(isMobileTask, ua);
        context = await browser.newContext({
          ...ctxOpts,
          ...(proxy ? { proxy } : {}),
          ...(useStoredNaverState ? { storageState: storedNaverStatePath! } : {}),
        });
        if (isMobileTask) {
          await applyMobileStealth(context);
        }
        // esbuild/tsx가 page.evaluate 함수를 __name(...)으로 감쌀 수 있어 브라우저에 polyfill을 먼저 둔다.
        await context.addInitScript(PAGE_EVALUATE_NAME_POLYFILL);
        page =
          context.pages().length > 0 ? context.pages()[0]! : await context.newPage();
        await ensurePageEvaluateNamePolyfill(page);
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
      }

      // start.bat D순위와 동일: PRB 경로는 browser/proxy 지연 미적용
      if (!isRankD) {
        await sleep(ENGINE.delay("browserLaunch"));
      }
      if (!isRankD && ENGINE.proxyEnabled) {
        await sleep(ENGINE.delay("proxySetup"));
      }

      totalRuns++;

      // D순위: rank_1 은 자동 로그인 없음(차단 완화). 필요 시 NAVER_LOGIN_ON_RANK=1 → PRB 전용 로그인
      // naverLoginEnabled=false(기본)이면 파일 유무 무관하게 로그인 스킵
      const loginOk = !ENGINE.naverLoginEnabled
        ? true
        : isRankD && process.env.NAVER_LOGIN_ON_RANK !== "1"
          ? true
          : isRankD
            ? await ensureNaverLoginPrbPage(page, workerId)
            : manualNaverLogin
              ? await ensureNaverLoginManually(page as Page, workerId, context, profileName)
              : useStoredNaverState
                ? (log(`[Worker ${workerId}] 네이버 저장 세션 로드 완료: ${storedNaverStatePath}`), true)
                : await ensureNaverLoginIfConfigured(page as Page, workerId, context, profileName, guiNaverLogin);
      if (!loginOk) {
        totalFailed++;
        writeEngineTaskResult(work, {
          productPageEntered: false,
          captchaDetected: false,
          captchaSolved: false,
          midMatched: false,
          failReason: "LOGIN_FAILED",
          error: "login failed",
        });
        const failMsg = `[실패] Worker${workerId} | slot_sequence=${work.slotSequence} | 사유=로그인실패 | ${productShort}...`;
        log(failMsg, "warn");
        console.log(failMsg);
        await sleep(ENGINE.delay("taskGapRest"));
        if (onceMode) process.exit(1);
        continue;
      }

      // 3. 엔진 실행 (트래픽 A/B/C vs 순위 D)
      const engineResult = isRankD
        ? await runRankCheckFlow(
            { page: page as RankCheckPage, work, workerId },
            { log, sleep }
          )
        : await runPatchrightEngine(
            page as Page,
            work.mid,
            work.productName,
            work.keyword,
            workerId,
            ENGINE,
            work.keywordName,
            work.secondKeywordRaw,
            work.catalogMid,
            work.linkUrl
          );

      // 4. 결과 처리
      if (isRankD) {
        if (engineResult.rankCheckOk) {
          totalSuccess++;
          writeEngineTaskResult(work, engineResult);
          const successMsg = `[성공·순위] Worker${workerId} | ${engineResult.shoppingRank}위 | slot_sequence=${work.slotSequence} | ${productShort}...`;
          log(successMsg);
          console.log(successMsg);
        } else {
          totalFailed++;
          const failReason =
            engineResult.failReason === "NO_MID_MATCH"
              ? "순위미발견"
              : engineResult.failReason === "TIMEOUT"
                ? "타임아웃"
                : engineResult.error || "Unknown";
          writeEngineTaskResult(work, engineResult);
          const failMsg = `[실패·순위] Worker${workerId} | slot_sequence=${work.slotSequence} | 사유=${failReason} | ${productShort}...`;
          log(failMsg, "warn");
          console.log(failMsg);
        }
      } else if (engineResult.productPageEntered) {
        totalSuccess++;
        writeEngineTaskResult(work, engineResult);

        const successMsg = `[성공] Worker${workerId} | slot_sequence=${work.slotSequence} | ${productShort}...${engineResult.captchaSolved ? " (CAPTCHA해결)" : ""}`;
        log(successMsg);
        console.log(successMsg);
        if (engineResult.captchaSolved) {
          log(`[Worker ${workerId}] SUCCESS(CAPTCHA해결) | ${productShort}...`);
        } else {
          log(`[Worker ${workerId}] SUCCESS | ${productShort}...`);
        }
      } else {
        totalFailed++;
        const failReason = engineResult.failReason === 'CAPTCHA_UNSOLVED' ? 'CAPTCHA'
          : engineResult.failReason === 'IP_BLOCKED' ? 'IP차단'
          : engineResult.failReason === 'NO_MID_MATCH' ? 'MID없음'
          : engineResult.failReason === 'DETAIL_NOT_REACHED' ? '상세미진입'
          : engineResult.failReason === 'PRODUCT_NOT_FOUND' ? '상품미노출'
          : engineResult.failReason === 'TIMEOUT' ? '타임아웃'
          : engineResult.failReason === 'INVALID_TASK' ? '작업설정오류'
          : (engineResult.error || 'Unknown');
        writeEngineTaskResult(work, engineResult);

        const failMsg = `[실패] Worker${workerId} | slot_sequence=${work.slotSequence} | 사유=${failReason} | ${productShort}...`;
        log(failMsg, "warn");
        console.log(failMsg);

        if (engineResult.failReason === 'CAPTCHA_UNSOLVED') {
          totalCaptcha++;
          log(`[Worker ${workerId}] FAIL(CAPTCHA) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'IP_BLOCKED') {
          log(`[Worker ${workerId}] FAIL(IP차단) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'NO_MID_MATCH') {
          log(`[Worker ${workerId}] FAIL(MID없음) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'DETAIL_NOT_REACHED') {
          log(`[Worker ${workerId}] FAIL(상세미진입) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'TIMEOUT') {
          log(`[Worker ${workerId}] FAIL(타임아웃) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'INVALID_TASK') {
          log(`[Worker ${workerId}] FAIL(작업설정) | ${productShort}...`, "warn");
        } else {
          log(`[Worker ${workerId}] FAIL(${engineResult.error || 'Unknown'}) | ${productShort}...`, "warn");
        }

        if (shouldAppendSecondComboBlacklistAfterRun(ENGINE.searchFlowVersion, engineResult)) {
          await appendSecondComboBlacklistEntry(
            ENGINE,
            work.mid,
            engineResult.secondSearchPhraseUsed || ""
          );
        }
      }

      // 5. 작업 간 휴식
      await sleep(ENGINE.delay("taskGapRest"));

      if (onceMode) {
        log(`[Worker ${workerId}] 1건 처리 완료 - 종료`);
        process.exit(0);
      }
    } catch (e: any) {
      log(`[Worker ${workerId}] ERROR: ${e.message}`, "error");
      if (onceMode) process.exit(1);
      await sleep(5000);  // 에러 시 5초 대기
    } finally {
      if (rankPrbBrowser) {
        await sleep(randomBetween(200, 500));
        await rankPrbBrowser.close().catch(() => {});
        // Windows: 프로필 디렉터리 잠금 해제까지 짧으면 다음 작업에서 동일 폴더 재진입 시 Chromium이 중복 프로필 오류 표시
        await sleep(randomBetween(800, 1500));
      } else {
        if (context) {
          await clearBrowserContextCookiesAndCache(context, workerId);
        }
        if (browser) {
          await sleep(randomBetween(100, 500));
          await browser.close().catch(() => {});
        }
      }
    }

    // 주기적으로 Temp 폴더 정리 (10작업마다)
    if (totalRuns % 10 === 0 && workerId === 1) {
      cleanupChromeTempFolders();
    }
  }
}

// ============ 통계 출력 ============
function printStats(): void {
  const elapsed = (Date.now() - sessionStartTime) / 1000 / 60;
  const successRate = totalRuns > 0 ? (totalSuccess / totalRuns * 100).toFixed(1) : '0';
  const captchaRate = totalRuns > 0 ? (totalCaptcha / totalRuns * 100).toFixed(1) : '0';

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  통계 (${elapsed.toFixed(1)}분 경과)`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  총 실행: ${totalRuns}회`);
  console.log(`  성공: ${totalSuccess} (${successRate}%) | CAPTCHA: ${totalCaptcha} (${captchaRate}%)`);
  console.log(`  실패: ${totalFailed} | 현재 IP: ${currentIP}`);
  console.log(`  속도: ${elapsed > 0 ? (totalRuns / elapsed).toFixed(1) : '0'}회/분`);
  console.log(`${"=".repeat(60)}\n`);
}

// ============ 메인 (전체 계층 조율) ============
// 실행 흐름:
// 1. [네트워크] 테더링 어댑터 감지 + IP 확인
// 2. [세션] 프로필 로드
// 3. [워커] 독립 워커 N개 시작 (각자 무한 루프)
//    └─ [브라우저+디바이스] 워커 생성
//       └─ [행동] 검색/클릭/체류
async function main() {
  // Git 커밋 해시 가져오기
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();
  } catch (e) {
    // git 명령 실패 시 무시
  }

  // --strategy 모드: 전략 파일에서 ENGINE 설정 + 작업 큐 초기화
  if (STRATEGY_ARG) {
    const strategyPath = path.isAbsolute(STRATEGY_ARG)
      ? STRATEGY_ARG
      : path.resolve(process.cwd(), STRATEGY_ARG);
    log(`[Strategy] 전략 파일 로드: ${strategyPath}`);
    const rawStrategy = loadStrategyFile(strategyPath);
    const validation = validateStrategy(rawStrategy);
    if (validation.errors.length > 0) {
      console.error("[Strategy] 유효성 오류:\n" + validation.errors.join("\n"));
      process.exit(1);
    }
    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) log(`[Strategy] 경고: ${w}`, "warn");
    }
    const normalized = normalizeStrategy(rawStrategy);
    ENGINE = buildEngineRuntime(normalized.runtime);
    strategyQueue = createStrategyQueue(normalized);
    const checkedTasks = normalized.tasks.filter((t) => t.checked);
    log(`[Strategy] "${normalized.name}" | 플로우=${ENGINE.searchFlowVersion} | 작업=${checkedTasks.length}개 (checked)`);
    for (const t of checkedTasks) {
      log(`[Strategy]   · ${t.keyword} → mid=${t.mid} | 횟수=${t.targetCount > 0 ? t.targetCount + "회" : "무제한"}`);
    }
  }

  const onceMode = process.argv.includes("--once");
  const workerCount = onceMode ? 1 : PARALLEL_BROWSERS;
  const adbBeforeTaskEnabled = ENGINE.airplaneBeforeTask && ENGINE.searchFlowVersion !== "D";
  const adbLabel = adbBeforeTaskEnabled
    ? `작업전ADB=ON(${ENGINE.airplaneCycles}회)`
    : ENGINE.searchFlowVersion === "D"
      ? "작업전ADB=OFF(D모드·start.bat 동일)"
      : "작업전ADB=OFF";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Unified Runner (Patchright + 엔진 파일)`);
  console.log(`  Script: unified-runner.ts | Commit: ${gitCommit}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  동시 워커: ${workerCount}개${onceMode ? " (--once 1건 후 종료)" : ""}`);
  if (workerCount > 1) {
    console.log(`  [주의] 작업 JSON 1개 큐 — PARALLEL_BROWSERS=1 권장`);
  }
  console.log(
    `  입출력: 작업=${ENGINE.engineTaskFilePath} | 결과=${ENGINE.engineResultFilePath} | workMode=${ENGINE.workMode} | 검색모드=${ENGINE.searchFlowVersion} | proxy=${ENGINE.proxyEnabled} | ${adbLabel}`
  );
  console.log(`${"=".repeat(60)}`);

  if (adbBeforeTaskEnabled) {
    log(`시작 전 데이터 토글 생략 — 작업 1건당 ${ENGINE.airplaneCycles}회 OFF→ON 실행`);
  } else if (ENGINE.searchFlowVersion === "D") {
    log("D모드: 작업 전 ADB 데이터 토글 비활성화 (start.bat 동일)");
  } else {
    log("작업 전 ADB 데이터 토글 비활성화");
  }

  // Git 업데이트 체커 시작
  startGitUpdateChecker();
  log(`Git update checker started (interval: ${GIT_CHECK_INTERVAL / 1000}s)`);

  // 프로필 로드
  const profile = loadProfile("pc_v7");
  log(`[Profile] ${profile.name}`);

  // 현재 IP 확인 (Heartbeat/로그용)
  try {
    currentIP = await getCurrentIP();
    log(`현재 IP: ${currentIP}`);
  } catch (e: any) {
    log(`IP 확인 실패: ${e.message}`, "error");
    currentIP = "unknown";
  }

  // 통계 출력 인터벌
  setInterval(printStats, 60000);

  // 독립 워커들 시작 (--once면 1개만, 그 외 PARALLEL_BROWSERS개)
  const numWorkers = onceMode ? 1 : PARALLEL_BROWSERS;
  log(`\n${numWorkers}개 워커 시작...`);
  for (let i = 1; i <= numWorkers; i++) {
    runIndependentWorker(i, profile, onceMode).catch((e) => {
      log(`[Worker ${i}] 치명적 에러: ${e.message}`, "error");
      if (onceMode) process.exit(1);
    });

    if (i < numWorkers) {
      await sleep(ENGINE.workerStartDelayMs);
    }
  }

  if (onceMode) {
    // --once: 워커가 1건 처리 후 process.exit 하므로 여기 도달하지 않음 (작업 없을 때만)
    log(`[--once] 워커 대기 중...`);
    await new Promise(() => {});  // 워커가 exit할 때까지 대기 (무한 대기)
  }

  log(`모든 워커 시작 완료 - 독립 실행 중...\n`);

  while (true) {
    await sleep(60000);
  }
}

// 종료 시그널
process.on('SIGINT', () => {
  console.log('\n\n[STOP] 종료 요청됨');
  printStats();
  process.exit(0);
});

// 전역 에러 핸들러 (비정상 종료 방지)
process.on('uncaughtException', (error) => {
  const msg = error.message || "";
  // EPERM/ENOENT 에러는 무시 (chrome-launcher Temp 폴더 삭제 시 발생)
  if ((msg.includes('EPERM') || msg.includes('ENOENT')) &&
      (msg.includes('temp') || msg.includes('lighthouse') || msg.includes('puppeteer'))) {
    return;
  }
  console.error(`\n[FATAL] Uncaught Exception: ${error.message}`);
  console.error(error.stack);
  // 죽지 않고 계속 실행
});

process.on('unhandledRejection', (reason: any) => {
  console.error(`\n[FATAL] Unhandled Rejection: ${reason?.message || reason}`);
  // 죽지 않고 계속 실행
});

// 실행
main().catch((error) => {
  console.error(`[FATAL] Main error: ${error.message}`);
  process.exit(1);
});
