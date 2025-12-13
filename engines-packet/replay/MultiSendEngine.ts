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
  private pixelSendCount: number = 0;  // 디버깅용 카운터
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
   * 픽셀 비콘 URL인지 확인 (Image로 전송해야 하는 URL)
   */
  private isPixelBeaconUrl(url: string): boolean {
    return (
      url.includes("nlog.naver.com") ||
      url.includes("nlog.commerce.naver.com") ||
      url.includes("wcs.naver.net") ||
      url.includes("wcs.naver.com") ||
      url.includes("/n?") ||  // nlog 패턴
      url.includes("/b?")     // wcs 패턴
    );
  }

  /**
   * 단일 패킷 전송 (Chrome TLS)
   */
  private async sendPacket(packet: BuiltPacket): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!this.page) {
      return { success: false, error: "Page not set" };
    }

    try {
      // 픽셀 비콘 URL은 Image로 전송 (CORS 우회)
      if (this.isPixelBeaconUrl(packet.url)) {
        return await this.sendPixelBeacon(packet.url);
      }

      // 일반 API는 fetch로 전송
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
   * 픽셀 URL에 노이즈 적용 (쿼리 파라미터 수정)
   */
  private applyNoiseToPixelUrl(originalUrl: string): string {
    try {
      const url = new URL(originalUrl);
      const now = Date.now();

      // 타임스탬프 관련 파라미터 업데이트
      const timestampParams = ["ts", "t", "eltts", "timestamp", "eventTime", "_t"];
      for (const param of timestampParams) {
        if (url.searchParams.has(param)) {
          url.searchParams.set(param, String(now + Math.floor(Math.random() * 1000)));
        }
      }

      // 랜덤 요청 ID 추가/업데이트
      if (url.searchParams.has("req_seq")) {
        url.searchParams.set("req_seq", String(Math.floor(Math.random() * 10000)));
      }
      if (url.searchParams.has("rnd")) {
        url.searchParams.set("rnd", String(Math.random()));
      }

      // 캐시 버스터 추가 (없으면 추가)
      if (!url.searchParams.has("_")) {
        url.searchParams.set("_", String(now));
      } else {
        url.searchParams.set("_", String(now + Math.floor(Math.random() * 1000)));
      }

      return url.toString();
    } catch {
      // URL 파싱 실패 시 캐시 버스터만 추가
      const separator = originalUrl.includes("?") ? "&" : "?";
      return `${originalUrl}${separator}_=${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
  }

  /**
   * 픽셀 비콘 전송 (Image 방식) - 노이즈 적용
   */
  private async sendPixelBeacon(url: string): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!this.page) {
      return { success: false, error: "Page not set" };
    }

    // 노이즈 적용된 URL 생성
    const noisyUrl = this.applyNoiseToPixelUrl(url);

    // 처음 몇 개만 로그 출력 (디버깅용)
    if (this.pixelSendCount < 3) {
      this.log(`[MultiSendEngine] Pixel URL with noise: ${noisyUrl.substring(0, 100)}...`);
      this.pixelSendCount++;
    }

    try {
      const result = await this.page.evaluate(async (pixelUrl) => {
        return new Promise<{ success: boolean; status?: number; error?: string }>((resolve) => {
          const img = new Image();

          img.onload = () => {
            resolve({ success: true, status: 200 });
          };

          img.onerror = () => {
            // 픽셀 비콘은 실제로 이미지가 아닐 수 있어서 error도 성공으로 처리
            // 서버가 요청을 받았다면 목적 달성
            resolve({ success: true, status: 200 });
          };

          // 타임아웃 설정
          setTimeout(() => {
            resolve({ success: true, status: 200 });  // 타임아웃도 성공으로 (요청은 전송됨)
          }, 3000);

          img.src = pixelUrl;
        });
      }, noisyUrl);

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
   * 특정 타입 로그 다중 전송 (과거 시간 분산)
   * - 타임스탬프를 과거 시간대로 분산하여 자연스러운 트래픽 패턴 생성
   * - spreadHours: 분산할 시간 범위 (기본 6시간)
   */
  async sendBehaviorLog(
    type: BehaviorLogType,
    count: number,
    options: BuildOptions,
    config?: Partial<MultiSendConfig & { spreadHours?: number }>
  ): Promise<MultiSendResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const spreadHours = cfg.spreadHours ?? 6;  // 기본 6시간 분산
    const startTime = Date.now();
    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    this.log(`[MultiSendEngine] Sending ${count} ${type} logs (spread over ${spreadHours}h)`);
    this.log(`[MultiSendEngine] Builder has template: ${this.builder.hasTemplate(type)}`);

    if (!this.builder.hasTemplate(type)) {
      this.log(`[MultiSendEngine] No template for type: ${type}`);
      return {
        total: 0,
        success: 0,
        failed: 0,
        duration: 0,
        errors: [`No template for ${type}`],
      };
    }

    // 과거 시간 분산 타임스탬프 생성
    const now = Date.now();
    const spreadMs = spreadHours * 60 * 60 * 1000;
    const timestamps = this.generateSpreadTimestamps(now, spreadMs, count);

    for (let i = 0; i < count; i++) {
      const fakeTimestamp = timestamps[i];
      const realtimeOptions: BuildOptions = {
        ...options,
        timestamp: fakeTimestamp,
        scrollDepth: this.randomBetween(10, 95),
        dwellTime: this.randomBetween(3000, 25000),  // 체류시간도 랜덤
      };

      const packet = this.builder.buildSingle(type, realtimeOptions);

      if (!packet) {
        failed++;
        errors.push(`Packet ${i}: Failed to build`);
        continue;
      }

      const result = await this.sendPacket(packet);

      if (result.success) {
        success++;
      } else {
        failed++;
        const errMsg = `Packet ${i}: ${result.error || `Status ${result.status}`}`;
        errors.push(errMsg);
        if (i < 3) {
          this.log(`[MultiSendEngine] ${errMsg}`);
        }

        if (cfg.failFast) {
          this.log(`[MultiSendEngine] FailFast triggered at packet ${i}`);
          break;
        }
      }

      // 지터 적용된 딜레이 (마지막 패킷 제외)
      if (i < count - 1) {
        const delay = this.getJitteredDelay(cfg.minDelay, cfg.maxDelay, cfg.jitterPercent);
        await this.sleep(delay);
      }
    }

    const duration = Date.now() - startTime;
    this.log(`[MultiSendEngine] Complete: ${success}/${count} in ${duration}ms`);

    return {
      total: count,
      success,
      failed,
      duration,
      errors,
    };
  }

  /**
   * 과거 시간대로 분산된 타임스탬프 배열 생성
   * - 완전 균등 분포가 아닌 자연스러운 클러스터링 적용
   * - 피크 타임(오전 10-12시, 오후 2-4시, 저녁 8-10시) 가중치
   */
  private generateSpreadTimestamps(now: number, spreadMs: number, count: number): number[] {
    const timestamps: number[] = [];
    const startTime = now - spreadMs;

    for (let i = 0; i < count; i++) {
      // 기본 분산 + 랜덤 지터
      const baseOffset = (spreadMs / count) * i;
      const jitter = (Math.random() - 0.5) * (spreadMs / count) * 0.8;
      let timestamp = startTime + baseOffset + jitter;

      // 피크 타임 가중치 (선택적)
      const hour = new Date(timestamp).getHours();
      if (this.isPeakHour(hour) && Math.random() < 0.3) {
        // 피크 타임에 약간 더 몰리게
        timestamp += this.randomBetween(-30, 30) * 60 * 1000;
      }

      // 현재 시간을 넘지 않도록
      timestamp = Math.min(timestamp, now - 1000);

      timestamps.push(Math.floor(timestamp));
    }

    // 시간순 정렬 (선택적 - 자연스러움을 위해)
    timestamps.sort((a, b) => a - b);

    // 첫 번째와 마지막 타임스탬프 로그
    if (timestamps.length > 0) {
      const firstTime = new Date(timestamps[0]).toLocaleTimeString();
      const lastTime = new Date(timestamps[timestamps.length - 1]).toLocaleTimeString();
      this.log(`[MultiSendEngine] Timestamp range: ${firstTime} ~ ${lastTime}`);
    }

    return timestamps;
  }

  /**
   * 피크 타임 여부 (쇼핑 트래픽 패턴)
   */
  private isPeakHour(hour: number): boolean {
    return (
      (hour >= 10 && hour <= 12) ||  // 오전 피크
      (hour >= 14 && hour <= 16) ||  // 오후 피크
      (hour >= 20 && hour <= 22)     // 저녁 피크
    );
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
   * 픽셀 비콘 단일 전송 (외부 호출용 - GET Image beacon)
   * nlog.naver.com, nlog.commerce 등에 사용
   */
  async sendSinglePixelBeacon(url: string): Promise<{ success: boolean; status?: number; error?: string }> {
    return this.sendPixelBeacon(url);
  }

  /**
   * Product-logs POST 전송 (조회수 핵심 API)
   *
   * @param capturedLog - 캡처된 product-logs 요청
   * @param behaviorData - 행동 데이터 (dwellTime, scrollDepth)
   */
  async sendProductLogPost(
    capturedLog: { url: string; headers: Record<string, string>; body: any },
    behaviorData: { dwellTime: number; scrollDepth: number }
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!this.page) {
      return { success: false, error: "Page not set" };
    }

    try {
      const now = Date.now();

      const result = await this.page.evaluate(
        async ({ url, headers, body, behavior, timestamp }) => {
          try {
            // body가 문자열이면 파싱, 아니면 그대로 사용
            let bodyObj = typeof body === "string" ? JSON.parse(body) : body;

            // 행동 데이터 및 타임스탬프 업데이트
            const updatedBody = {
              ...bodyObj,
              dwellTime: behavior.dwellTime,
              scrollDepth: behavior.scrollDepth,
              timestamp: timestamp,
              eventTime: timestamp,
            };

            // 헤더 정리 (content-length 제거 - 자동 계산됨)
            const cleanHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(headers)) {
              const lowerKey = key.toLowerCase();
              if (lowerKey !== "content-length" && lowerKey !== "host") {
                cleanHeaders[key] = value as string;
              }
            }
            cleanHeaders["content-type"] = "application/json";

            const response = await fetch(url, {
              method: "POST",
              headers: cleanHeaders,
              body: JSON.stringify(updatedBody),
              credentials: "include" as RequestCredentials,
            });

            return { success: response.ok, status: response.status };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        {
          url: capturedLog.url,
          headers: capturedLog.headers,
          body: capturedLog.body,
          behavior: behaviorData,
          timestamp: now,
        }
      );

      this.log(`[MultiSendEngine] ProductLog POST: ${result.status} (dwell=${behaviorData.dwellTime}, scroll=${behaviorData.scrollDepth})`);
      return result;
    } catch (e: any) {
      return { success: false, error: e.message };
    }
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
