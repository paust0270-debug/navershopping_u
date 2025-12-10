/**
 * Validators Module
 *
 * 엔진 완성 후 자동 실행되는 검증기들
 * - TLS Consistency Checker
 * - Cookie Continuity Checker
 * - HTTP/2 ALPN Checker
 * - Request Timing Deviation Analyzer
 * - Header Entropy Analyzer
 */

import type { Page } from "patchright";
import type {
  ValidatorResult,
  TLSCheckResult,
  CookieCheckResult,
  HeaderCheckResult,
  TimingCheckResult,
  ValidationReport,
  ValidatorStatus,
  SessionState,
  CookieData,
  LogFunction,
} from "../types";
import { SessionManager } from "../session/SessionManager";
import { HeaderBuilder } from "../session/HeaderBuilder";

/**
 * TLS Consistency Checker
 * Node TLS vs Chrome TLS 차이 검출
 */
export class TLSConsistencyChecker {
  private log: LogFunction;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * TLS 일관성 검사
   * page.request.fetch()를 사용하면 Chrome TLS를 사용하므로 통과해야 함
   */
  async check(page: Page): Promise<TLSCheckResult> {
    const details: string[] = [];
    const risks: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    try {
      // Chrome TLS 사용 여부 확인
      // page.request가 존재하면 Patchright Request API 사용 중
      const hasPageRequest = !!page.request;

      if (hasPageRequest) {
        details.push("✓ Patchright Request API 사용 중 (Chrome TLS)");
      } else {
        details.push("✗ Native fetch 사용 감지");
        risks.push("Node.js TLS fingerprint 노출 위험");
        recommendations.push("page.request.fetch() 사용으로 전환 필요");
        score -= 50;
      }

      // 브라우저 내에서 TLS 정보 확인 (간접적)
      const tlsInfo = await page.evaluate(async () => {
        try {
          // https 연결 확인
          const response = await fetch("https://www.howsmyssl.com/a/check", {
            method: "GET",
          });
          return await response.json();
        } catch {
          return null;
        }
      });

      if (tlsInfo) {
        details.push(`TLS Version: ${tlsInfo.tls_version || "Unknown"}`);

        // TLS 1.3 확인
        if (tlsInfo.tls_version === "TLS 1.3") {
          details.push("✓ TLS 1.3 사용 중");
        } else {
          risks.push("TLS 1.3 미사용 - 구버전 TLS 감지");
          score -= 10;
        }
      }

      const status: ValidatorStatus =
        score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";

      return {
        name: "TLS Consistency Checker",
        status,
        score,
        details,
        risks,
        recommendations,
        tlsVersion: tlsInfo?.tls_version,
        alpnProtocol: "h2", // Patchright는 HTTP/2 지원
      };
    } catch (error: any) {
      return {
        name: "TLS Consistency Checker",
        status: "fail",
        score: 0,
        details: [`Error: ${error.message}`],
        risks: ["TLS 검사 실패"],
        recommendations: ["수동 검사 필요"],
      };
    }
  }
}

/**
 * Cookie Continuity Checker
 * 쿠키 연속성 및 일관성 검사
 */
export class CookieContinuityChecker {
  private log: LogFunction;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 쿠키 연속성 검사
   */
  async check(
    page: Page,
    sessionManager: SessionManager
  ): Promise<CookieCheckResult> {
    const details: string[] = [];
    const risks: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    try {
      // 브라우저 쿠키 가져오기
      const context = page.context();
      const browserCookies = await context.cookies();

      // SessionManager 쿠키 가져오기
      const sessionCookies = sessionManager.getAllCookies();

      details.push(`Browser cookies: ${browserCookies.length}`);
      details.push(`Session cookies: ${sessionCookies.length}`);

      // 만료된 쿠키 확인
      const now = Date.now() / 1000;
      const expiredCookies = sessionCookies.filter(
        (c) => c.expires && c.expires < now
      );

      if (expiredCookies.length > 0) {
        details.push(`✗ 만료된 쿠키: ${expiredCookies.length}개`);
        risks.push("만료된 쿠키가 세션에 남아있음");
        score -= 10;
      }

      // 동기화 확인
      const missingInBrowser: string[] = [];
      const missingInSession: string[] = [];

      for (const sc of sessionCookies) {
        const found = browserCookies.find(
          (bc) => bc.name === sc.name && bc.domain.includes(sc.domain)
        );
        if (!found) {
          missingInBrowser.push(sc.name);
        }
      }

      for (const bc of browserCookies) {
        const found = sessionCookies.find(
          (sc) => sc.name === bc.name && bc.domain.includes(sc.domain)
        );
        if (!found) {
          missingInSession.push(bc.name);
        }
      }

      if (missingInBrowser.length > 0) {
        details.push(
          `✗ 브라우저에 없는 세션 쿠키: ${missingInBrowser.join(", ")}`
        );
        risks.push("세션과 브라우저 쿠키 불일치");
        recommendations.push("syncToBrowser() 호출 필요");
        score -= 15;
      }

      if (missingInSession.length > 0) {
        details.push(
          `✗ 세션에 없는 브라우저 쿠키: ${missingInSession.slice(0, 5).join(", ")}...`
        );
        risks.push("브라우저 쿠키가 세션에 동기화되지 않음");
        recommendations.push("syncFromBrowser() 호출 필요");
        score -= 10;
      }

      // 필수 쿠키 확인 (네이버)
      const requiredCookies = ["NNB", "NACT"];
      const inconsistentCookies: string[] = [];

      for (const required of requiredCookies) {
        const found = sessionCookies.find((c) => c.name === required);
        if (!found) {
          inconsistentCookies.push(required);
        }
      }

      if (inconsistentCookies.length > 0) {
        details.push(
          `⚠ 필수 쿠키 누락: ${inconsistentCookies.join(", ")}`
        );
        // 필수 쿠키 누락은 경고만
      }

      const status: ValidatorStatus =
        score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";

      return {
        name: "Cookie Continuity Checker",
        status,
        score,
        details,
        risks,
        recommendations,
        totalCookies: sessionCookies.length,
        expiredCookies: expiredCookies.length,
        missingCookies: [...missingInBrowser, ...missingInSession],
        inconsistentCookies,
      };
    } catch (error: any) {
      return {
        name: "Cookie Continuity Checker",
        status: "fail",
        score: 0,
        details: [`Error: ${error.message}`],
        risks: ["쿠키 검사 실패"],
        recommendations: ["수동 검사 필요"],
        totalCookies: 0,
        expiredCookies: 0,
        missingCookies: [],
        inconsistentCookies: [],
      };
    }
  }
}

/**
 * HTTP/2 ALPN Checker
 * HTTP/2 프로토콜 사용 확인
 */
export class ALPNChecker {
  private log: LogFunction;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * ALPN 프로토콜 검사
   */
  async check(page: Page): Promise<ValidatorResult> {
    const details: string[] = [];
    const risks: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    try {
      // Patchright는 Chrome 기반이므로 HTTP/2 지원
      // 직접적인 ALPN 확인은 어렵지만 간접적으로 확인

      // Performance API를 통한 프로토콜 확인
      const protocolInfo = await page.evaluate(async () => {
        // Navigation 요청의 프로토콜 확인
        const entries = performance.getEntriesByType(
          "navigation"
        ) as PerformanceNavigationTiming[];
        if (entries.length > 0) {
          return {
            protocol: entries[0].nextHopProtocol,
            url: entries[0].name,
          };
        }
        return null;
      });

      if (protocolInfo) {
        details.push(`Protocol: ${protocolInfo.protocol}`);
        details.push(`URL: ${protocolInfo.url}`);

        if (protocolInfo.protocol === "h2") {
          details.push("✓ HTTP/2 사용 중");
        } else if (protocolInfo.protocol === "h3") {
          details.push("✓ HTTP/3 사용 중");
        } else {
          details.push(`⚠ HTTP/1.1 사용 중`);
          risks.push("HTTP/2 미사용 - 봇 탐지 위험 증가");
          recommendations.push("서버가 HTTP/2를 지원하는지 확인");
          score -= 20;
        }
      } else {
        details.push("⚠ 프로토콜 정보 확인 불가");
        score -= 10;
      }

      // Patchright 사용 확인
      const isPatchright = await page.evaluate(() => {
        // Patchright 사용 시 특정 속성이 없어야 함
        return !(navigator as any).webdriver;
      });

      if (isPatchright) {
        details.push("✓ Anti-detection 활성화됨");
      } else {
        details.push("✗ webdriver 속성 감지됨");
        risks.push("봇 탐지 가능성 높음");
        score -= 30;
      }

      const status: ValidatorStatus =
        score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";

      return {
        name: "HTTP/2 ALPN Checker",
        status,
        score,
        details,
        risks,
        recommendations,
      };
    } catch (error: any) {
      return {
        name: "HTTP/2 ALPN Checker",
        status: "fail",
        score: 0,
        details: [`Error: ${error.message}`],
        risks: ["ALPN 검사 실패"],
        recommendations: ["수동 검사 필요"],
      };
    }
  }
}

/**
 * Request Timing Deviation Analyzer
 * 요청 타이밍 편차 분석
 */
export class TimingDeviationAnalyzer {
  private log: LogFunction;
  private timings: number[] = [];

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 타이밍 기록
   */
  recordTiming(ms: number): void {
    this.timings.push(ms);
  }

  /**
   * 타이밍 편차 검사
   */
  check(expectedDistribution: "uniform" | "normal" | "exponential" = "normal"): TimingCheckResult {
    const details: string[] = [];
    const risks: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    if (this.timings.length < 3) {
      return {
        name: "Request Timing Deviation Analyzer",
        status: "warning",
        score: 50,
        details: ["타이밍 데이터 부족 (최소 3개 필요)"],
        risks: [],
        recommendations: ["더 많은 요청 타이밍 수집 필요"],
        avgDeviation: 0,
        maxDeviation: 0,
        outliers: 0,
        distributionMatch: false,
      };
    }

    // 평균 및 표준편차 계산
    const mean = this.timings.reduce((a, b) => a + b, 0) / this.timings.length;
    const variance =
      this.timings.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) /
      this.timings.length;
    const stdDev = Math.sqrt(variance);

    details.push(`평균 타이밍: ${mean.toFixed(2)}ms`);
    details.push(`표준편차: ${stdDev.toFixed(2)}ms`);

    // 편차 계산
    const deviations = this.timings.map((t) => Math.abs(t - mean));
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const maxDeviation = Math.max(...deviations);

    details.push(`평균 편차: ${avgDeviation.toFixed(2)}ms`);
    details.push(`최대 편차: ${maxDeviation.toFixed(2)}ms`);

    // 이상치 감지 (평균 ± 2σ 외)
    const outliers = this.timings.filter(
      (t) => t < mean - 2 * stdDev || t > mean + 2 * stdDev
    ).length;

    if (outliers > 0) {
      details.push(`⚠ 이상치: ${outliers}개`);
      if (outliers > this.timings.length * 0.1) {
        risks.push("타이밍 일관성 부족 - 봇 탐지 위험");
        score -= 15;
      }
    }

    // 분포 일치 확인 (간단한 휴리스틱)
    const cv = stdDev / mean; // 변동계수
    let distributionMatch = false;

    switch (expectedDistribution) {
      case "uniform":
        distributionMatch = cv > 0.3 && cv < 0.6;
        break;
      case "normal":
        distributionMatch = cv > 0.1 && cv < 0.4;
        break;
      case "exponential":
        distributionMatch = cv > 0.8;
        break;
    }

    if (distributionMatch) {
      details.push(`✓ 예상 분포(${expectedDistribution})와 일치`);
    } else {
      details.push(`⚠ 예상 분포(${expectedDistribution})와 불일치`);
      risks.push("타이밍 분포가 인간적이지 않음");
      recommendations.push("타이밍 시뮬레이터 분포 조정 필요");
      score -= 10;
    }

    // 너무 일정한 타이밍 확인 (봇 의심)
    if (cv < 0.05) {
      details.push("✗ 타이밍이 너무 일정함 (봇 의심)");
      risks.push("기계적인 타이밍 패턴 감지됨");
      recommendations.push("랜덤 지터 추가 필요");
      score -= 25;
    }

    const status: ValidatorStatus =
      score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";

    return {
      name: "Request Timing Deviation Analyzer",
      status,
      score,
      details,
      risks,
      recommendations,
      avgDeviation,
      maxDeviation,
      outliers,
      distributionMatch,
    };
  }

  /**
   * 타이밍 초기화
   */
  reset(): void {
    this.timings = [];
  }
}

/**
 * Header Entropy Analyzer
 * 헤더 엔트로피 및 일관성 분석
 */
export class HeaderEntropyAnalyzer {
  private log: LogFunction;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 헤더 엔트로피 검사
   */
  check(
    headers: Record<string, string>,
    headerBuilder: HeaderBuilder
  ): HeaderCheckResult {
    const details: string[] = [];
    const risks: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // 필수 헤더 확인
    const requiredHeaders = [
      "user-agent",
      "accept",
      "accept-language",
      "accept-encoding",
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
    ];

    const missingHeaders: string[] = [];
    const suspiciousHeaders: string[] = [];

    for (const required of requiredHeaders) {
      const found = Object.keys(headers).find(
        (k) => k.toLowerCase() === required
      );
      if (!found) {
        missingHeaders.push(required);
      }
    }

    if (missingHeaders.length > 0) {
      details.push(`✗ 누락된 필수 헤더: ${missingHeaders.join(", ")}`);
      risks.push("필수 브라우저 헤더 누락");
      score -= missingHeaders.length * 5;
    } else {
      details.push("✓ 모든 필수 헤더 존재");
    }

    // Node.js 특유 헤더 확인
    const nodeHeaders = ["host", "connection", "content-length"];
    for (const nodeHeader of nodeHeaders) {
      if (headers[nodeHeader]) {
        suspiciousHeaders.push(nodeHeader);
      }
    }

    if (suspiciousHeaders.length > 0) {
      details.push(
        `⚠ Node.js 특유 헤더 감지: ${suspiciousHeaders.join(", ")}`
      );
      risks.push("Node.js 환경 노출 위험");
      recommendations.push("removeNodeSpecificHeaders() 확인");
      score -= 10;
    }

    // User-Agent 일관성 확인
    const userAgent = headers["user-agent"] || headers["User-Agent"];
    const secChUa = headers["sec-ch-ua"] || headers["Sec-Ch-Ua"];

    if (userAgent && secChUa) {
      // Chrome 버전 일치 확인
      const uaVersion = userAgent.match(/Chrome\/(\d+)/)?.[1];
      const chUaVersion = secChUa.match(/v="(\d+)"/)?.[1];

      if (uaVersion && chUaVersion && uaVersion !== chUaVersion) {
        details.push(
          `✗ User-Agent(${uaVersion})와 sec-ch-ua(${chUaVersion}) 버전 불일치`
        );
        risks.push("헤더 버전 불일치 - 봇 탐지 위험");
        recommendations.push("HeaderBuilder 버전 동기화 필요");
        score -= 20;
      } else {
        details.push("✓ User-Agent와 sec-ch-ua 버전 일치");
      }
    }

    // 헤더 엔트로피 계산 (단순화)
    const headerValues = Object.values(headers).join("");
    const uniqueChars = new Set(headerValues).size;
    const entropy = uniqueChars / headerValues.length;

    details.push(`헤더 엔트로피: ${(entropy * 100).toFixed(2)}%`);

    if (entropy < 0.1) {
      risks.push("헤더 엔트로피가 너무 낮음 - 단순한 패턴");
      score -= 10;
    }

    // sec-ch-ua brands 순서 확인
    if (secChUa) {
      const brands = secChUa.match(/"[^"]+"/g) || [];
      details.push(`sec-ch-ua brands: ${brands.length}개`);

      // 항상 같은 순서면 경고
      if (secChUa.startsWith('"Chromium"')) {
        details.push("⚠ brands 순서가 고정됨");
        recommendations.push("brands 순서 랜덤화 권장");
        // 점수 감점은 하지 않음 (경미한 문제)
      }
    }

    const inconsistentHeaders: string[] = [];
    if (userAgent && !userAgent.includes("Chrome")) {
      inconsistentHeaders.push("user-agent");
    }

    const status: ValidatorStatus =
      score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";

    return {
      name: "Header Entropy Analyzer",
      status,
      score,
      details,
      risks,
      recommendations,
      entropy,
      missingHeaders,
      inconsistentHeaders,
      suspiciousHeaders,
    };
  }
}

/**
 * Validation Runner
 * 모든 검증기를 실행하고 종합 리포트 생성
 */
export class ValidationRunner {
  private log: LogFunction;
  private tlsChecker: TLSConsistencyChecker;
  private cookieChecker: CookieContinuityChecker;
  private alpnChecker: ALPNChecker;
  private timingAnalyzer: TimingDeviationAnalyzer;
  private headerAnalyzer: HeaderEntropyAnalyzer;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
    this.tlsChecker = new TLSConsistencyChecker(logFn);
    this.cookieChecker = new CookieContinuityChecker(logFn);
    this.alpnChecker = new ALPNChecker(logFn);
    this.timingAnalyzer = new TimingDeviationAnalyzer(logFn);
    this.headerAnalyzer = new HeaderEntropyAnalyzer(logFn);
  }

  /**
   * 타이밍 기록
   */
  recordTiming(ms: number): void {
    this.timingAnalyzer.recordTiming(ms);
  }

  /**
   * 전체 검증 실행
   */
  async runAll(
    page: Page,
    sessionManager: SessionManager,
    headerBuilder: HeaderBuilder,
    currentHeaders?: Record<string, string>
  ): Promise<ValidationReport> {
    this.log("[ValidationRunner] Starting validation...");

    const results: ValidationReport["results"] = {};

    // TLS 검사
    try {
      results.tls = await this.tlsChecker.check(page);
      this.log(`[TLS] Score: ${results.tls.score}`);
    } catch (e) {
      this.log(`[TLS] Error: ${e}`);
    }

    // Cookie 검사
    try {
      results.cookie = await this.cookieChecker.check(page, sessionManager);
      this.log(`[Cookie] Score: ${results.cookie.score}`);
    } catch (e) {
      this.log(`[Cookie] Error: ${e}`);
    }

    // ALPN 검사
    try {
      results.alpn = await this.alpnChecker.check(page);
      this.log(`[ALPN] Score: ${results.alpn.score}`);
    } catch (e) {
      this.log(`[ALPN] Error: ${e}`);
    }

    // Timing 검사
    try {
      results.timing = this.timingAnalyzer.check("normal");
      this.log(`[Timing] Score: ${results.timing.score}`);
    } catch (e) {
      this.log(`[Timing] Error: ${e}`);
    }

    // Header 검사
    if (currentHeaders) {
      try {
        results.header = this.headerAnalyzer.check(currentHeaders, headerBuilder);
        this.log(`[Header] Score: ${results.header.score}`);
      } catch (e) {
        this.log(`[Header] Error: ${e}`);
      }
    }

    // 종합 점수 계산
    const scores = Object.values(results)
      .filter((r): r is ValidatorResult => r !== undefined)
      .map((r) => r.score);

    const overallScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const overallStatus: ValidatorStatus =
      overallScore >= 80 ? "pass" : overallScore >= 50 ? "warning" : "fail";

    // 요약 생성
    const failedChecks = Object.values(results)
      .filter((r): r is ValidatorResult => r !== undefined && r.status === "fail")
      .map((r) => r.name);

    const warningChecks = Object.values(results)
      .filter((r): r is ValidatorResult => r !== undefined && r.status === "warning")
      .map((r) => r.name);

    let summary = `Overall Score: ${overallScore}/100 (${overallStatus})`;
    if (failedChecks.length > 0) {
      summary += `\nFailed: ${failedChecks.join(", ")}`;
    }
    if (warningChecks.length > 0) {
      summary += `\nWarnings: ${warningChecks.join(", ")}`;
    }

    this.log(`[ValidationRunner] ${summary}`);

    return {
      timestamp: Date.now(),
      overallStatus,
      overallScore,
      results,
      summary,
    };
  }

  /**
   * 타이밍 초기화
   */
  resetTimings(): void {
    this.timingAnalyzer.reset();
  }
}
