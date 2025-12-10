/**
 * Naver Log API Monitor
 *
 * 네이버 트래픽 반영에 필수적인 로그 API 호출 모니터링
 * - /log/expose (노출 로그)
 * - /log/productClick (클릭 로그)
 * - /log/viewProduct (상품 조회 로그)
 * - /log/scrollEvent (스크롤 이벤트)
 * - dwell time 관련 로그
 */

import type { Page, Request, Response } from "patchright";
import type { LogFunction } from "../types";

export interface NaverLogEvent {
  timestamp: number;
  type: string;
  url: string;
  method: string;
  status?: number;
  payload?: any;
  responseTime?: number;
}

export interface NaverLogSummary {
  totalLogs: number;
  exposeCount: number;
  productClickCount: number;
  viewProductCount: number;
  scrollEventCount: number;
  dwellTimeLogged: boolean;
  sessionStarted: boolean;
  requiredLogsMissing: string[];
  warnings: string[];
  isValid: boolean;
}

// 필수 로그 API 패턴
const REQUIRED_LOG_PATTERNS = {
  expose: /\/log\/expose|expose\.nhn|logsink.*expose/i,
  productClick: /\/log\/productClick|click\.nhn|logsink.*click/i,
  viewProduct: /\/log\/viewProduct|view\.nhn|logsink.*view|logsink.*product/i,
  scrollEvent: /\/log\/scrollEvent|scroll\.nhn|logsink.*scroll/i,
  dwellTime: /\/log\/dwell|stay\.nhn|logsink.*dwell|logsink.*stay/i,
  session: /\/log\/session|session\.nhn|logsink.*session/i,
};

// 네이버 로그 API 도메인
const NAVER_LOG_DOMAINS = [
  "cr-web-api.shopping.naver.com",
  "siape.naver.com",
  "wcs.naver.com",
  "lcs.naver.com",
  "cc.naver.com",
  "ntm.naver.com",
  "logsink.shopping.naver.com",
];

export class NaverLogMonitor {
  private log: LogFunction;
  private events: NaverLogEvent[] = [];
  private isMonitoring: boolean = false;
  private page: Page | null = null;
  private requestHandler: ((request: Request) => void) | null = null;
  private responseHandler: ((response: Response) => void) | null = null;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 모니터링 시작
   */
  async startMonitoring(page: Page): Promise<void> {
    if (this.isMonitoring) {
      this.log("[NaverLogMonitor] Already monitoring");
      return;
    }

    this.page = page;
    this.events = [];
    this.isMonitoring = true;

    this.log("[NaverLogMonitor] Starting log monitoring...");

    // Request 인터셉터
    this.requestHandler = (request: Request) => {
      const url = request.url();

      if (this.isNaverLogRequest(url)) {
        const event: NaverLogEvent = {
          timestamp: Date.now(),
          type: this.classifyLogType(url),
          url: url,
          method: request.method(),
        };

        // POST body 추출 시도
        try {
          const postData = request.postData();
          if (postData) {
            try {
              event.payload = JSON.parse(postData);
            } catch {
              event.payload = postData;
            }
          }
        } catch {
          // ignore
        }

        this.events.push(event);
        this.log(`[NaverLogMonitor] Captured: ${event.type} - ${url.substring(0, 80)}...`);
      }
    };

    // Response 인터셉터
    this.responseHandler = (response: Response) => {
      const url = response.url();

      if (this.isNaverLogRequest(url)) {
        // 해당 요청의 이벤트 찾아서 업데이트
        const event = this.events.find(e => e.url === url && !e.status);
        if (event) {
          event.status = response.status();
          event.responseTime = Date.now() - event.timestamp;
        }
      }
    };

    page.on("request", this.requestHandler);
    page.on("response", this.responseHandler);

    this.log("[NaverLogMonitor] Monitoring active");
  }

  /**
   * 모니터링 중지
   */
  stopMonitoring(): void {
    if (!this.isMonitoring || !this.page) return;

    if (this.requestHandler) {
      this.page.off("request", this.requestHandler);
    }
    if (this.responseHandler) {
      this.page.off("response", this.responseHandler);
    }

    this.isMonitoring = false;
    this.log("[NaverLogMonitor] Monitoring stopped");
  }

  /**
   * 네이버 로그 요청인지 확인
   */
  private isNaverLogRequest(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // 네이버 로그 도메인 확인
      if (NAVER_LOG_DOMAINS.some(domain => hostname.includes(domain))) {
        return true;
      }

      // 로그 관련 경로 확인
      const path = urlObj.pathname;
      if (path.includes("/log/") || path.includes("logsink") || path.includes(".nhn")) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 로그 타입 분류
   */
  private classifyLogType(url: string): string {
    for (const [type, pattern] of Object.entries(REQUIRED_LOG_PATTERNS)) {
      if (pattern.test(url)) {
        return type;
      }
    }

    // 일반적인 패턴으로 추가 분류
    if (url.includes("click")) return "click";
    if (url.includes("view")) return "view";
    if (url.includes("scroll")) return "scroll";
    if (url.includes("expose")) return "expose";
    if (url.includes("impression")) return "impression";

    return "unknown";
  }

  /**
   * 현재까지 캡처된 이벤트 가져오기
   */
  getEvents(): NaverLogEvent[] {
    return [...this.events];
  }

  /**
   * 로그 요약 생성
   */
  getSummary(): NaverLogSummary {
    const summary: NaverLogSummary = {
      totalLogs: this.events.length,
      exposeCount: 0,
      productClickCount: 0,
      viewProductCount: 0,
      scrollEventCount: 0,
      dwellTimeLogged: false,
      sessionStarted: false,
      requiredLogsMissing: [],
      warnings: [],
      isValid: false,
    };

    for (const event of this.events) {
      switch (event.type) {
        case "expose":
        case "impression":
          summary.exposeCount++;
          break;
        case "productClick":
        case "click":
          summary.productClickCount++;
          break;
        case "viewProduct":
        case "view":
          summary.viewProductCount++;
          break;
        case "scrollEvent":
        case "scroll":
          summary.scrollEventCount++;
          break;
        case "dwellTime":
          summary.dwellTimeLogged = true;
          break;
        case "session":
          summary.sessionStarted = true;
          break;
      }
    }

    // 필수 로그 누락 확인
    if (summary.exposeCount === 0) {
      summary.requiredLogsMissing.push("expose (노출 로그)");
    }
    if (summary.productClickCount === 0) {
      summary.requiredLogsMissing.push("productClick (클릭 로그)");
    }
    if (summary.viewProductCount === 0) {
      summary.requiredLogsMissing.push("viewProduct (상품 조회 로그)");
    }

    // 경고 생성
    if (summary.scrollEventCount === 0) {
      summary.warnings.push("No scroll events detected - traffic may not count as real user");
    }
    if (!summary.dwellTimeLogged) {
      summary.warnings.push("No dwell time log detected - may affect traffic attribution");
    }

    // 유효성 판단
    // 최소한 expose + productClick + viewProduct 있어야 함
    summary.isValid =
      summary.exposeCount > 0 &&
      summary.productClickCount > 0 &&
      summary.viewProductCount > 0;

    return summary;
  }

  /**
   * 로그 보고서 출력
   */
  printReport(): void {
    const summary = this.getSummary();

    this.log("\n========== NAVER LOG API REPORT ==========");
    this.log(`Total Log Requests: ${summary.totalLogs}`);
    this.log(`├─ Expose/Impression: ${summary.exposeCount}`);
    this.log(`├─ Product Click: ${summary.productClickCount}`);
    this.log(`├─ View Product: ${summary.viewProductCount}`);
    this.log(`├─ Scroll Events: ${summary.scrollEventCount}`);
    this.log(`├─ Dwell Time: ${summary.dwellTimeLogged ? "YES" : "NO"}`);
    this.log(`└─ Session Start: ${summary.sessionStarted ? "YES" : "NO"}`);

    if (summary.requiredLogsMissing.length > 0) {
      this.log("\n⚠️  MISSING REQUIRED LOGS:");
      summary.requiredLogsMissing.forEach(log => {
        this.log(`   - ${log}`);
      });
    }

    if (summary.warnings.length > 0) {
      this.log("\n⚠️  WARNINGS:");
      summary.warnings.forEach(warning => {
        this.log(`   - ${warning}`);
      });
    }

    this.log(`\n📊 TRAFFIC VALIDITY: ${summary.isValid ? "✅ VALID" : "❌ INVALID"}`);
    this.log("==========================================\n");
  }

  /**
   * 특정 타입의 로그 이벤트 필터링
   */
  getEventsByType(type: string): NaverLogEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * 마지막 N개의 이벤트 가져오기
   */
  getRecentEvents(count: number = 10): NaverLogEvent[] {
    return this.events.slice(-count);
  }

  /**
   * 이벤트 초기화
   */
  clearEvents(): void {
    this.events = [];
    this.log("[NaverLogMonitor] Events cleared");
  }

  /**
   * 실시간 이벤트 스트림 (콜백)
   */
  onEvent(callback: (event: NaverLogEvent) => void): void {
    // 기존 이벤트 핸들러 래핑
    if (this.page && this.isMonitoring) {
      const originalHandler = this.requestHandler;
      this.requestHandler = (request: Request) => {
        if (originalHandler) originalHandler(request);

        const url = request.url();
        if (this.isNaverLogRequest(url)) {
          const event = this.events[this.events.length - 1];
          if (event) {
            callback(event);
          }
        }
      };

      // 재등록
      this.page.off("request", originalHandler!);
      this.page.on("request", this.requestHandler);
    }
  }

  /**
   * 트래픽 반영에 필요한 로그 발생 대기
   */
  async waitForRequiredLogs(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const summary = this.getSummary();
      if (summary.isValid) {
        this.log("[NaverLogMonitor] All required logs detected");
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.log("[NaverLogMonitor] Timeout waiting for required logs");
    return false;
  }

  /**
   * 네이버 JS가 로드되고 로그가 발생하는지 확인
   */
  async verifyNaverJSLogging(page: Page): Promise<{
    jsLoaded: boolean;
    loggingActive: boolean;
    details: Record<string, any>;
  }> {
    const result = {
      jsLoaded: false,
      loggingActive: false,
      details: {} as Record<string, any>,
    };

    try {
      // 네이버 JS 로드 확인
      const jsCheck = await page.evaluate(() => {
        return {
          hasNclk: typeof (window as any).nclk !== "undefined",
          hasNclkImg: typeof (window as any).nclk_img !== "undefined",
          hasLcs: typeof (window as any).lcs !== "undefined",
          hasWcs: typeof (window as any).wcs !== "undefined",
          hasNa: typeof (window as any).na !== "undefined",
          hasNtm: typeof (window as any).ntm !== "undefined",
        };
      });

      result.details = jsCheck;
      result.jsLoaded = Object.values(jsCheck).some(v => v === true);

      // 로깅 활성화 여부 (최근 이벤트 확인)
      const summary = this.getSummary();
      result.loggingActive = summary.totalLogs > 0;

      this.log(`[NaverLogMonitor] Naver JS loaded: ${result.jsLoaded}`);
      this.log(`[NaverLogMonitor] Logging active: ${result.loggingActive}`);
      this.log(`[NaverLogMonitor] JS details: ${JSON.stringify(jsCheck)}`);

      return result;
    } catch (error: any) {
      this.log(`[NaverLogMonitor] JS verification error: ${error.message}`);
      return result;
    }
  }
}
