/**
 * Browser Sync (Enhanced)
 *
 * 브라우저와 HTTP 클라이언트 간 상태 양방향 동기화
 * - Page Context 쿠키 상태와 SessionManager 쿠키 상태 양방향 동기화
 * - 쿠키 동기화
 * - 세션 상태 전파
 * - localStorage/sessionStorage 동기화
 */

import type { BrowserContext, Page } from "patchright";
import type { SessionState, CookieData, LogFunction } from "../types";
import { SessionManager } from "../session/SessionManager";
import { CookieExtractor } from "../session/CookieExtractor";

export class BrowserSync {
  private log: LogFunction;
  private context: BrowserContext | null = null;
  private session: SessionManager;
  private cookieExtractor: CookieExtractor;
  private lastSyncTime: number = 0;
  private syncInterval: number = 5000; // 5초마다 자동 동기화 체크

  constructor(sessionManager?: SessionManager, logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.session = sessionManager || new SessionManager(logFn);
    this.cookieExtractor = new CookieExtractor(logFn);
  }

  /**
   * 브라우저 컨텍스트 설정
   */
  setContext(context: BrowserContext): void {
    this.context = context;
  }

  /**
   * 브라우저에서 세션 동기화 (브라우저 → SessionManager)
   */
  async syncFromBrowser(): Promise<SessionState> {
    if (!this.context) {
      throw new Error("Browser context not set");
    }

    await this.session.initFromBrowser(this.context);
    this.lastSyncTime = Date.now();
    this.log("[BrowserSync] Synced session from browser");

    return this.session.getState();
  }

  /**
   * SessionManager를 브라우저에 적용 (SessionManager → 브라우저)
   */
  async syncToBrowser(state?: SessionState): Promise<void> {
    if (!this.context) {
      throw new Error("Browser context not set");
    }

    const sessionState = state || this.session.getState();

    // 기존 쿠키 클리어 (선택적)
    // await this.context.clearCookies();

    // 쿠키 설정
    const cookies = sessionState.cookies
      .filter((c) => c.domain && c.name && c.value) // 유효한 쿠키만
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
        path: c.path || "/",
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
      }));

    if (cookies.length > 0) {
      await this.context.addCookies(cookies);
      this.log(`[BrowserSync] Applied ${cookies.length} cookies to browser`);
    }

    this.lastSyncTime = Date.now();
  }

  /**
   * 양방향 동기화 (병합)
   * 브라우저와 SessionManager 모두의 쿠키를 병합
   */
  async syncBidirectional(): Promise<SessionState> {
    if (!this.context) {
      throw new Error("Browser context not set");
    }

    // 1. 브라우저에서 쿠키 추출
    const browserCookies = await this.cookieExtractor.extractFromContext(
      this.context
    );

    // 2. SessionManager의 현재 쿠키
    const sessionCookies = this.session.getAllCookies();

    // 3. 병합 (브라우저 쿠키 우선)
    const mergedCookies = this.mergeCookies(browserCookies, sessionCookies);

    // 4. SessionManager 업데이트
    for (const cookie of mergedCookies) {
      this.session.updateCookie(cookie);
    }

    // 5. 브라우저에 다시 적용 (SessionManager에만 있던 쿠키 추가)
    await this.syncToBrowser();

    this.lastSyncTime = Date.now();
    this.log(
      `[BrowserSync] Bidirectional sync complete: ${mergedCookies.length} cookies`
    );

    return this.session.getState();
  }

  /**
   * 쿠키 병합 (브라우저 쿠키 우선)
   */
  private mergeCookies(
    browserCookies: CookieData[],
    sessionCookies: CookieData[]
  ): CookieData[] {
    const cookieMap = new Map<string, CookieData>();

    // SessionManager 쿠키 먼저
    for (const cookie of sessionCookies) {
      const key = `${cookie.domain}:${cookie.path}:${cookie.name}`;
      cookieMap.set(key, cookie);
    }

    // 브라우저 쿠키로 덮어쓰기 (우선)
    for (const cookie of browserCookies) {
      const key = `${cookie.domain}:${cookie.path}:${cookie.name}`;
      cookieMap.set(key, cookie);
    }

    return Array.from(cookieMap.values());
  }

  /**
   * 특정 도메인 쿠키만 동기화
   */
  async syncDomainCookies(domain: string): Promise<void> {
    if (!this.context) {
      throw new Error("Browser context not set");
    }

    const cookies = await this.cookieExtractor.extractForDomain(
      this.context,
      domain
    );

    for (const cookie of cookies) {
      this.session.updateCookie(cookie);
    }

    this.log(`[BrowserSync] Synced ${cookies.length} cookies for ${domain}`);
  }

  /**
   * 페이지에서 localStorage 추출
   */
  async extractLocalStorage(page: Page): Promise<Record<string, string>> {
    const storage = await page.evaluate(() => {
      const result: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          result[key] = localStorage.getItem(key) || "";
        }
      }
      return result;
    });

    this.log(
      `[BrowserSync] Extracted ${Object.keys(storage).length} localStorage items`
    );
    return storage;
  }

  /**
   * 페이지에 localStorage 설정
   */
  async applyLocalStorage(
    page: Page,
    storage: Record<string, string>
  ): Promise<void> {
    await page.evaluate((data) => {
      for (const [key, value] of Object.entries(data)) {
        localStorage.setItem(key, value);
      }
    }, storage);

    this.log(
      `[BrowserSync] Applied ${Object.keys(storage).length} localStorage items`
    );
  }

  /**
   * 페이지에서 sessionStorage 추출
   */
  async extractSessionStorage(page: Page): Promise<Record<string, string>> {
    const storage = await page.evaluate(() => {
      const result: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          result[key] = sessionStorage.getItem(key) || "";
        }
      }
      return result;
    });

    return storage;
  }

  /**
   * 페이지에 sessionStorage 설정
   */
  async applySessionStorage(
    page: Page,
    storage: Record<string, string>
  ): Promise<void> {
    await page.evaluate((data) => {
      for (const [key, value] of Object.entries(data)) {
        sessionStorage.setItem(key, value);
      }
    }, storage);
  }

  /**
   * 네트워크 응답에서 토큰 추출
   */
  async extractTokensFromResponse(
    url: string,
    responseBody: string
  ): Promise<void> {
    // NAC 토큰
    if (url.includes("nam.veta.naver.com/nac")) {
      this.session.extractNacToken(responseBody);
    }

    // Auth 토큰
    if (url.includes("shopsquare.naver.com/api/auth")) {
      this.session.extractAuthToken(responseBody);
    }
  }

  /**
   * 쿠키 변경 감지
   */
  async detectCookieChanges(): Promise<{
    added: CookieData[];
    removed: CookieData[];
    modified: Array<{ old: CookieData; new: CookieData }>;
  }> {
    if (!this.context) {
      throw new Error("Browser context not set");
    }

    const oldCookies = this.session.getState().cookies;
    const newCookies = await this.cookieExtractor.extractFromContext(
      this.context
    );

    return this.cookieExtractor.compareCookies(oldCookies, newCookies);
  }

  /**
   * 전체 상태 스냅샷
   */
  async takeSnapshot(page: Page): Promise<{
    session: SessionState;
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
    url: string;
  }> {
    const session = await this.syncFromBrowser();
    const localStorage = await this.extractLocalStorage(page);
    const sessionStorage = await this.extractSessionStorage(page);
    const url = page.url();

    return { session, localStorage, sessionStorage, url };
  }

  /**
   * 스냅샷 복원
   */
  async restoreSnapshot(
    page: Page,
    snapshot: {
      session: SessionState;
      localStorage: Record<string, string>;
      sessionStorage: Record<string, string>;
    }
  ): Promise<void> {
    // 세션 상태 가져오기
    this.session.importState(snapshot.session);

    // 브라우저에 적용
    await this.syncToBrowser(snapshot.session);
    await this.applyLocalStorage(page, snapshot.localStorage);
    await this.applySessionStorage(page, snapshot.sessionStorage);
  }

  /**
   * 동기화가 필요한지 확인
   */
  needsSync(): boolean {
    return Date.now() - this.lastSyncTime > this.syncInterval;
  }

  /**
   * 자동 동기화 (필요한 경우에만)
   */
  async autoSync(): Promise<SessionState | null> {
    if (this.needsSync()) {
      return this.syncFromBrowser();
    }
    return null;
  }

  /**
   * 동기화 간격 설정
   */
  setSyncInterval(ms: number): void {
    this.syncInterval = ms;
  }

  /**
   * 마지막 동기화 시간 가져오기
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /**
   * 세션 매니저 가져오기
   */
  getSessionManager(): SessionManager {
    return this.session;
  }

  /**
   * 현재 세션 상태 가져오기
   */
  getSessionState(): SessionState {
    return this.session.getState();
  }

  /**
   * 브라우저 컨텍스트 가져오기
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * 쿠키 개수 비교 (동기화 상태 확인용)
   */
  async getCookieCounts(): Promise<{
    browser: number;
    session: number;
    match: boolean;
  }> {
    if (!this.context) {
      return { browser: 0, session: 0, match: false };
    }

    const browserCookies = await this.context.cookies();
    const sessionCookies = this.session.getAllCookies();

    return {
      browser: browserCookies.length,
      session: sessionCookies.length,
      match: browserCookies.length === sessionCookies.length,
    };
  }
}
