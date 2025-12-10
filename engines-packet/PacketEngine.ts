/**
 * Packet Engine (Refactored)
 *
 * 네트워크 로그 기반 패킷 자동화 엔진
 * - Patchright Request API 사용 (Chrome TLS)
 * - 브라우저: 행동 (스크롤/클릭/입력)
 * - Network: page.request.fetch() 기반 요청
 * - 검증: 최종 상태 확인
 */

import type { Browser, Page } from "patchright";
import * as fs from "fs";
import type {
  Product,
  RunContext,
  PacketEngineConfig,
  PacketEngineResult,
  RequestPattern,
  LogFunction,
  BehaviorReplayPlan,
  MultiSendResult,
} from "./types";
import { HybridContext } from "./hybrid/HybridContext";
import { RequestReplayer } from "./replay/RequestReplayer";
import { PatternAnalyzer } from "./analysis/PatternAnalyzer";
import { HeaderBuilder } from "./session/HeaderBuilder";
import { TimingSimulator } from "./replay/TimingSimulator";
import { DeviceIdGenerator } from "./session/DeviceIdGenerator";
import { BehaviorLogBuilder } from "./builders/BehaviorLogBuilder";
import { MultiSendEngine } from "./replay/MultiSendEngine";
import { defaultReplayConfig, defaultHybridConfig } from "./index";

export class PacketEngine {
  private log: LogFunction;
  private config: PacketEngineConfig;
  private hybrid: HybridContext;
  private replayer: RequestReplayer;
  private patterns: RequestPattern[] = [];
  private analyzer: PatternAnalyzer;
  private headers: HeaderBuilder;
  private timing: TimingSimulator;
  private deviceId: DeviceIdGenerator;
  private logBuilder: BehaviorLogBuilder;
  private multiSend: MultiSendEngine;
  private initialized: boolean = false;

  constructor(config?: Partial<PacketEngineConfig>, logFn?: LogFunction) {
    this.log = logFn || console.log;

    this.config = {
      headless: config?.headless ?? false,
      replayConfig: { ...defaultReplayConfig, ...config?.replayConfig },
      hybridConfig: { ...defaultHybridConfig, ...config?.hybridConfig },
      patternsPath: config?.patternsPath,
      logNetwork: config?.logNetwork ?? true,
    };

    this.hybrid = new HybridContext(this.config.hybridConfig, this.log);
    this.replayer = new RequestReplayer(this.config.replayConfig, undefined, this.log);
    this.analyzer = new PatternAnalyzer(this.log);
    this.headers = new HeaderBuilder(this.log);
    this.timing = new TimingSimulator(this.log);
    this.deviceId = new DeviceIdGenerator(this.log);
    this.logBuilder = new BehaviorLogBuilder(this.log);
    this.multiSend = new MultiSendEngine(this.logBuilder, this.log);
  }

  /**
   * 엔진 초기화
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log("[PacketEngine] Initializing");

    // 브라우저 초기화
    await this.hybrid.initialize();

    // Page를 RequestReplayer에 설정 (Chrome TLS 사용)
    const page = this.hybrid.getPage();
    if (page) {
      this.replayer.setPage(page);

      // User-Agent 동기화
      const userAgent = await page.evaluate(() => navigator.userAgent);
      this.headers.setBrowserUserAgent(userAgent);
    }

    // 패턴 로드 (있는 경우)
    if (this.config.patternsPath) {
      await this.loadPatterns(this.config.patternsPath);
    }

    // 세션 매니저 연결
    this.replayer.setSessionManager(this.hybrid.getSessionManager());

    this.initialized = true;
    this.log("[PacketEngine] Initialized");
  }

  /**
   * 패턴 파일 로드
   */
  async loadPatterns(patternsPath: string): Promise<void> {
    try {
      const content = fs.readFileSync(patternsPath, "utf-8");
      const data = JSON.parse(content);

      this.patterns = [
        ...(data.criticalPatterns || []),
        ...(data.optionalPatterns || []),
      ];

      this.log(`[PacketEngine] Loaded ${this.patterns.length} patterns from ${patternsPath}`);
    } catch (error) {
      this.log(`[PacketEngine] Failed to load patterns: ${error}`);
    }
  }

  /**
   * 메인 실행 메서드
   */
  async run(product: Product, ctx: RunContext): Promise<PacketEngineResult> {
    const startTime = Date.now();

    const result: PacketEngineResult = {
      success: false,
      captchaDetected: false,
      midMatched: false,
      productPageEntered: false,
      duration: 0,
      requestCount: 0,
      failedRequests: [],
      sessionValid: false,
      replayDuration: 0,
      phases: [],
    };

    try {
      // 초기화
      if (!this.initialized) {
        await this.initialize();
      }

      // Phase 1: 브라우저 단계
      ctx.log("phase_browser_start", { product: product.product_name });
      const browserResult = await this.hybrid.browserPhase(product, ctx);
      result.phases.push(browserResult);

      if (!browserResult.success) {
        result.error = `Browser phase failed: ${browserResult.error}`;
        result.duration = Date.now() - startTime;
        return result;
      }

      // Phase 2: 검색 및 상품 페이지 접근
      ctx.log("phase_search_start", { keyword: product.keyword });
      const searchResult = await this.executeSearchFlow(product, ctx);

      if (!searchResult.success) {
        result.error = searchResult.error;
        result.captchaDetected = searchResult.captchaDetected;
        result.duration = Date.now() - startTime;
        return result;
      }

      result.requestCount = searchResult.requestCount;
      result.replayDuration = searchResult.duration;

      // Phase 3: 검증 단계
      ctx.log("phase_verify_start", {});
      const verifyResult = await this.hybrid.verifyPhase(ctx);
      result.phases.push(verifyResult);

      result.captchaDetected = (verifyResult.data?.hasCaptcha as boolean) ?? false;
      result.productPageEntered = (verifyResult.data?.isProductPage as boolean) ?? false;

      // MID 매칭 확인 (URL 또는 페이지 콘텐츠)
      const page = this.hybrid.getPage();
      if (page) {
        const url = page.url();
        // smartstore URL엔 MID 없음 - 페이지 콘텐츠에서 확인
        const midInContent = await page.evaluate((mid: string) => {
          return document.body?.innerHTML?.includes(mid) || false;
        }, product.mid);
        result.midMatched = url.includes(product.mid) || midInContent;
      }

      // 성공 여부 결정 (상품 페이지 + CAPTCHA 없음)
      result.success = result.productPageEntered && !result.captchaDetected;

      // 체류 시간 (성공 시에만)
      if (result.success) {
        const dwellTime = this.timing.getDwellTime();
        ctx.log("dwell_time", { ms: dwellTime });
        await this.timing.sleep(dwellTime);
      }

      result.sessionValid = this.hybrid.getSessionManager().isSessionValid();
      result.duration = Date.now() - startTime;
      result.phases = this.hybrid.getPhases();

      ctx.log("engine_complete", {
        success: result.success,
        duration: result.duration,
        captcha: result.captchaDetected,
        midMatched: result.midMatched,
      });

      return result;
    } catch (error: any) {
      result.error = error.message;
      result.duration = Date.now() - startTime;

      ctx.log("engine_error", { error: error.message });
      return result;
    }
  }

  /**
   * 검색 플로우 실행
   */
  private async executeSearchFlow(
    product: Product,
    ctx: RunContext
  ): Promise<{
    success: boolean;
    captchaDetected: boolean;
    requestCount: number;
    duration: number;
    error?: string;
  }> {
    const startTime = Date.now();
    const page = this.hybrid.getPage();

    if (!page) {
      return {
        success: false,
        captchaDetected: false,
        requestCount: 0,
        duration: 0,
        error: "Page not available",
      };
    }

    try {
      // 검색 전 추가 대기 (사람처럼)
      await this.timing.sleep(this.timing.randomBetween(500, 1000));

      // 검색어 입력 (브라우저 행동)
      await this.hybrid.typeSearch(product.keyword);

      // 검색 제출 전 대기 (타이핑 후 생각하는 시간)
      await this.timing.sleep(this.timing.randomBetween(800, 1500));
      await this.hybrid.submitSearch();

      // CAPTCHA 확인
      const hasCaptcha = await this.detectCaptcha(page);
      if (hasCaptcha) {
        return {
          success: false,
          captchaDetected: true,
          requestCount: 0,
          duration: Date.now() - startTime,
          error: "CAPTCHA detected on search results",
        };
      }

      // 스크롤 (브라우저 행동)
      await this.hybrid.scroll(1200);

      // 상품 링크 찾기 및 클릭 (MID 일치 필수)
      const linkClicked = await this.findAndClickProductLink(page, product.mid);

      if (!linkClicked) {
        return {
          success: false,
          captchaDetected: false,
          requestCount: 0,
          duration: Date.now() - startTime,
          error: `MID ${product.mid} not found in search results`,
        };
      }

      // 페이지 로드 대기
      await this.timing.sleep(2000);

      return {
        success: true,
        captchaDetected: false,
        requestCount: 1,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        captchaDetected: false,
        requestCount: 0,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * CAPTCHA 감지 (정확한 요소 기반)
   * - 단순 키워드 검색은 false positive 발생
   * - CAPTCHA 전용 요소 또는 특정 텍스트 조합 확인
   */
  private async detectCaptcha(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
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

      // 조합 조건: 보안 확인 + (영수증/실제사용자/자동입력) 중 하나
      return hasSecurityCheck || hasReceiptNumber || hasRealUser || hasAutoInput;
    });
  }

  /**
   * 상품 링크 찾기 및 클릭
   * - MID가 일치하는 링크만 클릭 (fallback 없음)
   * - href, data 속성, bridge URL 등 다양한 위치에서 MID 검색
   */
  private async findAndClickProductLink(
    page: Page,
    mid: string
  ): Promise<boolean> {
    this.log(`[PacketEngine] Finding product link for MID: ${mid}`);

    // MID가 포함된 링크 찾기 (다양한 방법으로)
    const linkInfo = await page.evaluate((targetMid: string) => {
      const links = Array.from(document.querySelectorAll("a"));
      const results: { index: number; href: string; method: string }[] = [];

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href || "";
        const dataAttrs = JSON.stringify(link.dataset || {});
        const onclick = link.getAttribute("onclick") || "";

        // 1순위: MID 포함된 smartstore/brand 직접 링크
        if (
          (href.includes("smartstore.naver.com") || href.includes("brand.naver.com")) &&
          href.includes("/products/") &&
          href.includes(targetMid)
        ) {
          // bridge/cr 리다이렉트 제외
          if (!href.includes("/bridge") && !href.includes("cr.shopping") &&
              !href.includes("cr2.shopping") && !href.includes("cr3.shopping")) {
            return { found: true, index: i, href, method: "direct-mid" };
          }
        }

        // 2순위: Bridge URL에 MID 포함
        if (href.includes(targetMid) &&
            (href.includes("cr.shopping") || href.includes("cr2.shopping") ||
             href.includes("cr3.shopping") || href.includes("/bridge"))) {
          results.push({ index: i, href, method: "bridge-mid" });
        }

        // 3순위: data 속성에 MID 포함
        if (dataAttrs.includes(targetMid)) {
          results.push({ index: i, href, method: "data-attr-mid" });
        }

        // 4순위: onclick에 MID 포함
        if (onclick.includes(targetMid)) {
          results.push({ index: i, href, method: "onclick-mid" });
        }
      }

      // 우선순위에 따라 결과 반환
      if (results.length > 0) {
        // bridge-mid가 우선
        const bridgeResult = results.find(r => r.method === "bridge-mid");
        if (bridgeResult) {
          return { found: true, ...bridgeResult };
        }
        // 그 외 첫 번째 결과
        return { found: true, ...results[0] };
      }

      // 찾지 못함 - 디버깅용 정보 수집
      const smartstoreLinks = links.filter(l =>
        l.href?.includes("smartstore.naver.com") || l.href?.includes("brand.naver.com")
      ).slice(0, 3).map(l => l.href?.substring(0, 80));

      return {
        found: false,
        index: -1,
        href: "",
        method: "not-found",
        debug: { totalLinks: links.length, smartstoreLinks }
      };
    }, mid);

    if (!linkInfo.found) {
      this.log(`[PacketEngine] MID ${mid} not found. Debug: ${JSON.stringify((linkInfo as any).debug || {})}`);
      return false;
    }

    this.log(`[PacketEngine] Found link: method=${linkInfo.method}, href=${linkInfo.href?.substring(0, 60)}`);

    // 링크 클릭 (새 탭 처리)
    const context = this.hybrid.getContext();
    if (!context) return false;

    try {
      const [newPage] = await Promise.all([
        context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
        page.evaluate((index: number) => {
          const links = Array.from(document.querySelectorAll("a"));
          if (links[index]) {
            (links[index] as HTMLAnchorElement).click();
          }
        }, linkInfo.index),
      ]);

      if (newPage) {
        this.log("[PacketEngine] New tab opened, waiting for load");
        await newPage.waitForLoadState("domcontentloaded", { timeout: 10000 });
        // 새 탭을 현재 페이지로 설정 (verify에서 사용)
        this.hybrid.setPage(newPage);
      } else {
        this.log("[PacketEngine] No new tab, checking current page");
        await this.timing.sleep(2000);
      }
    } catch (e: any) {
      this.log(`[PacketEngine] Click handling: ${e.message}`);
    }

    return true;
  }

  /**
   * page.request.fetch()를 사용한 네트워크 요청
   * (Chrome TLS fingerprint 사용)
   */
  async fetch(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    if (!this.replayer.hasPage()) {
      throw new Error("Engine not initialized. Call initialize() first.");
    }

    const response = await this.replayer.executeRequest(
      url,
      options?.method || "GET",
      options?.headers || {},
      options?.body
    );

    return {
      status: response.status,
      body: response.body || "",
      headers: response.headers,
    };
  }

  /**
   * 페이지 가져오기
   */
  getPage(): Page | null {
    return this.hybrid.getPage();
  }

  /**
   * 브라우저 가져오기
   */
  getBrowser(): Browser | null {
    return this.hybrid.getBrowser();
  }

  /**
   * HybridContext 가져오기
   */
  getHybridContext(): HybridContext {
    return this.hybrid;
  }

  /**
   * RequestReplayer 가져오기
   */
  getReplayer(): RequestReplayer {
    return this.replayer;
  }

  /**
   * DeviceIdGenerator 가져오기
   */
  getDeviceIdGenerator(): DeviceIdGenerator {
    return this.deviceId;
  }

  /**
   * HeaderBuilder 가져오기
   */
  getHeaderBuilder(): HeaderBuilder {
    return this.headers;
  }

  /**
   * MultiSendEngine 가져오기
   */
  getMultiSendEngine(): MultiSendEngine {
    return this.multiSend;
  }

  /**
   * BehaviorLogBuilder 가져오기
   */
  getBehaviorLogBuilder(): BehaviorLogBuilder {
    return this.logBuilder;
  }

  /**
   * 행동 로그 재생 (상품 페이지 진입 후 사용)
   *
   * 브라우저가 1번 진입 후, 패킷으로 행동 로그를 다중 전송
   * - viewProduct: 조회 로그
   * - scroll: 스크롤 로그
   * - dwell: 체류 시간 로그
   */
  async replayBehaviorLogs(
    plan: BehaviorReplayPlan,
    nvMid: string,
    page_uid?: string
  ): Promise<{
    success: boolean;
    results: {
      viewProduct: MultiSendResult;
      scroll: MultiSendResult;
      dwell: MultiSendResult;
      expose: MultiSendResult;
    };
    totalDuration: number;
  }> {
    const page = this.hybrid.getPage();
    if (!page) {
      return {
        success: false,
        results: {
          viewProduct: this.emptyResult(),
          scroll: this.emptyResult(),
          dwell: this.emptyResult(),
          expose: this.emptyResult(),
        },
        totalDuration: 0,
      };
    }

    // MultiSendEngine에 페이지 설정
    this.multiSend.setPage(page);

    // 캡처된 템플릿을 Builder에 설정
    const templates = this.hybrid.getCapturedTemplates();
    this.log(`[PacketEngine] Templates available: ${templates.size}`);
    for (const [type, template] of Array.from(templates.entries())) {
      this.log(`[PacketEngine] Setting template: ${type} -> ${template.url.substring(0, 50)}`);
      this.logBuilder.setTemplate(type, template);
    }
    this.log(`[PacketEngine] Builder has: ${this.logBuilder.getAvailableTypes().join(", ")}`);

    // 세션 상태 설정
    this.logBuilder.setSessionState(this.hybrid.getSessionState());

    // page_uid 결정
    const actualPageUid = page_uid || this.deviceId.generatePageUid();

    this.log(`[PacketEngine] Starting behavior replay: viewProduct=${plan.viewProduct}, scroll=${plan.scroll}`);

    // 재생 실행
    const results = await this.multiSend.executeReplayPlan(plan, {
      nvMid,
      page_uid: actualPageUid,
      timestamp: Date.now(),
    });

    const success =
      results.viewProduct.failed === 0 &&
      results.scroll.failed === 0;

    this.log(`[PacketEngine] Behavior replay complete: success=${success}, duration=${results.totalDuration}ms`);

    return {
      success,
      results: {
        viewProduct: results.viewProduct,
        scroll: results.scroll,
        dwell: results.dwell,
        expose: results.expose,
      },
      totalDuration: results.totalDuration,
    };
  }

  /**
   * 빈 결과
   */
  private emptyResult(): MultiSendResult {
    return { total: 0, success: 0, failed: 0, duration: 0, errors: [] };
  }

  /**
   * 정리
   */
  async cleanup(): Promise<void> {
    await this.hybrid.cleanup();
    this.initialized = false;
    this.log("[PacketEngine] Cleaned up");
  }

  /**
   * 분석 도구로 로그 분석
   */
  async analyzeNetworkLogs(logsDir: string): Promise<void> {
    this.analyzer.loadFromDirectory(logsDir, "success");
    const result = this.analyzer.analyzeMultiple();

    this.log(`[PacketEngine] Analyzed ${result.totalCaptures} captures`);
    this.log(`[PacketEngine] Critical patterns: ${result.criticalPatterns.length}`);
    this.log(`[PacketEngine] Optional patterns: ${result.optionalPatterns.length}`);

    this.patterns = [...result.criticalPatterns, ...result.optionalPatterns];
  }

  /**
   * 패턴을 파일로 저장
   */
  async savePatterns(outputPath: string): Promise<void> {
    this.analyzer.exportPatterns(outputPath);
  }
}

/**
 * 패킷 엔진 실행 헬퍼 함수
 * (v7_engine의 runV7Engine과 유사한 인터페이스)
 */
export async function runPacketEngine(
  page: Page,
  browser: Browser,
  product: Product,
  ctx: RunContext,
  workerId?: number
): Promise<PacketEngineResult> {
  // 기존 브라우저/페이지 사용하는 경우 별도 처리 필요
  // 현재는 PacketEngine 클래스 직접 사용 권장
  const engine = new PacketEngine(
    { headless: false },
    (msg: string) => ctx.log(msg)
  );

  try {
    const result = await engine.run(product, ctx);
    return result;
  } finally {
    await engine.cleanup();
  }
}
