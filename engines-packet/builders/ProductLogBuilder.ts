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
   * 패킷 빌드 (동일 body, 약간의 타이밍 변화)
   */
  build(): BuiltProductLogPacket | null {
    if (!this.template) {
      this.log("[ProductLogBuilder] No template set");
      return null;
    }

    // x-client-version 업데이트 (현재 날짜 기반)
    const headers = { ...this.template.headers };
    const now = new Date();
    const version = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    headers["x-client-version"] = version;

    // 쿠키에서 민감한 세션 정보 유지
    // (실제 브라우저 세션의 쿠키 사용)

    return {
      url: this.template.url,
      method: this.template.method,
      headers,
      body: JSON.stringify(this.template.body),
    };
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
