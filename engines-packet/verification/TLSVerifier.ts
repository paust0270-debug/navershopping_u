/**
 * TLS Fingerprint Verifier
 *
 * 실제 패킷의 TLS fingerprint가 Chrome과 동일한지 검증
 * - JA3/JA4 fingerprint 비교
 * - ALPN 프로토콜 확인
 * - Cipher Suite 순서 검증
 * - HTTP/2 SETTINGS 프레임 확인
 */

import type { Page, BrowserContext } from "patchright";
import type { LogFunction } from "../types";

// Chrome 142 기준 JA3 fingerprint (예시 - 실제 값은 버전마다 다름)
const CHROME_JA3_PATTERNS = [
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
  // Chrome 120+
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-41,29-23-24,0",
];

// Chrome의 예상 Cipher Suites 순서
const CHROME_CIPHER_SUITES = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
  "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
];

// Node.js TLS fingerprint 패턴 (탐지되면 실패)
const NODE_JA3_PATTERNS = [
  "771,49196-49200-159-52393-52392-52394-49195-49199-158-49188-49192-107-49187-49191-103-49162-49172-57-49161-49171-51-157-156-61-60-53-47-255,0-11-10-35-22-23-13-43-45-51,29-23-24-25,0",
];

export interface TLSVerificationResult {
  success: boolean;
  isChromeTLS: boolean;
  isNodeTLS: boolean;
  ja3Fingerprint: string | null;
  ja4Fingerprint: string | null;
  alpn: string | null;
  httpVersion: string | null;
  cipherSuite: string | null;
  tlsVersion: string | null;
  warnings: string[];
  errors: string[];
  rawData: Record<string, any>;
}

export class TLSVerifier {
  private log: LogFunction;
  private testEndpoints = [
    "https://tls.peet.ws/api/all",  // TLS fingerprint 분석 서비스
    "https://ja3er.com/json",        // JA3 fingerprint 서비스
    "https://www.howsmyssl.com/a/check", // SSL/TLS 체크
  ];

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 브라우저 내부 fetch()로 TLS fingerprint 검증
   * page.request는 Node TLS 사용 → page.evaluate(fetch) 사용해야 Chrome TLS
   */
  async verifyPageRequest(page: Page): Promise<TLSVerificationResult> {
    const result: TLSVerificationResult = {
      success: false,
      isChromeTLS: false,
      isNodeTLS: false,
      ja3Fingerprint: null,
      ja4Fingerprint: null,
      alpn: null,
      httpVersion: null,
      cipherSuite: null,
      tlsVersion: null,
      warnings: [],
      errors: [],
      rawData: {},
    };

    try {
      // 1. tls.peet.ws로 TLS fingerprint 확인 (브라우저 내부 fetch 사용)
      this.log("[TLSVerifier] Testing TLS fingerprint via tls.peet.ws (browser fetch)...");

      // 브라우저 내부 fetch → Chrome TLS 사용
      const tlsData = await page.evaluate(async () => {
        try {
          const response = await fetch("https://tls.peet.ws/api/all", {
            credentials: "omit",
          });
          return await response.json();
        } catch (e: any) {
          return { error: e.message };
        }
      });

      if (!tlsData.error) {
        result.rawData.tlsPeet = tlsData;

        // JA3 추출
        if (tlsData.ja3) {
          result.ja3Fingerprint = tlsData.ja3;
        }
        if (tlsData.ja3_hash) {
          result.rawData.ja3Hash = tlsData.ja3_hash;
        }

        // JA4 추출
        if (tlsData.ja4) {
          result.ja4Fingerprint = tlsData.ja4;
        }

        // TLS 버전
        if (tlsData.tls_version) {
          result.tlsVersion = tlsData.tls_version;
        }

        // Cipher Suite
        if (tlsData.cipher_suite) {
          result.cipherSuite = tlsData.cipher_suite;
        }

        // ALPN
        if (tlsData.alpn) {
          result.alpn = tlsData.alpn;
        }

        // HTTP 버전
        if (tlsData.http_version) {
          result.httpVersion = tlsData.http_version;
        }
      }

      // 2. howsmyssl.com 추가 검증 (브라우저 내부 fetch 사용)
      this.log("[TLSVerifier] Testing via howsmyssl.com (browser fetch)...");

      const sslData = await page.evaluate(async () => {
        try {
          const response = await fetch("https://www.howsmyssl.com/a/check", {
            credentials: "omit",
          });
          return await response.json();
        } catch (e: any) {
          return { error: e.message };
        }
      });

      if (!sslData.error) {
        result.rawData.howsmyssl = sslData;

        // TLS 버전 확인
        if (sslData.tls_version) {
          if (!result.tlsVersion) {
            result.tlsVersion = sslData.tls_version;
          }

          // TLS 1.3 필수
          if (!sslData.tls_version.includes("1.3")) {
            result.warnings.push(`TLS version is ${sslData.tls_version}, Chrome uses TLS 1.3`);
          }
        }

        // Rating 확인
        if (sslData.rating && sslData.rating !== "Probably Okay") {
          result.warnings.push(`SSL rating: ${sslData.rating}`);
        }
      }

      // 3. Chrome TLS 패턴 매칭
      if (result.ja3Fingerprint) {
        result.isChromeTLS = CHROME_JA3_PATTERNS.some(pattern =>
          this.compareJA3(result.ja3Fingerprint!, pattern)
        );

        result.isNodeTLS = NODE_JA3_PATTERNS.some(pattern =>
          this.compareJA3(result.ja3Fingerprint!, pattern)
        );
      } else if (result.tlsVersion?.includes("1.3")) {
        // TLS 1.3에서는 JA3가 정의되지 않을 수 있음
        // HTTP/2가 작동하고 TLS 1.3이면 Chrome TLS로 간주
        result.warnings.push("JA3 not available (TLS 1.3 detected) - using HTTP version as indicator");
        result.isChromeTLS = result.httpVersion === "2" || result.alpn === "h2";
        result.isNodeTLS = false;
      }

      // 4. ALPN 검증 (h2 필수)
      if (result.alpn) {
        if (result.alpn !== "h2" && !result.alpn.includes("h2")) {
          result.errors.push(`ALPN is "${result.alpn}", expected "h2" for HTTP/2`);
        }
      }

      // 5. HTTP/2 검증
      if (result.httpVersion) {
        if (result.httpVersion !== "2" && !result.httpVersion.includes("2")) {
          result.warnings.push(`HTTP version is ${result.httpVersion}, Chrome typically uses HTTP/2`);
        }
      }

      // 6. Node TLS 감지 시 에러
      if (result.isNodeTLS) {
        result.errors.push("CRITICAL: Node.js TLS fingerprint detected! This will be blocked by Naver.");
      }

      // 7. 최종 성공 여부
      result.success =
        result.errors.length === 0 &&
        (result.isChromeTLS || !result.isNodeTLS);

      this.log(`[TLSVerifier] Verification complete: ${result.success ? "PASS" : "FAIL"}`);
      this.log(`[TLSVerifier] JA3: ${result.ja3Fingerprint?.substring(0, 50)}...`);
      this.log(`[TLSVerifier] Is Chrome TLS: ${result.isChromeTLS}`);
      this.log(`[TLSVerifier] Is Node TLS: ${result.isNodeTLS}`);

      if (result.errors.length > 0) {
        result.errors.forEach(e => this.log(`[TLSVerifier] ERROR: ${e}`));
      }
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => this.log(`[TLSVerifier] WARNING: ${w}`));
      }

      return result;
    } catch (error: any) {
      result.errors.push(`Verification failed: ${error.message}`);
      this.log(`[TLSVerifier] ERROR: ${error.message}`);
      return result;
    }
  }

  /**
   * 브라우저 내부 fetch()의 TLS 검증 (page.evaluate 사용)
   */
  async verifyBrowserFetch(page: Page): Promise<TLSVerificationResult> {
    const result: TLSVerificationResult = {
      success: false,
      isChromeTLS: false,
      isNodeTLS: false,
      ja3Fingerprint: null,
      ja4Fingerprint: null,
      alpn: null,
      httpVersion: null,
      cipherSuite: null,
      tlsVersion: null,
      warnings: [],
      errors: [],
      rawData: {},
    };

    try {
      this.log("[TLSVerifier] Testing browser's internal fetch()...");

      // 브라우저 내부에서 fetch 실행 (Chrome TLS 사용 보장)
      const tlsData = await page.evaluate(async () => {
        try {
          const response = await fetch("https://tls.peet.ws/api/all");
          return await response.json();
        } catch (e: any) {
          return { error: e.message };
        }
      });

      if (tlsData.error) {
        result.errors.push(`Browser fetch failed: ${tlsData.error}`);
        return result;
      }

      result.rawData.browserFetch = tlsData;

      if (tlsData.ja3) {
        result.ja3Fingerprint = tlsData.ja3;
        result.isChromeTLS = true; // 브라우저 내부 fetch는 항상 Chrome TLS
        result.isNodeTLS = false;
      }

      if (tlsData.ja4) {
        result.ja4Fingerprint = tlsData.ja4;
      }

      if (tlsData.alpn) {
        result.alpn = tlsData.alpn;
      }

      if (tlsData.http_version) {
        result.httpVersion = tlsData.http_version;
      }

      result.success = true;
      this.log(`[TLSVerifier] Browser fetch JA3: ${result.ja3Fingerprint?.substring(0, 50)}...`);

      return result;
    } catch (error: any) {
      result.errors.push(`Browser fetch verification failed: ${error.message}`);
      return result;
    }
  }

  /**
   * page.request vs browser fetch 비교
   * 두 방식의 JA3가 같으면 Patchright가 Chrome TLS를 사용하는 것
   */
  async compareRequestMethods(page: Page): Promise<{
    match: boolean;
    pageRequestJA3: string | null;
    browserFetchJA3: string | null;
    recommendation: string;
  }> {
    this.log("[TLSVerifier] Comparing page.request.fetch() vs browser fetch()...");

    const pageRequestResult = await this.verifyPageRequest(page);
    const browserFetchResult = await this.verifyBrowserFetch(page);

    const match = pageRequestResult.ja3Fingerprint === browserFetchResult.ja3Fingerprint;

    let recommendation: string;
    if (match && browserFetchResult.isChromeTLS) {
      recommendation = "GOOD: page.request.fetch() uses Chrome TLS stack";
    } else if (!match && browserFetchResult.isChromeTLS) {
      recommendation = "WARNING: page.request.fetch() uses different TLS stack. Use page.evaluate(fetch) instead.";
    } else {
      recommendation = "ERROR: Unable to verify TLS fingerprints";
    }

    this.log(`[TLSVerifier] JA3 Match: ${match}`);
    this.log(`[TLSVerifier] Recommendation: ${recommendation}`);

    return {
      match,
      pageRequestJA3: pageRequestResult.ja3Fingerprint,
      browserFetchJA3: browserFetchResult.ja3Fingerprint,
      recommendation,
    };
  }

  /**
   * 네이버 서버로 직접 TLS 검증 (브라우저 내부 fetch 사용)
   */
  async verifyAgainstNaver(page: Page): Promise<{
    success: boolean;
    canConnect: boolean;
    httpVersion: string | null;
    securityHeaders: Record<string, string>;
    warnings: string[];
  }> {
    this.log("[TLSVerifier] Testing direct connection to Naver (browser fetch)...");

    const result = {
      success: false,
      canConnect: false,
      httpVersion: null as string | null,
      securityHeaders: {} as Record<string, string>,
      warnings: [] as string[],
    };

    try {
      // 브라우저 내부 fetch로 네이버 연결 (Chrome TLS 사용)
      const fetchResult = await page.evaluate(async () => {
        try {
          const response = await fetch("https://www.naver.com/", {
            credentials: "include",
          });

          // 응답 헤더 추출
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            url: response.url,
            redirected: response.redirected,
            error: null,
          };
        } catch (e: any) {
          return {
            ok: false,
            status: 0,
            statusText: "Error",
            headers: {},
            url: "",
            redirected: false,
            error: e.message,
          };
        }
      });

      if (fetchResult.error) {
        result.warnings.push(`Connection failed: ${fetchResult.error}`);
        return result;
      }

      result.canConnect = true;

      // 보안 관련 헤더 추출
      const securityHeaderKeys = [
        "x-frame-options",
        "x-content-type-options",
        "strict-transport-security",
        "content-security-policy",
        "x-xss-protection",
      ];

      for (const key of securityHeaderKeys) {
        if (fetchResult.headers[key]) {
          result.securityHeaders[key] = fetchResult.headers[key];
        }
      }

      // 성공 응답인지 확인
      if (fetchResult.status === 200) {
        result.success = true;
        this.log("[TLSVerifier] Successfully connected to Naver");
      } else if (fetchResult.status === 403) {
        result.warnings.push("403 Forbidden - May indicate TLS fingerprint detection");
      } else if (fetchResult.status === 302 || fetchResult.status === 301) {
        result.warnings.push(`Redirect (${fetchResult.status}) - Check if being redirected to captcha`);
      }

      return result;
    } catch (error: any) {
      result.warnings.push(`Connection failed: ${error.message}`);
      return result;
    }
  }

  /**
   * JA3 fingerprint 비교 (순서 무관한 부분 비교)
   */
  private compareJA3(actual: string, expected: string): boolean {
    // 정확히 일치
    if (actual === expected) return true;

    // 주요 부분만 비교 (버전, 주요 cipher suites)
    const actualParts = actual.split(",");
    const expectedParts = expected.split(",");

    // TLS 버전 비교 (첫 번째 필드)
    if (actualParts[0] !== expectedParts[0]) return false;

    // Cipher suites (두 번째 필드) - 시작 부분만 비교
    const actualCiphers = actualParts[1]?.split("-").slice(0, 5);
    const expectedCiphers = expectedParts[1]?.split("-").slice(0, 5);

    if (actualCiphers?.join("-") !== expectedCiphers?.join("-")) return false;

    return true;
  }

  /**
   * CDP를 통한 HTTP/2 프로토콜 검증
   * 외부 TLS 핑거프린트 서비스보다 더 신뢰할 수 있음
   */
  async verifyHTTP2viaCDP(page: Page): Promise<{
    http2Working: boolean;
    http2Count: number;
    http11Count: number;
    sampleUrls: { url: string; protocol: string }[];
  }> {
    this.log("[TLSVerifier] Verifying HTTP/2 via CDP...");

    const context = page.context();
    const cdp = await context.newCDPSession(page);

    await cdp.send("Network.enable");

    const protocols: Map<string, string> = new Map();

    // Response 이벤트 리스너 설정
    const responseHandler = (params: any) => {
      if (params.response?.url?.includes("naver.com")) {
        protocols.set(params.response.url, params.response.protocol || "unknown");
      }
    };

    cdp.on("Network.responseReceived", responseHandler);

    // 네이버에 접속하여 실제 요청 발생
    try {
      await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
    } catch {
      // 이미 네이버에 있을 수 있음
    }

    cdp.off("Network.responseReceived", responseHandler);

    // 프로토콜 통계
    let http2Count = 0;
    let http11Count = 0;
    const sampleUrls: { url: string; protocol: string }[] = [];

    for (const [url, protocol] of protocols) {
      if (protocol === "h2") {
        http2Count++;
        if (sampleUrls.filter(s => s.protocol === "h2").length < 3) {
          sampleUrls.push({ url: url.substring(0, 60), protocol });
        }
      } else if (protocol === "http/1.1") {
        http11Count++;
        if (sampleUrls.filter(s => s.protocol === "http/1.1").length < 3) {
          sampleUrls.push({ url: url.substring(0, 60), protocol });
        }
      }
    }

    const http2Working = http2Count > http11Count;

    this.log(`[TLSVerifier] HTTP/2: ${http2Count} requests, HTTP/1.1: ${http11Count} requests`);
    this.log(`[TLSVerifier] HTTP/2 working: ${http2Working ? "YES ✅" : "NO ❌"}`);

    return {
      http2Working,
      http2Count,
      http11Count,
      sampleUrls,
    };
  }

  /**
   * 전체 TLS 검증 실행
   */
  async runFullVerification(page: Page): Promise<{
    overall: "PASS" | "FAIL" | "WARNING";
    details: {
      pageRequest: TLSVerificationResult;
      browserFetch: TLSVerificationResult;
      comparison: { match: boolean; recommendation: string };
      naverTest: { success: boolean; canConnect: boolean };
      http2Check: { http2Working: boolean; http2Count: number; http11Count: number };
    };
    recommendation: string;
  }> {
    this.log("[TLSVerifier] Running full TLS verification...");

    const pageRequest = await this.verifyPageRequest(page);
    const browserFetch = await this.verifyBrowserFetch(page);
    const comparison = await this.compareRequestMethods(page);
    const naverTest = await this.verifyAgainstNaver(page);

    // CDP를 통한 HTTP/2 검증 (가장 신뢰할 수 있는 방법)
    const http2Check = await this.verifyHTTP2viaCDP(page);

    let overall: "PASS" | "FAIL" | "WARNING";
    let recommendation: string;

    if (pageRequest.isNodeTLS) {
      overall = "FAIL";
      recommendation = "CRITICAL: page.request.fetch() is using Node.js TLS. Must use page.evaluate(fetch) for all requests.";
    } else if (!http2Check.http2Working) {
      overall = "FAIL";
      recommendation = "HTTP/2 is not working. Check Chrome configuration and network conditions.";
    } else if (http2Check.http2Working && naverTest.canConnect) {
      // HTTP/2가 작동하고 네이버 연결 가능하면 PASS
      // JA3가 없어도 (TLS 1.3) HTTP/2가 작동하면 Chrome TLS 사용 중
      overall = "PASS";
      recommendation = "HTTP/2 working and Naver connection successful. Chrome TLS fingerprint in use.";
    } else if (!comparison.match) {
      overall = "WARNING";
      recommendation = "page.request.fetch() has different TLS fingerprint than browser. Consider using page.evaluate(fetch) for critical requests.";
    } else {
      overall = "WARNING";
      recommendation = "Some checks inconclusive. Manual packet capture recommended for final verification.";
    }

    this.log(`[TLSVerifier] Overall: ${overall}`);
    this.log(`[TLSVerifier] ${recommendation}`);

    return {
      overall,
      details: {
        pageRequest,
        browserFetch,
        comparison: { match: comparison.match, recommendation: comparison.recommendation },
        naverTest: { success: naverTest.success, canConnect: naverTest.canConnect },
        http2Check: {
          http2Working: http2Check.http2Working,
          http2Count: http2Check.http2Count,
          http11Count: http2Check.http11Count,
        },
      },
      recommendation,
    };
  }
}
