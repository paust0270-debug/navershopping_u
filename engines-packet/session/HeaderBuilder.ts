/**
 * Header Builder (Enhanced)
 *
 * HTTP 요청 헤더 동적 생성
 * - 브라우저 호환 헤더 생성
 * - 동적 Client Hints 생성 (자동 버전화, brands 순서 랜덤화)
 * - bitness/arch/wow64 헤더 포함
 * - Node 특유 헤더 제거
 * - page.userAgent() 기반 자동화
 */

import type {
  SessionState,
  ClientHintsConfig,
  GeneratedClientHints,
  LogFunction,
} from "../types";

export type RequestType =
  | "document"
  | "xhr"
  | "fetch"
  | "script"
  | "image"
  | "stylesheet";

export interface HeaderOptions {
  referer?: string;
  origin?: string;
  contentType?: string;
  accept?: string;
  excludeNodeHeaders?: boolean; // Node 특유 헤더 제외
}

// 기본 Chrome 버전 설정
const DEFAULT_CHROME_VERSION = "142";
const DEFAULT_CHROME_FULL_VERSION = "142.0.6878.100";

// 기본 Client Hints 설정
const DEFAULT_CLIENT_HINTS_CONFIG: ClientHintsConfig = {
  browserName: "Google Chrome",
  browserVersion: DEFAULT_CHROME_VERSION,
  platformName: "Windows",
  platformVersion: "15.0.0",
  architecture: "x86",
  bitness: "64",
  mobile: false,
  wow64: false,
};

export class HeaderBuilder {
  private log: LogFunction;
  private defaultUserAgent: string;
  private clientHintsConfig: ClientHintsConfig;
  private browserUserAgent: string | null = null;

  constructor(logFn?: LogFunction, config?: Partial<ClientHintsConfig>) {
    this.log = logFn || console.log;
    this.clientHintsConfig = { ...DEFAULT_CLIENT_HINTS_CONFIG, ...config };
    this.defaultUserAgent = this.buildDefaultUserAgent();
  }

  /**
   * 브라우저에서 User-Agent 설정 (page.userAgent() 기반)
   */
  setBrowserUserAgent(userAgent: string): void {
    this.browserUserAgent = userAgent;

    // User-Agent에서 Chrome 버전 추출
    const chromeMatch = userAgent.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (chromeMatch) {
      this.clientHintsConfig.browserVersion = chromeMatch[1];

      // Full version 설정
      const fullVersion = `${chromeMatch[1]}.${chromeMatch[2]}.${chromeMatch[3]}.${chromeMatch[4]}`;
      this.log(`[HeaderBuilder] Detected Chrome version: ${fullVersion}`);
    }

    // Platform 추출
    if (userAgent.includes("Windows NT")) {
      this.clientHintsConfig.platformName = "Windows";
      const winMatch = userAgent.match(/Windows NT (\d+\.\d+)/);
      if (winMatch) {
        this.clientHintsConfig.platformVersion = winMatch[1] + ".0";
      }
    } else if (userAgent.includes("Mac OS X")) {
      this.clientHintsConfig.platformName = "macOS";
    } else if (userAgent.includes("Linux")) {
      this.clientHintsConfig.platformName = "Linux";
    }

    // Mobile 감지
    this.clientHintsConfig.mobile = /Mobile|Android/.test(userAgent);

    // 64-bit 감지
    if (userAgent.includes("Win64") || userAgent.includes("x64")) {
      this.clientHintsConfig.bitness = "64";
      this.clientHintsConfig.architecture = "x86";
    }
  }

  /**
   * 기본 User-Agent 생성
   */
  private buildDefaultUserAgent(): string {
    const version = this.clientHintsConfig.browserVersion;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
  }

  /**
   * 요청 타입에 맞는 기본 헤더 생성
   */
  buildHeaders(
    type: RequestType,
    options: HeaderOptions = {},
    session?: SessionState
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // User-Agent (브라우저 기반 우선)
    headers["user-agent"] =
      this.browserUserAgent || session?.userAgent || this.defaultUserAgent;

    // Client Hints (동적 생성)
    const clientHints = this.generateClientHints();
    Object.assign(headers, clientHints);

    // 타입별 Accept 헤더
    headers["accept"] = options.accept || this.getAcceptHeader(type);

    // Accept-Language
    headers["accept-language"] = "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7";

    // Accept-Encoding (브라우저와 동일)
    headers["accept-encoding"] = "gzip, deflate, br, zstd";

    // Referer
    if (options.referer) {
      headers["referer"] = options.referer;
    }

    // Origin (CORS 요청)
    if (options.origin) {
      headers["origin"] = options.origin;
    }

    // Content-Type (POST)
    if (options.contentType) {
      headers["content-type"] = options.contentType;
    }

    // 세션 쿠키
    if (session && session.cookies.length > 0) {
      headers["cookie"] = session.cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
    }

    // 타입별 추가 헤더
    this.addTypeSpecificHeaders(headers, type);

    // Node 특유 헤더 제거 (기본적으로 제거)
    if (options.excludeNodeHeaders !== false) {
      this.removeNodeSpecificHeaders(headers);
    }

    return headers;
  }

  /**
   * Node.js 특유 헤더 제거
   * - host (자동 설정됨)
   * - connection: keep-alive (브라우저 기본값과 다름)
   * - 기타 Node 관련 헤더
   */
  private removeNodeSpecificHeaders(headers: Record<string, string>): void {
    // 이 헤더들은 Patchright page.request.fetch()가 자동으로 적절히 설정함
    delete headers["host"];
    delete headers["connection"];
    delete headers["transfer-encoding"];
    delete headers["content-length"]; // 자동 계산됨
  }

  /**
   * 인증 헤더 추가
   */
  addAuthHeaders(
    headers: Record<string, string>,
    session: SessionState
  ): Record<string, string> {
    const result = { ...headers };

    // NAC 토큰
    if (session.nacToken) {
      result["x-nac-token"] = session.nacToken;
    }

    // Auth 토큰
    if (session.authToken) {
      result["authorization"] = `Bearer ${session.authToken}`;
    }

    return result;
  }

  /**
   * Client Hints 헤더 동적 생성
   * - 버전 자동화
   * - brands 순서 랜덤화
   * - bitness/arch/wow64 포함
   */
  generateClientHints(): GeneratedClientHints {
    const config = this.clientHintsConfig;
    const version = config.browserVersion;

    // Brands 생성 (순서 랜덤화)
    const brands = this.generateBrands(version);
    const shuffledBrands = this.shuffleArray([...brands]);

    // Full version brands
    const fullVersion = this.getFullVersion();
    const fullVersionBrands = this.generateFullVersionBrands(fullVersion);
    const shuffledFullBrands = this.shuffleArray([...fullVersionBrands]);

    const hints: GeneratedClientHints = {
      "sec-ch-ua": shuffledBrands.map((b) => `"${b.brand}";v="${b.version}"`).join(", "),
      "sec-ch-ua-mobile": config.mobile ? "?1" : "?0",
      "sec-ch-ua-platform": `"${config.platformName}"`,
    };

    // 추가 Client Hints (선택적으로 포함)
    hints["sec-ch-ua-full-version-list"] = shuffledFullBrands
      .map((b) => `"${b.brand}";v="${b.version}"`)
      .join(", ");
    hints["sec-ch-ua-arch"] = `"${config.architecture}"`;
    hints["sec-ch-ua-bitness"] = `"${config.bitness}"`;
    hints["sec-ch-ua-wow64"] = config.wow64 ? "?1" : "?0";

    if (config.model) {
      hints["sec-ch-ua-model"] = `"${config.model}"`;
    }

    return hints;
  }

  /**
   * Brands 생성
   */
  private generateBrands(version: string): Array<{ brand: string; version: string }> {
    // Chrome의 Not-A-Brand 패턴 (버전마다 다름)
    const notABrandPatterns = [
      "Not_A Brand",
      "Not-A.Brand",
      "Not A;Brand",
      "Not/A)Brand",
    ];

    // 버전 기반 인덱스 선택
    const patternIndex = parseInt(version, 10) % notABrandPatterns.length;
    const notABrand = notABrandPatterns[patternIndex];

    return [
      { brand: "Chromium", version },
      { brand: "Google Chrome", version },
      { brand: notABrand, version: "99" },
    ];
  }

  /**
   * Full Version Brands 생성
   */
  private generateFullVersionBrands(
    fullVersion: string
  ): Array<{ brand: string; version: string }> {
    const majorVersion = fullVersion.split(".")[0];
    const notABrandPatterns = [
      "Not_A Brand",
      "Not-A.Brand",
      "Not A;Brand",
      "Not/A)Brand",
    ];
    const patternIndex = parseInt(majorVersion, 10) % notABrandPatterns.length;

    return [
      { brand: "Chromium", version: fullVersion },
      { brand: "Google Chrome", version: fullVersion },
      { brand: notABrandPatterns[patternIndex], version: "99.0.0.0" },
    ];
  }

  /**
   * Full version 가져오기
   */
  private getFullVersion(): string {
    const major = this.clientHintsConfig.browserVersion;
    // 실제 Full version 형식: major.minor.build.patch
    return `${major}.0.6878.100`;
  }

  /**
   * 배열 랜덤 섞기 (Fisher-Yates)
   */
  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Fetch API 요청용 헤더
   */
  buildFetchHeaders(
    url: string,
    options: HeaderOptions = {},
    session?: SessionState
  ): Record<string, string> {
    const headers = this.buildHeaders("fetch", options, session);

    // Fetch 메타데이터
    headers["sec-fetch-dest"] = "empty";
    headers["sec-fetch-mode"] = "cors";
    headers["sec-fetch-site"] = this.getSameSite(url, options.referer);

    return headers;
  }

  /**
   * XHR 요청용 헤더
   */
  buildXhrHeaders(
    url: string,
    options: HeaderOptions = {},
    session?: SessionState
  ): Record<string, string> {
    const headers = this.buildHeaders("xhr", options, session);

    headers["x-requested-with"] = "XMLHttpRequest";

    return headers;
  }

  /**
   * Document 요청용 헤더
   */
  buildDocumentHeaders(
    options: HeaderOptions = {},
    session?: SessionState
  ): Record<string, string> {
    const headers = this.buildHeaders("document", options, session);

    headers["upgrade-insecure-requests"] = "1";
    headers["sec-fetch-dest"] = "document";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-site"] = "none";
    headers["sec-fetch-user"] = "?1";

    return headers;
  }

  /**
   * 네이버 검색 API용 헤더
   */
  buildNaverSearchHeaders(
    referer: string,
    session?: SessionState
  ): Record<string, string> {
    const headers = this.buildHeaders(
      "document",
      {
        referer,
        excludeNodeHeaders: true,
      },
      session
    );

    headers["sec-fetch-dest"] = "document";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-site"] = "same-origin";
    headers["sec-fetch-user"] = "?1";
    headers["upgrade-insecure-requests"] = "1";

    return headers;
  }

  /**
   * 네이버 API용 헤더 (XHR/Fetch)
   */
  buildNaverApiHeaders(
    url: string,
    referer: string,
    session?: SessionState
  ): Record<string, string> {
    const headers = this.buildFetchHeaders(
      url,
      {
        referer,
        origin: "https://search.naver.com",
        excludeNodeHeaders: true,
      },
      session
    );

    return headers;
  }

  /**
   * 타입별 Accept 헤더
   */
  private getAcceptHeader(type: RequestType): string {
    switch (type) {
      case "document":
        return "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
      case "xhr":
      case "fetch":
        return "application/json, text/plain, */*";
      case "script":
        return "*/*";
      case "image":
        return "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
      case "stylesheet":
        return "text/css,*/*;q=0.1";
      default:
        return "*/*";
    }
  }

  /**
   * 타입별 추가 헤더
   */
  private addTypeSpecificHeaders(
    headers: Record<string, string>,
    type: RequestType
  ): void {
    switch (type) {
      case "document":
        headers["cache-control"] = "max-age=0";
        break;
      case "script":
        headers["sec-fetch-dest"] = "script";
        headers["sec-fetch-mode"] = "no-cors";
        break;
      case "stylesheet":
        headers["sec-fetch-dest"] = "style";
        headers["sec-fetch-mode"] = "no-cors";
        break;
    }
  }

  /**
   * Same-site 판단
   */
  private getSameSite(
    targetUrl: string,
    refererUrl?: string
  ): "same-origin" | "same-site" | "cross-site" | "none" {
    if (!refererUrl) return "none";

    try {
      const target = new URL(targetUrl);
      const referer = new URL(refererUrl);

      if (target.origin === referer.origin) {
        return "same-origin";
      }

      // 같은 eTLD+1 확인
      const targetDomain = this.getBaseDomain(target.hostname);
      const refererDomain = this.getBaseDomain(referer.hostname);

      if (targetDomain === refererDomain) {
        return "same-site";
      }

      return "cross-site";
    } catch {
      return "cross-site";
    }
  }

  /**
   * 기본 도메인 추출
   */
  private getBaseDomain(hostname: string): string {
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
  }

  /**
   * User-Agent 설정
   */
  setDefaultUserAgent(userAgent: string): void {
    this.defaultUserAgent = userAgent;
  }

  /**
   * Client Hints 설정 업데이트
   */
  updateClientHintsConfig(config: Partial<ClientHintsConfig>): void {
    this.clientHintsConfig = { ...this.clientHintsConfig, ...config };
  }

  /**
   * 현재 Client Hints 설정 가져오기
   */
  getClientHintsConfig(): ClientHintsConfig {
    return { ...this.clientHintsConfig };
  }

  /**
   * 현재 User-Agent 가져오기
   */
  getUserAgent(): string {
    return this.browserUserAgent || this.defaultUserAgent;
  }
}
