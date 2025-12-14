/**
 * Slot Naver Runner - slot_naver 테이블 기반 병렬 작업 러너
 *
 * 4개 브라우저가 각각 다른 슬롯을 담당하여 100회씩 시퀀스 전송
 * 각 브라우저는 독립된 chromium.launch() 인스턴스로 실행
 *
 * 실행:
 *   npx tsx scripts/slot-naver-runner.ts
 *   npx tsx scripts/slot-naver-runner.ts --test     # 테스트 모드 (슬롯당 10회)
 *   npx tsx scripts/slot-naver-runner.ts --headless # 헤드리스 모드
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Chrome Temp 폴더를 D드라이브로 변경
const TEMP_DIR = "D:\\temp";
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
process.env.TEMP = TEMP_DIR;
process.env.TMP = TEMP_DIR;
process.env.TMPDIR = TEMP_DIR;

// .env 로드
const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, "..", ".env"),
  "C:\\turafic\\.env",
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
import { BehaviorLogCaptor } from "../engines-packet/capture/BehaviorLogCaptor";
import { BehaviorLogBuilder } from "../engines-packet/builders/BehaviorLogBuilder";
import { MultiSendEngine } from "../engines-packet/replay/MultiSendEngine";
import { ReceiptCaptchaSolverPRB } from "../captcha/ReceiptCaptchaSolverPRB";

// 캡챠 솔버 인스턴스
const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log(msg));

// ============ 설정 ============
const PARALLEL_BROWSERS = 4;
const SEQUENCES_PER_SLOT = 100;  // 슬롯당 시퀀스 반복 횟수
const LOCK_TIMEOUT_MINUTES = 60;
const IP_ROTATION_INTERVAL = 60 * 60 * 1000; // 1시간

// 브라우저 창 위치
const BROWSER_POSITIONS = [
  { x: 0, y: 0 },
  { x: 960, y: 0 },
  { x: 0, y: 540 },
  { x: 960, y: 540 },
];
const BROWSER_WIDTH = 940;
const BROWSER_HEIGHT = 520;

// 환경변수
const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;
const SUPABASE_CONTROL_URL = process.env.SUPABASE_CONTROL_URL;
const SUPABASE_CONTROL_KEY = process.env.SUPABASE_CONTROL_KEY;
const HOSTNAME = os.hostname();
const WORKER_ID = process.env.EQUIPMENT_NAME || `slot-naver-${HOSTNAME.toLowerCase()}`;

// 실행 옵션
const IS_TEST_MODE = process.argv.includes("--test");
const IS_HEADLESS = process.argv.includes("--headless");
const TEST_SEQUENCES = 100;  // 테스트도 100회

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Control DB (워커 모니터링용) - 선택적
const controlDb = SUPABASE_CONTROL_URL && SUPABASE_CONTROL_KEY
  ? createClient(SUPABASE_CONTROL_URL, SUPABASE_CONTROL_KEY)
  : null;

// Heartbeat 설정
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5분
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentProcessingSlots: string[] = [];

// 프로필 경로 (충돌 방지)
const PROFILE_BASE_DIR = path.join(process.cwd(), "profiles");

// ============ 타입 ============
interface SlotNaver {
  id: number;
  keyword: string;
  mid: string;
  product_name: string;
  success_count: number;
  fail_count: number;
  worker_lock: string | null;
  locked_at: string | null;
  last_reset_date: string | null;
}

// ============ 전역 상태 ============
let currentIP = "";
let tetheringAdapter: string | null = null;
let lastIPRotationTime = Date.now();

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string, level: "info" | "warn" | "error" = "info") {
  const time = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const prefix = { info: "[INFO]", warn: "[WARN]", error: "[ERROR]" }[level];
  console.log(`[${time}] ${prefix} ${msg}`);
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

// ============ 워커 Heartbeat ============
async function sendHeartbeat(status: "online" | "working" | "idle" | "error" = "online"): Promise<void> {
  if (!controlDb) return;

  try {
    const now = new Date().toISOString();
    const activeSlots = Object.values(currentProcessingSlots).filter(Boolean);
    const taskCount = activeSlots.length;

    // upsert: nodeId로 찾아서 업데이트, 없으면 생성
    const { error } = await controlDb
      .from("workerNodes")
      .upsert({
        nodeId: WORKER_ID,
        nodeType: "worker",  // enum: experiment, worker, playwright, prb
        hostname: HOSTNAME,
        status: status,
        lastHeartbeat: now,
        currentTaskId: taskCount > 0 ? taskCount : null,  // integer: 현재 처리 중인 슬롯 수
        updatedAt: now,
      }, {
        onConflict: "nodeId",
      });

    if (error) {
      log(`[Heartbeat] 전송 실패: ${error.message}`, "warn");
    } else {
      log(`[Heartbeat] ${status}, 작업 슬롯: ${taskCount}개`);
    }
  } catch (e: any) {
    log(`[Heartbeat] 예외: ${e.message}`, "error");
  }
}

function startHeartbeat(): void {
  if (!controlDb) {
    log("[Heartbeat] Control DB 미설정 - 비활성화");
    return;
  }

  // 즉시 첫 heartbeat 전송
  sendHeartbeat("online");

  // 5분마다 heartbeat
  heartbeatTimer = setInterval(() => {
    const status = currentProcessingSlots.length > 0 ? "working" : "idle";
    sendHeartbeat(status);
  }, HEARTBEAT_INTERVAL);

  log(`[Heartbeat] 시작 (${HEARTBEAT_INTERVAL / 60000}분 간격)`);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  sendHeartbeat("idle");
}

// ============ 프로필 충돌 방지 ============
function getProfilePath(workerId: number): string {
  const profileNum = String(workerId + 1).padStart(2, "0");
  return path.join(PROFILE_BASE_DIR, `profile_${profileNum}`);
}

async function cleanupProfileLock(profilePath: string): Promise<void> {
  const singletonLock = path.join(profilePath, "SingletonLock");
  try {
    if (fs.existsSync(singletonLock)) {
      fs.unlinkSync(singletonLock);
      log(`[Profile] SingletonLock 삭제: ${profilePath}`);
    }
  } catch (e: any) {
    // 무시 (다른 프로세스가 사용 중일 수 있음)
  }
}

// ============ 일일 리셋 ============
async function checkDailyReset(): Promise<void> {
  const today = getTodayDate();
  const { data: slots } = await supabase
    .from("slot_naver")
    .select("id, success_count, fail_count, last_reset_date")
    .or(`last_reset_date.is.null,last_reset_date.neq.${today}`);

  if (!slots || slots.length === 0) return;

  log(`일일 리셋: ${slots.length}개 슬롯`);
  for (const slot of slots) {
    await supabase
      .from("slot_naver")
      .update({
        yesterday_success_count: slot.success_count || 0,
        yesterday_fail_count: slot.fail_count || 0,
        success_count: 0,
        fail_count: 0,
        last_reset_date: today,
        worker_lock: null,
        locked_at: null,
      })
      .eq("id", slot.id);
  }
}

// ============ N개 슬롯 동시 획득 ============
async function acquireMultipleSlots(count: number): Promise<SlotNaver[]> {
  const lockTimeoutMs = LOCK_TIMEOUT_MINUTES * 60 * 1000;
  const sequencesLimit = IS_TEST_MODE ? TEST_SEQUENCES : SEQUENCES_PER_SLOT;

  const { data: slots, error } = await supabase
    .from("slot_naver")
    .select("*")
    .eq("status", "작동중")
    .not("mid", "is", null)
    .not("product_name", "is", null)
    .order("id", { ascending: true });

  if (error || !slots) {
    log(`슬롯 조회 실패: ${error?.message}`, "error");
    return [];
  }

  const acquired: SlotNaver[] = [];

  for (const slot of slots) {
    if (acquired.length >= count) break;

    // 오늘 작업 완료된 슬롯 스킵
    const todayTasks = (slot.success_count || 0) + (slot.fail_count || 0);
    if (todayTasks >= sequencesLimit) continue;

    // 잠금 체크
    const isLocked = slot.worker_lock !== null;
    const lockExpired = slot.locked_at
      ? (Date.now() - new Date(slot.locked_at).getTime()) > lockTimeoutMs
      : true;

    if (isLocked && !lockExpired) continue;

    // 잠금 획득
    const { data: updated, error: updateError } = await supabase
      .from("slot_naver")
      .update({
        worker_lock: `${WORKER_ID}_${acquired.length}`,
        locked_at: new Date().toISOString(),
      })
      .eq("id", slot.id)
      .select()
      .single();

    if (!updateError && updated) {
      acquired.push(updated as SlotNaver);
      log(`슬롯 잠금: ${slot.product_name?.substring(0, 20)}... (ID: ${slot.id})`);
    }
  }

  return acquired;
}

// ============ 슬롯 잠금 해제 ============
async function releaseSlot(slotId: number): Promise<void> {
  await supabase
    .from("slot_naver")
    .update({ worker_lock: null, locked_at: null })
    .eq("id", slotId);
}

// ============ 슬롯 통계 업데이트 ============
async function updateSlotStats(slotId: number, successCount: number, failCount: number): Promise<void> {
  try {
    const { data: current, error: selectError } = await supabase
      .from("slot_naver")
      .select("success_count, fail_count")
      .eq("id", slotId)
      .single();

    if (selectError) {
      log(`[DB] 슬롯 ${slotId} 조회 실패: ${selectError.message}`, "error");
      return;
    }

    if (current) {
      const newSuccess = (current.success_count || 0) + successCount;
      const newFail = (current.fail_count || 0) + failCount;

      const { error: updateError } = await supabase
        .from("slot_naver")
        .update({
          success_count: newSuccess,
          fail_count: newFail,
        })
        .eq("id", slotId);

      if (updateError) {
        log(`[DB] 슬롯 ${slotId} 업데이트 실패: ${updateError.message}`, "error");
      } else {
        log(`[DB] 슬롯 ${slotId} 업데이트: success=${newSuccess}, fail=${newFail}`);
      }
    }
  } catch (e: any) {
    log(`[DB] 슬롯 ${slotId} 예외: ${e.message}`, "error");
  }
}

// ============ 인간화 스크롤 ============
async function humanScroll(page: Page, distance: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < distance) {
    const step = randomBetween(50, 150);
    await page.mouse.wheel(0, step);
    scrolled += step;
    await sleep(randomBetween(30, 80));
  }
}

// ============ 인간화 타이핑 ============
async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomBetween(50, 150) });
  }
}

// ============ 차단 감지 및 캡챠 해결 ============
async function detectAndSolveBlock(page: Page, workerId: number): Promise<boolean> {
  const blockInfo = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const isCaptcha = text.includes("보안 확인") ||
                      text.includes("자동입력방지") ||
                      text.includes("영수증") ||
                      !!document.querySelector("#rcpt_form") ||
                      !!document.querySelector("#rcpt_img");
    const isHardBlock = text.includes("비정상적인 접근") ||
                        text.includes("접근이 차단");
    return { isCaptcha, isHardBlock };
  }).catch(() => ({ isCaptcha: false, isHardBlock: false }));

  // 완전 차단 (복구 불가)
  if (blockInfo.isHardBlock) {
    log(`[Worker ${workerId}] 하드 차단 감지 - IP 변경 필요`, "error");
    return true;
  }

  // 캡챠 감지 시 풀기 시도
  if (blockInfo.isCaptcha) {
    log(`[Worker ${workerId}] 캡챠 감지 - 풀기 시도...`);
    try {
      const solved = await captchaSolver.solve(page as any);
      if (solved) {
        log(`[Worker ${workerId}] 캡챠 해결 성공!`);
        await sleep(2000);
        return false;  // 계속 진행
      } else {
        log(`[Worker ${workerId}] 캡챠 해결 실패`, "warn");
        return true;  // 중단
      }
    } catch (e: any) {
      log(`[Worker ${workerId}] 캡챠 솔버 오류: ${e.message}`, "error");
      return true;
    }
  }

  return false;  // 차단 없음
}

// ============ 상품 찾기 및 클릭 ============
async function findAndClickProduct(page: Page, mid: string, workerId: number): Promise<Page | null> {
  for (let scroll = 0; scroll < 15; scroll++) {
    // nv_mid=타겟MID 형식으로 정확히 매칭
    const found = await page.evaluate((targetMid) => {
      const selector = `a[href*="nv_mid=${targetMid}"]`;
      const links = Array.from(document.querySelectorAll(selector));

      if (links.length > 0) {
        const link = links[0] as HTMLAnchorElement;
        link.scrollIntoView({ behavior: "smooth", block: "center" });
        return {
          found: true,
          href: link.href.substring(0, 80),
          text: link.innerText?.substring(0, 30) || "(no text)"
        };
      }
      return { found: false, href: "", text: "" };
    }, mid).catch(() => ({ found: false, href: "", text: "" }));

    if (found.found) {
      log(`[Worker ${workerId}] 클릭: ${found.text}`);
      await sleep(randomBetween(500, 1000));

      // 클릭
      const context = page.context();
      const [newPage] = await Promise.all([
        context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
        page.click(`a[href*="nv_mid=${mid}"]`),
      ]);

      if (newPage) {
        await newPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
        return newPage as Page;
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      return page;
    }

    await humanScroll(page, 800);
    await sleep(randomBetween(500, 1000));
  }

  return null;
}

// ============ 단일 슬롯 처리 (독립 브라우저) ============
async function processSlot(slot: SlotNaver, workerId: number): Promise<{ success: number; failed: number }> {
  const sequencesLimit = IS_TEST_MODE ? TEST_SEQUENCES : SEQUENCES_PER_SLOT;
  const pos = BROWSER_POSITIONS[workerId % 4];
  const profilePath = getProfilePath(workerId);
  let context: BrowserContext | null = null;
  let success = 0;
  let failed = 0;

  // 현재 작업 슬롯 추적 (heartbeat용)
  currentProcessingSlots[workerId] = `${slot.id}:${slot.product_name?.substring(0, 15)}`;

  try {
    log(`[Worker ${workerId}] 슬롯 시작: ${slot.product_name?.substring(0, 25)}... (${sequencesLimit}회)`);

    // 프로필 잠금 정리
    await cleanupProfileLock(profilePath);

    // 독립된 브라우저 인스턴스 생성 (launchPersistentContext로 프로필 사용)
    context = await chromium.launchPersistentContext(profilePath, {
      channel: "chrome",
      headless: IS_HEADLESS,
      viewport: { width: BROWSER_WIDTH - 20, height: BROWSER_HEIGHT - 100 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      args: [
        `--window-position=${pos.x},${pos.y}`,
        `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(60000);

    // 1. 네이버 접속
    log(`[Worker ${workerId}] 네이버 접속...`);
    await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(randomBetween(1500, 2500));

    if (await detectAndSolveBlock(page, workerId)) {
      await context.close();
      return { success: 0, failed: sequencesLimit };
    }

    // 2. 검색
    log(`[Worker ${workerId}] 검색: ${slot.product_name?.substring(0, 30)}...`);
    await page.click('input[name="query"]');
    await sleep(randomBetween(200, 400));
    await humanType(page, slot.product_name);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await sleep(randomBetween(2000, 3000));

    if (await detectAndSolveBlock(page, workerId)) {
      await context.close();
      return { success: 0, failed: sequencesLimit };
    }

    // 3. 상품 찾기 및 클릭
    log(`[Worker ${workerId}] MID ${slot.mid} 탐색...`);

    // 디버그: 현재 페이지의 MID들 출력
    const foundMids = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="nv_mid="]'));
      return links.slice(0, 5).map(a => {
        const href = (a as HTMLAnchorElement).href;
        const match = href.match(/nv_mid=(\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean);
    }).catch(() => []);
    log(`[Worker ${workerId}] 발견된 MID들: [${foundMids.join(', ')}]`);

    const targetPage = await findAndClickProduct(page, slot.mid, workerId);

    if (!targetPage) {
      log(`[Worker ${workerId}] 상품 못 찾음`, "warn");
      await context.close();
      return { success: 0, failed: sequencesLimit };
    }

    // Bridge URL 대기
    for (let i = 0; i < 10; i++) {
      if (!targetPage.url().includes("/bridge") && !targetPage.url().includes("cr.shopping")) break;
      await sleep(1000);
    }
    await sleep(randomBetween(2000, 3000));

    if (await detectAndSolveBlock(targetPage, workerId)) {
      await context.close();
      return { success: 0, failed: sequencesLimit };
    }

    // 4. 행동 로그 캡처
    log(`[Worker ${workerId}] 행동 로그 캡처...`);
    const captor = new BehaviorLogCaptor(() => {});
    captor.attach(targetPage);

    await targetPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await sleep(randomBetween(2000, 3000));

    await humanScroll(targetPage, 500);
    await sleep(randomBetween(1000, 1500));
    await humanScroll(targetPage, 400);
    await sleep(randomBetween(1000, 1500));

    const capturedLogs = captor.getCapturedLogs();
    const productLog = capturedLogs.find((l) => l.url.includes("product-logs") && l.url.includes("smartstore"));
    const nlogLogs = capturedLogs.filter((l) => l.url.includes("nlog.naver.com") && !l.url.includes("product-logs"));
    const commerceLogs = capturedLogs.filter((l) => l.url.includes("nlog.commerce.naver.com"));

    log(`[Worker ${workerId}] 캡처: product-logs=${productLog ? 'O' : 'X'}, nlog=${nlogLogs.length}, commerce=${commerceLogs.length}`);

    // product-logs가 없으면 실패
    if (!productLog) {
      log(`[Worker ${workerId}] product-logs 없음 - 실패`, "warn");
      await context.close();
      return { success: 0, failed: sequencesLimit };
    }

    // 5. MultiSendEngine 준비
    const nlogBuilder = new BehaviorLogBuilder(() => {});
    const multiSend = new MultiSendEngine(nlogBuilder, () => {});
    multiSend.setPage(targetPage);

    // 6. 초기 product-logs (dwell=0) - 1회만
    await multiSend.sendProductLogPost(
      { url: productLog.url, headers: productLog.headers, body: productLog.body },
      { dwellTime: 0, scrollDepth: 0 }
    );

    // 7. 시퀀스 반복
    log(`[Worker ${workerId}] ${sequencesLimit}회 시퀀스 시작...`);
    let cumulativeDwell = 0;

    for (let iter = 0; iter < sequencesLimit; iter++) {
      try {
        // 진행률 (10회마다 로그)
        if ((iter + 1) % 10 === 0 || iter === 0) {
          log(`[Worker ${workerId}] [${iter + 1}/${sequencesLimit}] 전송 중...`);
        }

        // 행동 시뮬레이션
        const dwellTime = randomBetween(500, 1500);
        const scrollDepth = randomBetween(20, 70);
        cumulativeDwell += dwellTime;

        await humanScroll(targetPage, randomBetween(100, 300));
        await sleep(dwellTime);

        // product-logs POST (dwell > 0)
        const result = await multiSend.sendProductLogPost(
          { url: productLog.url, headers: productLog.headers, body: productLog.body },
          { dwellTime: cumulativeDwell, scrollDepth }
        );
        if (result.success) success++;
        else failed++;

        // nlog 픽셀 비콘
        for (const nlog of nlogLogs.slice(0, 2)) {
          await multiSend.sendSinglePixelBeacon(nlog.url);
        }

        // commerce 픽셀 비콘
        for (const commerce of commerceLogs.slice(0, 1)) {
          await multiSend.sendSinglePixelBeacon(commerce.url);
        }

        // 쿨다운
        await sleep(randomBetween(100, 300));

      } catch (e: any) {
        log(`[Worker ${workerId}] 시퀀스 ${iter + 1} 오류: ${e.message}`, "error");
        failed++;
      }
    }

    log(`[Worker ${workerId}] 슬롯 완료: ${success}/${sequencesLimit} 성공`);
    await context.close();

  } catch (e: any) {
    log(`[Worker ${workerId}] 오류: ${e.message}`, "error");
    failed = sequencesLimit - success;
    if (context) {
      await context.close().catch(() => {});
    }
  }

  // DB 업데이트
  await updateSlotStats(slot.id, success, failed);
  await releaseSlot(slot.id);

  // 작업 슬롯 추적 제거
  delete currentProcessingSlots[workerId];

  return { success, failed };
}

// ============ 메인 ============
async function main() {
  const sequencesLimit = IS_TEST_MODE ? TEST_SEQUENCES : SEQUENCES_PER_SLOT;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Slot Naver Runner`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Worker ID: ${WORKER_ID}`);
  console.log(`  Hostname: ${HOSTNAME}`);
  console.log(`  모드: ${IS_TEST_MODE ? `테스트 (${TEST_SEQUENCES}회/슬롯)` : `정상 (${SEQUENCES_PER_SLOT}회/슬롯)`}`);
  console.log(`  병렬 브라우저: ${PARALLEL_BROWSERS}개`);
  console.log(`  프로필 경로: ${PROFILE_BASE_DIR}`);
  console.log(`  Heartbeat: ${controlDb ? "활성화" : "비활성화 (SUPABASE_CONTROL_* 미설정)"}`);
  console.log(`${"=".repeat(60)}\n`);

  // Heartbeat 시작
  startHeartbeat();

  // 일일 리셋
  await checkDailyReset();

  // 테더링 어댑터
  tetheringAdapter = await getTetheringAdapter();
  if (tetheringAdapter) {
    log(`테더링 어댑터: ${tetheringAdapter}`);
    startRecoveryDaemon();
  }

  // 현재 IP
  currentIP = await getCurrentIP().catch(() => "unknown");
  log(`현재 IP: ${currentIP}`);

  // 메인 루프
  while (true) {
    try {
      await checkDailyReset();

      // IP 로테이션
      if (tetheringAdapter && Date.now() - lastIPRotationTime > IP_ROTATION_INTERVAL) {
        log("\nIP 로테이션...");
        const result = await rotateIP(tetheringAdapter);
        if (result.success) {
          log(`IP 변경: ${result.oldIP} → ${result.newIP}`);
          currentIP = result.newIP;
        }
        lastIPRotationTime = Date.now();
      }

      // 4개 슬롯 획득
      const slots = await acquireMultipleSlots(PARALLEL_BROWSERS);

      if (slots.length === 0) {
        log("작업 가능한 슬롯 없음 - 60초 대기...");
        await sleep(60000);
        continue;
      }

      log(`\n${"=".repeat(60)}`);
      log(`${slots.length}개 슬롯 병렬 처리 시작`);
      log(`${"=".repeat(60)}\n`);

      // 4개 브라우저 병렬 실행 (각각 독립된 browser 인스턴스)
      const promises = slots.map((slot, idx) => processSlot(slot, idx));
      const results = await Promise.all(promises);

      // 결과 집계
      const totalSuccess = results.reduce((sum, r) => sum + r.success, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      log(`\n${"=".repeat(60)}`);
      log(`배치 완료: 성공 ${totalSuccess}, 실패 ${totalFailed}`);
      log(`${"=".repeat(60)}\n`);

      await sleep(5000);

    } catch (e: any) {
      log(`메인 루프 오류: ${e.message}`, "error");
      await sleep(10000);
    }
  }
}

process.on("SIGINT", async () => {
  console.log("\n종료 요청됨");
  stopHeartbeat();
  await sleep(1000); // heartbeat 전송 대기
  process.exit(0);
});

main().catch(console.error);
