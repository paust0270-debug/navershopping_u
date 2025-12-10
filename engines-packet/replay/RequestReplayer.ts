/**
 * Request Replayer (Patchright Edition)
 *
 * HTTP 요청 실행 - page.request.fetch() 사용
 * - Native fetch 금지 → Patchright Request API 전면 사용
 * - Chrome/BoringSSL TLS fingerprint 유지
 * - Set-Cookie 응답 처리
 * - 재시도 로직
 */

import type { Page, APIRequestContext, APIResponse } from "patchright";
import type {
  ReplayRequest,
  ReplayResponse,
  ReplayResult,
  ReplayConfig,
  SessionState,
  LogFunction,
} from "../types";
import { SessionManager } from "../session/SessionManager";
import { HeaderBuilder } from "../session/HeaderBuilder";
import { TimingSimulator } from "./TimingSimulator";
import { RequestQueue } from "./RequestQueue";

export class RequestReplayer {
  private log: LogFunction;
  private config: ReplayConfig;
  private session: SessionManager;
  private headers: HeaderBuilder;
  private timing: TimingSimulator;
  private queue: RequestQueue;
  private baseTime: number = 0;

  // Patchright Request Context
  private page: Page | null = null;
  private requestContext: APIRequestContext | null = null;

  constructor(
    config: ReplayConfig,
    sessionManager?: SessionManager,
    logFn?: LogFunction
  ) {
    this.log = logFn || console.log;
    this.config = config;
    this.session = sessionManager || new SessionManager(logFn);
    this.headers = new HeaderBuilder(logFn);
    this.timing = new TimingSimulator(logFn);
    this.queue = new RequestQueue(
      {
        maxConcurrency: config.maxConcurrency,
        retryCount: config.retryCount,
        retryDelay: config.retryDelay,
      },
      logFn
    );
  }

  /**
   * Patchright Page 설정 (필수)
   * 모든 요청은 이 Page의 request context를 사용
   */
  setPage(page: Page): void {
    this.page = page;
    this.requestContext = page.request;
    this.log("[RequestReplayer] Page context set - using Chrome TLS");
  }

  /**
   * 직접 Request Context 설정
   */
  setRequestContext(context: APIRequestContext): void {
    this.requestContext = context;
    this.log("[RequestReplayer] Request context set directly");
  }

  /**
   * 세션 매니저 설정
   */
  setSessionManager(session: SessionManager): void {
    this.session = session;
  }

  /**
   * 단일 요청 실행 (page.request.fetch 사용)
   */
  async executeRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<ReplayResponse> {
    const startTime = Date.now();
    const requestId = `req_${startTime}`;

    // Request Context 확인
    if (!this.requestContext) {
      return {
        requestId,
        url,
        status: 0,
        statusText: "No Request Context",
        headers: {},
        duration: 0,
        success: false,
        error: "Page not set. Call setPage() first.",
      };
    }

    try {
      // 스킵 패턴 확인
      if (this.shouldSkip(url)) {
        return {
          requestId,
          url,
          status: 0,
          statusText: "Skipped",
          headers: {},
          duration: 0,
          success: true,
        };
      }

      // Patchright page.request.fetch() 사용 (Chrome TLS)
      const response = await this.requestContext.fetch(url, {
        method,
        headers,
        data: method !== "GET" && method !== "HEAD" ? body : undefined,
        timeout: this.config.timeout,
        failOnStatusCode: false, // 에러 코드도 처리
        ignoreHTTPSErrors: false,
        maxRedirects: 10,
      });

      const duration = Date.now() - startTime;

      // 응답 헤더 파싱
      const responseHeaders = this.parseHeaders(response);

      // Set-Cookie 처리 (중요!)
      this.processSetCookies(responseHeaders, url);

      // 응답 본문 (선택적)
      let responseBody: string | undefined;
      const contentType = responseHeaders["content-type"] || "";
      if (
        contentType.includes("json") ||
        contentType.includes("text") ||
        contentType.includes("html")
      ) {
        try {
          responseBody = await response.text();
        } catch {
          // 본문 읽기 실패 무시
        }
      }

      const isSuccess =
        response.ok() || this.isCriticalSuccess(url, response.status());

      return {
        requestId,
        url,
        status: response.status(),
        statusText: response.statusText(),
        headers: responseHeaders,
        body: responseBody,
        duration,
        success: isSuccess,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      return {
        requestId,
        url,
        status: 0,
        statusText: "Network Error",
        headers: {},
        duration,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * APIResponse에서 헤더 파싱
   */
  private parseHeaders(response: APIResponse): Record<string, string> {
    const headers: Record<string, string> = {};
    const allHeaders = response.headers();

    for (const [key, value] of Object.entries(allHeaders)) {
      headers[key.toLowerCase()] = value;
    }

    return headers;
  }

  /**
   * Set-Cookie 응답 처리
   */
  private processSetCookies(
    headers: Record<string, string>,
    requestUrl: string
  ): void {
    // Patchright는 set-cookie 헤더를 자동으로 처리하지만
    // 우리의 SessionManager도 동기화해야 함
    this.session.processResponseHeaders(headers, requestUrl);
  }

  /**
   * ReplayRequest 실행
   */
  async executeReplayRequest(request: ReplayRequest): Promise<ReplayResponse> {
    // 타이밍 대기 (상대적 타이밍 보존)
    if (this.config.preserveTiming && this.baseTime > 0) {
      const targetTime = request.scheduledTime * this.config.timingMultiplier;
      await this.timing.sleepRelative(targetTime, this.baseTime);
    }

    return this.executeRequest(
      request.url,
      request.method,
      request.headers,
      request.body
    );
  }

  /**
   * GET 요청 헬퍼
   */
  async get(
    url: string,
    headers?: Record<string, string>
  ): Promise<ReplayResponse> {
    const defaultHeaders = this.headers.buildDocumentHeaders(
      { referer: url },
      this.session.getState()
    );
    return this.executeRequest(url, "GET", { ...defaultHeaders, ...headers });
  }

  /**
   * POST 요청 헬퍼
   */
  async post(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<ReplayResponse> {
    const defaultHeaders = this.headers.buildFetchHeaders(
      url,
      {
        contentType: "application/json",
      },
      this.session.getState()
    );
    return this.executeRequest(url, "POST", { ...defaultHeaders, ...headers }, body);
  }

  /**
   * 네이버 검색 요청
   */
  async naverSearch(
    keyword: string,
    referer: string
  ): Promise<ReplayResponse> {
    const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    const headers = this.headers.buildNaverSearchHeaders(
      referer,
      this.session.getState()
    );
    return this.executeRequest(url, "GET", headers);
  }

  /**
   * 배치 실행 (의존성 존중)
   */
  async executeBatch(requests: ReplayRequest[]): Promise<ReplayResult> {
    if (!this.requestContext) {
      throw new Error("Page not set. Call setPage() first.");
    }

    this.baseTime = Date.now();
    this.queue.clear();

    // 큐에 요청 추가
    for (const request of requests) {
      this.queue.add(request, request.pattern.required ? 1 : 0);
    }

    this.log(`[RequestReplayer] Starting batch of ${requests.length} requests`);

    // 큐가 빌 때까지 실행
    while (!this.queue.isComplete()) {
      const ready = this.queue.getReady();

      if (ready.length === 0) {
        // 대기 중인 요청이 있지만 실행 가능한 것이 없음
        if (this.queue.getPendingCount() > 0) {
          await this.timing.sleep(10);
          continue;
        }
        break;
      }

      // 병렬 실행 (maxConcurrency 존중)
      const batch = ready.slice(0, this.config.maxConcurrency);
      const promises = batch.map(async (request) => {
        const response = await this.executeReplayRequest(request);
        this.queue.complete(request.id, response);
        return response;
      });

      await Promise.all(promises);
    }

    const duration = Date.now() - this.baseTime;
    const results = this.queue.getAllResults();
    const failed = this.queue.getFailedRequests();

    return {
      totalRequests: requests.length,
      successfulRequests: results.length - failed.length,
      failedRequests: failed,
      duration,
      sessionState: this.session.getState(),
    };
  }

  /**
   * 스킵 여부 확인
   */
  private shouldSkip(url: string): boolean {
    return this.config.skipPatterns.some((pattern) => {
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return false;
      }
    });
  }

  /**
   * 중요 요청 성공 여부 (특수 케이스 처리)
   */
  private isCriticalSuccess(url: string, status: number): boolean {
    // 204 No Content는 일부 API에서 성공
    if (status === 204) return true;

    // 3xx 리다이렉트도 성공으로 간주
    if (status >= 300 && status < 400) return true;

    return false;
  }

  /**
   * 재시도 로직이 적용된 요청 실행
   */
  async executeWithRetry(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<ReplayResponse> {
    let lastResponse: ReplayResponse | null = null;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      if (attempt > 0) {
        this.log(`[RequestReplayer] Retry ${attempt} for ${url}`);
        await this.timing.sleep(this.config.retryDelay);
      }

      lastResponse = await this.executeRequest(url, method, headers, body);

      if (lastResponse.success) {
        return lastResponse;
      }

      // 4xx 에러는 재시도 안 함
      if (lastResponse.status >= 400 && lastResponse.status < 500) {
        break;
      }
    }

    return lastResponse!;
  }

  /**
   * Page가 설정되어 있는지 확인
   */
  hasPage(): boolean {
    return this.page !== null && this.requestContext !== null;
  }

  /**
   * 현재 세션 상태 가져오기
   */
  getSessionState(): SessionState {
    return this.session.getState();
  }

  /**
   * 타이밍 시뮬레이터 가져오기
   */
  getTiming(): TimingSimulator {
    return this.timing;
  }

  /**
   * 헤더 빌더 가져오기
   */
  getHeaderBuilder(): HeaderBuilder {
    return this.headers;
  }

  /**
   * 세션 매니저 가져오기
   */
  getSessionManager(): SessionManager {
    return this.session;
  }

  /**
   * 큐 상태 가져오기
   */
  getQueueStatus(): {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    return this.queue.getStatus();
  }

  /**
   * 브라우저 컨텍스트의 쿠키를 세션에 동기화
   */
  async syncCookiesFromBrowser(): Promise<void> {
    if (!this.page) return;

    const context = this.page.context();
    await this.session.initFromBrowser(context);
    this.log("[RequestReplayer] Synced cookies from browser");
  }

  /**
   * 세션 쿠키를 브라우저 컨텍스트에 동기화
   */
  async syncCookiesToBrowser(): Promise<void> {
    if (!this.page) return;

    const context = this.page.context();
    const cookies = this.session.toPatchrightCookies();

    if (cookies.length > 0) {
      await context.addCookies(cookies);
      this.log(`[RequestReplayer] Synced ${cookies.length} cookies to browser`);
    }
  }
}
