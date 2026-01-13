/**
 * Test Keywords Runner - 특정 키워드 테스트용 러너
 *
 * slot_naver 테이블에서 특정 키워드만 필터링하여 테스트
 * 실제 브라우저 자동화 실행 + success/fail 카운트 증가
 *
 * 실행:
 *   TEST_KEYWORDS="키워드1,키워드2" npx tsx scripts/test-keywords-runner.ts
 *   npx tsx scripts/test-keywords-runner.ts --config test-keywords.json
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// Chrome/Puppeteer Temp 폴더 설정
const getDriveLetter = () => {
  try {
    if (fs.existsSync('D:\\')) {
      return 'D:\\temp';
    }
  } catch (e) {}
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
}

// .env 로드
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
  'C:\\turafic\\.env',
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}

import { chromium, type Page, type Browser, type BrowserContext } from "patchright";
import { createClient } from "@supabase/supabase-js";
import { rotateIP, getCurrentIP, getTetheringAdapter, startRecoveryDaemon } from "../ipRotation";
import { ReceiptCaptchaSolverPRB } from "../captcha/ReceiptCaptchaSolverPRB";
import { applyMobileStealth, MOBILE_CONTEXT_OPTIONS } from "../shared/mobile-stealth";

// ============ 설정 ============
const PARALLEL_BROWSERS = 2;
const WORKER_REST = 2 * 1000;
const EMPTY_WAIT = 10 * 1000;
const IP_ROTATION_ENABLED = true;
const TASKS_PER_ROTATION = 120;
const WORKER_START_DELAY = 3000;
const LOCK_TIMEOUT_MINUTES = 60;

// 브라우저 창 위치
const BROWSER_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 480, y: 0 },
  { x: 0, y: 540 },
  { x: 480, y: 540 },
];
const BROWSER_WIDTH = 480;
const BROWSER_HEIGHT = 540;

// 모바일 모드
const USE_MOBILE_MODE = true;
const MOBILE_CONTEXT = MOBILE_CONTEXT_OPTIONS;
const WEB_CONTEXT = {
  viewport: { width: 400, height: 700 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;
const EQUIPMENT_NAME = process.env.EQUIPMENT_NAME || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ 테스트 키워드 로드 ============
interface TestKeywordsConfig {
  keywords: string[];
  enabled: boolean;
}

function loadTestKeywords(): string[] {
  // 1. 환경변수 체크
  const envKeywords = process.env.TEST_KEYWORDS;
  if (envKeywords) {
    const keywords = envKeywords.split(',').map(k => k.trim()).filter(Boolean);
    log(`[TEST] 환경변수에서 ${keywords.length}개 키워드 로드: [${keywords.join(', ')}]`);
    return keywords;
  }

  // 2. 설정 파일 체크
  const configArg = process.argv.find(arg => arg.startsWith('--config='));
  const configPath = configArg
    ? configArg.split('=')[1]
    : path.join(process.cwd(), 'test-keywords.json');

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config: TestKeywordsConfig = JSON.parse(content);
      if (config.enabled && config.keywords.length > 0) {
        log(`[TEST] 설정 파일에서 ${config.keywords.length}개 키워드 로드: [${config.keywords.join(', ')}]`);
        return config.keywords;
      }
    } catch (e: any) {
      log(`[TEST] 설정 파일 로드 실패: ${e.message}`, "error");
    }
  }

  log(`[TEST] 키워드 없음 - 모든 슬롯 대상`, "warn");
  return [];
}

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
let tasksSinceRotation = 0;

let isClaimingTask = false;
let isRotatingIP = false;

// ============ Git 업데이트 체크 ============
const GIT_CHECK_INTERVAL = 3 * 60 * 1000;
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
    execSync("git fetch origin main", { encoding: "utf8", timeout: 30000 });
    const remoteHash = execSync("git rev-parse origin/main", { encoding: "utf8", timeout: 5000 }).trim();
    const localHash = getCurrentCommitHash();
    if (remoteHash && localHash && remoteHash !== localHash) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function startGitUpdateChecker(): void {
  lastCommitHash = getCurrentCommitHash();
  setInterval(() => {
    if (checkForUpdates()) {
      log("Git update detected! Restarting to apply changes...", "warn");
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

// ============ 베지어 곡선 마우스 ============
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

// ============ 인간화 스크롤 (모바일 터치 제스처) ============
async function humanScroll(page: Page, targetY: number): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const client = await getCDPSession(page);
  const x = Math.floor(viewport.width / 2);
  const y = Math.floor(viewport.height / 2);

  let scrolled = 0;
  while (scrolled < targetY) {
    const step = 100 + Math.random() * 150;

    // CDP로 모바일 터치 스크롤 제스처 시뮬레이션 (모든 파라미터 정수 변환)
    await client.send('Input.synthesizeScrollGesture', {
      x: Math.floor(x),
      y: Math.floor(y),
      yDistance: -Math.floor(step),  // 음수 = 아래로 스크롤
      xDistance: 0,
      speed: Math.floor(randomBetween(800, 1500)),
      gestureSourceType: 'touch',
      repeatCount: 1,
      repeatDelayMs: 0,
    });

    scrolled += step;
    await sleep(80 + Math.random() * 60);
  }
}

// ============ 인간화 타이핑 ============
async function humanizedType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await sleep(randomBetween(250, 600));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomKeyDelay() });
  }
}

// ============ Chrome Temp 폴더 정리 ============
function cleanupChromeTempFolders(): void {
  const tempDirs = ['D:\\temp', 'D:\\tmp'];
  let totalCleaned = 0;

  for (const tempDir of tempDirs) {
    if (!fs.existsSync(tempDir)) continue;

    try {
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });

      for (const entry of entries) {
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

// ============ 프로필 로드 ============
function loadProfile(profileName: string): Profile {
  const profilePath = path.join(__dirname, '..', 'profiles', `${profileName}.json`);
  if (fs.existsSync(profilePath)) {
    const content = fs.readFileSync(profilePath, 'utf-8');
    return JSON.parse(content);
  }
  return {
    name: profileName,
    prb_options: {
      headless: false,
      turnstile: true
    }
  };
}

// ============ slot_naver에서 작업 1개 가져오기 ============
async function claimWorkItemFromSlot(): Promise<WorkItem | null> {
  while (isClaimingTask) {
    await sleep(100);
  }
  isClaimingTask = true;

  try {
    const testKeywords = loadTestKeywords();
    const lockTimeoutMs = LOCK_TIMEOUT_MINUTES * 60 * 1000;

    // slot_naver에서 키워드 필터링
    let query = supabase
      .from("slot_naver")
      .select("id, keyword, mid, product_name, worker_lock, locked_at")
      .eq("status", "작동중")
      .not("mid", "is", null)
      .not("product_name", "is", null);

    // 키워드 필터링 (있을 경우)
    if (testKeywords.length > 0) {
      query = query.in("keyword", testKeywords);
    }

    const { data: slots, error } = await query
      .order("id", { ascending: false })
      .limit(50);

    if (error) {
      log(`[DEBUG] 슬롯 조회 에러: ${error.message}`, "error");
      return null;
    }

    if (!slots || slots.length === 0) {
      log(`[DEBUG] 조회된 슬롯 없음 (키워드: ${testKeywords.join(', ')})`);
      return null;
    }

    log(`[DEBUG] ${slots.length}개 슬롯 조회됨 (키워드: ${testKeywords.join(', ')})`);

    // 키워드별 균등 분배를 위해 랜덤 셔플
    const shuffled = [...slots].sort(() => Math.random() - 0.5);

    // 잠금되지 않았거나 타임아웃된 슬롯 찾기
    let checkedCount = 0;
    let lockedCount = 0;
    for (const slot of shuffled) {
      checkedCount++;
      const isLocked = slot.worker_lock !== null;
      const lockExpired = slot.locked_at
        ? (Date.now() - new Date(slot.locked_at).getTime()) > lockTimeoutMs
        : true;

      if (isLocked && !lockExpired) {
        lockedCount++;
        log(`[DEBUG] 슬롯 ${slot.id} (${slot.keyword}) 잠김: ${slot.worker_lock}`);
        continue;
      }

      log(`[DEBUG] 슬롯 ${slot.id} (${slot.keyword}) 잠금 시도...`);

      // 잠금 획득 시도
      const { data: updated, error: updateError } = await supabase
        .from("slot_naver")
        .update({
          worker_lock: EQUIPMENT_NAME || 'test-runner',
          locked_at: new Date().toISOString(),
        })
        .eq("id", slot.id)
        .is("worker_lock", null)  // 낙관적 잠금 (다른 워커가 안 잡은 것만)
        .select()
        .single();

      if (updateError) {
        log(`[DEBUG] 슬롯 ${slot.id} 잠금 실패: ${updateError.message}`, "warn");
        continue;
      }

      if (!updated) {
        log(`[DEBUG] 슬롯 ${slot.id} 잠금 실패: 다른 워커가 먼저 획득`, "warn");
        continue;
      }

      log(`[DEBUG] 슬롯 ${slot.id} (${slot.keyword}) 획득 성공!`);
      return {
        taskId: slot.id,
        slotId: slot.id,
        keyword: slot.keyword,
        productName: slot.product_name,
        mid: slot.mid,
        linkUrl: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(slot.product_name)}`
      };
    }

    log(`[DEBUG] 모든 슬롯 획득 실패 (체크: ${checkedCount}, 잠김: ${lockedCount})`, "warn");
    return null;
  } catch (e: any) {
    log(`[CLAIM ERROR] ${e.message}`, "error");
    return null;
  } finally {
    isClaimingTask = false;
  }
}

// ============ 슬롯 잠금 해제 ============
async function releaseSlot(slotId: number): Promise<void> {
  await supabase
    .from("slot_naver")
    .update({ worker_lock: null, locked_at: null })
    .eq("id", slotId);
}

// ============ slot_naver 통계 업데이트 ============
type FailReason =
  | 'NO_MID_MATCH'
  | 'CAPTCHA_UNSOLVED'
  | 'PAGE_NOT_LOADED'
  | 'PRODUCT_DELETED'
  | 'TIMEOUT'
  | 'IP_BLOCKED';

async function updateSlotStats(
  slotId: number,
  success: boolean,
  failReason?: FailReason,
  captchaSolved?: boolean
): Promise<void> {
  try {
    if (success) {
      const { data: current, error: selectError } = await supabase
        .from("slot_naver")
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
          .from("slot_naver")
          .update({ success_count: newCount })
          .eq("id", slotId);

        if (updateError) {
          log(`[Stats] Update failed (slot ${slotId}): ${updateError.message}`, "warn");
        } else {
          log(`[Stats] slot ${slotId} success_count: ${newCount}`);
        }
      }
    } else {
      const { data: current, error: selectError } = await supabase
        .from("slot_naver")
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
          .from("slot_naver")
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

// ============ Patchright 엔진 실행 ============
interface EngineResult {
  productPageEntered: boolean;
  captchaDetected: boolean;
  captchaSolved: boolean;
  midMatched: boolean;
  failReason?: FailReason;
  error?: string;
}

async function runPatchrightEngine(page: Page, mid: string, productName: string, keyword: string, workerId: number): Promise<EngineResult> {
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(`[Worker ${workerId}] ${msg}`));

  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };

  try {
    // 1. 모바일 네이버 접속
    log(`[Worker ${workerId}] m.naver.com 접속...`);
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(randomBetween(1500, 2500));

    // 2. 검색창 클릭
    await page.evaluate(() => window.scrollTo(0, 0));
    log(`[Worker ${workerId}] 검색창 클릭...`);
    await page.locator('#MM_SEARCH_FAKE').click({ force: true });
    await sleep(randomBetween(800, 1200));

    // 3. 키워드 입력
    const shortKeyword = keyword || productName.split(' ')[0].substring(0, 10);
    log(`[Worker ${workerId}] "${shortKeyword}" 입력...`);
    const searchInput = page.locator('#query.sch_input').first();
    await searchInput.type(shortKeyword, { delay: randomBetween(80, 150) });
    await sleep(randomBetween(1500, 2500));

    // 4. 자동완성 선택
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
      autocompleteClicked = true;
    }

    if (!autocompleteClicked) {
      result.error = 'NoAutocomplete';
      return result;
    }

    await page.waitForLoadState('domcontentloaded');
    await sleep(randomBetween(2000, 3000));

    // 5. ackey 확인 + query를 상품명으로 변경
    const currentUrl = page.url();
    const urlObj = new URL(currentUrl);
    const ackey = urlObj.searchParams.get('ackey');
    const sm = urlObj.searchParams.get('sm');
    log(`[Worker ${workerId}] ackey=${ackey}, sm=${sm}`);

    urlObj.searchParams.set('query', productName);
    log(`[Worker ${workerId}] 상품명으로 검색 이동...`);
    await page.goto(urlObj.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(randomBetween(2000, 3000));

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

    // 8. MID 찾기 + 클릭
    log(`[Worker ${workerId}] MID 탐색: ${mid}`);
    const MAX_SCROLL = 10;
    let midClicked = false;

    for (let i = 0; i < MAX_SCROLL; i++) {
      const productLink = page.locator(`a[href*="nv_mid=${mid}"]`).first();
      const isVisible = await productLink.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        log(`[Worker ${workerId}] MID 일치 상품 발견!`);

        await productLink.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await sleep(2000);

        log(`[Worker ${workerId}] 상품 페이지 진입`);
        midClicked = true;
        result.midMatched = true;

        const dwellTime = randomBetween(3000, 6000);
        log(`[Worker ${workerId}] 체류 ${(dwellTime / 1000).toFixed(1)}초...`);
        await sleep(dwellTime);

        const currentPageUrl = page.url();
        const isSmartStore = currentPageUrl.includes('smartstore.naver.com') ||
                             currentPageUrl.includes('brand.naver.com');

        log(`[Worker ${workerId}] 페이지: ${currentPageUrl.substring(0, 50)}...`);

        if (isSmartStore) {
          result.productPageEntered = true;
        }
        break;
      }

      await humanScroll(page, 500);
      await sleep(randomBetween(300, 500));

      const prevHeight = await page.evaluate(() => document.body?.scrollHeight || 0).catch(() => 0);
      await sleep(300);
      const newHeight = await page.evaluate(() => document.body?.scrollHeight || 0).catch(() => 0);
      if (newHeight === prevHeight && i > 3) {
        log(`[Worker ${workerId}] 스크롤 끝`, "warn");
        break;
      }
    }

    if (!midClicked) {
      result.error = 'NoMidMatch';
      result.failReason = 'NO_MID_MATCH';
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

// ============ IP 로테이션 ============
async function tryRotateIP(): Promise<void> {
  if (!IP_ROTATION_ENABLED || !tetheringAdapter) return;
  if (tasksSinceRotation < TASKS_PER_ROTATION) return;
  if (isRotatingIP) return;

  isRotatingIP = true;
  try {
    log(`\n[IP] 로테이션 시작... (${tasksSinceRotation}건 처리 완료)`);
    const rotationResult = await rotateIP(tetheringAdapter);

    if (rotationResult.success && rotationResult.oldIP !== rotationResult.newIP) {
      log(`[IP] 변경 성공: ${rotationResult.oldIP} → ${rotationResult.newIP}`);
      currentIP = rotationResult.newIP;
      tasksSinceRotation = 0;
    } else if (rotationResult.oldIP === rotationResult.newIP) {
      log(`[IP] 변경 안됨 (동일 IP: ${rotationResult.oldIP})`, "warn");
      tasksSinceRotation = 0;
    } else {
      log(`[IP] 로테이션 실패: ${rotationResult.error}`, "warn");
    }
  } finally {
    isRotatingIP = false;
  }
}

async function forceRotateIP(reason: string): Promise<void> {
  if (!IP_ROTATION_ENABLED || !tetheringAdapter) return;
  if (isRotatingIP) {
    while (isRotatingIP) {
      await sleep(1000);
    }
    return;
  }

  isRotatingIP = true;
  try {
    log(`\n[IP] 강제 로테이션 (${reason}) - 60초 쿨다운...`, "warn");
    await sleep(60000);

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

// ============ 독립 워커 ============
async function runIndependentWorker(workerId: number, profile: Profile): Promise<void> {
  log(`[Worker ${workerId}] 시작`);

  while (true) {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      const work = await claimWorkItemFromSlot();

      if (!work) {
        await sleep(EMPTY_WAIT);
        continue;
      }

      const productShort = work.productName.substring(0, 30);
      log(`[Worker ${workerId}] 작업: ${productShort}... (mid=${work.mid}) [IP: ${currentIP}]`);

      const pos = BROWSER_POSITIONS[(workerId - 1) % BROWSER_POSITIONS.length];
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
          `--window-position=${pos.x},${pos.y}`,
          `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
        ],
      });

      context = await browser.newContext(USE_MOBILE_MODE ? MOBILE_CONTEXT : WEB_CONTEXT);

      if (USE_MOBILE_MODE) {
        await applyMobileStealth(context);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);

      const engineResult = await runPatchrightEngine(page, work.mid, work.productName, work.keyword, workerId);

      totalRuns++;
      tasksSinceRotation++;

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

      // 슬롯 잠금 해제
      await releaseSlot(work.slotId);

      await tryRotateIP();
      await sleep(WORKER_REST + Math.random() * 1000);

    } catch (e: any) {
      log(`[Worker ${workerId}] ERROR: ${e.message}`, "error");
      await sleep(5000);
    } finally {
      if (browser) {
        await sleep(randomBetween(100, 500));
        await browser.close().catch(() => {});
      }
    }

    if (totalRuns % 10 === 0 && workerId === 1) {
      cleanupChromeTempFolders();
    }
  }
}

// ============ Heartbeat ============
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

// ============ 메인 ============
async function main() {
  const testKeywords = loadTestKeywords();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Test Keywords Runner`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  동시 워커: ${PARALLEL_BROWSERS}개`);
  console.log(`  테스트 키워드: ${testKeywords.length > 0 ? testKeywords.join(', ') : '전체'}`);
  console.log(`  IP 로테이션: ${IP_ROTATION_ENABLED ? `${TASKS_PER_ROTATION}건마다` : '비활성화'}`);
  console.log(`${"=".repeat(60)}`);

  startGitUpdateChecker();
  log(`Git update checker started (interval: ${GIT_CHECK_INTERVAL / 1000}s)`);

  const profile = loadProfile("pc_v7");
  log(`[Profile] ${profile.name}`);

  if (IP_ROTATION_ENABLED) {
    log("\n테더링 어댑터 감지 중...");
    tetheringAdapter = await getTetheringAdapter();
    if (tetheringAdapter) {
      log(`테더링 어댑터: ${tetheringAdapter}`);
    } else {
      log("테더링 어댑터 없음 - IP 로테이션 비활성화", "warn");
    }
    startRecoveryDaemon();
  }

  try {
    currentIP = await getCurrentIP();
    log(`현재 IP: ${currentIP}`);
  } catch (e: any) {
    log(`IP 확인 실패: ${e.message}`, "error");
    currentIP = "unknown";
  }

  setInterval(printStats, 60000);

  if (EQUIPMENT_NAME) {
    setInterval(sendHeartbeat, 30000);
    sendHeartbeat();
    log(`장비명: ${EQUIPMENT_NAME}`);
  }

  log(`\n${PARALLEL_BROWSERS}개 워커 시작...`);
  for (let i = 1; i <= PARALLEL_BROWSERS; i++) {
    runIndependentWorker(i, profile).catch((e) => {
      log(`[Worker ${i}] 치명적 에러: ${e.message}`, "error");
    });

    if (i < PARALLEL_BROWSERS) {
      await sleep(WORKER_START_DELAY);
    }
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

// 전역 에러 핸들러
process.on('uncaughtException', (error) => {
  const msg = error.message || "";
  if ((msg.includes('EPERM') || msg.includes('ENOENT')) &&
      (msg.includes('temp') || msg.includes('lighthouse') || msg.includes('puppeteer'))) {
    return;
  }
  console.error(`\n[FATAL] Uncaught Exception: ${error.message}`);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason: any) => {
  console.error(`\n[FATAL] Unhandled Rejection: ${reason?.message || reason}`);
});

// 실행
main().catch((error) => {
  console.error(`[FATAL] Main error: ${error.message}`);
  process.exit(1);
});
