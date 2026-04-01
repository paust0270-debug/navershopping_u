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
  resolveMobileForTask,
  pickUserAgent,
  pickProxyConfig,
  buildBrowserContextOptions,
  type EngineRuntime,
} from "./engine-config";
import { connect } from "puppeteer-real-browser";
import { ReceiptCaptchaSolverPRB } from "./captcha/ReceiptCaptchaSolverPRB";
import { applyMobileStealth } from "./shared/mobile-stealth";
import { findNaverShoppingRankByMid, type RankCheckPage } from "./rank-check-shopping";

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

// 브라우저 창 위치 (4분할 배치 - 모바일 사이트용 좁은 창)
const BROWSER_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: 0 },      // Worker 1: 좌상단
  { x: 480, y: 0 },    // Worker 2: 우상단
  { x: 0, y: 540 },    // Worker 3: 좌하단
  { x: 480, y: 540 },  // Worker 4: 우하단
];
const BROWSER_WIDTH = 480;   // 브라우저 너비 (모바일 사이트용)
const BROWSER_HEIGHT = 540;  // 브라우저 높이

/** 엔진 설정 — engine-config.json */
const ENGINE = loadEngineConfig();

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
    // fetch만 (pull 안 함)
    execSync("git fetch origin main", { encoding: "utf8", timeout: 30000 });
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
    log("Git 업데이트 자동 확인 생략 (SKIP_GIT_UPDATE_CHECK=1)", "info");
    return;
  }
  // 현재 커밋 해시 저장
  lastCommitHash = getCurrentCommitHash();

  setInterval(() => {
    if (checkForUpdates()) {
      log("Git update detected! Restarting to apply changes...", "warn");
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
    .filter((l) => l.length > 0 && !l.startsWith("#"));
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

/** naver-account.txt 없으면 true. 있으면 로그인 성공 시 true, 형식 오류·로그인 실패 시 false */
async function ensureNaverLoginIfConfigured(page: Page, workerId: number): Promise<boolean> {
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

    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (!page.url().includes("nidlogin.login")) {
        await sleep(randomBetween(1500, 2500));
        log(`[Worker ${workerId}] 네이버 로그인 완료`);
        return true;
      }
    }

    log(`[Worker ${workerId}] 네이버 로그인 타임아웃 (로그인 페이지 이탈 없음)`, "warn");
    return false;
  } catch (e: any) {
    log(`[Worker ${workerId}] 네이버 로그인 예외: ${e.message}`, "warn");
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

    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (!page.url().includes("nidlogin.login")) {
        await sleep(randomBetween(1500, 2500));
        log(`[Worker ${workerId}] 네이버 로그인 완료`);
        return true;
      }
    }

    log(`[Worker ${workerId}] 네이버 로그인 타임아웃(PRb)`, "warn");
    return false;
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

// 2차 검색어: keyword + (2차 키워드에서 랜덤 1단어) + (판매|최저가|최저|구매|비교|판매처|추천|가격|구매처|가격비교) → 3개 파트 랜덤 순서 띄어쓰기
// 단, 2차 키워드 단어가 1차 검색어 단어와 같으면 제외 후 랜덤 선택
// 예: 1차="제주 레몬", 2차="제주 레몬 유기농 못난이" -> "유기농", "못난이" 중 랜덤 1개 사용
const SECOND_SEARCH_TAIL_WORDS = ["판매", "최저가", "최저", "구매", "비교", "판매처", "추천", "가격", "구매처", "가격비교"];
function buildSecondSearchPhrase(firstKeyword: string, keywordName: string): string {
  const part1 = (firstKeyword || "").trim() || "상품";
  const firstWords = new Set(
    part1
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
  );
  const nameWords = (keywordName || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .filter((w) => !firstWords.has(w));
  const part2 = nameWords.length > 0 ? nameWords[Math.floor(Math.random() * nameWords.length)] : part1;
  const part3 = SECOND_SEARCH_TAIL_WORDS[Math.floor(Math.random() * SECOND_SEARCH_TAIL_WORDS.length)];
  const parts = [part1, part2, part3];
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }
  return parts.join(" ");
}

/** 블랙에 없는 2차 조합을 랜덤 생성으로 찾음 (동일 mid에서 실패한 조합 문자열은 재사용 안 함) */
function pickSecondSearchPhraseAvoidingBlacklist(
  engine: EngineRuntime,
  mid: string,
  firstKeyword: string,
  keywordName: string,
  workerId: number
): string {
  if (!engine.keywordBlacklistEnabled) {
    return buildSecondSearchPhrase(firstKeyword, keywordName);
  }
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const phrase = buildSecondSearchPhrase(firstKeyword, keywordName);
    if (!isSecondComboBlacklisted(engine, mid, phrase)) {
      if (t > 0) {
        log(
          `[Worker ${workerId}] [KeywordBlacklist] 2차 조합 ${t + 1}번째 시도로 채택: "${phrase.substring(0, 50)}${phrase.length > 50 ? "..." : ""}"`
        );
      }
      return phrase;
    }
  }
  const fallback = buildSecondSearchPhrase(firstKeyword, keywordName);
  log(
    `[Worker ${workerId}] [KeywordBlacklist] 2차 조합 블랙 시도 다수 — 임의 조합 사용: "${fallback.substring(0, 50)}${fallback.length > 50 ? "..." : ""}"`,
    "warn"
  );
  return fallback;
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

// ============ 작업 1개 — 엔진 JSON 파일 ============
async function claimWorkItem(): Promise<WorkItem | null> {
  while (isClaimingTask) {
    await sleep(100);
  }
  isClaimingTask = true;

  try {
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
  /** D모드: 목록에서 추출한 상품명 → GUI에서 2차 키워드 비었을 때만 채움 */
  extractedProductTitle?: string | null;
  catalogMid?: string | null;
}

/** 스마트스토어/브랜드 상세 미도달이면서, 해당 2차 조합이 실패 원인일 때만 조합 블랙리스트 (캡차/IP/타임아웃 등 제외) */
function shouldBlacklistSecondComboAfterRun(r: EngineResult): boolean {
  if (r.productPageEntered) return false;
  return r.failReason === "NO_MID_MATCH" || r.failReason === "DETAIL_NOT_REACHED";
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

/** D모드: 네이버 통검 → 쇼핑 탭 MID 순위 (sellermate_naver_rank_1 단일 체크 흐름) */
async function runShoppingRankCheck(
  page: RankCheckPage,
  work: WorkItem,
  workerId: number,
  engine: EngineRuntime
): Promise<EngineResult> {
  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false,
    rankCheckMode: true,
    rankCheckOk: false,
    shoppingRank: null,
  };

  try {
    const kw = work.keyword.trim();
    const mid = work.mid;
    // start.bat 경로(parallel-rank-checker.ts)는 ProductId 순회를 15페이지 고정
    const maxPages = 15;
    log(`[Worker ${workerId}] D모드 순위체크: "${kw.substring(0, 40)}..." mid=${mid} (최대 ${maxPages}페이지)`);

    const detail = await findNaverShoppingRankByMid(
      page,
      kw,
      mid,
      maxPages,
      (m) => log(`[Worker ${workerId}] ${m}`),
      sleep
    );

    if (detail.rank != null && detail.rank > 0) {
      result.shoppingRank = detail.rank;
      result.reviewCount = detail.reviewCount;
      result.starRating = detail.starRating;
      result.extractedProductTitle = detail.productTitle?.trim() || null;
      result.catalogMid = detail.catalogMid || null;
      result.rankCheckOk = true;
      result.midMatched = true;
      log(
        `[Worker ${workerId}] 순위: ${detail.rank}위` +
          (detail.reviewCount != null ? ` | 리뷰 ${detail.reviewCount}` : "") +
          (detail.starRating != null ? ` | 별 ${detail.starRating}` : "") +
          (result.extractedProductTitle
            ? ` | 제목 "${result.extractedProductTitle.substring(0, 36)}${result.extractedProductTitle.length > 36 ? "…" : ""}"`
            : "")
      );
    } else {
      result.failReason = "NO_MID_MATCH";
      result.error = "순위권_미발견";
      log(`[Worker ${workerId}] 순위권 내 MID 없음`, "warn");
    }
  } catch (e: any) {
    result.error = e?.message || "Unknown";
    result.failReason = "TIMEOUT";
    log(`[Worker ${workerId}] 순위체크 예외: ${result.error}`, "warn");
  }

  return result;
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
  await portalSearchInput.click({ force: true });
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
    await portalSearchInput.click({ force: true });
    await sleep(80);
    await portalSearchInput.fill(firstKeyword);
    await sleep(engine.delay("afterFirstKeywordType"));
    q = (await portalSearchInput.inputValue().catch(() => "")).trim();
  }
  if (!q && firstKeyword.trim()) {
    log(`[Worker ${workerId}] 1차 검색어 입력 후에도 비어 있음`, "warn");
  }
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
  catalogMid?: string
): Promise<EngineResult> {
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(`[Worker ${workerId}] ${msg}`));

  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };

  const flow = engine.searchFlowVersion;

  try {
    const firstKeyword = (keyword || "").trim() || "상품";
    log(
      `[Worker ${workerId}] m.naver.com 접속 (작업 모드: ${flow === "A" ? "A 조합형" : flow === "B" ? "B 메인키워드만" : "C 2차키워드만"})`
    );
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(engine.delay("browserLoad"));

    await page.evaluate(() => window.scrollTo(0, 0));
    try {
      await page.locator("#MM_SEARCH_FAKE").click({ force: true, timeout: 8000 });
    } catch {
      log(`[Worker ${workerId}] MM_SEARCH_FAKE 없음, 검색 입력으로 포커스 시도`, "warn");
      await page.locator("#query, input[name='query'], .sch_input").first().click({ force: true }).catch(() => {});
    }
    await sleep(engine.delay("searchFakeClickGap"));

    const portalSearchInput = page.locator("#query.sch_input, #query, input[name='query']").first();

    if (flow === "C") {
      const onlySecond = (secondKeywordRaw || "").trim();
      if (!onlySecond) {
        log(`[Worker ${workerId}] C모드는 2차 키워드 필수 — 작업 스킵`, "warn");
        result.failReason = "INVALID_TASK";
        result.error = "C모드_2차키워드없음";
        return result;
      }
      log(`[Worker ${workerId}] C모드 단일 검색 (2차 키워드): ${onlySecond.substring(0, 48)}${onlySecond.length > 48 ? "..." : ""}`);
      await pasteFirstSearchKeywordIntoPortal(page, page.context(), portalSearchInput, onlySecond, workerId, engine);
      await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
      await sleep(engine.delay("afterFirstSearchLoad"));
      result.secondSearchPhraseUsed = onlySecond;
    } else {
      log(`[Worker ${workerId}] 1차 검색 (검색 키워드): ${firstKeyword}`);
      await pasteFirstSearchKeywordIntoPortal(
        page,
        page.context(),
        portalSearchInput,
        firstKeyword,
        workerId,
        engine
      );
      await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
      await sleep(engine.delay("afterFirstSearchLoad"));

      if (flow === "A") {
        // productTitle(순위체크 수집 풀네임) 있으면 직접 사용, 없으면 3단 조합 생성
        let secondSearchKeyword: string;
        if (catalogMid && productName && productName.length > 10) {
          // 상품 풀네임이 있으면 그대로 2차 검색어로 사용 (combined-runner 방식)
          secondSearchKeyword = productName;
          log(`[Worker ${workerId}] 2차 검색 (풀네임): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
        } else {
          const nameForSecond = (keywordName || productName || "").trim() || firstKeyword;
          secondSearchKeyword = pickSecondSearchPhraseAvoidingBlacklist(
            engine,
            mid,
            firstKeyword,
            nameForSecond,
            workerId
          );
          log(`[Worker ${workerId}] 2차 검색 (3단조합): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
        }
        result.secondSearchPhraseUsed = secondSearchKeyword;
        const searchInput = page.locator('#query, .sch_input, input[name="query"]').first();
        await searchInput.click({ force: true });
        await sleep(engine.delay("secondSearchField"));
        await page.keyboard.press("Control+a");
        await sleep(100);
        await page.keyboard.press("Backspace");
        await sleep(200);
        await searchInput.type(secondSearchKeyword, { delay: engine.delay("secondKeywordTypingDelay") });
        await sleep(engine.delay("afterSecondKeywordType"));
        await page.keyboard.press("Enter");
        log(`[Worker ${workerId}] 2차 검색 결과 로딩 대기...`);
        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 1000 });
        } catch {
          log(`[Worker ${workerId}] 2차 검색 로딩 없음/지연 — 페이지 새로고침 1회`, "warn");
          await page
            .reload({ waitUntil: "domcontentloaded", timeout: 60000 })
            .catch((e: any) => {
              log(`[Worker ${workerId}] 2차 검색 새로고침 실패: ${e?.message ?? e}`, "warn");
            });
        }
        await sleep(engine.delay("afterSecondSearchLoad"));
      } else {
        log(`[Worker ${workerId}] B모드 — 2차 검색 생략, 1차 결과에서 상품 탐색`);
      }
    }

    // IP 차단 체크
    const isBlocked = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return bodyText.includes('비정상적인 접근') ||
             bodyText.includes('자동화된 접근') ||
             bodyText.includes('접근이 제한') ||
             bodyText.includes('잠시 후 다시') ||
             bodyText.includes('비정상적인 요청') ||
             bodyText.includes('이용이 제한');
    }).catch(() => false);

    if (isBlocked) {
      log(`[Worker ${workerId}] IP 차단 감지!`, "warn");
      result.failReason = 'IP_BLOCKED';
      result.error = 'Blocked';
      return result;
    }

    // 7. CAPTCHA 체크
    const searchCaptcha = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return bodyText.includes('보안 확인') || bodyText.includes('자동입력방지');
    }).catch(() => false);

    if (searchCaptcha) {
      log(`[Worker ${workerId}] 검색 CAPTCHA 감지 - 해결 시도...`);
      result.captchaDetected = true;
      const solved = await captchaSolver.solve(page);
      if (solved) {
        log(`[Worker ${workerId}] 검색 CAPTCHA 해결 성공!`);
        result.captchaSolved = true;
        result.captchaDetected = false;
      } else {
        log(`[Worker ${workerId}] 검색 CAPTCHA 해결 실패`, "warn");
        result.failReason = 'CAPTCHA_UNSOLVED';
        return result;
      }
    }

    // 8. MID로 직접 상품 링크 탐색 (combined-runner 방식)
    const MAX_SCROLL = engine.maxScrollAttempts;
    let linkClicked = false;

    for (let i = 0; i < MAX_SCROLL && !linkClicked; i++) {
      log(`[Worker ${workerId}] 상품 링크 탐색 ${i + 1}/${MAX_SCROLL}`);

      // MID href로 직접 탐색 (4가지 전략, 가격비교·플러스스토어·쇼핑탭 모두 커버)
      const searchMid = catalogMid || mid;
      const link =
        // 1. 쇼핑탭: data-shp-contents-id (Catalog MID)
        (catalogMid ? await page.$(`a[data-shp-contents-id="${catalogMid}"]`).catch(() => null) : null) ||
        // 2. 가격비교: nv_mid= 파라미터
        await page.$(`a[href*="nv_mid=${searchMid}"]`).catch(() => null) ||
        // 3. 플러스스토어: /products/MID 경로
        await page.$(`a[href*="/products/${searchMid}"]`).catch(() => null) ||
        // 4. ID 속성 매칭 (nstore_productId_MID)
        await page.$(`[id="nstore_productId_${mid}"]`).catch(() => null) ||
        // 5. Channel Product No 폴백 (catalogMid 있을 때)
        (catalogMid ? await page.$(`a[href*="/products/${mid}"]`).catch(() => null) : null);

      if (link) {
        const isVisible = await link.isVisible().catch(() => false);
        if (isVisible) {
          log(`[Worker ${workerId}] MID(${mid}) 링크 발견 → 클릭`);
          await link.evaluate((el: HTMLAnchorElement) => el.removeAttribute('target'));
          await link.click();
          await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
          await sleep(engine.delay("afterProductClick"));

          const currentPageUrl = page.url();
          log(`[Worker ${workerId}] 페이지: ${currentPageUrl.substring(0, 80)}...`);

          linkClicked = true;
          result.midMatched = true;

          const dwellTime = engine.delay("stayOnProduct");
          log(`[Worker ${workerId}] 체류 ${(dwellTime / 1000).toFixed(1)}초...`);
          await sleep(dwellTime);

          if (currentPageUrl.includes('smartstore.naver.com') || currentPageUrl.includes('brand.naver.com')) {
            result.productPageEntered = true;
          } else {
            result.failReason = "DETAIL_NOT_REACHED";
            result.error = "StoreDetailUrlMismatch";
          }
          break;
        }
      }

      await humanScroll(page, engine.explorationScrollPixels);
      await sleep(engine.delay("explorationBetweenScrolls"));
    }

    if (!linkClicked) {
      log(`[Worker ${workerId}] 상품이 존재하지 않음 — MID(${mid}) 검색결과에 미노출 (${MAX_SCROLL}회 스크롤)`, "warn");
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
        // 작업 없으면 대기 (once 모드면 대기 없이 종료)
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
      if (ENGINE.logEngineEvents) {
        log(
          `[Engine] Worker ${workerId} mode=${isRankD ? "rankCheck(start.bat·puppeteer-real-browser)" : isMobileTask ? "mobile" : "desktop"} proxy=${proxy ? proxy.server : "none"}`
        );
      }

      let page: Page | RankCheckPage;

      // 2. D모드 = rank_1 start.bat → ParallelRankChecker (puppeteer-real-browser connect)
      if (isRankD) {
        const userDataDir = getPrbRankUserDataDir(workerId);
        if (ENGINE.logEngineEvents) {
          log(`[Engine] Worker ${workerId} 순위 PRB 프로필: ${userDataDir}`);
        }
        // rank_1 start.bat(check-batch-worker-pool.ts)와 동일 옵션만 사용
        const connectOpts: any = {
          headless: false,
          turnstile: true,
          fingerprint: true,
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
        browser = await chromium.launch({
          headless: false,
          channel: "chrome",
          args: [
            `--window-position=${pos.x},${pos.y}`,
            `--window-size=${winW},${winH}`,
          ],
        });
        const ctxOpts = buildBrowserContextOptions(isMobileTask, ua);
        context = await browser.newContext({
          ...ctxOpts,
          ...(proxy ? { proxy } : {}),
        });
        if (isMobileTask) {
          await applyMobileStealth(context);
        }
        page =
          context.pages().length > 0 ? context.pages()[0]! : await context.newPage();
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
      const loginOk =
        isRankD && process.env.NAVER_LOGIN_ON_RANK !== "1"
          ? true
          : isRankD
            ? await ensureNaverLoginPrbPage(page, workerId)
            : await ensureNaverLoginIfConfigured(page as Page, workerId);
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
        ? await runShoppingRankCheck(page as RankCheckPage, work, workerId, ENGINE)
        : await runPatchrightEngine(
            page as Page,
            work.mid,
            work.productName,
            work.keyword,
            workerId,
            ENGINE,
            work.keywordName,
            work.secondKeywordRaw,
            work.catalogMid
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

        if (
          ENGINE.searchFlowVersion === "A" &&
          shouldBlacklistSecondComboAfterRun(engineResult)
        ) {
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
        await sleep(randomBetween(100, 500));
        await rankPrbBrowser.close().catch(() => {});
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
