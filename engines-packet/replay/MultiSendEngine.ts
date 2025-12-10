/**
 * Multi-Send Engine
 *
 * 행동 로그를 빠르게 다중 전송
 * - Chrome TLS 유지 (page.evaluate + fetch)
 * - 타이밍 지터 적용
 * - HTTP/2 멀티플렉싱 활용
 */

import type { Page } from "patchright";
import type {
  MultiSendConfig,
  MultiSendResult,
  BehaviorLogType,
  BehaviorReplayPlan,
  LogFunction,
} from "../types";
import { BehaviorLogBuilder, type BuiltPacket, type BuildOptions } from "../builders/BehaviorLogBuilder";
import { ProductLogBuilder, type BuiltProductLogPacket } from "../builders/ProductLogBuilder";

export class MultiSendEngine {
  private log: LogFunction;
  private page: Page | null = null;
  private builder: BehaviorLogBuilder;
  private defaultConfig: MultiSendConfig = {
    count: 50,
    minDelay: 10,
    maxDelay: 50,
    jitterPercent: 20,
    preserveOrder: true,
    failFast: false,
  };

  constructor(builder: BehaviorLogBuilder, logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.builder = builder;
  }

  /**
   * 페이지 설정 (Chrome TLS 사용을 위해 필요)
   */
  setPage(page: Page): void {
    this.page = page;
    this.log("[MultiSendEngine] Page set");
  }

  /**
   * 단일 패킷 전송 (Chrome TLS)
   */
  private async sendPacket(packet: BuiltPacket): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!this.page) {
      return { success: false, error: "Page not set" };
    }

    try {
      const result = await this.page.evaluate(
        async ({ url, method, headers, body }) => {
          try {
            // GET 요청은 body 없이, POST는 body와 함께
            const fetchOptions: RequestInit = {
              method,
              headers,
              credentials: "include" as RequestCredentials,
            };

            // POST/PUT만 body 추가
            if (method === "POST" || method === "PUT") {
              fetchOptions.body = body;
            }

            const response = await fetch(url, fetchOptions);
            return { success: response.ok, status: response.status };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        packet
      );

      return result;
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 다중 전송
   */
  async multiSend(
    packets: BuiltPacket[],
    config?: Partial<MultiSendConfig>
  ): Promise<MultiSendResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    this.log(`[MultiSendEngine] Starting multiSend: ${packets.length} packets`);

    for (let i = 0; i < packets.length; i++) {
      const packet = packets[i];

      const result = await this.sendPacket(packet);

      if (result.success) {
        success++;
      } else {
        failed++;
        const errMsg = `Packet ${i}: ${result.error || `Status ${result.status}`}`;
        errors.push(errMsg);
        if (i < 3) {  // 처음 3개 에러만 로그
          this.log(`[MultiSendEngine] ${errMsg}`);
        }

        if (cfg.failFast) {
          this.log(`[MultiSendEngine] FailFast triggered at packet ${i}`);
          break;
        }
      }

      // 지터 적용된 딜레이
      if (i < packets.length - 1) {
        const delay = this.getJitteredDelay(cfg.minDelay, cfg.maxDelay, cfg.jitterPercent);
        await this.sleep(delay);
      }
    }

    const duration = Date.now() - startTime;

    this.log(`[MultiSendEngine] Complete: ${success}/${packets.length} in ${duration}ms`);

    return {
      total: packets.length,
      success,
      failed,
      duration,
      errors,
    };
  }

  /**
   * 특정 타입 로그 다중 전송
   */
  async sendBehaviorLog(
    type: BehaviorLogType,
    count: number,
    options: BuildOptions,
    config?: Partial<MultiSendConfig>
  ): Promise<MultiSendResult> {
    this.log(`[MultiSendEngine] Building ${count} packets for type: ${type}`);
    this.log(`[MultiSendEngine] Builder has template: ${this.builder.hasTemplate(type)}`);

    const packets = this.builder.buildBatch(type, count, options);

    this.log(`[MultiSendEngine] Built ${packets.length} packets`);

    if (packets.length === 0) {
      this.log(`[MultiSendEngine] No packets built for type: ${type}`);
      return {
        total: 0,
        success: 0,
        failed: 0,
        duration: 0,
        errors: [`No template for ${type}`],
      };
    }

    return this.multiSend(packets, config);
  }

  /**
   * 재생 계획 실행
   */
  async executeReplayPlan(
    plan: BehaviorReplayPlan,
    options: BuildOptions,
    config?: Partial<MultiSendConfig>
  ): Promise<{
    viewProduct: MultiSendResult;
    scroll: MultiSendResult;
    dwell: MultiSendResult;
    expose: MultiSendResult;
    totalDuration: number;
  }> {
    const startTime = Date.now();

    this.log(`[MultiSendEngine] Executing replay plan:`, plan);

    // viewProduct 전송
    const viewProductResult = plan.viewProduct > 0
      ? await this.sendBehaviorLog("viewProduct", plan.viewProduct, options, config)
      : this.emptyResult();

    // scroll 전송
    const scrollResult = plan.scroll > 0
      ? await this.sendBehaviorLog("scroll", plan.scroll, options, config)
      : this.emptyResult();

    // dwell 전송
    const dwellResult = plan.dwell > 0
      ? await this.sendBehaviorLog("dwellStart", plan.dwell, options, config)
      : this.emptyResult();

    // expose 전송
    const exposeResult = plan.expose > 0
      ? await this.sendBehaviorLog("expose", plan.expose, options, config)
      : this.emptyResult();

    const totalDuration = Date.now() - startTime;

    this.log(`[MultiSendEngine] Replay plan complete in ${totalDuration}ms`);

    return {
      viewProduct: viewProductResult,
      scroll: scrollResult,
      dwell: dwellResult,
      expose: exposeResult,
      totalDuration,
    };
  }

  /**
   * 빈 결과 생성
   */
  private emptyResult(): MultiSendResult {
    return {
      total: 0,
      success: 0,
      failed: 0,
      duration: 0,
      errors: [],
    };
  }

  /**
   * 지터 적용된 딜레이 계산
   */
  private getJitteredDelay(min: number, max: number, jitterPercent: number): number {
    const base = this.randomBetween(min, max);
    const jitter = base * (jitterPercent / 100) * (Math.random() - 0.5) * 2;
    return Math.max(1, Math.round(base + jitter));
  }

  /**
   * 랜덤 범위
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 대기
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 빠른 버스트 모드 (최소 딜레이)
   */
  async burstSend(
    type: BehaviorLogType,
    count: number,
    options: BuildOptions
  ): Promise<MultiSendResult> {
    return this.sendBehaviorLog(type, count, options, {
      minDelay: 5,
      maxDelay: 15,
      jitterPercent: 10,
    });
  }

  /**
   * 사람처럼 천천히 전송
   */
  async humanLikeSend(
    type: BehaviorLogType,
    count: number,
    options: BuildOptions
  ): Promise<MultiSendResult> {
    return this.sendBehaviorLog(type, count, options, {
      minDelay: 100,
      maxDelay: 500,
      jitterPercent: 30,
    });
  }

  /**
   * Product Log 패킷 전송 (핵심 조회수 API)
   */
  private async sendProductLogPacket(
    packet: BuiltProductLogPacket
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!this.page) {
      return { success: false, error: "Page not set" };
    }

    try {
      const result = await this.page.evaluate(
        async ({ url, method, headers, body }) => {
          try {
            const response = await fetch(url, {
              method,
              headers,
              body,
              credentials: "include" as RequestCredentials,
            });
            return { success: response.ok, status: response.status };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        packet
      );

      return result;
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Product Log 다중 전송 (상품 조회수 증가)
   */
  async sendProductLogs(
    builder: ProductLogBuilder,
    count: number,
    config?: Partial<MultiSendConfig>
  ): Promise<MultiSendResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    if (!builder.hasTemplate()) {
      this.log("[MultiSendEngine] ProductLogBuilder has no template");
      return {
        total: 0,
        success: 0,
        failed: 0,
        duration: 0,
        errors: ["No product-log template"],
      };
    }

    this.log(`[MultiSendEngine] Sending ${count} product-logs`);

    for (let i = 0; i < count; i++) {
      const packet = builder.build();
      if (!packet) {
        failed++;
        errors.push(`Packet ${i}: Failed to build`);
        continue;
      }

      const result = await this.sendProductLogPacket(packet);

      if (result.success) {
        success++;
        if (success <= 3 || success % 10 === 0) {
          this.log(`[MultiSendEngine] ProductLog ${success}/${count} sent ✅`);
        }
      } else {
        failed++;
        const errMsg = `Packet ${i}: ${result.error || `Status ${result.status}`}`;
        errors.push(errMsg);
        if (failed <= 3) {
          this.log(`[MultiSendEngine] ProductLog failed: ${errMsg}`);
        }

        if (cfg.failFast) {
          this.log(`[MultiSendEngine] FailFast triggered at packet ${i}`);
          break;
        }
      }

      // 지터 적용된 딜레이
      if (i < count - 1) {
        const delay = this.getJitteredDelay(cfg.minDelay, cfg.maxDelay, cfg.jitterPercent);
        await this.sleep(delay);
      }
    }

    const duration = Date.now() - startTime;
    this.log(`[MultiSendEngine] ProductLogs complete: ${success}/${count} in ${duration}ms`);

    return {
      total: count,
      success,
      failed,
      duration,
      errors,
    };
  }
}
