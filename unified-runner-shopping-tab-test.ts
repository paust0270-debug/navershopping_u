/**
 * Unified Runner - Shopping Tab (Test)
 *
 * 실행: npx tsx unified-runner-shopping-tab-test.ts
 * PM2: pm2 start ecosystem.config.js --only turafic-shopping-tab-test
 *
 * 워크플로우:
 * 1. 자동완성 선택
 * 2. 쇼핑탭 진입 (msearch.shopping.naver.com)
 * 3. MID 매칭되는 상품 찾기
 *
 * 큐: traffic_navershopping_test
 * 통계: slot_navertest
 * 히스토리: slot_rank_navertest_history
 */

// ============ .env 로드 (최우선) ============
// 반드시 다른 import보다 먼저 실행
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// 현재 작업 디렉토리 기준으로 .env 로드
const envPath = path.join(process.cwd(), '.env');
console.log('[ENV] 현재 작업 디렉토리:', process.cwd());
console.log('[ENV] .env 파일 경로:', envPath);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[ENV] ✅ .env 파일 로드 완료');
} else {
  console.error('[ENV] ❌ .env 파일을 찾을 수 없습니다!');
  console.error('[ENV] 경로:', envPath);
  console.error('[ENV] 현재 디렉토리에 .env 파일을 생성하세요.');
  process.exit(1);
}

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

import { chromium, type Page, type Browser, type BrowserContext } from "patchright";
import { createClient } from "@supabase/supabase-js";
import { rotateIP, getCurrentIP, getTetheringAdapter, startRecoveryDaemon } from "./ipRotation";
import { ReceiptCaptchaSolverPRB } from "./captcha/ReceiptCaptchaSolverPRB";
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS } from "./shared/mobile-stealth";

// ================================================================
//  탐지 우회 계층 구조 (Detection Bypass Layers)
// ================================================================
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  1. 네트워크 계층 (Network Layer)                           │
//  │     - IP 로테이션 (ipRotation.ts)                           │
//  │     - 외부 IP 확인, 테더링 어댑터 관리                       │
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
const PARALLEL_BROWSERS = 1;    // 동시 실행 워커 수
const WORKER_REST = 2 * 1000;   // 워커 작업 간 휴식 (2초)
const EMPTY_WAIT = 10 * 1000;   // 작업 없을 때 대기 (10초)
const IP_ROTATION_ENABLED = true; // IP 로테이션 활성화
const TASKS_PER_ROTATION = 120;   // 120건마다 IP 로테이션
const WORKER_START_DELAY = 3000;  // 워커 시작 간격 (3초)
const TEST_MODE_ONE_RUN = false;   // 운영 모드: 무한 실행

// 테이블 설정 (Test 버전)
const QUEUE_TABLE = "traffic_navershopping-test";
const SLOT_TABLE = "slot_navertest";
const HISTORY_TABLE = "slot_rank_navertest_history";
const SLOT_TYPE_FILTER = "네이버test";

// 브라우저 창 위치 (4분할 배치 - 모바일 사이트용 좁은 창)
const BROWSER_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: 0 },      // Worker 1: 좌상단
  { x: 480, y: 0 },    // Worker 2: 우상단
  { x: 0, y: 540 },    // Worker 3: 좌하단
  { x: 480, y: 540 },  // Worker 4: 우하단
];
const BROWSER_WIDTH = 480;   // 브라우저 너비 (모바일 사이트용)
const BROWSER_HEIGHT = 540;  // 브라우저 높이

// 모바일/웹 모드 설정
const USE_MOBILE_MODE = true;  // true: 모바일(m.smartstore), false: 웹(smartstore)

// 모바일 디바이스 설정 (mobile-stealth.ts에서 import)
// MOBILE_CONTEXT_OPTIONS 사용으로 platform-version, model 헤더 포함
const MOBILE_CONTEXT = MOBILE_CONTEXT_OPTIONS;

// 웹(PC) 디바이스 설정
const WEB_CONTEXT = {
  viewport: { width: 400, height: 700 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;
const EQUIPMENT_NAME = process.env.EQUIPMENT_NAME || '';

// 환경변수 검증
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌ 환경변수가 설정되지 않았습니다!');
  console.error('SUPABASE_PRODUCTION_URL:', SUPABASE_URL ? '✅ 설정됨' : '❌ 없음');
  console.error('SUPABASE_PRODUCTION_KEY:', SUPABASE_KEY ? '✅ 설정됨' : '❌ 없음');
  console.error('EQUIPMENT_NAME:', EQUIPMENT_NAME || '(선택사항)');
  console.error('\n.env 파일을 확인하세요!');
  process.exit(1);
}

console.log('[ENV] 환경변수 검증 완료');
console.log('[ENV] SUPABASE_URL:', SUPABASE_URL.substring(0, 40) + '...');
console.log('[ENV] EQUIPMENT_NAME:', EQUIPMENT_NAME || '(미설정)');

// ============ Supabase 클라이언트 ============
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ 타입 정의 ============
interface WorkItem {
  taskId: number;
  slotId: number;
  keyword: string;
  productName: string;
  mid: string;
  linkUrl: string;
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
let tetheringAdapter: string | null = null;
let tasksSinceRotation = 0;  // IP 로테이션 후 처리된 작업 수

// ============ 작업 큐 락 (동시 접근 방지) ============
let isClaimingTask = false;

// ============ IP 로테이션 락 (동시 로테이션 방지) ============
let isRotatingIP = false;

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

// ============ 작업 1개 가져오기 (직접 쿼리 + 즉시 삭제) ============
async function claimWorkItem(): Promise<WorkItem | null> {
  // 동시 접근 방지 (한 번에 하나씩만)
  while (isClaimingTask) {
    await sleep(100);
  }
  isClaimingTask = true;

  try {
    // 1. 작업 여러개 가져오기
    const { data: tasks, error: taskError } = await supabase
      .from(QUEUE_TABLE)
      .select("id, slot_id, keyword, link_url")
      .eq("slot_type", SLOT_TYPE_FILTER)
      .order("id", { ascending: true })
      .limit(10);

    if (taskError) {
      log(`[FETCH ERROR] ${taskError.message}`, "error");
      return null;
    }

    if (!tasks || tasks.length === 0) {
      return null;
    }

    // 2. mid, product_name 있는 작업 찾기
    for (const task of tasks) {
      const { data: slot } = await supabase
        .from(SLOT_TABLE)
        .select("mid, product_name")
        .eq("id", task.slot_id)
        .single();

      if (!slot || !slot.mid || !slot.product_name) {
        // mid/product_name 없으면 삭제하고 다음으로
        await supabase.from(QUEUE_TABLE).delete().eq("id", task.id);
        continue;
      }

      // 3. 유효한 작업 찾음 - 즉시 삭제
      const { error: deleteError } = await supabase
        .from(QUEUE_TABLE)
        .delete()
        .eq("id", task.id);

      if (deleteError) {
        log(`[DELETE ERROR] ${deleteError.message}`, "error");
        return null;
      }

      return {
        taskId: task.id,
        slotId: task.slot_id,
        keyword: task.keyword,
        productName: slot.product_name,
        mid: slot.mid,
        linkUrl: task.link_url
      };
    }

    return null;
  } catch (e: any) {
    log(`[CLAIM ERROR] ${e.message}`, "error");
    return null;
  } finally {
    isClaimingTask = false;
  }
}

// ============ slot_naver 통계 업데이트 ============
async function updateSlotStats(
  slotId: number,
  success: boolean,
  failReason?: FailReason,
  captchaSolved?: boolean
): Promise<void> {
  try {
    if (success) {
      // 성공: success_count 증가
      const { data: current, error: selectError } = await supabase
        .from(SLOT_TABLE)
        .select("success_count")
        .eq("id", slotId)
        .single();

      if (selectError) {
        log(`[Stats] Select failed (slot ${slotId}): ${selectError.message}`, "warn");
        return;
      }

      if (current) {
        const newCount = ((current as any).success_count || 0) + 1;
        const { error: updateError } = await supabase
          .from(SLOT_TABLE)
          .update({ success_count: newCount })
          .eq("id", slotId);

        if (updateError) {
          log(`[Stats] Update failed (slot ${slotId}): ${updateError.message}`, "warn");
        } else {
          log(`[Stats] slot ${slotId} success_count: ${newCount}`);
        }
      }
    } else {
      // 실패: fail_count 증가
      const { data: current, error: selectError } = await supabase
        .from(SLOT_TABLE)
        .select("fail_count")
        .eq("id", slotId)
        .single();

      if (selectError) {
        log(`[Stats] Select failed (slot ${slotId}): ${selectError.message}`, "warn");
        return;
      }

      if (current) {
        const newCount = ((current as any).fail_count || 0) + 1;
        const { error: updateError } = await supabase
          .from(SLOT_TABLE)
          .update({ fail_count: newCount })
          .eq("id", slotId);

        if (updateError) {
          log(`[Stats] Update failed (slot ${slotId}): ${updateError.message}`, "warn");
        } else {
          log(`[Stats] slot ${slotId} fail_count: ${newCount} (reason: ${failReason || 'unknown'})`);
        }
      }
    }
  } catch (e: any) {
    log(`[Stats] Exception (slot ${slotId}): ${e.message}`, "warn");
  }
}

// ============ 큐와 슬롯 동기화 (시작 시 자동 슬롯 생성) ============
async function syncSlotsFromQueue(): Promise<void> {
  try {
    log("[Sync] 큐에서 슬롯 동기화 시작...");

    // 1. 큐에서 모든 고유 keyword 가져오기
    const { data: queueKeywords, error: queueError } = await supabase
      .from(QUEUE_TABLE)
      .select("keyword")
      .not("keyword", "is", null);

    if (queueError) {
      log(`[Sync] 큐 조회 실패: ${queueError.message}`, "error");
      return;
    }

    if (!queueKeywords || queueKeywords.length === 0) {
      log("[Sync] 큐에 작업이 없습니다.");
      return;
    }

    // 고유 키워드 추출
    const uniqueKeywords = [...new Set(queueKeywords.map(k => k.keyword).filter(Boolean))];
    log(`[Sync] 큐에서 ${uniqueKeywords.length}개 고유 키워드 발견`);

    // 2. slot_navertest에 이미 있는 키워드 확인
    const { data: existingSlots, error: slotError } = await supabase
      .from(SLOT_TABLE)
      .select("keyword");

    if (slotError) {
      log(`[Sync] 슬롯 조회 실패: ${slotError.message}`, "error");
      return;
    }

    const existingKeywords = new Set(
      (existingSlots || []).map(s => s.keyword).filter(Boolean)
    );

    // 3. 없는 키워드들만 추가
    const missingKeywords = uniqueKeywords.filter(k => !existingKeywords.has(k));

    if (missingKeywords.length === 0) {
      log("[Sync] 모든 키워드가 이미 슬롯에 존재합니다.");
      return;
    }

    log(`[Sync] ${missingKeywords.length}개 키워드를 슬롯에 추가 중...`);

    // 4. 슬롯 추가 (mid, product_name은 임시값)
    const newSlots = missingKeywords.map(keyword => ({
      keyword,
      mid: "NEED_MID_" + Math.floor(Math.random() * 1000000),
      product_name: `${keyword} (수동 입력 필요)`,
      success_count: 0,
      fail_count: 0
    }));

    const { error: insertError } = await supabase
      .from(SLOT_TABLE)
      .insert(newSlots);

    if (insertError) {
      log(`[Sync] 슬롯 삽입 실패: ${insertError.message}`, "error");
      return;
    }

    log(`[Sync] ✅ ${missingKeywords.length}개 슬롯 추가 완료`);
    log(`[Sync] ⚠️  Supabase에서 각 슬롯의 MID와 상품명을 수동으로 입력하세요!`);
    missingKeywords.forEach(k => log(`      - ${k}`));

  } catch (e: any) {
    log(`[Sync] 에러: ${e.message}`, "error");
  }
}

// ============ 큐의 slot_id를 자동 매칭 (슬롯 생성 후 실행) ============
async function autoAssignSlotIds(): Promise<void> {
  try {
    log("[AutoAssign] slot_id가 없는 작업에 자동 할당 시작...");

    // 1. slot_id가 null인 작업들 가져오기
    const { data: nullSlotTasks, error: fetchError } = await supabase
      .from(QUEUE_TABLE)
      .select("id, keyword")
      .is("slot_id", null)
      .limit(100);

    if (fetchError) {
      log(`[AutoAssign] 조회 실패: ${fetchError.message}`, "error");
      return;
    }

    if (!nullSlotTasks || nullSlotTasks.length === 0) {
      log("[AutoAssign] slot_id가 null인 작업이 없습니다.");
      return;
    }

    log(`[AutoAssign] ${nullSlotTasks.length}개 작업에 slot_id 할당 중...`);

    // 2. 각 keyword에 맞는 slot_id 찾아서 업데이트
    let assigned = 0;
    for (const task of nullSlotTasks) {
      if (!task.keyword) continue;

      // 해당 keyword의 slot_id 찾기
      const { data: slot } = await supabase
        .from(SLOT_TABLE)
        .select("id")
        .eq("keyword", task.keyword)
        .limit(1)
        .single();

      if (!slot) continue;

      // 업데이트
      const { error: updateError } = await supabase
        .from(QUEUE_TABLE)
        .update({ slot_id: slot.id })
        .eq("id", task.id);

      if (!updateError) {
        assigned++;
      }
    }

    log(`[AutoAssign] ✅ ${assigned}개 작업에 slot_id 할당 완료`);

  } catch (e: any) {
    log(`[AutoAssign] 에러: ${e.message}`, "error");
  }
}

// ============ 히스토리 기록 (모든 실행마다) ============
async function recordHistory(
  work: WorkItem,
  engineResult: EngineResult,
  workerId: number,
  durationMs: number
): Promise<void> {
  try {
    const record = {
      slot_status_id: work.slotId,
      keyword: work.keyword,
      link_url: work.linkUrl,
      mid: work.mid,
      product_name: work.productName,

      // 순위 정보 (현재는 null, 나중에 순위 체크 기능 추가 시 사용)
      current_rank: null,
      start_rank: null,
      rank_change: null,
      previous_rank: null,
      rank_diff: null,

      // 실행 결과
      success: engineResult.productPageEntered,
      captcha_solved: engineResult.captchaSolved,
      fail_reason: engineResult.failReason || null,
      execution_duration_ms: durationMs,

      // 메타데이터
      worker_id: `Worker ${workerId}`,
      equipment_name: EQUIPMENT_NAME || 'unknown',
      ip_address: currentIP,
      rank_date: new Date().toISOString(),
      created_at: new Date().toISOString(),

      // 분류
      customer_id: null,
      distributor: 'shopping-tab-test',
      slot_type: SLOT_TYPE_FILTER,
      source_table: SLOT_TABLE,
      source_row_id: work.slotId,
    };

    const { error } = await supabase
      .from(HISTORY_TABLE)
      .insert([record]);

    if (error) {
      log(`[History] 기록 실패: ${error.message}`, "warn");
    }
  } catch (e: any) {
    log(`[History] 에러: ${e.message}`, "warn");
  }
}

// ============ [브라우저 계층] Patchright 엔진 실행 ============
// Patchright: Playwright 포크로 봇 탐지 우회 내장
// - navigator.webdriver 속성 제거
// - Chrome DevTools Protocol 탐지 우회
// - 자동화 플래그 숨김

type FailReason =
  | 'NO_MID_MATCH'
  | 'CAPTCHA_UNSOLVED'
  | 'PAGE_NOT_LOADED'
  | 'PRODUCT_DELETED'
  | 'TIMEOUT'
  | 'IP_BLOCKED';

interface EngineResult {
  productPageEntered: boolean;
  captchaDetected: boolean;
  captchaSolved: boolean;
  midMatched: boolean;
  failReason?: FailReason;
  error?: string;
}

/**
 * 쇼핑탭 상품 전체 로드 (rank-check 방식)
 * 18번 스크롤, 550px씩, 100ms 간격으로 모든 lazy loading 상품 로드
 */
async function hydrateShoppingPage(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));

  const SCROLL_STEPS = 18;
  const SCROLL_GAP_MS = 100;

  for (let step = 0; step < SCROLL_STEPS; step++) {
    await page.evaluate(() => window.scrollBy(0, 550));
    await sleep(SCROLL_GAP_MS);
  }
  await sleep(150);
}

async function runPatchrightEngine(page: Page, mid: string, productName: string, keyword: string, workerId: number): Promise<EngineResult> {
  // CAPTCHA 솔버 초기화
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(`[Worker ${workerId}] ${msg}`));

  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };

  try {
    // 1. 모바일 네이버 접속 (PC UA 그대로)
    log(`[Worker ${workerId}] m.naver.com 접속...`);
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(randomBetween(1500, 2500));

    // 2. 검색창 클릭
    await page.evaluate(() => window.scrollTo(0, 0));
    log(`[Worker ${workerId}] 검색창 클릭...`);
    await page.locator('#MM_SEARCH_FAKE').click({ force: true });
    await sleep(randomBetween(800, 1200));

    // 3. 짧은 키워드 입력 (keyword 또는 상품명 첫 단어)
    const shortKeyword = keyword || productName.split(' ')[0].substring(0, 10);
    log(`[Worker ${workerId}] "${shortKeyword}" 입력...`);
    const searchInput = page.locator('#query.sch_input').first();
    await searchInput.type(shortKeyword, { delay: randomBetween(80, 150) });
    await sleep(randomBetween(1500, 2500));

    // 4. 일반 자동완성 항목 랜덤 클릭 (data-area="top")
    log(`[Worker ${workerId}] 자동완성 선택...`);
    const autocompleteItems = page.locator('#sb-ac-recomm-wrap li.u_atcp_l[data-area="top"] a.u_atcp_a');

    let autocompleteClicked = false;
    try {
      await autocompleteItems.first().waitFor({ state: 'visible', timeout: 3000 });
      const count = await autocompleteItems.count();
      log(`[Worker ${workerId}] 자동완성 항목 ${count}개`);

      if (count > 1) {
        const randomIndex = Math.floor(Math.random() * (count - 1)) + 1;
        const selectedItem = autocompleteItems.nth(randomIndex);
        const keywordText = await selectedItem.textContent();
        log(`[Worker ${workerId}] 선택: "${keywordText?.trim()}"`);
        await selectedItem.click();
        autocompleteClicked = true;
      } else if (count === 1) {
        await autocompleteItems.first().click();
        autocompleteClicked = true;
      }
    } catch (e) {
      log(`[Worker ${workerId}] 자동완성 실패, 검색 버튼 탭...`, "warn");
      const searchBtn = await page.$('button[type="submit"], .btn_search, [class*="search_btn"]');
      if (searchBtn) {
        await searchBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      autocompleteClicked = true; // 버튼 탭으로 대체
    }

    if (!autocompleteClicked) {
      result.error = 'NoAutocomplete';
      return result;
    }

    await page.waitForLoadState('domcontentloaded');
    await sleep(randomBetween(2000, 3000));

    // 5. URL에서 ackey 확인 + query를 상품명으로 변경
    const currentUrl = page.url();
    const urlObj = new URL(currentUrl);
    const ackey = urlObj.searchParams.get('ackey');
    const sm = urlObj.searchParams.get('sm');
    log(`[Worker ${workerId}] ackey=${ackey}, sm=${sm}`);

    // query를 상품명으로 변경
    urlObj.searchParams.set('query', productName);
    log(`[Worker ${workerId}] 상품명으로 검색 이동...`);
    await page.goto(urlObj.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(randomBetween(2000, 3000));

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 쇼핑탭 진입 (직접 이동)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    log(`[Worker ${workerId}] 🛍️ 쇼핑탭 진입...`);
    const shoppingUrl = `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(productName)}`;
    await page.goto(shoppingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(randomBetween(2000, 3000));
    log(`[Worker ${workerId}] 쇼핑탭 로딩 완료`);

    // 6. IP 차단 체크
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

    // 8. 쇼핑탭 상품 전체 로드 (rank-check 방식)
    log(`[Worker ${workerId}] 쇼핑탭 상품 로드 중...`);
    await hydrateShoppingPage(page);
    log(`[Worker ${workerId}] 상품 로드 완료`);

    // 9. 모든 상품 MID 수집 (광고 제외)
    log(`[Worker ${workerId}] MID 탐색: ${mid}`);
    const allProducts = await page.$$eval('a[data-shp-contents-id]', (anchors, targetMid) => {
      const results: any[] = [];

      for (const anchor of anchors) {
        const productMid = anchor.getAttribute('data-shp-contents-id');
        if (!productMid) continue;

        // 광고 제외 (NPLA)
        const inventory = anchor.getAttribute('data-shp-inventory') || '';
        const isAd = /lst\*(A|P|D)/.test(inventory);
        if (isAd) continue;

        results.push({
          mid: productMid,
          isTarget: productMid === targetMid,
          href: anchor.getAttribute('href') || '',
        });
      }

      return results;
    }, mid);

    log(`[Worker ${workerId}] 수집된 상품: ${allProducts.length}개 (광고 제외)`);

    // 10. target MID 찾기
    const targetProduct = allProducts.find(p => p.isTarget);

    if (!targetProduct) {
      log(`[Worker ${workerId}] MID를 찾을 수 없습니다.`, "warn");

      // 디버깅: 페이지 내 모든 MID 출력
      const allMids = allProducts.map(p => p.mid).join(', ');
      log(`[Worker ${workerId}] 페이지 내 MID 목록: ${allMids.substring(0, 200)}...`);

      result.failReason = 'NO_MID_MATCH';
      result.error = 'NoMID';
      return result;
    }

    log(`[Worker ${workerId}] MID 발견! 클릭 시도...`);

    // 11. MID 상품 클릭 (3가지 전략)
    let midClicked = false;

    // 전략 1: data-shp-contents-id 속성으로 찾기
    const linkByAttr = page.locator(`a[data-shp-contents-id="${mid}"]`).first();
    const attrVisible = await linkByAttr.isVisible({ timeout: 2000 }).catch(() => false);

    if (attrVisible) {
      log(`[Worker ${workerId}] 클릭 (data-shp-contents-id)`);
      await linkByAttr.click();
      midClicked = true;
    } else {
      // 전략 2: URL 파라미터로 찾기
      const linkByParam = page.locator(`a[href*="nv_mid=${mid}"]`).first();
      const paramVisible = await linkByParam.isVisible({ timeout: 1000 }).catch(() => false);

      if (paramVisible) {
        log(`[Worker ${workerId}] 클릭 (URL 파라미터)`);
        await linkByParam.click();
        midClicked = true;
      } else {
        // 전략 3: URL 경로로 찾기
        const linkByPath = page.locator(`a[href*="/products/${mid}"]`).first();
        const pathVisible = await linkByPath.isVisible({ timeout: 1000 }).catch(() => false);

        if (pathVisible) {
          log(`[Worker ${workerId}] 클릭 (URL 경로)`);
          await linkByPath.click();
          midClicked = true;
        }
      }
    }

    if (!midClicked) {
      log(`[Worker ${workerId}] MID를 찾았지만 클릭 실패`, "warn");
      result.failReason = 'NO_MID_MATCH';
      result.error = 'ClickFailed';
      return result;
    }

    // 12. 페이지 로딩 대기
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await sleep(2000);
    result.midMatched = true;

    // 13. 체류 + 검증
    const dwellTime = randomBetween(3000, 6000);
    log(`[Worker ${workerId}] 체류 ${(dwellTime / 1000).toFixed(1)}초...`);
    await sleep(dwellTime);

    const currentPageUrl = page.url();
    log(`[Worker ${workerId}] 페이지: ${currentPageUrl.substring(0, 50)}...`);
    if (currentPageUrl.includes('smartstore.naver.com') ||
        currentPageUrl.includes('brand.naver.com') ||
        currentPageUrl.includes('shopping.naver.com/window-products/')) {
      result.productPageEntered = true;
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

// ============ IP 로테이션 (작업 수 기반) ============
async function tryRotateIP(): Promise<void> {
  if (!IP_ROTATION_ENABLED || !tetheringAdapter) return;
  if (tasksSinceRotation < TASKS_PER_ROTATION) return;
  if (isRotatingIP) return;  // 이미 로테이션 중

  isRotatingIP = true;
  try {
    log(`\n[IP] 로테이션 시작... (${tasksSinceRotation}건 처리 완료)`);
    const rotationResult = await rotateIP(tetheringAdapter);

    if (rotationResult.success && rotationResult.oldIP !== rotationResult.newIP) {
      log(`[IP] 변경 성공: ${rotationResult.oldIP} → ${rotationResult.newIP}`);
      currentIP = rotationResult.newIP;
      tasksSinceRotation = 0;  // 카운터 리셋
    } else if (rotationResult.oldIP === rotationResult.newIP) {
      log(`[IP] 변경 안됨 (동일 IP: ${rotationResult.oldIP})`, "warn");
      tasksSinceRotation = 0;  // 어쨌든 리셋
    } else {
      log(`[IP] 로테이션 실패: ${rotationResult.error}`, "warn");
    }
  } finally {
    isRotatingIP = false;
  }
}

// ============ 강제 IP 로테이션 (차단/CAPTCHA 시) ============
async function forceRotateIP(reason: string): Promise<void> {
  if (!IP_ROTATION_ENABLED || !tetheringAdapter) return;
  if (isRotatingIP) {
    // 이미 로테이션 중이면 완료 대기
    while (isRotatingIP) {
      await sleep(1000);
    }
    return;
  }

  isRotatingIP = true;
  try {
    log(`\n[IP] 강제 로테이션 (${reason}) - 60초 쿨다운...`, "warn");
    await sleep(60000);  // 쿨다운

    const rotationResult = await rotateIP(tetheringAdapter);
    if (rotationResult.success) {
      log(`[IP] 변경: ${rotationResult.oldIP} → ${rotationResult.newIP}`);
      currentIP = rotationResult.newIP;
      tasksSinceRotation = 0;
    }
  } finally {
    isRotatingIP = false;
  }
}

// ============ [독립 워커] 무한 루프로 작업 처리 ============
// 각 워커가 독립적으로 작업 가져오기 → 실행 → 다음 작업
async function runIndependentWorker(workerId: number, profile: Profile): Promise<void> {
  log(`[Worker ${workerId}] 시작`);

  while (true) {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      // 1. 작업 가져오기
      const work = await claimWorkItem();

      if (!work) {
        // 테스트 모드: 작업 없으면 바로 종료
        if (TEST_MODE_ONE_RUN) {
          log(`[Worker ${workerId}] 작업 없음 - 테스트 모드 종료`);
          return;
        }
        // 작업 없으면 대기
        await sleep(EMPTY_WAIT);
        continue;
      }

      const productShort = work.productName.substring(0, 30);
      log(`[Worker ${workerId}] 작업: ${productShort}... (mid=${work.mid}) [IP: ${currentIP}]`);

      // 2. Patchright 브라우저 시작
      const pos = BROWSER_POSITIONS[(workerId - 1) % BROWSER_POSITIONS.length];
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
          `--window-position=${pos.x},${pos.y}`,
          `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
        ],
      });

      // 모바일/웹 모드에 따라 context 설정
      context = await browser.newContext(USE_MOBILE_MODE ? MOBILE_CONTEXT : WEB_CONTEXT);

      // 모바일 스텔스 스크립트 적용 (봇 탐지 우회)
      if (USE_MOBILE_MODE) {
        await applyMobileStealth(context);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);

      // 3. Patchright 엔진 실행
      const startTime = Date.now();
      const engineResult = await runPatchrightEngine(page, work.mid, work.productName, work.keyword, workerId);
      const executionTime = Date.now() - startTime;

      // 4. 결과 처리
      totalRuns++;
      tasksSinceRotation++;

      // 히스토리 기록 (모든 실행마다)
      await recordHistory(work, engineResult, workerId, executionTime);

      if (engineResult.productPageEntered) {
        totalSuccess++;
        await updateSlotStats(work.slotId, true, undefined, engineResult.captchaSolved);

        if (engineResult.captchaSolved) {
          log(`[Worker ${workerId}] SUCCESS(CAPTCHA해결) | ${productShort}...`);
        } else {
          log(`[Worker ${workerId}] SUCCESS | ${productShort}...`);
        }
      } else {
        totalFailed++;

        if (engineResult.failReason === 'CAPTCHA_UNSOLVED') {
          totalCaptcha++;
          await updateSlotStats(work.slotId, false, 'CAPTCHA_UNSOLVED', false);
          log(`[Worker ${workerId}] FAIL(CAPTCHA) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'IP_BLOCKED') {
          await updateSlotStats(work.slotId, false, 'IP_BLOCKED', false);
          log(`[Worker ${workerId}] FAIL(IP차단) | ${productShort}...`, "warn");
          // IP 차단 시 강제 로테이션
          await forceRotateIP('IP_BLOCKED');
        } else if (engineResult.failReason === 'NO_MID_MATCH') {
          await updateSlotStats(work.slotId, false, 'NO_MID_MATCH', false);
          log(`[Worker ${workerId}] FAIL(MID없음) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === 'TIMEOUT') {
          await updateSlotStats(work.slotId, false, 'TIMEOUT', false);
          log(`[Worker ${workerId}] FAIL(타임아웃) | ${productShort}...`, "warn");
        } else {
          await updateSlotStats(work.slotId, false, undefined, false);
          log(`[Worker ${workerId}] FAIL(${engineResult.error || 'Unknown'}) | ${productShort}...`, "warn");
        }
      }

      // 5. IP 로테이션 체크 (N건마다)
      await tryRotateIP();

      // 6. 작업 간 휴식
      await sleep(WORKER_REST + Math.random() * 1000);

    } catch (e: any) {
      log(`[Worker ${workerId}] ERROR: ${e.message}`, "error");
      await sleep(5000);  // 에러 시 5초 대기
    } finally {
      // 브라우저 종료
      if (browser) {
        await sleep(randomBetween(100, 500));
        await browser.close().catch(() => {});
      }
    }

    // 주기적으로 Temp 폴더 정리 (10작업마다)
    if (totalRuns % 10 === 0 && workerId === 1) {
      cleanupChromeTempFolders();
    }

    // 테스트 모드: 1회만 실행
    if (TEST_MODE_ONE_RUN) {
      log(`[Worker ${workerId}] 테스트 모드 - 1회 실행 완료, 종료`);
      break;
    }
  }
}

// ============ Heartbeat (장비현황 업데이트) ============
async function sendHeartbeat(): Promise<void> {
  if (!EQUIPMENT_NAME) return;

  try {
    const { data, error, count } = await supabase
      .from('equipment_status')
      .update({
        ip_address: currentIP || 'unknown',
        connection_status: 'connected',
        last_heartbeat: new Date().toISOString(),
      })
      .eq('equipment_name', EQUIPMENT_NAME)
      .select();

    if (error) {
      log(`Heartbeat 실패: ${error.message}`, "warn");
    } else if (!data || data.length === 0) {
      log(`Heartbeat: 매칭되는 장비 없음 (equipment_name=${EQUIPMENT_NAME})`, "warn");
    } else {
      log(`Heartbeat OK (${EQUIPMENT_NAME})`);
    }
  } catch (e: any) {
    log(`Heartbeat 에러: ${e.message}`, "error");
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
  console.log(`  총 실행: ${totalRuns}회 | 다음 IP 로테이션까지: ${TASKS_PER_ROTATION - tasksSinceRotation}건`);
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

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Shopping Tab Runner - TEST`);
  console.log(`  Script: unified-runner-shopping-tab-test.ts | Commit: ${gitCommit}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  큐: ${QUEUE_TABLE}`);
  console.log(`  통계: ${SLOT_TABLE}`);
  console.log(`  히스토리: ${HISTORY_TABLE}`);
  console.log(`  동시 워커: ${PARALLEL_BROWSERS}개 (각자 독립 실행)`);
  console.log(`  IP 로테이션: ${IP_ROTATION_ENABLED ? `${TASKS_PER_ROTATION}건마다` : '비활성화'}`);
  console.log(`${"=".repeat(60)}`);

  // Git 업데이트 체커 시작
  startGitUpdateChecker();
  log(`Git update checker started (interval: ${GIT_CHECK_INTERVAL / 1000}s)`);

  // 프로필 로드
  const profile = loadProfile("pc_v7");
  log(`[Profile] ${profile.name}`);

  // 테더링 어댑터 감지 및 복구 데몬 시작
  if (IP_ROTATION_ENABLED) {
    log("\n테더링 어댑터 감지 중...");
    tetheringAdapter = await getTetheringAdapter();
    if (tetheringAdapter) {
      log(`테더링 어댑터: ${tetheringAdapter}`);
    } else {
      log("테더링 어댑터 없음 - IP 로테이션 비활성화", "warn");
    }

    // ADB 복구 데몬 시작 (5초마다 자동으로 모바일 데이터 켜기)
    startRecoveryDaemon();
  }

  // 현재 IP 확인
  try {
    currentIP = await getCurrentIP();
    log(`현재 IP: ${currentIP}`);
  } catch (e: any) {
    log(`IP 확인 실패: ${e.message}`, "error");
    currentIP = "unknown";
  }

  // 통계 출력 인터벌
  setInterval(printStats, 60000);

  // Heartbeat 시작 (30초마다)
  if (EQUIPMENT_NAME) {
    setInterval(sendHeartbeat, 30000);
    sendHeartbeat(); // 즉시 한 번 전송
    log(`장비명: ${EQUIPMENT_NAME}`);
  }

  // ============ 큐와 슬롯 동기화 ============
  log("");
  await syncSlotsFromQueue();       // 1. 큐의 keyword를 슬롯에 추가 (없으면)
  await autoAssignSlotIds();        // 2. 큐의 slot_id를 자동 매칭
  log("");

  // 독립 워커들 시작 (순차적으로 시작하여 각자 무한 루프)
  log(`\n${PARALLEL_BROWSERS}개 워커 시작...`);

  if (TEST_MODE_ONE_RUN) {
    // 테스트 모드: 워커가 끝날 때까지 기다림
    for (let i = 1; i <= PARALLEL_BROWSERS; i++) {
      await runIndependentWorker(i, profile).catch((e) => {
        log(`[Worker ${i}] 치명적 에러: ${e.message}`, "error");
      });
    }
    log(`\n테스트 완료 - 종료합니다.\n`);
    printStats();
    process.exit(0);
  } else {
    // 일반 모드: 비동기로 실행
    for (let i = 1; i <= PARALLEL_BROWSERS; i++) {
      // 각 워커를 독립적으로 시작 (await 없음 - 비동기로 실행)
      runIndependentWorker(i, profile).catch((e) => {
        log(`[Worker ${i}] 치명적 에러: ${e.message}`, "error");
      });

      // 다음 워커까지 지연 (동시 시작 방지)
      if (i < PARALLEL_BROWSERS) {
        await sleep(WORKER_START_DELAY);
      }
    }

    log(`모든 워커 시작 완료 - 독립 실행 중...\n`);

    // 메인 스레드는 살아있어야 함 (워커들이 백그라운드에서 실행)
    while (true) {
      await sleep(60000);  // 1분마다 체크 (실제로는 아무것도 안 함)
    }
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
