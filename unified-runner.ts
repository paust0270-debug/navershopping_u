/**
 * Unified Runner - PRB 엔진 + IP 로테이션 + 배치 실행
 *
 * 실행: npx tsx unified-runner.ts
 *
 * 워크플로우:
 * 1. 테더링 어댑터 감지 + 현재 IP 확인
 * 2. 5개 브라우저 동시 실행 (각각 작업 1개씩)
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

import { connect } from "puppeteer-real-browser";
import type { Page, Browser } from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import { runV7Engine } from "./engines/v7_engine";
import { rotateIP, getCurrentIP, getTetheringAdapter } from "./ipRotation";

// ============ 설정 ============
const PARALLEL_BROWSERS = 4;    // 동시 실행 브라우저 수
const BATCH_REST = 5 * 1000;    // 배치 간 휴식 (5초)
const EMPTY_WAIT = 10 * 1000;   // 작업 없을 때 대기 (10초)
const IP_ROTATION_ENABLED = true; // IP 로테이션 활성화

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

// ============ 단일 워커 실행 (브라우저 생성 → 작업 실행 → 종료) ============
async function runSingleWorker(workerId: number, profile: Profile): Promise<WorkerResult> {
  let browser: Browser | null = null;
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

    // 2. 브라우저 시작 (12/5 버전 - 단순 옵션)
    const response = await connect({
      headless: false,
      turnstile: true,
    });

    browser = response.browser as Browser;
    page = response.page as Page;
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // 3. Context 생성
    const ctx: RunContext = {
      log: (event: string) => log(`[Worker ${workerId}] ${event}`),
      profile,
      login: false
    };

    // 4. Product 객체
    const product = {
      id: work.slotId,
      keyword: work.keyword,
      product_name: work.productName,
      mid: work.mid
    };

    // 5. V7 엔진 실행
    const engineResult = await runV7Engine(page, browser, product, ctx);

    // 6. 결과 처리
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

  // 5개 워커 순차 시작 (1~3초 간격으로 봇 감지 회피)
  const workerPromises: Promise<WorkerResult>[] = [];
  for (let i = 1; i <= PARALLEL_BROWSERS; i++) {
    workerPromises.push(runSingleWorker(i, profile));
    // 마지막 워커가 아니면 1~3초 랜덤 대기 후 다음 워커 시작
    if (i < PARALLEL_BROWSERS) {
      await sleep(1000 + Math.random() * 2000);
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
  console.log(`  Unified Runner (PRB + IP Rotation + Batch)`);
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

      // IP 로테이션
      if (IP_ROTATION_ENABLED && tetheringAdapter) {
        log("\nIP 로테이션 시작...");
        const rotationResult = await rotateIP(tetheringAdapter);

        if (rotationResult.success && rotationResult.oldIP !== rotationResult.newIP) {
          log(`IP 변경 성공: ${rotationResult.oldIP} → ${rotationResult.newIP}`);
          currentIP = rotationResult.newIP;
        } else if (rotationResult.oldIP === rotationResult.newIP) {
          log(`IP 변경 안됨! (동일 IP: ${rotationResult.oldIP})`, "warn");
        } else {
          log(`IP 로테이션 실패: ${rotationResult.error}`, "warn");
        }
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
