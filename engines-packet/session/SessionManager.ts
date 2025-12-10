/**
 * Session Manager (Enhanced)
 *
 * 세션 상태 관리 (쿠키, 토큰, 헤더)
 * - Patchright 브라우저에서 세션 추출
 * - Set-Cookie 파싱 및 저장
 * - Domain/path/SameSite/expiry 처리
 * - 만료 쿠키 자동 삭제
 * - HttpOnly 쿠키 유지
 * - NAC/Auth 토큰 관리
 */

import type { BrowserContext, Page } from "patchright";
import type {
  SessionState,
  CookieData,
  ParsedSetCookie,
  CookieJarOptions,
  LogFunction,
} from "../types";

const DEFAULT_COOKIE_OPTIONS: CookieJarOptions = {
  autoExpire: true,
  respectHttpOnly: true,
  respectSameSite: true,
};

export class SessionManager {
  private log: LogFunction;
  private state: SessionState;
  private cookieOptions: CookieJarOptions;
  private browserUserAgent: string | null = null;

  constructor(logFn?: LogFunction, options?: Partial<CookieJarOptions>) {
    this.log = logFn || console.log;
    this.state = this.createEmptyState();
    this.cookieOptions = { ...DEFAULT_COOKIE_OPTIONS, ...options };
  }

  /**
   * 빈 세션 상태 생성
   */
  private createEmptyState(): SessionState {
    return {
      cookies: [],
      headers: {},
      userAgent: "",
      timestamp: Date.now(),
    };
  }

  /**
   * Patchright 브라우저 컨텍스트에서 세션 추출
   */
  async initFromBrowser(context: BrowserContext): Promise<void> {
    this.log("[SessionManager] Extracting session from browser");

    // 쿠키 추출
    const cookies = await context.cookies();
    this.state.cookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));

    // User-Agent 추출 (첫 번째 페이지에서)
    const pages = context.pages();
    if (pages.length > 0) {
      const userAgent = await pages[0].evaluate(() => navigator.userAgent);
      this.state.userAgent = userAgent;
      this.browserUserAgent = userAgent;
    }

    this.state.timestamp = Date.now();

    // 만료된 쿠키 자동 제거
    if (this.cookieOptions.autoExpire) {
      this.removeExpiredCookies();
    }

    this.log(
      `[SessionManager] Extracted ${this.state.cookies.length} cookies`
    );
  }

  /**
   * 페이지에서 세션 추출 (특정 페이지)
   */
  async initFromPage(page: Page): Promise<void> {
    const context = page.context();
    await this.initFromBrowser(context);

    // 페이지의 User-Agent 사용
    const userAgent = await page.evaluate(() => navigator.userAgent);
    this.state.userAgent = userAgent;
    this.browserUserAgent = userAgent;
  }

  /**
   * 브라우저 User-Agent 가져오기
   */
  getBrowserUserAgent(): string | null {
    return this.browserUserAgent;
  }

  /**
   * 응답 헤더에서 Set-Cookie 처리
   */
  processResponseHeaders(
    headers: Record<string, string>,
    requestUrl: string
  ): void {
    // Set-Cookie 헤더 찾기 (대소문자 무시)
    const setCookieKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === "set-cookie"
    );

    for (const key of setCookieKeys) {
      const value = headers[key];
      // 여러 쿠키가 쉼표로 구분될 수 있음 (하지만 Expires에도 쉼표가 있어 주의)
      const cookies = this.splitSetCookieHeader(value);

      for (const cookieStr of cookies) {
        this.updateFromSetCookie(cookieStr, requestUrl);
      }
    }

    // 만료된 쿠키 제거
    if (this.cookieOptions.autoExpire) {
      this.removeExpiredCookies();
    }
  }

  /**
   * Set-Cookie 헤더 문자열 분리
   * 쉼표가 날짜에도 사용되므로 주의 필요
   */
  private splitSetCookieHeader(header: string): string[] {
    const cookies: string[] = [];
    let current = "";
    let inExpires = false;

    const parts = header.split(",");
    for (const part of parts) {
      if (inExpires) {
        // Expires 값의 두 번째 부분
        current += "," + part;
        inExpires = false;
        cookies.push(current.trim());
        current = "";
      } else if (
        part.toLowerCase().includes("expires=") &&
        !part.includes(";")
      ) {
        // Expires 값의 시작 (날짜에 쉼표 포함)
        current = part;
        inExpires = true;
      } else {
        if (current) {
          cookies.push(current.trim());
        }
        current = part;
      }
    }

    if (current) {
      cookies.push(current.trim());
    }

    return cookies.filter((c) => c.length > 0);
  }

  /**
   * Set-Cookie 문자열에서 쿠키 업데이트
   */
  updateFromSetCookie(setCookieStr: string, requestUrl?: string): void {
    const parsed = this.parseSetCookie(setCookieStr);
    if (!parsed) return;

    // Domain 기본값 설정
    if (!parsed.domain && requestUrl) {
      try {
        const url = new URL(requestUrl);
        parsed.domain = url.hostname;
      } catch {
        // URL 파싱 실패 시 무시
      }
    }

    // CookieData로 변환
    const cookie: CookieData = {
      name: parsed.name,
      value: parsed.value,
      domain: parsed.domain || "",
      path: parsed.path || "/",
      expires: parsed.expires
        ? parsed.expires.getTime() / 1000
        : parsed.maxAge
          ? Date.now() / 1000 + parsed.maxAge
          : undefined,
      httpOnly: parsed.httpOnly,
      secure: parsed.secure,
      sameSite: parsed.sameSite,
    };

    this.updateCookie(cookie);
  }

  /**
   * Set-Cookie 헤더 파싱 (상세)
   */
  parseSetCookie(header: string): ParsedSetCookie | null {
    const parts = header.split(";").map((p) => p.trim());
    if (parts.length === 0) return null;

    const [nameValue, ...attributes] = parts;
    const eqIndex = nameValue.indexOf("=");
    if (eqIndex < 0) return null;

    const name = nameValue.substring(0, eqIndex).trim();
    const value = nameValue.substring(eqIndex + 1);

    const cookie: ParsedSetCookie = {
      name,
      value,
      httpOnly: false,
      secure: false,
    };

    for (const attr of attributes) {
      const eqIdx = attr.indexOf("=");
      let key: string;
      let val: string | undefined;

      if (eqIdx >= 0) {
        key = attr.substring(0, eqIdx).trim().toLowerCase();
        val = attr.substring(eqIdx + 1).trim();
      } else {
        key = attr.toLowerCase();
      }

      switch (key) {
        case "domain":
          // Domain 앞의 점 제거 (선택적)
          cookie.domain = val?.startsWith(".") ? val.slice(1) : val;
          break;
        case "path":
          cookie.path = val || "/";
          break;
        case "expires":
          if (val) {
            const date = new Date(val);
            if (!isNaN(date.getTime())) {
              cookie.expires = date;
            }
          }
          break;
        case "max-age":
          if (val) {
            const maxAge = parseInt(val, 10);
            if (!isNaN(maxAge)) {
              cookie.maxAge = maxAge;
            }
          }
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "samesite":
          if (val) {
            const lower = val.toLowerCase();
            if (lower === "strict") cookie.sameSite = "Strict";
            else if (lower === "lax") cookie.sameSite = "Lax";
            else if (lower === "none") cookie.sameSite = "None";
          }
          break;
        case "priority":
          if (val) {
            const lower = val.toLowerCase();
            if (lower === "low") cookie.priority = "Low";
            else if (lower === "medium") cookie.priority = "Medium";
            else if (lower === "high") cookie.priority = "High";
          }
          break;
      }
    }

    return cookie;
  }

  /**
   * 단일 쿠키 업데이트
   */
  updateCookie(cookie: CookieData): void {
    const existingIndex = this.state.cookies.findIndex(
      (c) =>
        c.name === cookie.name &&
        this.domainMatches(c.domain, cookie.domain) &&
        c.path === cookie.path
    );

    if (existingIndex >= 0) {
      this.state.cookies[existingIndex] = cookie;
    } else {
      this.state.cookies.push(cookie);
    }
  }

  /**
   * 도메인 매칭 확인
   */
  private domainMatches(domain1: string, domain2: string): boolean {
    const d1 = domain1.startsWith(".") ? domain1.slice(1) : domain1;
    const d2 = domain2.startsWith(".") ? domain2.slice(1) : domain2;
    return d1 === d2 || d1.endsWith(`.${d2}`) || d2.endsWith(`.${d1}`);
  }

  /**
   * 만료된 쿠키 제거
   */
  removeExpiredCookies(): number {
    const now = Date.now() / 1000;
    const before = this.state.cookies.length;

    this.state.cookies = this.state.cookies.filter((c) => {
      if (!c.expires) return true; // 세션 쿠키는 유지
      return c.expires > now;
    });

    const removed = before - this.state.cookies.length;
    if (removed > 0) {
      this.log(`[SessionManager] Removed ${removed} expired cookies`);
    }

    return removed;
  }

  /**
   * 특정 도메인의 쿠키 가져오기 (SameSite 고려)
   */
  getCookiesForRequest(
    url: string,
    isSameSite: boolean = true
  ): CookieData[] {
    let domain: string;
    let isSecure: boolean;
    let path: string;

    try {
      const parsed = new URL(url);
      domain = parsed.hostname;
      isSecure = parsed.protocol === "https:";
      path = parsed.pathname;
    } catch {
      return [];
    }

    const now = Date.now() / 1000;

    return this.state.cookies.filter((c) => {
      // 만료 확인
      if (c.expires && c.expires <= now) return false;

      // 도메인 매칭
      if (!this.domainMatchesRequest(c.domain, domain)) return false;

      // 경로 매칭
      if (!this.pathMatches(c.path, path)) return false;

      // Secure 확인
      if (c.secure && !isSecure) return false;

      // SameSite 확인
      if (this.cookieOptions.respectSameSite && !isSameSite) {
        if (c.sameSite === "Strict") return false;
        if (c.sameSite === "Lax") return false; // GET 요청만 허용하지만 여기서는 보수적으로 처리
      }

      return true;
    });
  }

  /**
   * 요청 URL과 쿠키 도메인 매칭
   */
  private domainMatchesRequest(cookieDomain: string, requestDomain: string): boolean {
    const cd = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;

    // 정확한 매칭
    if (requestDomain === cd) return true;

    // 서브도메인 매칭
    if (requestDomain.endsWith(`.${cd}`)) return true;

    return false;
  }

  /**
   * 경로 매칭
   */
  private pathMatches(cookiePath: string, requestPath: string): boolean {
    if (cookiePath === "/") return true;
    if (requestPath === cookiePath) return true;
    if (requestPath.startsWith(cookiePath + "/")) return true;
    return false;
  }

  /**
   * 도메인별 쿠키 문자열 가져오기
   */
  getCookiesForDomain(domain: string): string {
    const matching = this.state.cookies.filter((c) =>
      this.domainMatchesRequest(c.domain, domain)
    );

    return matching.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /**
   * 요청용 쿠키 문자열 가져오기
   */
  getCookieStringForRequest(url: string, isSameSite: boolean = true): string {
    const cookies = this.getCookiesForRequest(url, isSameSite);
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /**
   * 모든 쿠키를 문자열로
   */
  getAllCookiesString(): string {
    return this.state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /**
   * 응답에서 NAC 토큰 추출
   * nam.veta.naver.com/nac/1 응답에서 토큰 파싱
   */
  extractNacToken(responseBody: string): string | null {
    try {
      // NAC 응답은 JSON 형식
      const data = JSON.parse(responseBody);
      if (data.token) {
        this.state.nacToken = data.token;
        this.log("[SessionManager] NAC token extracted");
        return data.token;
      }
    } catch {
      // JSON이 아닌 경우 정규식으로 시도
      const match = responseBody.match(/"token"\s*:\s*"([^"]+)"/);
      if (match) {
        this.state.nacToken = match[1];
        return match[1];
      }
    }
    return null;
  }

  /**
   * GraphQL 인증 토큰 추출
   * shopsquare.naver.com/api/auth 응답에서 토큰 파싱
   */
  extractAuthToken(responseBody: string): string | null {
    try {
      const data = JSON.parse(responseBody);
      // GraphQL 응답 구조: { data: { getAuth: { ... } } }
      if (data.data?.getAuth?.token) {
        this.state.authToken = data.data.getAuth.token;
        this.log("[SessionManager] Auth token extracted");
        return data.data.getAuth.token;
      }
    } catch {
      // 실패 시 null
    }
    return null;
  }

  /**
   * 세션 유효성 검사
   */
  isSessionValid(): boolean {
    // 만료된 쿠키 정리
    if (this.cookieOptions.autoExpire) {
      this.removeExpiredCookies();
    }

    // 유효한 쿠키 존재 확인
    const hasValidCookies = this.state.cookies.length > 0;

    // 세션 나이 확인 (30분)
    const sessionAge = Date.now() - this.state.timestamp;
    const isRecent = sessionAge < 30 * 60 * 1000;

    return hasValidCookies && isRecent;
  }

  /**
   * 쿠키 개수 가져오기
   */
  getCookieCount(): number {
    return this.state.cookies.length;
  }

  /**
   * 특정 쿠키 가져오기
   */
  getCookie(name: string, domain?: string): CookieData | undefined {
    return this.state.cookies.find((c) => {
      if (c.name !== name) return false;
      if (domain && !this.domainMatchesRequest(c.domain, domain)) return false;
      return true;
    });
  }

  /**
   * 쿠키 삭제
   */
  deleteCookie(name: string, domain?: string): boolean {
    const before = this.state.cookies.length;
    this.state.cookies = this.state.cookies.filter((c) => {
      if (c.name !== name) return true;
      if (domain && !this.domainMatchesRequest(c.domain, domain)) return true;
      return false;
    });
    return before > this.state.cookies.length;
  }

  /**
   * 현재 상태 가져오기
   */
  getState(): SessionState {
    return { ...this.state };
  }

  /**
   * 상태 내보내기
   */
  exportState(): SessionState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * 상태 가져오기
   */
  importState(state: SessionState): void {
    this.state = JSON.parse(JSON.stringify(state));
    this.log("[SessionManager] Session state imported");

    // 만료된 쿠키 정리
    if (this.cookieOptions.autoExpire) {
      this.removeExpiredCookies();
    }
  }

  /**
   * 상태 초기화
   */
  clear(): void {
    this.state = this.createEmptyState();
    this.log("[SessionManager] Session cleared");
  }

  /**
   * NAC 토큰 가져오기
   */
  getNacToken(): string | undefined {
    return this.state.nacToken;
  }

  /**
   * Auth 토큰 가져오기
   */
  getAuthToken(): string | undefined {
    return this.state.authToken;
  }

  /**
   * User-Agent 가져오기
   */
  getUserAgent(): string {
    return this.state.userAgent;
  }

  /**
   * User-Agent 설정
   */
  setUserAgent(userAgent: string): void {
    this.state.userAgent = userAgent;
  }

  /**
   * 헤더 설정
   */
  setHeader(name: string, value: string): void {
    this.state.headers[name] = value;
  }

  /**
   * 헤더 가져오기
   */
  getHeaders(): Record<string, string> {
    return { ...this.state.headers };
  }

  /**
   * 모든 쿠키 가져오기
   */
  getAllCookies(): CookieData[] {
    return [...this.state.cookies];
  }

  /**
   * Patchright 쿠키 형식으로 변환
   */
  toPatchrightCookies(): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }> {
    return this.state.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
  }
}
