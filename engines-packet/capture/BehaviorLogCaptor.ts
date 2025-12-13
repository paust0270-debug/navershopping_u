/**
 * Behavior Log Captor
 *
 * 브라우저에서 발생하는 행동 로그 API 캡처
 * - log.shopping.naver.com 요청 후킹
 * - viewProduct, scroll, dwell 등 행동 로그 저장
 */

import type { Page, Request } from "patchright";
import type {
  CapturedBehaviorLog,
  BehaviorLogType,
  BehaviorLogTemplate,
  LogFunction,
} from "../types";

export class BehaviorLogCaptor {
  private log: LogFunction;
  private capturedLogs: CapturedBehaviorLog[] = [];
  private templates: Map<BehaviorLogType, BehaviorLogTemplate> = new Map();
  private isCapturing: boolean = false;

  // 행동 로그 URL 패턴
  private static LOG_PATTERNS: Record<string, BehaviorLogType> = {
    "viewProduct": "viewProduct",
    "scroll": "scroll",
    "dwell": "dwellStart",
    "dwellEnd": "dwellEnd",
    "dwellStart": "dwellStart",
    "expose": "expose",
    "impression": "impression",
    "adExpose": "adExpose",
    "click": "click",
  };

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 페이지에 캡처 훅 설치
   */
  attach(page: Page): void {
    // 새 페이지에 attach (여러 페이지에서 캡처 가능)
    page.on("request", (request) => this.onRequest(request));
    this.isCapturing = true;
    this.log("[BehaviorLogCaptor] Attached to page");
  }

  /**
   * 요청 이벤트 핸들러
   */
  private async onRequest(request: Request): Promise<void> {
    const url = request.url();

    // 디버그: 조회수 관련 가능성 있는 모든 URL 출력
    const viewCountPatterns = [
      "log", "wcs", "siape", "veta", "product-logs", "nlog",
      "view", "hit", "count", "stat", "track", "collect",
      "impression", "expose", "visit", "analytics", "beacon"
    ];

    const isViewCountRelated = viewCountPatterns.some(p => url.toLowerCase().includes(p));
    if (isViewCountRelated && !url.includes("youtube") && !url.includes("google")) {
      this.log(`[BehaviorLogCaptor] Potential log URL: ${url.substring(0, 100)}`);
    }

    // log.shopping.naver.com 또는 관련 로그 도메인 필터
    if (!this.isLogUrl(url)) return;

    const logType = this.detectLogType(url);
    if (!logType) return;

    try {
      const headers = request.headers();
      const postData = request.postData();
      let body: Record<string, unknown> = {};

      if (postData) {
        try {
          body = JSON.parse(postData);
        } catch {
          // URL encoded form data
          body = Object.fromEntries(new URLSearchParams(postData));
        }
      }

      const captured: CapturedBehaviorLog = {
        type: logType,
        url,
        method: request.method(),
        headers,
        body,
        cookies: headers["cookie"] || "",
        timestamp: Date.now(),
      };

      this.capturedLogs.push(captured);
      this.updateTemplate(captured);

      this.log(`[BehaviorLogCaptor] Captured: ${logType}`, {
        url: url.substring(0, 80),
        bodyKeys: Object.keys(body).slice(0, 5),
      });
    } catch (error: any) {
      this.log(`[BehaviorLogCaptor] Error capturing: ${error.message}`);
    }
  }

  /**
   * 로그 URL인지 확인
   */
  private isLogUrl(url: string): boolean {
    return (
      url.includes("log.shopping.naver.com") ||
      url.includes("cologger.shopping.naver.com") ||  // 쇼핑 행동 로그
      url.includes("siape.veta.naver.com") ||         // 광고/노출 로그
      url.includes("shopsquare.naver.com/api/log") ||
      url.includes("wcs.naver.net") ||
      url.includes("lcs_") ||                          // LCS 로그
      url.includes("/collect/") ||                     // collect API
      url.includes("scrolllog") ||                     // 스크롤 로그
      url.includes("l.search.naver.com") ||            // 검색 로그
      url.includes("smartstore.naver.com/i/v1/product-logs") ||  // 상품 조회 로그 (핵심!)
      url.includes("nlog.commerce.naver.com") ||       // 커머스 로그
      url.includes("nlog.naver.com")                   // 네이버 로그
    );
  }

  /**
   * URL에서 로그 타입 감지
   */
  private detectLogType(url: string): BehaviorLogType | null {
    const lowerUrl = url.toLowerCase();

    // 직접 패턴 매칭
    for (const [pattern, type] of Object.entries(BehaviorLogCaptor.LOG_PATTERNS)) {
      if (lowerUrl.includes(pattern.toLowerCase())) {
        return type;
      }
    }

    // URL 기반 타입 추론
    if (lowerUrl.includes("product-logs")) {
      return "viewProduct";  // 상품 페이지 조회 로그 (핵심!)
    }
    if (lowerUrl.includes("cologger") || lowerUrl.includes("exlogcr")) {
      return "viewProduct";  // 쇼핑 로그는 viewProduct로 분류
    }
    if (lowerUrl.includes("scrolllog")) {
      return "scroll";       // 스크롤 로그
    }
    if (lowerUrl.includes("fxview") || lowerUrl.includes("fxshow")) {
      return "expose";       // 노출 로그
    }
    if (lowerUrl.includes("nbimp") || lowerUrl.includes("nbackimp")) {
      return "impression";   // 임프레션 로그
    }
    if (lowerUrl.includes("nlog.commerce") || lowerUrl.includes("nlog.naver")) {
      return "viewProduct";  // 커머스/네이버 로그
    }

    // 쿼리 파라미터에서 감지
    try {
      const urlObj = new URL(url);
      const action = urlObj.searchParams.get("action") || urlObj.searchParams.get("type");
      if (action && action in BehaviorLogCaptor.LOG_PATTERNS) {
        return BehaviorLogCaptor.LOG_PATTERNS[action];
      }
    } catch {}

    // 알 수 없는 로그는 expose로 기본 처리
    if (this.isLogUrl(url)) {
      return "expose";
    }

    return null;
  }

  /**
   * 캡처된 로그로 템플릿 업데이트
   */
  private updateTemplate(captured: CapturedBehaviorLog): void {
    // 기존 템플릿이 없으면 새로 생성
    if (!this.templates.has(captured.type)) {
      const template: BehaviorLogTemplate = {
        type: captured.type,
        url: captured.url,
        method: captured.method,
        staticHeaders: { ...captured.headers },
        dynamicHeaders: [],
        bodyTemplate: { ...captured.body },
        dynamicFields: [],
      };

      // 동적 필드 식별
      const dynamicFields = ["timestamp", "eventTime", "eltts", "ts", "requestId", "req_seq"];
      template.dynamicFields = dynamicFields.filter((f) => f in captured.body);

      // 동적 헤더 식별
      const dynamicHeaders = ["x-request-id", "x-timestamp"];
      template.dynamicHeaders = dynamicHeaders.filter((h) =>
        h.toLowerCase() in Object.fromEntries(
          Object.entries(captured.headers).map(([k, v]) => [k.toLowerCase(), v])
        )
      );

      this.templates.set(captured.type, template);
      this.log(`[BehaviorLogCaptor] Created template for: ${captured.type}`);
    }
  }

  /**
   * 캡처된 로그 가져오기
   */
  getCapturedLogs(): CapturedBehaviorLog[] {
    return [...this.capturedLogs];
  }

  /**
   * 특정 타입의 로그만 가져오기
   */
  getLogsByType(type: BehaviorLogType): CapturedBehaviorLog[] {
    return this.capturedLogs.filter((log) => log.type === type);
  }

  /**
   * 템플릿 가져오기
   */
  getTemplate(type: BehaviorLogType): BehaviorLogTemplate | undefined {
    return this.templates.get(type);
  }

  /**
   * 모든 템플릿 가져오기
   */
  getAllTemplates(): Map<BehaviorLogType, BehaviorLogTemplate> {
    return new Map(this.templates);
  }

  /**
   * 캡처된 로그 개수
   */
  getStats(): Record<BehaviorLogType, number> {
    const stats: Partial<Record<BehaviorLogType, number>> = {};
    for (const log of this.capturedLogs) {
      stats[log.type] = (stats[log.type] || 0) + 1;
    }
    return stats as Record<BehaviorLogType, number>;
  }

  /**
   * 캡처 초기화
   */
  clear(): void {
    this.capturedLogs = [];
    this.templates.clear();
    this.log("[BehaviorLogCaptor] Cleared");
  }

  /**
   * 템플릿을 JSON으로 내보내기
   */
  exportTemplates(): string {
    const obj: Record<string, BehaviorLogTemplate> = {};
    for (const [type, template] of Array.from(this.templates.entries())) {
      obj[type] = template;
    }
    return JSON.stringify(obj, null, 2);
  }

  /**
   * JSON에서 템플릿 가져오기
   */
  importTemplates(json: string): void {
    const obj = JSON.parse(json);
    for (const [type, template] of Object.entries(obj)) {
      this.templates.set(type as BehaviorLogType, template as BehaviorLogTemplate);
    }
    this.log(`[BehaviorLogCaptor] Imported ${this.templates.size} templates`);
  }
}
