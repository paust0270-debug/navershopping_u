/**
 * Behavior Log Builder
 *
 * 캡처된 템플릿 기반으로 동적 패킷 생성
 * - timestamp, eventTime 등 동적 필드 업데이트
 * - scrollDepth, dwellTime 랜덤화
 * - 세션 정보 유지 (NNB, NACT, NAC, page_uid)
 */

import type {
  BehaviorLogTemplate,
  BehaviorLogType,
  CapturedBehaviorLog,
  LogFunction,
  SessionState,
} from "../types";

export interface BuiltPacket {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface BuildOptions {
  // 동적 파라미터
  timestamp?: number;
  scrollDepth?: number;     // 0-100
  dwellTime?: number;       // ms
  nvMid?: string;
  page_uid?: string;

  // 세션 정보
  cookies?: string;
  userAgent?: string;
  referer?: string;
}

export class BehaviorLogBuilder {
  private log: LogFunction;
  private templates: Map<BehaviorLogType, BehaviorLogTemplate> = new Map();
  private sessionState?: SessionState;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 세션 상태 설정
   */
  setSessionState(state: SessionState): void {
    this.sessionState = state;
  }

  /**
   * 템플릿 설정
   */
  setTemplate(type: BehaviorLogType, template: BehaviorLogTemplate): void {
    this.templates.set(type, template);
  }

  /**
   * 캡처된 로그에서 템플릿 추출
   */
  extractTemplate(captured: CapturedBehaviorLog): BehaviorLogTemplate {
    return {
      type: captured.type,
      url: captured.url,
      method: captured.method,
      staticHeaders: { ...captured.headers },
      dynamicHeaders: ["x-request-id", "x-timestamp"],
      bodyTemplate: { ...captured.body },
      dynamicFields: ["timestamp", "eventTime", "eltts", "ts", "requestId"],
    };
  }

  /**
   * viewProduct 패킷 빌드
   */
  buildViewProduct(options: BuildOptions): BuiltPacket | null {
    const template = this.templates.get("viewProduct");
    if (!template) {
      this.log("[BehaviorLogBuilder] No viewProduct template");
      return null;
    }

    return this.buildFromTemplate(template, options);
  }

  /**
   * scroll 패킷 빌드
   */
  buildScroll(options: BuildOptions): BuiltPacket | null {
    const template = this.templates.get("scroll");
    if (!template) {
      this.log("[BehaviorLogBuilder] No scroll template");
      return null;
    }

    // scrollDepth 랜덤화 (옵션 없으면)
    const scrollOptions = {
      ...options,
      scrollDepth: options.scrollDepth ?? this.randomBetween(10, 95),
    };

    return this.buildFromTemplate(template, scrollOptions);
  }

  /**
   * dwell 패킷 빌드
   */
  buildDwell(options: BuildOptions): BuiltPacket | null {
    const template = this.templates.get("dwellStart") || this.templates.get("dwellEnd");
    if (!template) {
      this.log("[BehaviorLogBuilder] No dwell template");
      return null;
    }

    // dwellTime 랜덤화 (옵션 없으면)
    const dwellOptions = {
      ...options,
      dwellTime: options.dwellTime ?? this.randomBetween(3000, 15000),
    };

    return this.buildFromTemplate(template, dwellOptions);
  }

  /**
   * expose 패킷 빌드
   */
  buildExpose(options: BuildOptions): BuiltPacket | null {
    const template = this.templates.get("expose");
    if (!template) {
      this.log("[BehaviorLogBuilder] No expose template");
      return null;
    }

    return this.buildFromTemplate(template, options);
  }

  /**
   * 템플릿에서 패킷 빌드
   */
  private buildFromTemplate(
    template: BehaviorLogTemplate,
    options: BuildOptions
  ): BuiltPacket {
    const now = options.timestamp || Date.now();

    // 헤더 빌드
    const headers = { ...template.staticHeaders };

    // 쿠키 업데이트
    if (options.cookies) {
      headers["cookie"] = options.cookies;
    } else if (this.sessionState) {
      headers["cookie"] = this.buildCookieString();
    }

    // User-Agent 업데이트
    if (options.userAgent) {
      headers["user-agent"] = options.userAgent;
    } else if (this.sessionState?.userAgent) {
      headers["user-agent"] = this.sessionState.userAgent;
    }

    // Referer 업데이트
    if (options.referer) {
      headers["referer"] = options.referer;
    }

    // 동적 헤더
    headers["x-request-id"] = this.generateRequestId();

    // Body 빌드
    const body = { ...template.bodyTemplate };

    // 동적 필드 업데이트
    if ("timestamp" in body) body["timestamp"] = now;
    if ("eventTime" in body) body["eventTime"] = now;
    if ("eltts" in body) body["eltts"] = now;
    if ("ts" in body) body["ts"] = now;
    if ("requestId" in body) body["requestId"] = this.generateRequestId();
    if ("req_seq" in body) body["req_seq"] = this.randomBetween(1, 1000);

    // 옵션 파라미터 적용
    if (options.nvMid && "nvMid" in body) body["nvMid"] = options.nvMid;
    if (options.nvMid && "nv_mid" in body) body["nv_mid"] = options.nvMid;
    if (options.page_uid && "page_uid" in body) body["page_uid"] = options.page_uid;
    if (options.scrollDepth !== undefined) {
      if ("depth" in body) body["depth"] = options.scrollDepth;
      if ("scrollDepth" in body) body["scrollDepth"] = options.scrollDepth;
      if ("scroll_depth" in body) body["scroll_depth"] = options.scrollDepth;
    }
    if (options.dwellTime !== undefined) {
      if ("dwellTime" in body) body["dwellTime"] = options.dwellTime;
      if ("dwell_time" in body) body["dwell_time"] = options.dwellTime;
      if ("duration" in body) body["duration"] = options.dwellTime;
    }

    return {
      url: template.url,
      method: template.method,
      headers,
      body: JSON.stringify(body),
    };
  }

  /**
   * 쿠키 문자열 생성
   */
  private buildCookieString(): string {
    if (!this.sessionState?.cookies) return "";

    return this.sessionState.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  /**
   * 요청 ID 생성
   */
  private generateRequestId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * 랜덤 범위
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 여러 패킷 한번에 빌드
   */
  buildBatch(
    type: BehaviorLogType,
    count: number,
    baseOptions: BuildOptions
  ): BuiltPacket[] {
    const packets: BuiltPacket[] = [];
    const baseTime = baseOptions.timestamp || Date.now();

    for (let i = 0; i < count; i++) {
      const options: BuildOptions = {
        ...baseOptions,
        timestamp: baseTime + i * this.randomBetween(50, 150),
        scrollDepth: this.randomBetween(10, 95),
      };

      let packet: BuiltPacket | null = null;

      switch (type) {
        case "viewProduct":
          packet = this.buildViewProduct(options);
          break;
        case "scroll":
          packet = this.buildScroll(options);
          break;
        case "dwellStart":
        case "dwellEnd":
          packet = this.buildDwell(options);
          break;
        case "expose":
          packet = this.buildExpose(options);
          break;
      }

      if (packet) {
        packets.push(packet);
      }
    }

    return packets;
  }

  /**
   * 단일 패킷 빌드 (실시간 타임스탬프용)
   */
  buildSingle(type: BehaviorLogType, options: BuildOptions): BuiltPacket | null {
    switch (type) {
      case "viewProduct":
        return this.buildViewProduct(options);
      case "scroll":
        return this.buildScroll(options);
      case "dwellStart":
      case "dwellEnd":
        return this.buildDwell(options);
      case "expose":
        return this.buildExpose(options);
      default:
        this.log(`[BehaviorLogBuilder] Unknown type: ${type}`);
        return null;
    }
  }

  /**
   * 템플릿 존재 여부 확인
   */
  hasTemplate(type: BehaviorLogType): boolean {
    return this.templates.has(type);
  }

  /**
   * 템플릿 목록
   */
  getAvailableTypes(): BehaviorLogType[] {
    return Array.from(this.templates.keys());
  }
}
