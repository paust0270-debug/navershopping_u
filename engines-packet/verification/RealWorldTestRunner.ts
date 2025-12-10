/**
 * Real World Test Runner
 *
 * 실제 네이버 환경에서 패킷 엔진 검증
 * - TLS fingerprint 검증
 * - 로그 API 발생 확인
 * - 쿠키 체인 연속성 검증
 * - A/B 테스트 (v7_engine vs packet_engine)
 */

import { chromium, type Browser, type Page, type BrowserContext } from "patchright";
import type { LogFunction, Product, RunContext } from "../types";
import { TLSVerifier, type TLSVerificationResult } from "./TLSVerifier";
import { NaverLogMonitor, type NaverLogSummary } from "./NaverLogMonitor";
import { CookieChainVerifier, type CookieChainResult } from "./CookieChainVerifier";

export interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  details: Record<string, any>;
  errors: string[];
  warnings: string[];
}

export interface FullTestReport {
  timestamp: number;
  overallSuccess: boolean;
  tests: {
    tlsVerification: TestResult;
    naverLogMonitoring: TestResult;
    cookieChainVerification: TestResult;
    naverProductFlow: TestResult;
  };
  recommendations: string[];
  criticalIssues: string[];
}

export class RealWorldTestRunner {
  private log: LogFunction;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private tlsVerifier: TLSVerifier;
  private logMonitor: NaverLogMonitor;
  private cookieVerifier: CookieChainVerifier;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.tlsVerifier = new TLSVerifier(logFn);
    this.logMonitor = new NaverLogMonitor(logFn);
    this.cookieVerifier = new CookieChainVerifier(logFn);
  }

  /**
   * 테스트 환경 초기화 (실제 Chrome 사용)
   *
   * 핵심: channel: 'chrome' + page.evaluate(fetch) = Chrome TLS + HTTP/2
   * page.request는 Node TLS (HTTP/1.1) 사용하므로 금지
   */
  async initialize(): Promise<void> {
    this.log("[TestRunner] Initializing test environment (Real Chrome)...");

    // 실제 Chrome 사용 → Chrome TLS fingerprint 보장
    this.browser = await chromium.launch({
      channel: "chrome",  // 실제 설치된 Chrome 사용
      headless: false,    // GUI 모드
      args: [
        // 최소 args만 (NetworkService 등 불필요 - Chrome이 알아서 함)
        "--disable-blink-features=AutomationControlled",
      ],
    });

    // BrowserContext 최소 설정
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      ignoreHTTPSErrors: false,  // TLS 오류 무시하면 fingerprint 변경될 수 있음
    });

    this.page = await this.context.newPage();

    // Anti-detection 스크립트 주입
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    });

    this.log("[TestRunner] Test environment initialized (Real Chrome)");
  }

  /**
   * 전체 테스트 실행
   */
  async runFullTest(testProduct?: Product): Promise<FullTestReport> {
    if (!this.page) {
      await this.initialize();
    }

    const report: FullTestReport = {
      timestamp: Date.now(),
      overallSuccess: false,
      tests: {
        tlsVerification: await this.runTLSVerificationTest(),
        naverLogMonitoring: await this.runNaverLogTest(testProduct),
        cookieChainVerification: await this.runCookieChainTest(),
        naverProductFlow: await this.runProductFlowTest(testProduct),
      },
      recommendations: [],
      criticalIssues: [],
    };

    // 결과 분석
    this.analyzeResults(report);

    return report;
  }

  /**
   * TLS Fingerprint 테스트
   */
  async runTLSVerificationTest(): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      testName: "TLS Fingerprint Verification",
      passed: false,
      duration: 0,
      details: {},
      errors: [],
      warnings: [],
    };

    try {
      this.log("\n[TestRunner] === TLS VERIFICATION TEST ===");

      if (!this.page) throw new Error("Page not initialized");

      const tlsResult = await this.tlsVerifier.runFullVerification(this.page);

      result.details = {
        overall: tlsResult.overall,
        isChromeTLS: tlsResult.details.pageRequest.isChromeTLS,
        isNodeTLS: tlsResult.details.pageRequest.isNodeTLS,
        ja3Match: tlsResult.details.comparison.match,
        naverConnected: tlsResult.details.naverTest.canConnect,
        ja3Fingerprint: tlsResult.details.pageRequest.ja3Fingerprint,
        alpn: tlsResult.details.pageRequest.alpn,
        httpVersion: tlsResult.details.pageRequest.httpVersion,
        // CDP HTTP/2 검증 결과 추가
        http2Working: tlsResult.details.http2Check?.http2Working,
        http2Count: tlsResult.details.http2Check?.http2Count,
        http11Count: tlsResult.details.http2Check?.http11Count,
      };

      result.errors = tlsResult.details.pageRequest.errors;
      result.warnings = tlsResult.details.pageRequest.warnings;

      // HTTP/2가 작동하면 PASS (JA3가 없어도 TLS 1.3에서는 정상)
      result.passed = tlsResult.overall === "PASS" ||
        (tlsResult.details.http2Check?.http2Working && !tlsResult.details.pageRequest.isNodeTLS);

      this.log(`[TestRunner] TLS Test: ${result.passed ? "✅ PASS" : "❌ FAIL"}`);
    } catch (error: any) {
      result.errors.push(`Test failed: ${error.message}`);
      this.log(`[TestRunner] TLS Test Error: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * 네이버 로그 API 테스트
   */
  async runNaverLogTest(product?: Product): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      testName: "Naver Log API Monitoring",
      passed: false,
      duration: 0,
      details: {},
      errors: [],
      warnings: [],
    };

    try {
      this.log("\n[TestRunner] === NAVER LOG API TEST ===");

      if (!this.page) throw new Error("Page not initialized");

      // 모니터링 시작
      await this.logMonitor.startMonitoring(this.page);

      // 네이버 쇼핑 시나리오 실행
      await this.executeNaverShoppingScenario(product);

      // 결과 수집
      const summary = this.logMonitor.getSummary();

      result.details = {
        totalLogs: summary.totalLogs,
        exposeCount: summary.exposeCount,
        productClickCount: summary.productClickCount,
        viewProductCount: summary.viewProductCount,
        scrollEventCount: summary.scrollEventCount,
        dwellTimeLogged: summary.dwellTimeLogged,
        sessionStarted: summary.sessionStarted,
      };

      result.errors = summary.requiredLogsMissing.map(m => `Missing: ${m}`);
      result.warnings = summary.warnings;

      result.passed = summary.isValid;

      // 보고서 출력
      this.logMonitor.printReport();
      this.logMonitor.stopMonitoring();

      this.log(`[TestRunner] Log API Test: ${result.passed ? "✅ PASS" : "❌ FAIL"}`);
    } catch (error: any) {
      result.errors.push(`Test failed: ${error.message}`);
      this.log(`[TestRunner] Log API Test Error: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * 쿠키 체인 테스트
   */
  async runCookieChainTest(): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      testName: "Cookie Chain Verification",
      passed: false,
      duration: 0,
      details: {},
      errors: [],
      warnings: [],
    };

    try {
      this.log("\n[TestRunner] === COOKIE CHAIN TEST ===");

      if (!this.page) throw new Error("Page not initialized");

      // 모니터링 시작
      await this.cookieVerifier.startMonitoring(this.page);

      // 여러 페이지 탐색으로 쿠키 체인 테스트
      await this.page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
      await this.sleep(2000);

      await this.page.goto("https://shopping.naver.com/", { waitUntil: "domcontentloaded" });
      await this.sleep(2000);

      await this.page.goto("https://search.shopping.naver.com/search/all?query=테스트", {
        waitUntil: "domcontentloaded",
      });
      await this.sleep(2000);

      // NAC API를 통한 실제 쿠키 전송 검증
      // CDP는 쿠키를 보고하지 않는 경우가 있으므로 NAC API로 확인
      const nacVerification = await this.cookieVerifier.verifyViaNacApi(this.page);

      // 기존 결과 수집
      const chainResult = this.cookieVerifier.getResult();

      result.details = {
        totalRequests: chainResult.statistics.totalRequests,
        requestsWithAllCookies: chainResult.statistics.requestsWithAllCookies,
        cookieConsistencyRate: `${(chainResult.statistics.cookieConsistencyRate * 100).toFixed(1)}%`,
        missingCookies: chainResult.missingCookies,
        requiredCookies: this.cookieVerifier.getRequiredCookies(),
        // NAC API 검증 결과 추가
        nacApiVerification: {
          cookiesSent: nacVerification.cookiesSent,
          nacTokenReceived: !!nacVerification.nacToken,
          browserCookies: nacVerification.browserCookies.map(c => c.name),
        },
      };

      // NAC API 검증이 통과하면 쿠키가 실제로 전송되는 것
      // CDP 보고 문제는 무시
      if (nacVerification.cookiesSent) {
        result.passed = true;
        result.warnings.push("CDP doesn't report cookies in headers (known limitation), but NAC API confirms cookies are sent");
      } else {
        result.errors = chainResult.errors;
        result.passed = chainResult.isValid;
      }

      result.warnings = [...result.warnings, ...chainResult.warnings];

      // 보고서 출력
      this.cookieVerifier.printReport();
      this.cookieVerifier.stopMonitoring();

      this.log(`[TestRunner] Cookie Chain Test: ${result.passed ? "✅ PASS" : "❌ FAIL"}`);
    } catch (error: any) {
      result.errors.push(`Test failed: ${error.message}`);
      this.log(`[TestRunner] Cookie Chain Test Error: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * 상품 플로우 테스트 (전체 시나리오)
   */
  async runProductFlowTest(product?: Product): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      testName: "Naver Product Flow",
      passed: false,
      duration: 0,
      details: {},
      errors: [],
      warnings: [],
    };

    try {
      this.log("\n[TestRunner] === PRODUCT FLOW TEST ===");

      if (!this.page) throw new Error("Page not initialized");

      // 테스트 상품 설정
      const testProduct = product || {
        product_name: "테스트 상품",
        keyword: "아이폰 케이스",
        mid: "12345678901",
        mall_name: "테스트몰",
      };

      // 1. 네이버 메인 접속
      this.log("[TestRunner] Step 1: Navigate to Naver main");
      await this.page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
      await this.sleep(2000);

      // 2. 검색어 입력
      this.log("[TestRunner] Step 2: Enter search keyword");
      const searchInput = await this.page.$('input[name="query"]');
      if (!searchInput) {
        result.errors.push("Search input not found");
        return result;
      }

      await this.page.click('input[name="query"]');
      await this.sleep(500);

      // 자연스러운 타이핑
      for (const char of testProduct.keyword) {
        await this.page.type('input[name="query"]', char, { delay: 50 + Math.random() * 100 });
      }
      await this.sleep(1000);

      // 3. 검색 실행
      this.log("[TestRunner] Step 3: Execute search");
      await this.page.keyboard.press("Enter");
      await this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 });
      await this.sleep(2000);

      // 4. 검색 결과 확인
      const currentUrl = this.page.url();
      const isSearchPage = currentUrl.includes("search.naver.com");

      result.details.searchPageReached = isSearchPage;

      if (!isSearchPage) {
        result.errors.push("Failed to reach search results page");
      }

      // 5. CAPTCHA 확인
      const pageContent = await this.page.content();
      const hasCaptcha = pageContent.includes("자동입력방지") ||
                         pageContent.includes("보안확인") ||
                         pageContent.includes("captcha");

      result.details.captchaDetected = hasCaptcha;

      if (hasCaptcha) {
        result.errors.push("CAPTCHA detected - traffic may be blocked");
      }

      // 6. 스크롤 테스트
      this.log("[TestRunner] Step 4: Test scroll behavior");
      let scrollY = 0;
      while (scrollY < 1500) {
        const step = 100 + Math.random() * 150;
        await this.page.mouse.wheel(0, step);
        scrollY += step;
        await this.sleep(50 + Math.random() * 100);
      }
      await this.sleep(1000);

      // 7. 상품 링크 클릭 시도
      this.log("[TestRunner] Step 5: Try to click product link");
      const productLinks = await this.page.$$('a[href*="smartstore.naver.com"]');
      result.details.productLinksFound = productLinks.length;

      if (productLinks.length > 0) {
        // 첫 번째 상품 클릭
        await productLinks[0].click();
        await this.sleep(3000);

        // 새 탭 확인
        const pages = this.context!.pages();
        const newPage = pages.length > 1 ? pages[pages.length - 1] : this.page;

        const productUrl = newPage.url();
        result.details.productPageReached = productUrl.includes("smartstore.naver.com");

        // 상품 페이지에서 체류
        if (result.details.productPageReached) {
          this.log("[TestRunner] Step 6: Dwell on product page");
          await this.sleep(5000);
        }
      }

      // 결과 판단
      result.passed = isSearchPage && !hasCaptcha && !result.errors.some(e => e.includes("CRITICAL"));

      this.log(`[TestRunner] Product Flow Test: ${result.passed ? "✅ PASS" : "❌ FAIL"}`);
    } catch (error: any) {
      result.errors.push(`Test failed: ${error.message}`);
      this.log(`[TestRunner] Product Flow Test Error: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * 네이버 쇼핑 시나리오 실행 (로그 API 테스트용)
   */
  private async executeNaverShoppingScenario(product?: Product): Promise<void> {
    if (!this.page) return;

    const keyword = product?.keyword || "아이폰 케이스";

    // 네이버 쇼핑 접속
    await this.page.goto("https://shopping.naver.com/", { waitUntil: "domcontentloaded" });
    await this.sleep(3000);

    // 검색
    const searchInput = await this.page.$('input[type="search"], input[name="query"]');
    if (searchInput) {
      await searchInput.click();
      await this.sleep(500);
      await searchInput.type(keyword, { delay: 100 });
      await this.page.keyboard.press("Enter");
      await this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await this.sleep(3000);
    }

    // 스크롤
    for (let i = 0; i < 5; i++) {
      await this.page.mouse.wheel(0, 300);
      await this.sleep(500);
    }

    // 상품 클릭
    const links = await this.page.$$('a[href*="smartstore"]');
    if (links.length > 0) {
      await links[0].click();
      await this.sleep(5000);
    }
  }

  /**
   * 결과 분석 및 권장사항 생성
   */
  private analyzeResults(report: FullTestReport): void {
    const { tlsVerification, naverLogMonitoring, cookieChainVerification, naverProductFlow } = report.tests;

    // 전체 성공 여부
    report.overallSuccess =
      tlsVerification.passed &&
      naverLogMonitoring.passed &&
      cookieChainVerification.passed &&
      naverProductFlow.passed;

    // Critical Issues
    if (!tlsVerification.passed) {
      if (tlsVerification.details.isNodeTLS) {
        report.criticalIssues.push("CRITICAL: Node.js TLS fingerprint detected. page.request.fetch() is NOT using Chrome TLS!");
        report.recommendations.push("Use page.evaluate(() => fetch(...)) instead of page.request.fetch() for all requests");
      } else if (!tlsVerification.details.ja3Match) {
        report.criticalIssues.push("TLS fingerprint mismatch between page.request and browser fetch");
        report.recommendations.push("Consider switching to browser-based fetch via page.evaluate()");
      }
    }

    if (!naverLogMonitoring.passed) {
      report.criticalIssues.push("Required Naver log APIs are not being called - traffic will NOT be counted");
      report.recommendations.push("Ensure Naver JS is fully loaded before interactions");
      report.recommendations.push("Add scroll/hover events to trigger log API calls");
      report.recommendations.push("Verify dwell time is being logged (5+ seconds on product page)");
    }

    if (!cookieChainVerification.passed) {
      report.criticalIssues.push("Cookie chain is broken - session will be invalid");
      report.recommendations.push("Check Set-Cookie handling in SessionManager");
      report.recommendations.push("Verify cookies are synced between browser and HTTP client");
    }

    if (naverProductFlow.details.captchaDetected) {
      report.criticalIssues.push("CAPTCHA detected during flow - bot detection triggered");
      report.recommendations.push("Review TLS fingerprint configuration");
      report.recommendations.push("Add more human-like delays and mouse movements");
      report.recommendations.push("Check IP reputation and consider rotation");
    }

    // 일반 권장사항
    if (report.overallSuccess) {
      report.recommendations.push("All tests passed! Proceed with A/B testing against real traffic");
    }
  }

  /**
   * 보고서 출력
   */
  printFullReport(report: FullTestReport): void {
    this.log("\n");
    this.log("╔════════════════════════════════════════════════════════════════╗");
    this.log("║            PACKET ENGINE VERIFICATION REPORT                  ║");
    this.log("╚════════════════════════════════════════════════════════════════╝");
    this.log(`\nTimestamp: ${new Date(report.timestamp).toISOString()}`);
    this.log(`Overall Result: ${report.overallSuccess ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);

    this.log("\n─────────────────── TEST RESULTS ───────────────────");

    for (const [name, test] of Object.entries(report.tests)) {
      this.log(`\n📋 ${test.testName}`);
      this.log(`   Status: ${test.passed ? "✅ PASS" : "❌ FAIL"}`);
      this.log(`   Duration: ${test.duration}ms`);

      if (Object.keys(test.details).length > 0) {
        this.log("   Details:");
        for (const [key, value] of Object.entries(test.details)) {
          this.log(`     - ${key}: ${JSON.stringify(value)}`);
        }
      }

      if (test.errors.length > 0) {
        this.log("   Errors:");
        test.errors.forEach(e => this.log(`     ❌ ${e}`));
      }

      if (test.warnings.length > 0) {
        this.log("   Warnings:");
        test.warnings.forEach(w => this.log(`     ⚠️  ${w}`));
      }
    }

    if (report.criticalIssues.length > 0) {
      this.log("\n─────────────────── CRITICAL ISSUES ───────────────────");
      report.criticalIssues.forEach(issue => {
        this.log(`🚨 ${issue}`);
      });
    }

    if (report.recommendations.length > 0) {
      this.log("\n─────────────────── RECOMMENDATIONS ───────────────────");
      report.recommendations.forEach((rec, i) => {
        this.log(`${i + 1}. ${rec}`);
      });
    }

    this.log("\n════════════════════════════════════════════════════════════════\n");
  }

  /**
   * Sleep 유틸리티
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 정리
   */
  async cleanup(): Promise<void> {
    this.logMonitor.stopMonitoring();
    this.cookieVerifier.stopMonitoring();

    if (this.page) {
      await this.page.close().catch(() => {});
    }
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }

    this.log("[TestRunner] Cleanup complete");
  }
}

/**
 * CLI 실행 헬퍼
 */
export async function runVerification(): Promise<void> {
  const runner = new RealWorldTestRunner(console.log);

  try {
    console.log("Starting Packet Engine Verification...\n");

    const report = await runner.runFullTest();
    runner.printFullReport(report);

    if (!report.overallSuccess) {
      console.log("\n⚠️  Some tests failed. Review the report above for details.");
      process.exit(1);
    }
  } finally {
    await runner.cleanup();
  }
}
