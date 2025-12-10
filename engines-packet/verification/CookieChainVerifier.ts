/**
 * Cookie Chain Verifier
 *
 * 세션 쿠키 체인의 연속성 검증
 * - 필수 쿠키 (NNB, atx_session, page_uid 등) 추적
 * - 모든 요청에 쿠키가 올바르게 전달되는지 확인
 * - Set-Cookie 응답이 다음 요청에 반영되는지 검증
 */

import type { Page, Request, Response, BrowserContext } from "patchright";
import type { LogFunction, CookieData } from "../types";

// 네이버 트래픽 반영에 필수적인 쿠키들
const CRITICAL_COOKIES = {
  NNB: {
    name: "NNB",
    domain: ".naver.com",
    description: "네이버 브라우저 식별자",
    required: true,
  },
  NACT: {
    name: "NACT",
    domain: ".naver.com",
    description: "네이버 활동 토큰",
    required: true,
  },
  nx_ssl: {
    name: "nx_ssl",
    domain: ".naver.com",
    description: "네이버 SSL 세션",
    required: false,
  },
  page_uid: {
    name: "page_uid",
    domain: ".shopping.naver.com",
    description: "페이지 고유 식별자",
    required: false,  // shopping.naver.com에서만 설정되므로 선택적
  },
  atx_session: {
    name: "atx_session",
    domain: ".shopping.naver.com",
    description: "쇼핑 세션",
    required: false,
  },
  _naver_crypto: {
    name: "_naver_crypto",
    domain: ".naver.com",
    description: "네이버 암호화 토큰",
    required: false,
  },
  "X-NSM": {
    name: "X-NSM",
    domain: ".naver.com",
    description: "네이버 보안 모듈",
    required: false,
  },
  NAC: {
    name: "NAC",
    domain: ".naver.com",
    description: "NAC 토큰",
    required: true,
  },
};

export interface CookieSnapshot {
  timestamp: number;
  url: string;
  cookies: Map<string, string>;
  source: "request" | "response" | "browser";
}

export interface CookieChainResult {
  isValid: boolean;
  missingCookies: string[];
  inconsistentCookies: string[];
  cookieTimeline: CookieSnapshot[];
  warnings: string[];
  errors: string[];
  statistics: {
    totalRequests: number;
    requestsWithAllCookies: number;
    cookieConsistencyRate: number;
  };
}

export class CookieChainVerifier {
  private log: LogFunction;
  private snapshots: CookieSnapshot[] = [];
  private isMonitoring: boolean = false;
  private page: Page | null = null;
  private requestHandler: ((request: Request) => void) | null = null;
  private responseHandler: ((response: Response) => void) | null = null;
  private lastCookieValues: Map<string, string> = new Map();

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 모니터링 시작
   */
  async startMonitoring(page: Page): Promise<void> {
    if (this.isMonitoring) {
      this.log("[CookieChainVerifier] Already monitoring");
      return;
    }

    this.page = page;
    this.snapshots = [];
    this.lastCookieValues.clear();
    this.isMonitoring = true;

    this.log("[CookieChainVerifier] Starting cookie chain monitoring...");

    // Request 인터셉터 - 요청에 포함된 쿠키 추적
    this.requestHandler = (request: Request) => {
      const url = request.url();

      // 네이버 도메인만 추적
      if (!this.isNaverDomain(url)) return;

      const headers = request.headers();
      const cookieHeader = headers["cookie"] || "";

      const cookies = this.parseCookieHeader(cookieHeader);
      const snapshot: CookieSnapshot = {
        timestamp: Date.now(),
        url: url,
        cookies: cookies,
        source: "request",
      };

      this.snapshots.push(snapshot);
      this.checkCookieConsistency(snapshot);
    };

    // Response 인터셉터 - Set-Cookie 추적
    this.responseHandler = (response: Response) => {
      const url = response.url();

      if (!this.isNaverDomain(url)) return;

      const headers = response.headers();
      const setCookies: string[] = [];

      // Set-Cookie 헤더 수집
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "set-cookie") {
          setCookies.push(value);
        }
      }

      if (setCookies.length > 0) {
        const cookies = new Map<string, string>();

        for (const setCookie of setCookies) {
          const parsed = this.parseSetCookie(setCookie);
          if (parsed) {
            cookies.set(parsed.name, parsed.value);
            this.lastCookieValues.set(parsed.name, parsed.value);
          }
        }

        const snapshot: CookieSnapshot = {
          timestamp: Date.now(),
          url: url,
          cookies: cookies,
          source: "response",
        };

        this.snapshots.push(snapshot);
        this.log(`[CookieChainVerifier] Set-Cookie received: ${Array.from(cookies.keys()).join(", ")}`);
      }
    };

    page.on("request", this.requestHandler);
    page.on("response", this.responseHandler);

    // 초기 브라우저 쿠키 스냅샷
    await this.snapshotBrowserCookies();

    this.log("[CookieChainVerifier] Monitoring active");
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
    this.log("[CookieChainVerifier] Monitoring stopped");
  }

  /**
   * 브라우저 쿠키 스냅샷
   */
  async snapshotBrowserCookies(): Promise<void> {
    if (!this.page) return;

    const context = this.page.context();
    const browserCookies = await context.cookies();

    const cookies = new Map<string, string>();
    for (const cookie of browserCookies) {
      cookies.set(cookie.name, cookie.value);
      this.lastCookieValues.set(cookie.name, cookie.value);
    }

    const snapshot: CookieSnapshot = {
      timestamp: Date.now(),
      url: "browser_context",
      cookies: cookies,
      source: "browser",
    };

    this.snapshots.push(snapshot);
    this.log(`[CookieChainVerifier] Browser cookies snapshot: ${browserCookies.length} cookies`);
  }

  /**
   * 네이버 도메인 확인
   */
  private isNaverDomain(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return hostname.includes("naver.com");
    } catch {
      return false;
    }
  }

  /**
   * 쿠키가 필요한 요청인지 확인 (광고/추적 픽셀 제외)
   * siape.veta.naver.com 등의 광고 요청은 의도적으로 쿠키 없이 전송됨
   */
  private requiresCookies(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;

      // 광고/추적 서버는 쿠키가 필요하지 않음
      // 이 도메인들은 의도적으로 쿠키 없이 요청됨
      const noCookieHosts = [
        "siape.veta.naver.com",  // 광고 서버
        "ader.naver.com",        // 광고 서버
        "g.tivan.naver.com",     // 광고/추적
        "tivan.naver.com",       // 광고/추적
        "ssl.pstatic.net",       // 정적 리소스
        "s.pstatic.net",         // 정적 리소스
        "static.naver.net",      // 정적 리소스
        "lcs.naver.com",         // 로그 수집
        "nlog.naver.com",        // 로그 수집
        "wcs.naver.com",         // 웹 로그 수집
        "cc.naver.com",          // 광고 클릭
        "adcr.naver.com",        // 광고 클릭 리다이렉트
      ];

      return !noCookieHosts.some(host => hostname.includes(host));
    } catch {
      return true;
    }
  }

  /**
   * Cookie 헤더 파싱
   */
  private parseCookieHeader(header: string): Map<string, string> {
    const cookies = new Map<string, string>();
    if (!header) return cookies;

    const pairs = header.split(";");
    for (const pair of pairs) {
      const [name, ...valueParts] = pair.trim().split("=");
      if (name) {
        cookies.set(name.trim(), valueParts.join("=").trim());
      }
    }

    return cookies;
  }

  /**
   * Set-Cookie 파싱
   */
  private parseSetCookie(header: string): { name: string; value: string } | null {
    if (!header) return null;

    const parts = header.split(";");
    if (parts.length === 0) return null;

    const [nameValue] = parts;
    const eqIndex = nameValue.indexOf("=");
    if (eqIndex === -1) return null;

    const name = nameValue.substring(0, eqIndex).trim();
    const value = nameValue.substring(eqIndex + 1).trim();

    return { name, value };
  }

  /**
   * 쿠키 일관성 체크
   */
  private checkCookieConsistency(snapshot: CookieSnapshot): void {
    // 이전 스냅샷과 비교
    if (this.snapshots.length < 2) return;

    const prevSnapshot = this.snapshots[this.snapshots.length - 2];
    if (prevSnapshot.source !== "request") return;

    // 쿠키가 필요하지 않은 요청은 스킵
    if (!this.requiresCookies(snapshot.url)) {
      return;
    }

    // 필수 쿠키가 유지되는지 확인
    for (const [name, config] of Object.entries(CRITICAL_COOKIES)) {
      if (!config.required) continue;

      const prevValue = prevSnapshot.cookies.get(name);
      const currValue = snapshot.cookies.get(name);

      if (prevValue && !currValue) {
        this.log(`[CookieChainVerifier] WARNING: Cookie "${name}" disappeared in request to ${snapshot.url}`);
      }
    }
  }

  /**
   * 체인 검증 결과 생성
   */
  getResult(): CookieChainResult {
    const result: CookieChainResult = {
      isValid: true,
      missingCookies: [],
      inconsistentCookies: [],
      cookieTimeline: [...this.snapshots],
      warnings: [],
      errors: [],
      statistics: {
        totalRequests: 0,
        requestsWithAllCookies: 0,
        cookieConsistencyRate: 0,
      },
    };

    // 요청 스냅샷 중 쿠키가 필요한 것만 필터링
    // (광고/추적 픽셀은 의도적으로 쿠키 없이 요청됨)
    const requestSnapshots = this.snapshots.filter(
      s => s.source === "request" && this.requiresCookies(s.url)
    );
    result.statistics.totalRequests = requestSnapshots.length;

    if (requestSnapshots.length === 0) {
      result.warnings.push("No requests captured");
      return result;
    }

    // 필수 쿠키 체크
    const requiredCookies = Object.entries(CRITICAL_COOKIES)
      .filter(([_, config]) => config.required)
      .map(([name, _]) => name);

    let requestsWithAllCookies = 0;
    const cookiePresenceCount: Record<string, number> = {};

    for (const snapshot of requestSnapshots) {
      let hasAllRequired = true;

      for (const cookieName of requiredCookies) {
        if (!snapshot.cookies.has(cookieName)) {
          hasAllRequired = false;

          if (!result.missingCookies.includes(cookieName)) {
            result.missingCookies.push(cookieName);
          }
        } else {
          cookiePresenceCount[cookieName] = (cookiePresenceCount[cookieName] || 0) + 1;
        }
      }

      if (hasAllRequired) {
        requestsWithAllCookies++;
      }
    }

    result.statistics.requestsWithAllCookies = requestsWithAllCookies;
    result.statistics.cookieConsistencyRate =
      requestSnapshots.length > 0
        ? requestsWithAllCookies / requestSnapshots.length
        : 0;

    // 쿠키 일관성 체크 (값 변경 추적)
    const cookieValueHistory: Record<string, string[]> = {};

    for (const snapshot of requestSnapshots) {
      for (const [name, value] of snapshot.cookies) {
        if (!cookieValueHistory[name]) {
          cookieValueHistory[name] = [];
        }

        const lastValue = cookieValueHistory[name][cookieValueHistory[name].length - 1];
        if (lastValue !== value) {
          cookieValueHistory[name].push(value);
        }
      }
    }

    // 너무 자주 변경되는 쿠키 감지
    for (const [name, values] of Object.entries(cookieValueHistory)) {
      if (values.length > 5) {
        result.inconsistentCookies.push(name);
        result.warnings.push(`Cookie "${name}" changed ${values.length} times - may indicate session issues`);
      }
    }

    // 최종 유효성 판단
    if (result.missingCookies.length > 0) {
      result.errors.push(`Missing required cookies: ${result.missingCookies.join(", ")}`);
      result.isValid = false;
    }

    if (result.statistics.cookieConsistencyRate < 0.9) {
      result.errors.push(`Low cookie consistency rate: ${(result.statistics.cookieConsistencyRate * 100).toFixed(1)}%`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * 보고서 출력
   */
  printReport(): void {
    const result = this.getResult();

    this.log("\n========== COOKIE CHAIN REPORT ==========");
    this.log(`Total Requests Monitored: ${result.statistics.totalRequests}`);
    this.log(`Requests with All Required Cookies: ${result.statistics.requestsWithAllCookies}`);
    this.log(`Cookie Consistency Rate: ${(result.statistics.cookieConsistencyRate * 100).toFixed(1)}%`);

    this.log("\nRequired Cookies Status:");
    for (const [name, config] of Object.entries(CRITICAL_COOKIES)) {
      if (!config.required) continue;
      const present = !result.missingCookies.includes(name);
      this.log(`├─ ${name}: ${present ? "✅" : "❌"} (${config.description})`);
    }

    if (result.errors.length > 0) {
      this.log("\n❌ ERRORS:");
      result.errors.forEach(e => this.log(`   - ${e}`));
    }

    if (result.warnings.length > 0) {
      this.log("\n⚠️  WARNINGS:");
      result.warnings.forEach(w => this.log(`   - ${w}`));
    }

    this.log(`\n📊 COOKIE CHAIN: ${result.isValid ? "✅ VALID" : "❌ INVALID"}`);
    this.log("==========================================\n");
  }

  /**
   * 특정 쿠키의 타임라인 추적
   */
  getCookieTimeline(cookieName: string): Array<{
    timestamp: number;
    value: string;
    source: string;
    url: string;
  }> {
    const timeline: Array<{
      timestamp: number;
      value: string;
      source: string;
      url: string;
    }> = [];

    for (const snapshot of this.snapshots) {
      if (snapshot.cookies.has(cookieName)) {
        timeline.push({
          timestamp: snapshot.timestamp,
          value: snapshot.cookies.get(cookieName)!,
          source: snapshot.source,
          url: snapshot.url,
        });
      }
    }

    return timeline;
  }

  /**
   * 현재 쿠키 상태 가져오기
   */
  getCurrentCookies(): Map<string, string> {
    return new Map(this.lastCookieValues);
  }

  /**
   * 필수 쿠키만 가져오기
   */
  getRequiredCookies(): Record<string, string | null> {
    const result: Record<string, string | null> = {};

    for (const [name, config] of Object.entries(CRITICAL_COOKIES)) {
      if (config.required) {
        result[name] = this.lastCookieValues.get(name) || null;
      }
    }

    return result;
  }

  /**
   * 쿠키 체인 유효성 빠른 체크
   */
  quickValidate(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const [name, config] of Object.entries(CRITICAL_COOKIES)) {
      if (config.required && !this.lastCookieValues.has(name)) {
        missing.push(name);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * NAC API를 통한 쿠키 전송 검증
   * CDP가 쿠키를 보고하지 않는 경우에도 실제 전송 확인 가능
   *
   * NAC API가 토큰을 반환하면 쿠키가 제대로 전송된 것
   */
  async verifyViaNacApi(page: Page): Promise<{
    cookiesSent: boolean;
    nacToken: string | null;
    browserCookies: { name: string; value: string; domain: string }[];
  }> {
    this.log("[CookieChainVerifier] Verifying cookie sending via NAC API...");

    // 브라우저 컨텍스트 쿠키 확인
    const context = page.context();
    const allCookies = await context.cookies();
    const browserCookies = allCookies
      .filter(c => c.name === "NNB" || c.name === "NACT" || c.name === "NAC")
      .map(c => ({ name: c.name, value: c.value.substring(0, 20), domain: c.domain }));

    // 브라우저 내부 fetch로 NAC API 호출
    const nacResult = await page.evaluate(async () => {
      try {
        const response = await fetch("https://nam.veta.naver.com/nac/1", {
          credentials: "include",
        });
        const text = await response.text();
        return {
          success: response.ok,
          status: response.status,
          body: text,
        };
      } catch (e: any) {
        return {
          success: false,
          status: 0,
          body: null,
          error: e.message,
        };
      }
    });

    // NAC 토큰 추출
    let nacToken: string | null = null;
    if (nacResult.body) {
      try {
        const parsed = JSON.parse(nacResult.body);
        nacToken = parsed.nac || null;
      } catch {
        // JSON 파싱 실패 시 그대로 사용
        if (nacResult.body.length > 5 && nacResult.body.length < 100) {
          nacToken = nacResult.body;
        }
      }
    }

    // NAC 토큰이 있으면 쿠키가 전송된 것
    const cookiesSent = nacResult.success && nacToken !== null;

    this.log(`[CookieChainVerifier] NAC API response: ${nacResult.status}`);
    this.log(`[CookieChainVerifier] NAC token received: ${cookiesSent ? "YES ✅" : "NO ❌"}`);
    this.log(`[CookieChainVerifier] Cookies in browser: ${browserCookies.map(c => c.name).join(", ")}`);

    return {
      cookiesSent,
      nacToken,
      browserCookies,
    };
  }

  /**
   * 스냅샷 초기화
   */
  clearSnapshots(): void {
    this.snapshots = [];
    this.lastCookieValues.clear();
    this.log("[CookieChainVerifier] Snapshots cleared");
  }
}
