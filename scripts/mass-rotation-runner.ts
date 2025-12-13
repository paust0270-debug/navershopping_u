/**
 * Mass Rotation Runner - 다중 프로필 대량 실행
 *
 * 사용법:
 *   npx tsx scripts/mass-rotation-runner.ts --count 300
 *   npx tsx scripts/mass-rotation-runner.ts --test
 *   npx tsx scripts/mass-rotation-runner.ts --count 50 --profile 1
 *
 * 옵션:
 *   --count <n>    : 실행할 총 요청 수 (default: 100)
 *   --test         : 테스트 모드 (10회)
 *   --profile <n>  : 특정 프로필만 사용
 *   --headless     : 헤드리스 모드
 *   --dry-run      : 실제 요청 없이 스케줄만 확인
 */

import * as fs from "fs";
import * as path from "path";
import {
  ProfileManager,
  BatchScheduler,
  type SubBatch,
  type BatchResult,
} from "../engines-packet/mass-replay";
import { MultiSendEngine } from "../engines-packet/replay/MultiSendEngine";
import { BehaviorLogBuilder } from "../engines-packet/builders/BehaviorLogBuilder";
import { BehaviorLogCaptor } from "../engines-packet/capture/BehaviorLogCaptor";
import type { Page } from "patchright";

// ============================================================
//  설정
// ============================================================

interface RunnerConfig {
  product: {
    mid: string;
    keyword: string;
    mallName: string;
  };
  profile: {
    dir: string;
    count: number;
    headless: boolean;
    maxDailyRequests: number;
    cooldownMs: number;
  };
  batch: {
    minSize: number;
    maxSize: number;
    delayBetween: [number, number];
  };
  request: {
    minDelay: number;
    maxDelay: number;
    jitterPercent: number;
  };
  logDir: string;
}

const DEFAULT_CONFIG: RunnerConfig = {
  product: {
    mid: "89029512267",
    keyword: "신지모루 Qi2 3in1 맥세이프 무선 충전기",
    mallName: "신지모루",
  },
  profile: {
    dir: "./profiles",
    count: 20,
    headless: false,
    maxDailyRequests: 80,
    cooldownMs: 30000,
  },
  batch: {
    minSize: 40,
    maxSize: 120,
    delayBetween: [5000, 15000],
  },
  request: {
    minDelay: 100,
    maxDelay: 300,
    jitterPercent: 20,
  },
  logDir: "./logs/mass-rotation",
};

// ============================================================
//  CLI 인자 파싱
// ============================================================

interface CliArgs {
  count: number;
  test: boolean;
  profile?: number;
  headless: boolean;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    count: 100,
    test: false,
    profile: undefined,
    headless: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--count":
        result.count = parseInt(args[++i] || "100");
        break;
      case "--test":
        result.test = true;
        result.count = 10;
        break;
      case "--profile":
        result.profile = parseInt(args[++i] || "1");
        break;
      case "--headless":
        result.headless = true;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
    }
  }

  return result;
}

// ============================================================
//  로거
// ============================================================

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: any;
}

class Logger {
  private logs: LogEntry[] = [];
  private startTime: number = Date.now();

  log(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message,
      data,
    };
    this.logs.push(entry);
    console.log(`[${this.elapsed()}] ${message}`, data ? JSON.stringify(data) : "");
  }

  warn(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "warn",
      message,
      data,
    };
    this.logs.push(entry);
    console.warn(`[${this.elapsed()}] ⚠️  ${message}`, data ? JSON.stringify(data) : "");
  }

  error(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      data,
    };
    this.logs.push(entry);
    console.error(`[${this.elapsed()}] ❌ ${message}`, data ? JSON.stringify(data) : "");
  }

  private elapsed(): string {
    const seconds = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }
}

// ============================================================
//  차단 감지
// ============================================================

async function detectBlock(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    return (
      bodyText.includes("비정상적인 접근") ||
      bodyText.includes("보안 확인") ||
      bodyText.includes("자동입력방지") ||
      bodyText.includes("영수증 번호") ||
      document.querySelector(".captcha_wrap") !== null ||
      document.querySelector("#rcpt_form") !== null
    );
  });
}

// ============================================================
//  메인 러너
// ============================================================

class MassRotationRunner {
  private config: RunnerConfig;
  private args: CliArgs;
  private logger: Logger;
  private profileManager: ProfileManager;
  private batchScheduler: BatchScheduler;
  private stats: {
    totalRequests: number;
    successRequests: number;
    failedRequests: number;
    blockedProfiles: number;
    startTime: number;
    endTime?: number;
  };

  constructor(config: RunnerConfig, args: CliArgs) {
    this.config = config;
    this.args = args;
    this.logger = new Logger();

    this.profileManager = new ProfileManager(
      {
        profileDir: config.profile.dir,
        profileCount: config.profile.count,
        headless: args.headless || config.profile.headless,
        maxDailyRequests: config.profile.maxDailyRequests,
        cooldownMs: config.profile.cooldownMs,
      },
      (msg) => this.logger.log(msg)
    );

    this.batchScheduler = new BatchScheduler(
      {
        totalCount: args.count,
        minBatchSize: config.batch.minSize,
        maxBatchSize: config.batch.maxSize,
        delayBetweenBatches: config.batch.delayBetween,
        profileCount: config.profile.count,
      },
      (msg) => this.logger.log(msg)
    );

    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      blockedProfiles: 0,
      startTime: Date.now(),
    };
  }

  /**
   * 실행
   */
  async run(): Promise<void> {
    this.printHeader();

    // 프로필 초기화
    await this.profileManager.initializeProfiles();

    // 배치 생성
    const batches = this.batchScheduler.generateBatches(this.args.count);

    // 스케줄 출력
    this.printSchedule(batches);

    if (this.args.dryRun) {
      this.logger.log("Dry run mode - exiting without execution");
      return;
    }

    // 실행
    await this.executeBatches(batches);

    // 결과 저장
    await this.saveResults();

    // 정리
    await this.profileManager.closeAllProfiles();

    this.printSummary();
  }

  /**
   * 배치 실행
   */
  private async executeBatches(batches: SubBatch[]): Promise<void> {
    this.logger.log(`Starting execution of ${batches.length} batches`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      this.logger.log(`\n${"=".repeat(60)}`);
      this.logger.log(`Batch ${i + 1}/${batches.length}: ${batch.count} requests with profile ${batch.profileId}`);
      this.logger.log(`${"=".repeat(60)}`);

      this.batchScheduler.startBatch(batch.id);

      try {
        const result = await this.executeSingleBatch(batch);
        this.batchScheduler.completeBatch(batch.id, result);

        this.stats.totalRequests += result.total;
        this.stats.successRequests += result.success;
        this.stats.failedRequests += result.failed;
      } catch (error: any) {
        this.logger.error(`Batch ${batch.id} failed: ${error.message}`);
        this.batchScheduler.completeBatch(batch.id, {
          total: batch.count,
          success: 0,
          failed: batch.count,
          duration: 0,
          errors: [error.message],
        });
        this.stats.failedRequests += batch.count;
      }

      // 배치 간 쿨다운 (마지막 배치 제외)
      if (i < batches.length - 1) {
        const delay = this.batchScheduler.getBatchDelay();
        this.logger.log(`Cooldown: ${(delay / 1000).toFixed(1)}s`);
        await this.sleep(delay);
      }

      // 진행 상황 출력
      this.printProgress();
    }
  }

  /**
   * 단일 배치 실행
   */
  private async executeSingleBatch(batch: SubBatch): Promise<BatchResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    // 프로필 시작
    let profile;
    try {
      if (this.args.profile) {
        profile = await this.profileManager.launchProfile(this.args.profile);
      } else {
        profile = await this.profileManager.launchProfile(batch.profileId);
      }
    } catch (error: any) {
      this.logger.error(`Failed to launch profile: ${error.message}`);
      return {
        total: batch.count,
        success: 0,
        failed: batch.count,
        duration: Date.now() - startTime,
        errors: [error.message],
      };
    }

    const page = profile.page!;

    try {
      // 1. 네이버 메인 접속
      this.logger.log("Navigating to Naver...");
      const naverResponse = await page.goto("https://www.naver.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // 응답 상태 확인
      if (naverResponse) {
        const status = naverResponse.status();
        if (status === 418 || status === 429 || status >= 400) {
          this.logger.error(`Naver blocked with status ${status}`);
          this.profileManager.blacklistProfile(profile.id);
          this.stats.blockedProfiles++;
          throw new Error(`Blocked: HTTP ${status}`);
        }
      }
      await page.waitForTimeout(this.randomBetween(1500, 2500));

      // 2. 통합검색에서 검색
      this.logger.log(`Searching: ${this.config.product.keyword}`);
      await this.typeSearch(page, this.config.product.keyword);
      await page.keyboard.press("Enter");

      // 검색 결과 응답 확인
      const searchResponse = await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 });
      if (searchResponse) {
        const status = searchResponse.status();
        if (status === 418 || status === 429 || status >= 400) {
          this.logger.error(`Search blocked with status ${status}`);
          this.profileManager.blacklistProfile(profile.id);
          this.stats.blockedProfiles++;
          throw new Error(`Search blocked: HTTP ${status}`);
        }
      }
      await page.waitForTimeout(this.randomBetween(1000, 2000));

      // 차단 확인 (페이지 내용 기반)
      if (await detectBlock(page)) {
        this.logger.warn(`Profile ${profile.id} blocked on search`);
        this.profileManager.blacklistProfile(profile.id);
        this.stats.blockedProfiles++;
        throw new Error("Blocked on search page");
      }

      // 3. 스크롤 (상품이 보이도록)
      await this.humanScroll(page, 500);
      await page.waitForTimeout(this.randomBetween(500, 1000));

      // 4. 스크롤하면서 상품 찾기 (통합검색 결과에서)
      this.logger.log(`Finding product: MID ${this.config.product.mid}`);
      const targetPage = await this.findAndClickProduct(page, this.config.product.mid);

      if (!targetPage) {
        throw new Error(`Product MID ${this.config.product.mid} not found`);
      }

      const isNewTab = targetPage !== page;
      this.logger.log(`Using ${isNewTab ? "new tab" : "same page"} for capture`);

      // 5. 상품 페이지 로드 대기
      await targetPage.waitForTimeout(this.randomBetween(2000, 3000));

      // 차단 확인
      if (await detectBlock(targetPage)) {
        this.logger.warn(`Profile ${profile.id} blocked on product page`);
        this.profileManager.blacklistProfile(profile.id);
        this.stats.blockedProfiles++;
        throw new Error("Blocked on product page");
      }

      // 6. 행동 로그 캡처 (픽셀 비콘)
      this.logger.log("Capturing behavior logs...");
      const captor = new BehaviorLogCaptor((msg) => this.logger.log(msg));
      captor.attach(targetPage);

      // 페이지 새로고침하여 nlog 요청 재발생 (캐시 문제 해결)
      this.logger.log("Reloading page to capture fresh logs...");
      const reloadResponse = await targetPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });

      // 리로드 응답 상태 확인
      if (reloadResponse) {
        const status = reloadResponse.status();
        this.logger.log(`Product page status: ${status}`);
        if (status === 418 || status === 429) {
          this.logger.error(`Product page blocked with status ${status}`);
          this.profileManager.blacklistProfile(profile.id);
          this.stats.blockedProfiles++;
          throw new Error(`Product page blocked: HTTP ${status}`);
        }
      }
      await targetPage.waitForTimeout(this.randomBetween(2000, 3000));

      // 스크롤해서 로그 트리거
      await this.humanScroll(targetPage, 500);
      await targetPage.waitForTimeout(this.randomBetween(1000, 1500));
      await this.humanScroll(targetPage, 400);
      await targetPage.waitForTimeout(this.randomBetween(1000, 1500));

      // 캡처된 로그 확인
      const capturedLogs = captor.getCapturedLogs();
      this.logger.log(`Captured ${capturedLogs.length} logs`);

      // 캡처된 URL 디버깅
      if (capturedLogs.length > 0) {
        this.logger.log("Captured URLs:");
        capturedLogs.forEach((l, i) => {
          this.logger.log(`  [${i}] ${l.type}: ${l.url.substring(0, 70)}...`);
        });
      }

      // ============================================================
      // 7. 네이버 조회수 시퀀스 (정확한 순서 필수!)
      // ============================================================
      // ① 페이지 로드 완료 후 200~600ms 대기
      // ② product-logs POST (초기: dwell=0, scroll=0)
      // ③ nlog GET pixel beacon
      // ④ commerce GET pixel beacon
      // ⑤ 행동 시뮬레이션 (3~5초 dwell, scroll 20~70%)
      // ⑥ product-logs POST (행동 후: dwell≥3000, scroll≥20)
      // ⑦ 추가 nlog GET pixel beacon
      // ============================================================

      // product-logs 찾기 (smartstore product-logs API)
      const productLog = capturedLogs.find((l) =>
        l.url.includes("product-logs") && l.url.includes("smartstore.naver.com")
      );

      // nlog.naver.com 픽셀 비콘 필터링
      const nlogLogs = capturedLogs.filter(l =>
        l.url.includes("nlog.naver.com") && !l.url.includes("product-logs")
      );

      // nlog.commerce 픽셀 비콘 필터링
      const commerceLogs = capturedLogs.filter(l =>
        l.url.includes("nlog.commerce.naver.com")
      );

      this.logger.log(`Found: product-logs=${productLog ? "✓" : "✗"}, nlog=${nlogLogs.length}, commerce=${commerceLogs.length}`);

      // MultiSendEngine 생성 (픽셀 전송용)
      const nlogBuilder = new BehaviorLogBuilder((msg) => this.logger.log(msg));
      const multiSend = new MultiSendEngine(nlogBuilder, (msg) => this.logger.log(msg));
      multiSend.setPage(targetPage);

      // ============================================================
      // 시퀀스 반복 (batch.count 만큼)
      // ============================================================
      //
      // 서버 관점에서 자연스러운 패턴:
      // [1회만] product-log(dwell=0) → 페이지 최초 로드
      // [반복]  행동 → product-log(dwell>0) → nlog → commerce
      //
      // ✔ 초기 product-log = 1회만
      // ✔ 행동 후 product-log = 반복 OK
      // ✖ 초기 product-logs 반복 = 봇 탐지됨
      // ============================================================

      const totalIterations = batch.count;
      this.logger.log(`Starting ${totalIterations} sequence iterations...`);

      // ★ 초기 product-logs POST는 딱 1회만! (페이지 로드 시점)
      const initialDelay = this.randomBetween(200, 600);
      this.logger.log(`Initial delay: ${initialDelay}ms`);
      await targetPage.waitForTimeout(initialDelay);

      if (productLog) {
        this.logger.log(`Sending product-logs POST (initial - ONCE)...`);
        const initialResult = await multiSend.sendProductLogPost(
          { url: productLog.url, headers: productLog.headers, body: productLog.body },
          { dwellTime: 0, scrollDepth: 0 }
        );
        if (initialResult.success) {
          success++;
        }
      }

      // 누적 체류 시간 (사람처럼 점점 증가)
      let cumulativeDwell = 0;

      for (let iter = 0; iter < totalIterations; iter++) {
        // 진행률 로그 (10회마다 또는 처음/마지막)
        if (iter === 0 || iter === totalIterations - 1 || (iter + 1) % 10 === 0) {
          this.logger.log(`[${iter + 1}/${totalIterations}] Sending behavior sequence...`);
        }

        // ① 행동 시뮬레이션 (500~1500ms dwell, scroll 20~70%)
        const dwellTime = this.randomBetween(500, 1500);
        const scrollDepth = this.randomBetween(20, 70);
        cumulativeDwell += dwellTime;

        // 스크롤 시뮬레이션 (5회마다)
        if (iter % 5 === 0) {
          await this.humanScroll(targetPage, this.randomBetween(100, 300));
        }
        await targetPage.waitForTimeout(dwellTime);

        // ② product-logs POST (행동 후: dwell > 0, scroll > 0)
        if (productLog) {
          const behaviorResult = await multiSend.sendProductLogPost(
            { url: productLog.url, headers: productLog.headers, body: productLog.body },
            { dwellTime: cumulativeDwell, scrollDepth: scrollDepth }
          );
          if (behaviorResult.success) {
            success++;
          }
        }

        // ③ nlog GET pixel beacon
        for (const nlog of nlogLogs.slice(0, 2)) {
          const result = await multiSend.sendSinglePixelBeacon(nlog.url);
          if (result.success) success++;
        }

        // ④ commerce GET pixel beacon
        for (const commerce of commerceLogs.slice(0, 1)) {
          const result = await multiSend.sendSinglePixelBeacon(commerce.url);
          if (result.success) success++;
        }

        // iteration 간 쿨다운 (100~300ms)
        if (iter < totalIterations - 1) {
          await targetPage.waitForTimeout(this.randomBetween(100, 300));
        }
      }

      // 성공/실패 계산
      // 초기 1회 + (행동후 product-log + nlog×2 + commerce×1) × iterations
      const stepsPerIter = (productLog ? 1 : 0) + Math.min(nlogLogs.length, 2) + Math.min(commerceLogs.length, 1);
      const totalExpected = (productLog ? 1 : 0) + stepsPerIter * totalIterations;
      failed = totalExpected - success;
      this.logger.log(`All sequences complete: ${success}/${totalExpected} success (${totalIterations} iterations)`);

      // 추가 체류 시간 (자연스러움)
      const extraDwell = this.randomBetween(1000, 2000);
      await targetPage.waitForTimeout(extraDwell);

      // 새 탭이면 닫기
      if (isNewTab) {
        await targetPage.close().catch(() => {});
      }

    } finally {
      // 프로필 해제
      await this.profileManager.releaseProfile(profile.id);
    }

    return {
      total: batch.count,
      success,
      failed,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * 검색어 입력 (인간처럼)
   */
  private async typeSearch(page: Page, keyword: string): Promise<void> {
    // 검색창이 준비될 때까지 대기
    const searchInput = page.locator('input[name="query"]');
    await searchInput.waitFor({ state: "visible", timeout: 10000 });

    // 혹시 팝업이 있으면 ESC로 닫기
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);

    // 검색창 클릭 (force 옵션으로 오버레이 무시)
    await searchInput.click({ force: true, timeout: 10000 });
    await page.waitForTimeout(this.randomBetween(200, 400));

    // 기존 텍스트 클리어
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(100);

    // 한 글자씩 입력
    for (const char of keyword) {
      await page.type('input[name="query"]', char, {
        delay: this.randomBetween(50, 150),
      });
    }

    await page.waitForTimeout(this.randomBetween(300, 600));
  }

  /**
   * 상품 찾기 및 클릭 - 새 탭이 열리면 해당 Page 반환
   */
  private async findAndClickProduct(page: Page, mid: string): Promise<Page | null> {
    // 최대 3번 스크롤하면서 찾기
    for (let scroll = 0; scroll < 3; scroll++) {
      const found = await page.evaluate((targetMid) => {
        const links = Array.from(document.querySelectorAll("a"));

        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          const href = link.href || "";

          if (href.includes(targetMid)) {
            // 스크롤해서 보이게
            link.scrollIntoView({ behavior: "smooth", block: "center" });
            return { found: true, index: i };
          }
        }

        return { found: false, index: -1 };
      }, mid);

      if (found.found) {
        await page.waitForTimeout(this.randomBetween(500, 1000));

        // 클릭 - 새 탭 대기
        const context = page.context();
        const [newPage] = await Promise.all([
          context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
          page.evaluate((index) => {
            const links = Array.from(document.querySelectorAll("a"));
            if (links[index]) {
              (links[index] as HTMLAnchorElement).click();
            }
          }, found.index),
        ]);

        if (newPage) {
          this.logger.log("New tab opened - switching to product page");
          await newPage.waitForLoadState("domcontentloaded", { timeout: 10000 });
          return newPage as Page;  // 새 탭 반환
        }

        // 새 탭이 없으면 현재 페이지에서 네비게이션 대기
        this.logger.log("Same tab navigation");
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
        return page;  // 현재 페이지 반환
      }

      // 스크롤
      await this.humanScroll(page, 800);
      await page.waitForTimeout(this.randomBetween(500, 1000));
    }

    return null;  // 못 찾으면 null
  }

  /**
   * 인간처럼 스크롤
   */
  private async humanScroll(page: Page, distance: number): Promise<void> {
    let scrolled = 0;
    while (scrolled < distance) {
      const step = this.randomBetween(50, 150);
      await page.mouse.wheel(0, step);
      scrolled += step;
      await page.waitForTimeout(this.randomBetween(30, 80));
    }
  }

  /**
   * 헤더 출력
   */
  private printHeader(): void {
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║           MASS ROTATION RUNNER                                 ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    console.log(`\nProduct: ${this.config.product.keyword}`);
    console.log(`MID: ${this.config.product.mid}`);
    console.log(`Total requests: ${this.args.count}`);
    console.log(`Profiles: ${this.config.profile.count}`);
    console.log(`Headless: ${this.args.headless}`);
    console.log(`Test mode: ${this.args.test}`);
    console.log("");
  }

  /**
   * 스케줄 출력
   */
  private printSchedule(batches: SubBatch[]): void {
    console.log("\n─── Schedule ───");
    console.log(`Batches: ${batches.length}`);
    console.log(`Sizes: [${batches.map((b) => b.count).join(", ")}]`);
    console.log(`Profiles: [${batches.map((b) => b.profileId).join(", ")}]`);

    const summary = this.batchScheduler.getSummary();
    console.log(`Estimated duration: ${Math.ceil(summary.estimatedDuration / 60000)} minutes`);
    console.log("");
  }

  /**
   * 진행 상황 출력
   */
  private printProgress(): void {
    const progress = this.batchScheduler.getProgress();
    const elapsed = Math.floor((Date.now() - this.stats.startTime) / 1000);

    console.log(`\n─── Progress: ${progress.completed}/${progress.total} batches (${progress.successRate.toFixed(1)}% success) ───`);
    console.log(`Requests: ${this.stats.successRequests}/${this.stats.totalRequests} success, ${this.stats.failedRequests} failed`);
    console.log(`Blocked profiles: ${this.stats.blockedProfiles}`);
    console.log(`Elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  }

  /**
   * 요약 출력
   */
  private printSummary(): void {
    this.stats.endTime = Date.now();
    const duration = (this.stats.endTime - this.stats.startTime) / 1000;

    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║                      SUMMARY                                   ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    console.log(`\nTotal requests: ${this.stats.totalRequests}`);
    console.log(`Success: ${this.stats.successRequests} (${((this.stats.successRequests / this.stats.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${this.stats.failedRequests}`);
    console.log(`Blocked profiles: ${this.stats.blockedProfiles}`);
    console.log(`Duration: ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`);
    console.log(`Rate: ${(this.stats.successRequests / duration * 60).toFixed(1)} req/min`);

    // 프로필 통계
    console.log("\n─── Profile Stats ───");
    const profileStats = this.profileManager.getProfileStats();
    for (const stat of profileStats.slice(0, 10)) {  // 상위 10개만
      console.log(`  Profile ${stat.profileId}: ${stat.dailyRequests}/${this.config.profile.maxDailyRequests} daily, ${stat.blocked ? "BLOCKED" : "OK"}`);
    }
  }

  /**
   * 결과 저장
   */
  private async saveResults(): Promise<void> {
    // 로그 디렉토리 생성
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = path.join(this.config.logDir, `run-${timestamp}.json`);

    const result = {
      config: this.config,
      args: this.args,
      stats: this.stats,
      batches: this.batchScheduler.getAllBatches(),
      profileStats: this.profileManager.getProfileStats(),
      logs: this.logger.getLogs(),
    };

    fs.writeFileSync(logFile, JSON.stringify(result, null, 2));
    this.logger.log(`Results saved to: ${logFile}`);
  }

  /**
   * 유틸리티
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
//  메인 실행
// ============================================================

async function main() {
  const args = parseArgs();

  console.log("Args:", args);

  const runner = new MassRotationRunner(DEFAULT_CONFIG, args);

  try {
    await runner.run();
  } catch (error: any) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
