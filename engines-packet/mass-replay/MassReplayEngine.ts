/**
 * Mass Replay Engine - 대량 패킷 리플레이 시스템
 *
 * 각 요청이 다른 사용자처럼 보이도록:
 * 1. IP 다양성 (프록시 풀)
 * 2. 디바이스 핑거프린트 다양성
 * 3. 세션/쿠키 다양성
 * 4. 타이밍 다양성
 * 5. 동시 처리 (Worker Pool)
 */

import { IdentityGenerator, UserIdentity } from "./IdentityGenerator";
import { ProxyPool, ProxyInfo } from "./ProxyPool";
import { RequestBuilder } from "./RequestBuilder";

// ============================================================
//  타입 정의
// ============================================================

export interface MassReplayConfig {
  // 동시성
  concurrency: number;           // 동시 워커 수 (기본: 50)
  maxRequestsPerSecond: number;  // 초당 최대 요청 수 (속도 제한)

  // 프록시
  proxyPool: ProxyInfo[];        // 프록시 목록
  rotateProxyEvery: number;      // N 요청마다 프록시 변경

  // 타이밍
  minDelayMs: number;            // 최소 요청 간격
  maxDelayMs: number;            // 최대 요청 간격
  dwellTimeRange: [number, number];  // 체류 시간 범위 [min, max] ms

  // 재시도
  maxRetries: number;
  retryDelayMs: number;
}

export interface ReplayTask {
  productId: string;
  merchantId: string;
  channelNo: string;
  categoryId: string;
  // 추가 메타데이터
  searchKeyword?: string;
  referer?: string;
}

export interface ReplayResult {
  taskId: string;
  productId: string;
  success: boolean;
  statusCode?: number;
  duration: number;
  identity: Partial<UserIdentity>;
  proxy?: string;
  error?: string;
  timestamp: number;
}

// ============================================================
//  Worker 클래스
// ============================================================

class ReplayWorker {
  private id: number;
  private identityGen: IdentityGenerator;
  private proxyPool: ProxyPool;
  private requestBuilder: RequestBuilder;
  private config: MassReplayConfig;
  private requestCount: number = 0;
  private currentProxy: ProxyInfo | null = null;

  constructor(
    id: number,
    identityGen: IdentityGenerator,
    proxyPool: ProxyPool,
    config: MassReplayConfig
  ) {
    this.id = id;
    this.identityGen = identityGen;
    this.proxyPool = proxyPool;
    this.config = config;
    this.requestBuilder = new RequestBuilder();
  }

  async execute(task: ReplayTask): Promise<ReplayResult> {
    const startTime = Date.now();
    const taskId = `${this.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // 1. 새 Identity 생성 (매 요청마다 다른 사람)
      const identity = this.identityGen.generate();

      // 2. 프록시 선택/로테이션
      if (
        !this.currentProxy ||
        this.requestCount % this.config.rotateProxyEvery === 0
      ) {
        this.currentProxy = this.proxyPool.getNext();
      }
      this.requestCount++;

      // 3. 랜덤 지연 (타이밍 다양성)
      const delay = this.randomDelay();
      await this.sleep(delay);

      // 4. product-logs 요청 빌드 및 전송
      const productLogResult = await this.sendProductLog(task, identity);

      // 5. 체류 시간 시뮬레이션
      const dwellTime = this.randomDwell();
      await this.sleep(dwellTime);

      // 6. 추가 행동 로그 (선택적)
      // await this.sendBehaviorLogs(task, identity, dwellTime);

      return {
        taskId,
        productId: task.productId,
        success: productLogResult.success,
        statusCode: productLogResult.statusCode,
        duration: Date.now() - startTime,
        identity: {
          userAgent: identity.userAgent.substring(0, 50) + "...",
          deviceId: identity.deviceId,
          screenResolution: identity.screenResolution,
        },
        proxy: this.currentProxy?.host,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        taskId,
        productId: task.productId,
        success: false,
        duration: Date.now() - startTime,
        identity: {},
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  private async sendProductLog(
    task: ReplayTask,
    identity: UserIdentity
  ): Promise<{ success: boolean; statusCode?: number }> {
    const url = `https://smartstore.naver.com/i/v1/product-logs/${task.productId}`;

    const headers = this.requestBuilder.buildHeaders(identity, {
      referer: task.referer || `https://search.shopping.naver.com/search/all?query=${task.searchKeyword || "상품"}`,
      origin: "https://smartstore.naver.com",
    });

    const body = this.requestBuilder.buildProductLogBody(task, identity);

    // HTTP 요청 (프록시 사용)
    const response = await this.httpRequest(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      proxy: this.currentProxy,
    });

    return {
      success: response.status >= 200 && response.status < 300,
      statusCode: response.status,
    };
  }

  private async httpRequest(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      proxy?: ProxyInfo | null;
    }
  ): Promise<{ status: number; body: string }> {
    // 실제 구현에서는 undici, got, axios 등 사용
    // 프록시 지원 필요

    // 임시 구현 (fetch 사용)
    const fetchOptions: RequestInit = {
      method: options.method,
      headers: options.headers,
      body: options.body,
    };

    // TODO: 프록시 적용 (node-fetch-with-proxy 또는 undici ProxyAgent)
    // if (options.proxy) {
    //   fetchOptions.agent = new ProxyAgent(options.proxy.url);
    // }

    try {
      const response = await fetch(url, fetchOptions);
      const body = await response.text();
      return { status: response.status, body };
    } catch (error: any) {
      throw new Error(`HTTP request failed: ${error.message}`);
    }
  }

  private randomDelay(): number {
    return (
      this.config.minDelayMs +
      Math.random() * (this.config.maxDelayMs - this.config.minDelayMs)
    );
  }

  private randomDwell(): number {
    const [min, max] = this.config.dwellTimeRange;
    return min + Math.random() * (max - min);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ============================================================
//  Main Engine
// ============================================================

export class MassReplayEngine {
  private config: MassReplayConfig;
  private identityGen: IdentityGenerator;
  private proxyPool: ProxyPool;
  private workers: ReplayWorker[] = [];
  private taskQueue: ReplayTask[] = [];
  private results: ReplayResult[] = [];
  private isRunning: boolean = false;
  private stats = {
    total: 0,
    success: 0,
    failed: 0,
    startTime: 0,
  };

  constructor(config: Partial<MassReplayConfig> = {}) {
    this.config = {
      concurrency: 50,
      maxRequestsPerSecond: 100,
      proxyPool: [],
      rotateProxyEvery: 5,
      minDelayMs: 100,
      maxDelayMs: 500,
      dwellTimeRange: [5000, 15000],
      maxRetries: 2,
      retryDelayMs: 1000,
      ...config,
    };

    this.identityGen = new IdentityGenerator();
    this.proxyPool = new ProxyPool(this.config.proxyPool);

    // Worker 초기화
    for (let i = 0; i < this.config.concurrency; i++) {
      this.workers.push(
        new ReplayWorker(i, this.identityGen, this.proxyPool, this.config)
      );
    }
  }

  /**
   * 대량 작업 실행
   */
  async execute(tasks: ReplayTask[]): Promise<ReplayResult[]> {
    this.taskQueue = [...tasks];
    this.results = [];
    this.stats = {
      total: tasks.length,
      success: 0,
      failed: 0,
      startTime: Date.now(),
    };
    this.isRunning = true;

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                   Mass Replay Engine Started                   ║
╠════════════════════════════════════════════════════════════════╣
║  Tasks: ${tasks.length.toString().padStart(6)}                                            ║
║  Workers: ${this.config.concurrency.toString().padStart(4)}                                            ║
║  Proxies: ${this.config.proxyPool.length.toString().padStart(4)}                                            ║
║  Rate: ${this.config.maxRequestsPerSecond.toString().padStart(5)} req/s                                       ║
╚════════════════════════════════════════════════════════════════╝
    `);

    // Rate limiter
    const rateLimiter = this.createRateLimiter();

    // Worker 실행
    const workerPromises = this.workers.map(async (worker, idx) => {
      while (this.taskQueue.length > 0 && this.isRunning) {
        await rateLimiter();

        const task = this.taskQueue.shift();
        if (!task) break;

        const result = await worker.execute(task);
        this.results.push(result);

        if (result.success) {
          this.stats.success++;
        } else {
          this.stats.failed++;
        }

        // 진행률 출력 (10% 단위)
        const progress = Math.floor(
          ((this.stats.success + this.stats.failed) / this.stats.total) * 100
        );
        if (progress % 10 === 0 && progress > 0) {
          this.printProgress();
        }
      }
    });

    await Promise.all(workerPromises);
    this.isRunning = false;

    this.printFinalStats();
    return this.results;
  }

  /**
   * Rate Limiter 생성
   */
  private createRateLimiter(): () => Promise<void> {
    const intervalMs = 1000 / this.config.maxRequestsPerSecond;
    let lastRequestTime = 0;
    let pendingRequests = 0;

    return async () => {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;

      if (timeSinceLastRequest < intervalMs) {
        await new Promise((r) =>
          setTimeout(r, intervalMs - timeSinceLastRequest)
        );
      }

      lastRequestTime = Date.now();
    };
  }

  private printProgress(): void {
    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const rate = (this.stats.success + this.stats.failed) / elapsed;
    const successRate =
      this.stats.total > 0
        ? ((this.stats.success / (this.stats.success + this.stats.failed)) * 100).toFixed(1)
        : "0";

    console.log(
      `[Progress] ${this.stats.success + this.stats.failed}/${this.stats.total} ` +
        `(${successRate}% success) | ${rate.toFixed(1)} req/s | ` +
        `${Math.round(elapsed)}s elapsed`
    );
  }

  private printFinalStats(): void {
    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const rate = this.stats.total / elapsed;
    const successRate =
      this.stats.total > 0
        ? ((this.stats.success / this.stats.total) * 100).toFixed(1)
        : "0";

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                   Mass Replay Completed                        ║
╠════════════════════════════════════════════════════════════════╣
║  Total:    ${this.stats.total.toString().padStart(6)}                                          ║
║  Success:  ${this.stats.success.toString().padStart(6)} (${successRate.padStart(5)}%)                                  ║
║  Failed:   ${this.stats.failed.toString().padStart(6)}                                          ║
║  Duration: ${elapsed.toFixed(1).padStart(6)}s                                         ║
║  Rate:     ${rate.toFixed(1).padStart(6)} req/s                                       ║
╚════════════════════════════════════════════════════════════════╝
    `);
  }

  /**
   * 실행 중지
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 결과 조회
   */
  getResults(): ReplayResult[] {
    return this.results;
  }

  /**
   * 통계 조회
   */
  getStats(): typeof this.stats {
    return this.stats;
  }
}

export default MassReplayEngine;
