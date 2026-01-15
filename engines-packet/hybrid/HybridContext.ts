/**
 * Hybrid Context (Chrome TLS 보장 버전)
 *
 * 핵심 원칙:
 * - 모든 HTTP 요청은 page.evaluate(fetch)로 실행 → Chrome TLS 100% 보장
 * - page.request.fetch()는 Node TLS를 쓸 수 있어서 사용 금지
 * - 쿠키는 BrowserContext가 자동 관리 (수동 동기화 최소화)
 * - 페이지 네비게이션은 networkidle 대기
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "patchright";
import type {
  HybridConfig,
  PhaseResult,
  SessionState,
  Product,
  RunContext,
  LogFunction,
  BehaviorLogTemplate,
  BehaviorLogType,
} from "../types";
import { SessionManager } from "../session/SessionManager";
import { BrowserSync } from "./BrowserSync";
import { BrowserFetch } from "../replay/BrowserFetch";
import { HeaderBuilder } from "../session/HeaderBuilder";
import { DeviceIdGenerator } from "../session/DeviceIdGenerator";
import { BehaviorLogCaptor } from "../capture/BehaviorLogCaptor";
import { ProductLogBuilder } from "../builders/ProductLogBuilder";

export class HybridContext {
  private log: LogFunction;
  private config: HybridConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private session: SessionManager;
  private sync: BrowserSync;
  private browserFetch: BrowserFetch;  // Chrome TLS 보장
  private headers: HeaderBuilder;
  private deviceId: DeviceIdGenerator;
  private captor: BehaviorLogCaptor;   // 행동 로그 캡처
  private phases: PhaseResult[] = [];

  constructor(config: HybridConfig, logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.config = config;
    this.session = new SessionManager(logFn);
    this.sync = new BrowserSync(this.session, logFn);
    this.browserFetch = new BrowserFetch(logFn);  // Chrome TLS 보장
    this.headers = new HeaderBuilder(logFn);
    this.deviceId = new DeviceIdGenerator(logFn);
    this.captor = new BehaviorLogCaptor(logFn);   // 행동 로그 캡처
  }

  /**
   * 브라우저 초기화 (Chrome TLS + HTTP/2 보장 설정)
   *
   * 핵심 조건:
   * 1. headless: false (headless=true는 다른 TLS fingerprint)
   * 2. NetworkService 활성화 → HTTP/2 + Chrome TLS
   * 3. BrowserContext 기본값 유지
   * 4. 모든 요청은 page.evaluate(fetch)로
   */
  async initialize(): Promise<void> {
    this.log("[HybridContext] Initializing browser (Chrome TLS + HTTP/2 mode)");

    // 실제 Chrome 사용 (channel: 'chrome')
    // page.request는 Node TLS → 반드시 page.evaluate(fetch) 사용해야 Chrome TLS
    this.browser = await chromium.launch({
      channel: "chrome",  // 실제 Chrome 사용 → Chrome TLS fingerprint
      headless: false,    // GUI 모드
      args: [
        // 최소 args만 (NetworkService 등 불필요)
        "--disable-blink-features=AutomationControlled",
      ],
    });

    // 실제 브라우저 User-Agent 가져오기
    const tempPage = await this.browser.newPage();
    const realUserAgent = await tempPage.evaluate(() => navigator.userAgent);
    const chromeVersion = realUserAgent.match(/Chrome\/(\d+)/)?.[1] || "131";
    await tempPage.close();

    // BrowserContext - Client Hints 완전 설정
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent: realUserAgent,
      // Client Hints 설정 (Low Entropy만 전송)
      extraHTTPHeaders: {
        "sec-ch-ua": `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        // High entropy 헤더 제거 (Accept-CH 요청 없음 - 봇 탐지 위험)
        // "sec-ch-ua-platform-version": '"15.0.0"',
        // "sec-ch-ua-arch": '"x86"',
        // "sec-ch-ua-bitness": '"64"',
        // "sec-ch-ua-full-version-list": `"Chromium";v="${chromeVersion}.0.0.0", "Google Chrome";v="${chromeVersion}.0.0.0", "Not-A.Brand";v="99.0.0.0"`,
        // "sec-ch-ua-wow64": "?0",
      },
    });

    this.page = await this.context.newPage();
    this.sync.setContext(this.context);

    // BrowserFetch에 Page 설정 (Chrome TLS 100% 보장)
    this.browserFetch.setPage(this.page);

    // 행동 로그 캡처 시작
    this.captor.attach(this.page);

    // 실제 브라우저 User-Agent 추출
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    this.headers.setBrowserUserAgent(userAgent);
    this.session.setUserAgent(userAgent);

    this.log(`[HybridContext] User-Agent: ${userAgent}`);

    // Anti-detection 스크립트 주입
    await this.injectAntiDetection();

    this.log("[HybridContext] Browser initialized (Chrome TLS guaranteed)");
  }

  /**
   * Anti-detection 스크립트 주입
   */
  private async injectAntiDetection(): Promise<void> {
    if (!this.page) return;

    await this.page.addInitScript(() => {
      // navigator.webdriver 숨기기
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      // Chrome 객체 에뮬레이션
      (window as any).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };

      // Permissions API 패치
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "prompt" } as PermissionStatus)
          : originalQuery(parameters);

      // navigator 속성 패치
      Object.defineProperty(navigator, "maxTouchPoints", {
        get: () => 0,
      });
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 8,
      });
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8,
      });
      Object.defineProperty(navigator, "platform", {
        get: () => "Win32",
      });
    });
  }

  /**
   * Phase 1: 브라우저 단계
   * - 네이버 메인 접속
   * - 사람 행동 시뮬레이션 (스크롤, 대기, hover)
   * - NAC 토큰 획득
   * - NACT 유도 (행동 로그 발생)
   */
  async browserPhase(product: Product, ctx: RunContext): Promise<PhaseResult> {
    const startTime = Date.now();
    this.log("[HybridContext] Starting browser phase");

    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      // 1. 네이버 메인 접속
      await this.page.goto("https://www.naver.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // 2. 페이지 완전 로드 대기 (networkidle 시뮬레이션)
      this.log("[HybridContext] Waiting for page load...");
      await this.page.waitForLoadState("load");
      await this.page.waitForTimeout(this.randomBetween(1500, 2500));

      // 3. 사람 행동 시뮬레이션 - 이게 핵심!
      // 이걸 해야 expose, impression, scroll, dwell 로그가 발생함
      await this.simulateHumanBehavior();

      // 4. NAC 토큰 획득 (브라우저 내에서 실행)
      await this.captureNacTokenFromBrowser();

      // 5. page_uid 생성 및 설정
      const pageUid = this.deviceId.generatePageUid();
      await this.context!.addCookies([{
        name: "page_uid",
        value: pageUid,
        domain: ".naver.com",
        path: "/",
      }]);
      this.log(`[HybridContext] page_uid set: ${pageUid}`);

      // 6. 쿠키 상태 확인 (BrowserContext에서)
      const cookies = await this.context!.cookies();
      this.log(`[HybridContext] Cookies from browser: ${cookies.length}`);

      // NACT 확인
      const hasNACT = cookies.some(c => c.name === "NACT");
      this.log(`[HybridContext] NACT cookie: ${hasNACT ? "✅" : "❌ (will be generated by behavior)"}`);

      // 7. 세션 동기화 (브라우저 → SessionManager)
      await this.sync.syncFromBrowser();

      const duration = Date.now() - startTime;
      const result: PhaseResult = {
        phase: "browser",
        success: true,
        duration,
        data: {
          sessionValid: this.session.isSessionValid(),
          cookieCount: cookies.length,
          hasNacToken: !!this.session.getNacToken(),
          hasNACT,
          pageUid,
          url: this.page.url(),
        },
      };

      this.phases.push(result);
      this.log(`[HybridContext] Browser phase completed in ${duration}ms`);
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const result: PhaseResult = {
        phase: "browser",
        success: false,
        duration,
        error: error.message,
      };

      this.phases.push(result);
      this.log(`[HybridContext] Browser phase failed: ${error.message}`);
      return result;
    }
  }

  /**
   * 사람 행동 시뮬레이션
   * 이걸 해야 네이버 로그 시스템에 다음이 찍힘:
   * - GNB expose
   * - mainpage impression
   * - scroll_event
   * - dwell_time_init
   */
  private async simulateHumanBehavior(): Promise<void> {
    if (!this.page) return;

    this.log("[HybridContext] Simulating human behavior...");

    // 1. 마우스를 화면 중앙으로 이동
    await this.page.mouse.move(
      this.randomBetween(400, 800),
      this.randomBetween(300, 500)
    );
    await this.page.waitForTimeout(this.randomBetween(300, 600));

    // 2. 첫 번째 스크롤 (200-300px) - expose 로그 발생
    await this.page.mouse.wheel(0, this.randomBetween(150, 250));
    await this.page.waitForTimeout(this.randomBetween(500, 900));

    // 3. 클릭 가능 요소에 hover (NACT 유도)
    const hoverTargets = [
      ".gnb_area",           // GNB 영역
      "#newsstand",          // 뉴스스탠드
      ".main_shopping_box",  // 쇼핑 박스
      "a[href*='shopping']", // 쇼핑 링크
    ];

    for (const selector of hoverTargets) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await element.hover();
          await this.page.waitForTimeout(this.randomBetween(200, 400));
          break;  // 하나만 hover 하면 됨
        }
      } catch {
        // 요소 없으면 무시
      }
    }

    // 4. 추가 스크롤 (100-200px) - scroll_event 로그
    await this.page.mouse.wheel(0, this.randomBetween(100, 180));
    await this.page.waitForTimeout(this.randomBetween(400, 700));

    // 5. 마우스를 검색창 근처로 이동 (자연스러운 흐름)
    await this.page.mouse.move(
      this.randomBetween(500, 700),
      this.randomBetween(100, 150)
    );
    await this.page.waitForTimeout(this.randomBetween(300, 500));

    // 6. Dwell time 대기 (1-2초)
    await this.page.waitForTimeout(this.randomBetween(1000, 2000));

    this.log("[HybridContext] Human behavior simulation complete");
  }

  /**
   * NAC 토큰 획득 (브라우저 내 JavaScript로 실행)
   * 패킷 재현이 아닌 page.evaluate() 기반
   */
  private async captureNacTokenFromBrowser(): Promise<void> {
    if (!this.page) return;

    try {
      // 브라우저 내에서 NAC API 호출
      const nacResponse = await this.page.evaluate(async () => {
        try {
          const response = await fetch("https://nam.veta.naver.com/nac/1", {
            method: "GET",
            credentials: "include",
          });
          return await response.text();
        } catch {
          return null;
        }
      });

      if (nacResponse) {
        this.session.extractNacToken(nacResponse);
        this.log("[HybridContext] NAC token captured via browser");
      }
    } catch (error) {
      this.log(`[HybridContext] Failed to capture NAC token: ${error}`);
    }
  }

  /**
   * Phase 2: 네트워크 요청 단계
   * - page.evaluate(fetch) 사용 (Chrome TLS 100% 보장)
   * - page.request.fetch()는 Node TLS를 쓸 수 있어서 사용 금지
   */
  async networkPhase(url: string, ctx: RunContext): Promise<PhaseResult> {
    const startTime = Date.now();
    this.log("[HybridContext] Starting network phase (Chrome TLS)");

    try {
      if (!this.browserFetch.hasPage()) {
        throw new Error("BrowserFetch not initialized with page");
      }

      // page.evaluate(fetch) 사용 (Chrome TLS 100% 보장)
      const response = await this.browserFetch.get(url);

      const duration = Date.now() - startTime;
      const result: PhaseResult = {
        phase: "http",
        success: response.ok,
        duration,
        data: {
          url: response.url,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
        },
      };

      this.phases.push(result);
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const result: PhaseResult = {
        phase: "http",
        success: false,
        duration,
        error: error.message,
      };

      this.phases.push(result);
      return result;
    }
  }

  /**
   * Phase 3: 검증 단계
   * - 현재 페이지 상태 확인
   * - CAPTCHA 확인
   * - 상품 페이지 검증
   */
  async verifyPhase(ctx: RunContext): Promise<PhaseResult> {
    const startTime = Date.now();
    this.log("[HybridContext] Starting verify phase");

    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      // 현재 페이지 상태 확인
      const url = this.page.url();

      // CAPTCHA 감지
      const hasCaptcha = await this.detectCaptcha();

      if (hasCaptcha && this.config.captchaSolverEnabled) {
        this.log("[HybridContext] CAPTCHA detected, attempting to solve");
        // CAPTCHA solver 통합 예정
      }

      // 상품 페이지 검증
      const isProductPage = await this.verifyProductPage();

      // 세션 동기화 (페이지 이동 후 쿠키 변경 반영)
      await this.sync.syncFromBrowser();

      const duration = Date.now() - startTime;
      const result: PhaseResult = {
        phase: "verify",
        success: !hasCaptcha && isProductPage,
        duration,
        data: {
          url,
          hasCaptcha,
          isProductPage,
        },
      };

      this.phases.push(result);
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const result: PhaseResult = {
        phase: "verify",
        success: false,
        duration,
        error: error.message,
      };

      this.phases.push(result);
      return result;
    }
  }

  /**
   * CAPTCHA 감지 (정확한 요소 기반)
   * - 단순 키워드 검색은 false positive 발생
   * - CAPTCHA 전용 요소 또는 특정 텍스트 조합 확인
   */
  private async detectCaptcha(): Promise<boolean> {
    if (!this.page) return false;

    return await this.page.evaluate(() => {
      // 1. CAPTCHA 전용 요소 확인 (확실한 CAPTCHA)
      const hasCaptchaElement = !!(
        document.querySelector('#rcpt_form') ||
        document.querySelector('.captcha_wrap') ||
        document.querySelector('input[name*="captcha"]') ||
        document.querySelector('img[src*="captcha"]') ||
        document.querySelector('.security_check')
      );
      if (hasCaptchaElement) return true;

      // 2. 특정 텍스트 조합 확인 (단독 키워드는 무시)
      const bodyText = document.body?.innerText || '';
      const hasSecurityCheck = bodyText.includes('보안 확인을 완료');
      const hasReceiptNumber = bodyText.includes('영수증 번호') || bodyText.includes('4자리');
      const hasRealUser = bodyText.includes('실제 사용자인지');
      const hasAutoInput = bodyText.includes('자동입력방지');

      return hasSecurityCheck || hasReceiptNumber || hasRealUser || hasAutoInput;
    });
  }

  /**
   * 상품 페이지 검증
   */
  private async verifyProductPage(): Promise<boolean> {
    if (!this.page) return false;

    const url = this.page.url();

    // smartstore 또는 상품 페이지 URL 패턴
    if (url.includes("smartstore.naver.com")) {
      return true;
    }

    // 상품 페이지 증거 확인
    const evidence = await this.page.evaluate(() => {
      const buyButton = document.querySelector('[class*="buy"]');
      const cartButton = document.querySelector('[class*="cart"]');
      const priceElement = document.querySelector('[class*="price"]');

      return !!(buyButton || cartButton || priceElement);
    });

    return evidence;
  }

  /**
   * 브라우저 행동: 검색어 입력
   */
  async typeSearch(keyword: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    const searchInput = await this.page.$('input[name="query"]');
    if (!searchInput) {
      throw new Error("Search input not found");
    }

    // 검색창으로 마우스 이동 후 클릭
    const box = await searchInput.boundingBox();
    if (box) {
      await this.page.mouse.move(
        box.x + this.randomBetween(10, box.width - 10),
        box.y + this.randomBetween(5, box.height - 5)
      );
      await this.page.waitForTimeout(this.randomBetween(100, 200));
    }

    await this.page.click('input[name="query"]');
    await this.page.waitForTimeout(this.randomBetween(300, 600));

    // 인간적 타이핑 (불규칙한 딜레이)
    for (let i = 0; i < keyword.length; i++) {
      const char = keyword[i];

      // 기본 딜레이 + 가끔 더 긴 딜레이 (생각하는 시간)
      let delay = this.randomBetween(80, 180);
      if (Math.random() < 0.1) {
        delay += this.randomBetween(100, 300);  // 10% 확률로 더 긴 딜레이
      }

      await this.page.type('input[name="query"]', char, { delay });
    }

    // 타이핑 완료 후 잠시 대기
    await this.page.waitForTimeout(this.randomBetween(200, 500));
  }

  /**
   * 브라우저 행동: 검색 실행
   */
  async submitSearch(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    await this.page.keyboard.press("Enter");
    await this.page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
  }

  /**
   * 브라우저 행동: 스크롤
   */
  async scroll(targetY: number): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    let currentY = 0;
    while (currentY < targetY) {
      const step = this.randomBetween(100, 250);
      await this.page.mouse.wheel(0, step);
      currentY += step;
      await this.page.waitForTimeout(this.randomBetween(50, 150));
    }
  }

  /**
   * 브라우저 행동: 클릭
   */
  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    const element = await this.page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    // 요소로 스크롤
    await element.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(this.randomBetween(100, 300));

    // 클릭
    await element.click();
  }

  /**
   * 랜덤 범위 값
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 페이지 가져오기
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * 페이지 설정 (새 탭으로 전환 시)
   */
  setPage(page: Page): void {
    this.page = page;
    this.browserFetch.setPage(page);
    this.captor.attach(page);  // 새 탭에서도 행동 로그 캡처
    this.log("[HybridContext] Page switched to new tab");
  }

  /**
   * 브라우저 가져오기
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * 컨텍스트 가져오기
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * 세션 매니저 가져오기
   */
  getSessionManager(): SessionManager {
    return this.session;
  }

  /**
   * 세션 상태 가져오기
   */
  getSessionState(): SessionState {
    return this.session.getState();
  }

  /**
   * 브라우저 싱크 가져오기
   */
  getBrowserSync(): BrowserSync {
    return this.sync;
  }

  /**
   * BrowserFetch 가져오기 (Chrome TLS 보장)
   */
  getBrowserFetch(): BrowserFetch {
    return this.browserFetch;
  }

  /**
   * Header Builder 가져오기
   */
  getHeaderBuilder(): HeaderBuilder {
    return this.headers;
  }

  /**
   * Device ID Generator 가져오기
   */
  getDeviceIdGenerator(): DeviceIdGenerator {
    return this.deviceId;
  }

  /**
   * 행동 로그 캡처 가져오기
   */
  getBehaviorLogCaptor(): BehaviorLogCaptor {
    return this.captor;
  }

  /**
   * 캡처된 템플릿 가져오기
   */
  getCapturedTemplates(): Map<BehaviorLogType, BehaviorLogTemplate> {
    return this.captor.getAllTemplates();
  }

  /**
   * 캡처된 product-logs로 ProductLogBuilder 생성
   */
  getProductLogBuilder(): ProductLogBuilder | null {
    const capturedLogs = this.captor.getCapturedLogs();
    const productLog = capturedLogs.find(l => l.url.includes("product-logs"));

    if (!productLog) {
      this.log("[HybridContext] No product-logs captured");
      return null;
    }

    const builder = new ProductLogBuilder(this.log);
    builder.setTemplateFromCapture(productLog);

    this.log(`[HybridContext] ProductLogBuilder created for product: ${builder.getProductId()}`);
    return builder;
  }

  /**
   * 페이즈 결과 가져오기
   */
  getPhases(): PhaseResult[] {
    return [...this.phases];
  }

  /**
   * 리소스 정리
   */
  async cleanup(): Promise<void> {
    this.log("[HybridContext] Cleaning up");

    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }

    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.phases = [];
  }

  /**
   * 세션 상태로 새 페이지 생성
   */
  async createPageWithSession(): Promise<Page> {
    if (!this.context) {
      throw new Error("Browser context not initialized");
    }

    // 세션 쿠키 적용
    await this.sync.syncToBrowser();

    // 새 페이지 생성
    const page = await this.context.newPage();

    // Anti-detection 스크립트 주입
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    return page;
  }

  /**
   * URL로 이동 (세션 유지)
   */
  async navigateTo(url: string): Promise<void> {
    if (!this.page) {
      throw new Error("Page not initialized");
    }

    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // JS 로드 대기
    await this.page.waitForTimeout(2000);

    // 이동 후 세션 동기화
    await this.sync.syncFromBrowser();
  }
}
