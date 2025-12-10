/**
 * Unified Runner - Patchright 엔진 + IP 로테이션 + 배치 실행
 *
 * 실행: npx tsx unified-runner.ts
 *
 * 워크플로우:
 * 1. 테더링 어댑터 감지 + 현재 IP 확인
 * 2. 4개 브라우저 동시 실행 (각각 작업 1개씩)
 * 3. 모두 완료 대기
 * 4. IP 로테이션 (테더링 껐다켜기)
 * 5. 다음 배치로 반복
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// Chrome/Puppeteer Temp 폴더를 D드라이브로 변경 (C드라이브 용량 문제 방지)
const TEMP_DIR = 'D:\\temp';
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
process.env.TEMP = TEMP_DIR;
process.env.TMP = TEMP_DIR;
process.env.TMPDIR = TEMP_DIR;

// .env 로드
const envPaths = [
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

import { chromium, type Page, type Browser, type BrowserContext } from "patchright";
import { createClient } from "@supabase/supabase-js";
import { rotateIP, getCurrentIP, getTetheringAdapter } from "./ipRotation";

// ============ 설정 ============
const PARALLEL_BROWSERS = 4;    // 동시 실행 브라우저 수
const BATCH_REST = 5 * 1000;    // 배치 간 휴식 (5초)
const EMPTY_WAIT = 10 * 1000;   // 작업 없을 때 대기 (10초)
const IP_ROTATION_ENABLED = true; // IP 로테이션 활성화
const BATCHES_PER_ROTATION = 5;   // 5배치(20건)마다 IP 로테이션
const BROWSER_LAUNCH_DELAY = 3000; // 브라우저 시작 간격 (3초)

// 브라우저 창 위치 (4분할 배치)
const BROWSER_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: 0 },      // Worker 1: 좌상단
  { x: 960, y: 0 },    // Worker 2: 우상단
  { x: 0, y: 540 },    // Worker 3: 좌하단
  { x: 960, y: 540 },  // Worker 4: 우하단
];
const BROWSER_WIDTH = 940;   // 브라우저 너비 (여백 포함)
const BROWSER_HEIGHT = 520;  // 브라우저 높이 (여백 포함)

const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;
const EQUIPMENT_NAME = process.env.EQUIPMENT_NAME || '';

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

interface WorkerResult {
  workerId: number;
  success: boolean;
  captcha: boolean;
  blocked: boolean;  // IP 차단 감지
  error?: string;
  productName?: string;
}

// ============ 전역 통계 ============
let totalRuns = 0;
let totalSuccess = 0;
let totalCaptcha = 0;
let totalFailed = 0;
let batchCount = 0;
let sessionStartTime = Date.now();
let currentIP = "";
let tetheringAdapter: string | null = null;

// ============ 작업 큐 락 (동시 접근 방지) ============
let isClaimingTask = false;

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

// ============ 인간화 스크롤 ============
async function humanScroll(page: Page, targetY: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < targetY) {
    const step = 100 + Math.random() * 150;
    await page.mouse.wheel(0, step);
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

// ============ 상품명 단어 셔플 ============
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

// ============ 프로필 로드 ============
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
      .from("traffic_navershopping")
      .select("id, slot_id, keyword, link_url")
      .eq("slot_type", "네이버쇼핑")
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
        .from("slot_naver")
        .select("mid, product_name")
        .eq("id", task.slot_id)
        .single();

      if (!slot || !slot.mid || !slot.product_name) {
        // mid/product_name 없으면 삭제하고 다음으로
        await supabase.from("traffic_navershopping").delete().eq("id", task.id);
        continue;
      }

      // 3. 유효한 작업 찾음 - 즉시 삭제
      const { error: deleteError } = await supabase
        .from("traffic_navershopping")
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
async function updateSlotStats(slotId: number, success: boolean): Promise<void> {
  const column = success ? "success_count" : "fail_count";
  const { data: current } = await supabase
    .from("slot_naver")
    .select(column)
    .eq("id", slotId)
    .single();

  if (current) {
    const newValue = ((current as any)[column] || 0) + 1;
    await supabase
      .from("slot_naver")
      .update({ [column]: newValue })
      .eq("id", slotId);
  }
}

// ============ Patchright 엔진 실행 ============
interface EngineResult {
  productPageEntered: boolean;
  captchaDetected: boolean;
  error?: string;
}

async function runPatchrightEngine(page: Page, mid: string, productName: string, workerId: number): Promise<EngineResult> {
  const result: EngineResult = {
    productPageEntered: false,
    captchaDetected: false
  };

  try {
    // 1. 네이버 메인
    log(`[Worker ${workerId}] 네이버 접속...`);
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(randomBetween(1500, 2500));

    // 2. 검색어 입력 (상품명 셔플)
    const searchQuery = shuffleWords(productName).substring(0, 50);
    log(`[Worker ${workerId}] 검색: ${searchQuery.substring(0, 30)}...`);
    await humanizedType(page, 'input[name="query"]', searchQuery);
    await sleep(randomBetween(300, 900));

    // 3. 엔터로 검색
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
    await sleep(randomBetween(2500, 3500));

    // 4. CAPTCHA 체크
    const searchCaptcha = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      return bodyText.includes('보안 확인') || bodyText.includes('자동입력방지');
    });

    if (searchCaptcha) {
      log(`[Worker ${workerId}] 검색 CAPTCHA 감지!`, "warn");
      result.captchaDetected = true;
      return result;
    }

    // 5. 스크롤
    await humanScroll(page, 1200);
    await sleep(randomBetween(400, 700));

    // 6. 상품 링크 찾기 (MID 매칭 우선)
    const linkInfo = await page.evaluate((targetMid: string) => {
      const links = Array.from(document.querySelectorAll('a'));

      // 1차: MID 포함된 링크
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href || '';
        if (href.includes(`nv_mid=${targetMid}`) || href.includes(`/${targetMid}`)) {
          const rect = link.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, index: i, href, x: rect.x + rect.width/2, y: rect.y + rect.height/2, method: 'MID-MATCH' };
          }
        }
      }

      // 2차: smartstore 직접 링크
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href || '';
        if (href.includes('/bridge') || href.includes('cr.shopping')) continue;
        if ((href.includes('smartstore.naver.com') || href.includes('brand.naver.com')) &&
            href.includes('/products/')) {
          const rect = link.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, index: i, href, x: rect.x + rect.width/2, y: rect.y + rect.height/2, method: 'ANY-SMARTSTORE' };
          }
        }
      }

      return { found: false };
    }, mid);

    if (!linkInfo.found) {
      log(`[Worker ${workerId}] 상품 링크 없음`, "warn");
      result.error = 'NoLink';
      return result;
    }

    log(`[Worker ${workerId}] 링크 발견: ${linkInfo.method}`);

    // 7. 베지어 마우스로 hover + 클릭
    const startX = randomBetween(300, 700);
    const startY = randomBetween(100, 300);
    await bezierMouseMove(page, startX, startY, linkInfo.x!, linkInfo.y!);
    await sleep(randomBetween(200, 400));

    // 새 탭 대기 + 클릭
    const context = page.context();
    const [newPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 60000 }).catch(() => null),
      page.locator(`a[href*="nv_mid=${mid}"]`).first().click().catch(() =>
        page.mouse.click(linkInfo.x!, linkInfo.y!)
      )
    ]);

    const targetPage = newPage || page;
    if (newPage) {
      await newPage.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
    } else {
      await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
    }
    await sleep(3000);

    // 8. Bridge URL 대기
    let finalUrl = targetPage.url();
    if (finalUrl.includes('/bridge') || finalUrl.includes('cr.shopping')) {
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        finalUrl = targetPage.url();
        if (!finalUrl.includes('/bridge') && !finalUrl.includes('cr.shopping')) break;
      }
    }

    // 9. 페이지 검증
    const pageCheck = await targetPage.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const hasCaptcha = bodyText.includes('보안 확인') ||
                        bodyText.includes('영수증 번호') ||
                        bodyText.includes('자동입력방지') ||
                        !!document.querySelector('#rcpt_form');
      const isDeleted = bodyText.includes('상품이 존재하지 않습니다') ||
                        bodyText.includes('상품이 삭제되었거나') ||
                        bodyText.includes('페이지를 찾을 수 없습니다');
      const isProductPage = (bodyText.includes('구매하기') || bodyText.includes('장바구니')) &&
                           !hasCaptcha && !isDeleted;
      return { hasCaptcha, isDeleted, isProductPage };
    });

    if (pageCheck.hasCaptcha) {
      log(`[Worker ${workerId}] 상품페이지 CAPTCHA`, "warn");
      result.captchaDetected = true;
      return result;
    }

    if (pageCheck.isDeleted) {
      result.error = 'Deleted';
      return result;
    }

    if (pageCheck.isProductPage) {
      result.productPageEntered = true;
      // 체류 시간
      const dwellTime = randomBetween(2000, 4000);
      log(`[Worker ${workerId}] 상품페이지 진입 성공! 체류: ${Math.round(dwellTime/1000)}초`);
      await sleep(dwellTime);
    } else {
      result.error = 'NotProductPage';
    }

    return result;

  } catch (e: any) {
    result.error = e.message;
    return result;
  }
}

// ============ 단일 워커 실행 (브라우저 생성 → 작업 실행 → 종료) ============
async function runSingleWorker(workerId: number, profile: Profile): Promise<WorkerResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const result: WorkerResult = {
    workerId,
    success: false,
    captcha: false,
    blocked: false
  };

  try {
    // 1. 작업 가져오기
    const work = await claimWorkItem();

    if (!work) {
      return result; // 작업 없음
    }

    result.productName = work.productName.substring(0, 30);
    log(`[Worker ${workerId}] 작업: ${result.productName}... (mid=${work.mid}) [IP: ${currentIP}]`);

    // 2. Patchright 브라우저 시작 (4분할 위치 배치)
    const pos = BROWSER_POSITIONS[(workerId - 1) % BROWSER_POSITIONS.length];
    browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: [
        `--window-position=${pos.x},${pos.y}`,
        `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
      ],
    });

    context = await browser.newContext({
      viewport: { width: BROWSER_WIDTH - 20, height: BROWSER_HEIGHT - 100 }, // 창 테두리/탭바 제외
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    page = await context.newPage();
    page.setDefaultTimeout(60000);       // 60초
    page.setDefaultNavigationTimeout(60000);

    // 3. Patchright 엔진 실행
    const engineResult = await runPatchrightEngine(page, work.mid, work.productName, workerId);

    // 4. 결과 처리
    if (engineResult.productPageEntered) {
      result.success = true;
      totalSuccess++;
      await updateSlotStats(work.slotId, true);
    } else if (engineResult.captchaDetected) {
      result.captcha = true;
      totalCaptcha++;
      await updateSlotStats(work.slotId, false);
    } else if (engineResult.error === 'Blocked') {
      result.blocked = true;
      log(`[Worker ${workerId}] IP 차단 감지!`, "warn");
      await updateSlotStats(work.slotId, false);
    } else {
      result.error = engineResult.error;
      totalFailed++;
      await updateSlotStats(work.slotId, false);
    }

    totalRuns++;

  } catch (e: any) {
    result.error = e.message;
    log(`[Worker ${workerId}] ERROR: ${e.message}`, "error");
  } finally {
    // 브라우저 종료
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return result;
}

// ============ 배치 실행 (5개 동시 → IP 로테이션) ============
async function runBatch(profile: Profile): Promise<boolean> {
  batchCount++;

  // 배치 시작 전 Temp 폴더 정리 (ENOSPC 방지)
  cleanupChromeTempFolders();

  log(`\n${"=".repeat(50)}`);
  log(`  배치 #${batchCount} 시작 (IP: ${currentIP})`);
  log(`${"=".repeat(50)}`);

  // 4개 워커 순차 시작 (BROWSER_LAUNCH_DELAY 간격)
  const workerPromises: Promise<WorkerResult>[] = [];
  for (let i = 1; i <= PARALLEL_BROWSERS; i++) {
    workerPromises.push(runSingleWorker(i, profile));
    // 마지막 워커가 아니면 지연 후 다음 워커 시작
    if (i < PARALLEL_BROWSERS) {
      log(`[Batch] 다음 브라우저까지 ${BROWSER_LAUNCH_DELAY/1000}초 대기...`);
      await sleep(BROWSER_LAUNCH_DELAY + Math.random() * 1000);
    }
  }

  // 모두 완료 대기
  const results = await Promise.all(workerPromises);

  // 결과 집계
  const successCount = results.filter(r => r.success).length;
  const captchaCount = results.filter(r => r.captcha).length;
  const blockedCount = results.filter(r => r.blocked).length;
  const noWorkCount = results.filter(r => !r.productName).length;

  log(`\n  배치 #${batchCount} 완료:`);
  log(`  - 성공: ${successCount}/${PARALLEL_BROWSERS}`);
  log(`  - CAPTCHA: ${captchaCount}`);
  log(`  - 차단: ${blockedCount}`);
  log(`  - 작업없음: ${noWorkCount}`);

  // IP 차단 감지 시 쿨다운
  if (blockedCount > 0) {
    log(`\n[경고] IP 차단 감지! 60초 쿨다운 후 IP 로테이션...`, "warn");
    await sleep(60000);  // 60초 대기
    return true;  // 작업 있음으로 처리해서 IP 로테이션 트리거
  }

  // 전체 CAPTCHA 시 쿨다운 (4개 모두 CAPTCHA면 IP 의심)
  if (captchaCount === PARALLEL_BROWSERS) {
    log(`\n[경고] 전체 CAPTCHA 감지! 60초 쿨다운 후 IP 로테이션...`, "warn");
    await sleep(60000);  // 60초 대기
    return true;  // IP 로테이션 트리거
  }

  // 작업이 모두 없으면 false 반환
  if (noWorkCount === PARALLEL_BROWSERS) {
    return false;
  }

  return true;
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
  console.log(`  배치: ${batchCount}회 | 총 실행: ${totalRuns}회`);
  console.log(`  성공: ${totalSuccess} (${successRate}%) | CAPTCHA: ${totalCaptcha} (${captchaRate}%)`);
  console.log(`  실패: ${totalFailed} | 현재 IP: ${currentIP}`);
  console.log(`  속도: ${elapsed > 0 ? (totalRuns / elapsed).toFixed(1) : '0'}회/분`);
  console.log(`${"=".repeat(60)}\n`);
}

// ============ 메인 ============
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Unified Runner (Patchright + IP Rotation + Batch)`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  동시 브라우저: ${PARALLEL_BROWSERS}개`);
  console.log(`  IP 로테이션: ${IP_ROTATION_ENABLED ? '활성화' : '비활성화'}`);
  console.log(`${"=".repeat(60)}`);

  // Git 업데이트 체커 시작
  startGitUpdateChecker();
  log(`Git update checker started (interval: ${GIT_CHECK_INTERVAL / 1000}s)`);

  // 프로필 로드
  const profile = loadProfile("pc_v7");
  log(`[Profile] ${profile.name}`);

  // 테더링 어댑터 감지
  if (IP_ROTATION_ENABLED) {
    log("\n테더링 어댑터 감지 중...");
    tetheringAdapter = await getTetheringAdapter();
    if (tetheringAdapter) {
      log(`테더링 어댑터: ${tetheringAdapter}`);
    } else {
      log("테더링 어댑터 없음 - IP 로테이션 비활성화", "warn");
    }
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

  // 메인 루프
  while (true) {
    try {
      // 배치 실행
      const hasWork = await runBatch(profile);

      if (!hasWork) {
        log("대기 중인 작업 없음...");
        await sleep(EMPTY_WAIT);
        continue;
      }

      // IP 로테이션 (N배치마다)
      if (IP_ROTATION_ENABLED && tetheringAdapter && batchCount % BATCHES_PER_ROTATION === 0) {
        log(`\nIP 로테이션 시작... (${BATCHES_PER_ROTATION}배치 완료)`);
        const rotationResult = await rotateIP(tetheringAdapter);

        if (rotationResult.success && rotationResult.oldIP !== rotationResult.newIP) {
          log(`IP 변경 성공: ${rotationResult.oldIP} → ${rotationResult.newIP}`);
          currentIP = rotationResult.newIP;
        } else if (rotationResult.oldIP === rotationResult.newIP) {
          log(`IP 변경 안됨! (동일 IP: ${rotationResult.oldIP})`, "warn");
        } else {
          log(`IP 로테이션 실패: ${rotationResult.error}`, "warn");
        }
      } else if (IP_ROTATION_ENABLED && tetheringAdapter) {
        log(`다음 IP 로테이션까지 ${BATCHES_PER_ROTATION - (batchCount % BATCHES_PER_ROTATION)}배치 남음`);
      }

      // 배치 간 휴식
      await sleep(BATCH_REST);

    } catch (error: any) {
      log(`메인 루프 에러: ${error.message}`, "error");
      await sleep(10000);
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
