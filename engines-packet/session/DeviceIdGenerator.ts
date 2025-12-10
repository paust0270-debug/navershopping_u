/**
 * Device ID Generator
 *
 * 네이버 API 호출에 필요한 고유 식별자 생성
 * - deviceId: 32자리 hex (브라우저 핑거프린트 모방)
 * - page_uid: timestamp_random 형식
 * - nvMid: 네이버 MID 형식
 */

import type { LogFunction } from "../types";

export interface GeneratedIds {
  deviceId: string;
  pageUid: string;
  timestamp: number;
}

export class DeviceIdGenerator {
  private log: LogFunction;
  private currentDeviceId: string | null = null;
  private sessionStartTime: number;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.sessionStartTime = Date.now();
  }

  /**
   * deviceId 생성 (32자리 hex)
   * 세션 동안 동일한 값 유지
   */
  getDeviceId(): string {
    if (!this.currentDeviceId) {
      this.currentDeviceId = this.generateDeviceId();
      this.log(`[DeviceIdGenerator] Generated deviceId: ${this.currentDeviceId}`);
    }
    return this.currentDeviceId;
  }

  /**
   * 새 deviceId 생성 (32자리 hex)
   * 네이버 클라이언트 fingerprint 형식
   */
  generateDeviceId(): string {
    const chars = "0123456789abcdef";
    let result = "";

    // 앞 8자리: timestamp 기반
    const timeHex = (Date.now() & 0xffffffff).toString(16).padStart(8, "0");
    result += timeHex;

    // 나머지 24자리: 랜덤
    for (let i = 0; i < 24; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }

    return result;
  }

  /**
   * page_uid 생성
   * 형식: timestamp_random9chars
   */
  generatePageUid(): string {
    const timestamp = Date.now();
    const random = this.generateRandomString(9);
    return `${timestamp}_${random}`;
  }

  /**
   * 짧은 page_uid 생성 (네이버 검색용)
   * 형식: random12chars
   */
  generateShortPageUid(): string {
    return this.generateRandomString(12);
  }

  /**
   * nvMid 형식 생성
   * 네이버 상품 MID와 유사한 형식
   */
  generateNvMid(): string {
    // nvMid는 보통 숫자로 구성
    const length = Math.floor(Math.random() * 3) + 10; // 10-12자리
    let result = "";
    for (let i = 0; i < length; i++) {
      result += Math.floor(Math.random() * 10).toString();
    }
    return result;
  }

  /**
   * 검색 API용 파라미터 세트 생성
   */
  generateSearchParams(): Record<string, string> {
    return {
      deviceId: this.getDeviceId(),
      page_uid: this.generateShortPageUid(),
      ts: Date.now().toString(),
    };
  }

  /**
   * 상품 상세 API용 파라미터 세트 생성
   */
  generateProductParams(mid?: string): Record<string, string> {
    return {
      deviceId: this.getDeviceId(),
      page_uid: this.generatePageUid(),
      nvMid: mid || this.generateNvMid(),
      ts: Date.now().toString(),
    };
  }

  /**
   * expose/log API용 파라미터 세트 생성
   */
  generateLogParams(): Record<string, string> {
    return {
      deviceId: this.getDeviceId(),
      page_uid: this.generatePageUid(),
      sid: this.generateSessionId(),
      ts: Date.now().toString(),
    };
  }

  /**
   * 세션 ID 생성
   */
  generateSessionId(): string {
    // 세션 시작 시간 + 랜덤
    const timeBase = this.sessionStartTime.toString(36);
    const random = this.generateRandomString(6);
    return `${timeBase}${random}`;
  }

  /**
   * 전체 ID 세트 생성
   */
  generateAll(): GeneratedIds {
    return {
      deviceId: this.getDeviceId(),
      pageUid: this.generatePageUid(),
      timestamp: Date.now(),
    };
  }

  /**
   * deviceId 리셋 (새 세션)
   */
  resetDeviceId(): void {
    this.currentDeviceId = null;
    this.sessionStartTime = Date.now();
    this.log("[DeviceIdGenerator] Reset deviceId for new session");
  }

  /**
   * 랜덤 문자열 생성
   */
  private generateRandomString(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  /**
   * UUID v4 생성
   */
  generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
