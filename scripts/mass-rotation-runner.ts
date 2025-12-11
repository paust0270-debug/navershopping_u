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
import { ProductLogBuilder } from "../engines-packet/builders/ProductLogBuilder";
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
      await page.goto("https://www.naver.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(this.randomBetween(1500, 2500));

      // 2. 검색
      this.logger.log(`Searching: ${this.config.product.keyword}`);
      await this.typeSearch(page, this.config.product.keyword);
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 });

      // 차단 확인
      if (await detectBlock(page)) {
        this.logger.warn(`Profile ${profile.id} blocked on search`);
        this.profileManager.blacklistProfile(profile.id);
        this.stats.blockedProfiles++;
        throw new Error("Blocked on search page");
      }

      // 3. 쇼핑 탭 클릭
      await page.waitForTimeout(this.randomBetween(500, 1000));
      const shoppingTab = await page.$('a[href*="shopping"]');
      if (shoppingTab) {
        await shoppingTab.click();
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 });
      }

      // 4. 스크롤하면서 상품 찾기
      this.logger.log(`Finding product: MID ${this.config.product.mid}`);
      const productFound = await this.findAndClickProduct(page, this.config.product.mid);

      if (!productFound) {
        throw new Error(`Product MID ${this.config.product.mid} not found`);
      }

      // 5. 상품 페이지 로드 대기
      await page.waitForTimeout(this.randomBetween(2000, 3000));

      // 차단 확인
      if (await detectBlock(page)) {
        this.logger.warn(`Profile ${profile.id} blocked on product page`);
        this.profileManager.blacklistProfile(profile.id);
        this.stats.blockedProfiles++;
        throw new Error("Blocked on product page");
      }

      // 6. 행동 로그 캡처
      this.logger.log("Capturing behavior logs...");
      const captor = new BehaviorLogCaptor((msg) => this.logger.log(msg));
      captor.attach(page);

      // 약간의 스크롤 및 대기 (로그 발생 유도)
      await this.humanScroll(page, 500);
      await page.waitForTimeout(this.randomBetween(1000, 2000));
      await this.humanScroll(page, 300);
      await page.waitForTimeout(this.randomBetween(1000, 2000));

      // 캡처된 로그 확인
      const capturedLogs = captor.getCapturedLogs();
      this.logger.log(`Captured ${capturedLogs.length} logs`);

      // product-logs 찾기
      const productLog = capturedLogs.find((l) => l.url.includes("product-logs"));

      if (!productLog) {
        this.logger.warn("No product-logs captured - using direct page fetch");
        // 직접 페이지에서 fetch 시도
      }

      // 7. Builder 설정
      const productLogBuilder = new ProductLogBuilder((msg) => this.logger.log(msg));
      if (productLog) {
        productLogBuilder.setTemplateFromCapture(productLog);
      }

      const behaviorLogBuilder = new BehaviorLogBuilder((msg) => this.logger.log(msg));
      const templates = captor.getAllTemplates();
      for (const [type, template] of templates) {
        behaviorLogBuilder.setTemplate(type, template);
      }

      // 8. 다중 전송
      this.logger.log(`Sending ${batch.count} requests...`);
      const multiSend = new MultiSendEngine(behaviorLogBuilder, (msg) => this.logger.log(msg));
      multiSend.setPage(page);

      if (productLogBuilder.hasTemplate()) {
        const result = await multiSend.sendProductLogs(productLogBuilder, batch.count, {
          minDelay: this.config.request.minDelay,
          maxDelay: this.config.request.maxDelay,
          jitterPercent: this.config.request.jitterPercent,
          failFast: false,
        });

        success = result.success;
        failed = result.failed;
        errors.push(...result.errors.slice(0, 5));  // 처음 5개 에러만

        this.logger.log(`Product logs: ${success}/${result.total} success`);
      } else {
        // product-logs 없으면 행동 로그만 전송
        this.logger.warn("No product-logs template, sending behavior logs only");

        const availableTypes = behaviorLogBuilder.getAvailableTypes();
        this.logger.log(`Available behavior types: ${availableTypes.join(", ")}`);

        for (const type of availableTypes) {
          const typeCount = Math.ceil(batch.count / availableTypes.length);
          const result = await multiSend.sendBehaviorLog(
            type,
            typeCount,
            { nvMid: this.config.product.mid, page_uid: `test_${Date.now()}`, timestamp: Date.now() },
            {
              minDelay: this.config.request.minDelay,
              maxDelay: this.config.request.maxDelay,
              jitterPercent: this.config.request.jitterPercent,
            }
          );
          success += result.success;
          failed += result.failed;
        }
      }

      // 9. 체류 시간
      const dwellTime = this.randomBetween(3000, 8000);
      this.logger.log(`Dwell time: ${(dwellTime / 1000).toFixed(1)}s`);
      await page.waitForTimeout(dwellTime);

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
    await page.click('input[name="query"]');
    await page.waitForTimeout(this.randomBetween(200, 400));

    for (const char of keyword) {
      await page.type('input[name="query"]', char, {
        delay: this.randomBetween(50, 150),
      });
    }

    await page.waitForTimeout(this.randomBetween(300, 600));
  }

  /**
   * 상품 찾기 및 클릭
   */
  private async findAndClickProduct(page: Page, mid: string): Promise<boolean> {
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

        // 클릭
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
          this.logger.log("New tab opened");
          await newPage.waitForLoadState("domcontentloaded", { timeout: 10000 });
          // 새 탭으로 전환이 필요하면 여기서 처리
        }

        return true;
      }

      // 스크롤
      await this.humanScroll(page, 800);
      await page.waitForTimeout(this.randomBetween(500, 1000));
    }

    return false;
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
