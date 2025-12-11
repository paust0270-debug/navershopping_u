/**
 * Product Log Builder
 *
 * smartstore.naver.com/i/v1/product-logs API 패킷 빌더
 * - 상품 조회수 증가의 핵심 API
 * - 캡처된 템플릿에서 동적 필드 변경
 */

import type { LogFunction } from "../types";

export interface ProductLogTemplate {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: ProductLogBody;
}

export interface ProductLogBody {
  id: string;
  channel: {
    accountNo: number;
    channelNo: string;
    channelUid: string;
    channelName: string;
    representName: string;
    channelSiteUrl: string;
    channelSiteFullUrl: string;
    channelSiteMobileUrl: string;
    accountId: string;
    naverPaySellerNo: string;
    sellerExternalStatusType: string;
    logoWidth: number;
    logoHeight: number;
    logoUrl: string;
    channelTypeCode: string;
  };
  channelServiceType: string;
  category: {
    categoryId: string;
    categoryName: string;
    category1Id: string;
    category2Id: string;
    category3Id: string;
    category1Name: string;
    category2Name: string;
    category3Name: string;
    wholeCategoryId: string;
    wholeCategoryName: string;
    categoryLevel: number;
    lastLevel: boolean;
    sortOrder: number;
    validCategory: boolean;
    receiptIssue: boolean;
    exceptionalCategoryTypes: string[];
    pointAccumulationYn: boolean;
  };
  groupId: string | null;
  tr: string;
  planNo: string;
  referer: string;
}

export interface BuiltProductLogPacket {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;  // JSON stringified
}

export class ProductLogBuilder {
  private log: LogFunction;
  private template: ProductLogTemplate | null = null;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 캡처된 로그에서 템플릿 설정
   */
  setTemplateFromCapture(captured: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }): void {
    this.template = {
      url: captured.url,
      method: captured.method,
      headers: { ...captured.headers },
      body: captured.body as ProductLogBody,
    };
    this.log("[ProductLogBuilder] Template set from captured log");
  }

  /**
   * 템플릿이 있는지 확인
   */
  hasTemplate(): boolean {
    return this.template !== null;
  }

  /**
   * 패킷 빌드 (동적 값 재생성 + 노이즈)
   */
  build(): BuiltProductLogPacket | null {
    if (!this.template) {
      this.log("[ProductLogBuilder] No template set");
      return null;
    }

    const headers = { ...this.template.headers };
    const now = new Date();

    // 1. x-client-version 업데이트 (현재 시간 + 랜덤 초)
    const jitterSec = Math.floor(Math.random() * 60);
    const versionDate = new Date(now.getTime() - jitterSec * 1000);
    const version = versionDate.getFullYear().toString() +
      String(versionDate.getMonth() + 1).padStart(2, "0") +
      String(versionDate.getDate()).padStart(2, "0") +
      String(versionDate.getHours()).padStart(2, "0") +
      String(versionDate.getMinutes()).padStart(2, "0") +
      String(versionDate.getSeconds()).padStart(2, "0");
    headers["x-client-version"] = version;

    // 2. page_uid는 브라우저 원본 유지 (서버에서 검증할 수 있음)
    // 랜덤 생성하면 서버가 "이 page_uid 없음" 하고 무시할 수 있음
    // headers["cookie"]는 그대로 유지

    // 3. referer에 노이즈 추가 (ackey 파라미터 랜덤화)
    const body = { ...this.template.body };
    if (body.referer && body.referer.includes("ackey=")) {
      body.referer = body.referer.replace(
        /ackey=[^&]+/,
        `ackey=${this.generateRandomKey(8)}`
      );
    }

    return {
      url: this.template.url,
      method: this.template.method,
      headers,
      body: JSON.stringify(body),
    };
  }

  /**
   * page_uid 생성 (네이버 형식)
   * 형식: {timestamp}_{random8chars} 또는 랜덤 문자열
   */
  private generatePageUid(): string {
    const timestamp = Date.now();
    const random = this.generateRandomKey(10);
    // 네이버 page_uid 형식 중 하나 선택
    const formats = [
      `${timestamp}_${random}`,  // 1765386988440_q2xgs47qj
      `${this.generateRandomKey(24)}`,  // jgEq8dqVW9hssk8PUZh-029662
    ];
    return formats[Math.floor(Math.random() * formats.length)];
  }

  /**
   * 랜덤 키 생성
   */
  private generateRandomKey(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  /**
   * 다중 패킷 빌드
   */
  buildBatch(count: number): BuiltProductLogPacket[] {
    const packets: BuiltProductLogPacket[] = [];

    for (let i = 0; i < count; i++) {
      const packet = this.build();
      if (packet) {
        packets.push(packet);
      }
    }

    this.log(`[ProductLogBuilder] Built ${packets.length} packets`);
    return packets;
  }

  /**
   * 템플릿 정보 가져오기
   */
  getTemplate(): ProductLogTemplate | null {
    return this.template;
  }

  /**
   * 상품 ID 가져오기
   */
  getProductId(): string | null {
    return this.template?.body?.id || null;
  }

  /**
   * 채널 정보 가져오기
   */
  getChannelInfo(): ProductLogTemplate["body"]["channel"] | null {
    return this.template?.body?.channel || null;
  }
}
