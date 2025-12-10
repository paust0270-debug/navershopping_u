/**
 * Cookie Extractor
 *
 * 브라우저에서 쿠키 추출 및 분석
 * - Patchright 브라우저 컨텍스트에서 쿠키 추출
 * - 쿠키 분류 (세션, 인증, 추적 등)
 * - 도메인별 쿠키 그룹화
 */

import type { BrowserContext, Page } from "patchright";
import type { CookieData, LogFunction } from "../types";

export interface CookieGroup {
  domain: string;
  cookies: CookieData[];
  isEssential: boolean;
}

export interface CookieAnalysis {
  total: number;
  byDomain: Map<string, CookieData[]>;
  sessionCookies: CookieData[];
  authCookies: CookieData[];
  trackingCookies: CookieData[];
  expiredCookies: CookieData[];
}

// 알려진 인증 관련 쿠키 이름
const AUTH_COOKIE_PATTERNS = [
  /^nid_/i,
  /^naver_/i,
  /session/i,
  /auth/i,
  /token/i,
  /login/i,
  /^nnb$/i,
];

// 알려진 추적 쿠키 이름
const TRACKING_COOKIE_PATTERNS = [
  /^_ga/i,
  /^_gid/i,
  /^fbp$/i,
  /^_fbp$/i,
  /analytics/i,
  /tracking/i,
];

export class CookieExtractor {
  private log: LogFunction;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * 브라우저 컨텍스트에서 모든 쿠키 추출
   */
  async extractFromContext(context: BrowserContext): Promise<CookieData[]> {
    const rawCookies = await context.cookies();

    return rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
  }

  /**
   * 페이지에서 쿠키 추출
   */
  async extractFromPage(page: Page): Promise<CookieData[]> {
    return this.extractFromContext(page.context());
  }

  /**
   * 특정 도메인의 쿠키만 추출
   */
  async extractForDomain(
    context: BrowserContext,
    domain: string
  ): Promise<CookieData[]> {
    const allCookies = await this.extractFromContext(context);

    return allCookies.filter(
      (c) => c.domain === domain || c.domain.endsWith(`.${domain}`)
    );
  }

  /**
   * 특정 URL에 해당하는 쿠키 추출
   */
  async extractForUrl(
    context: BrowserContext,
    url: string
  ): Promise<CookieData[]> {
    const rawCookies = await context.cookies([url]);

    return rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
  }

  /**
   * 쿠키 분석
   */
  analyzeCookies(cookies: CookieData[]): CookieAnalysis {
    const now = Date.now() / 1000;
    const byDomain = new Map<string, CookieData[]>();
    const sessionCookies: CookieData[] = [];
    const authCookies: CookieData[] = [];
    const trackingCookies: CookieData[] = [];
    const expiredCookies: CookieData[] = [];

    for (const cookie of cookies) {
      // 도메인별 그룹화
      const domainCookies = byDomain.get(cookie.domain) || [];
      domainCookies.push(cookie);
      byDomain.set(cookie.domain, domainCookies);

      // 만료 확인
      if (cookie.expires && cookie.expires < now) {
        expiredCookies.push(cookie);
        continue;
      }

      // 세션 쿠키 (만료 시간 없음)
      if (!cookie.expires) {
        sessionCookies.push(cookie);
      }

      // 인증 쿠키
      if (AUTH_COOKIE_PATTERNS.some((p) => p.test(cookie.name))) {
        authCookies.push(cookie);
      }

      // 추적 쿠키
      if (TRACKING_COOKIE_PATTERNS.some((p) => p.test(cookie.name))) {
        trackingCookies.push(cookie);
      }
    }

    return {
      total: cookies.length,
      byDomain,
      sessionCookies,
      authCookies,
      trackingCookies,
      expiredCookies,
    };
  }

  /**
   * 필수 쿠키만 필터링
   */
  filterEssentialCookies(cookies: CookieData[]): CookieData[] {
    const now = Date.now() / 1000;

    return cookies.filter((c) => {
      // 만료되지 않은 것
      if (c.expires && c.expires < now) return false;

      // 인증 관련이거나 세션 쿠키
      const isAuth = AUTH_COOKIE_PATTERNS.some((p) => p.test(c.name));
      const isSession = !c.expires;

      return isAuth || isSession;
    });
  }

  /**
   * 추적 쿠키 제외
   */
  filterWithoutTracking(cookies: CookieData[]): CookieData[] {
    return cookies.filter(
      (c) => !TRACKING_COOKIE_PATTERNS.some((p) => p.test(c.name))
    );
  }

  /**
   * 도메인별 쿠키 그룹화
   */
  groupByDomain(cookies: CookieData[]): CookieGroup[] {
    const groups = new Map<string, CookieData[]>();

    for (const cookie of cookies) {
      const domain = this.getBaseDomain(cookie.domain);
      const existing = groups.get(domain) || [];
      existing.push(cookie);
      groups.set(domain, existing);
    }

    return Array.from(groups.entries()).map(([domain, domainCookies]) => ({
      domain,
      cookies: domainCookies,
      isEssential: domainCookies.some((c) =>
        AUTH_COOKIE_PATTERNS.some((p) => p.test(c.name))
      ),
    }));
  }

  /**
   * 쿠키를 Cookie 헤더 문자열로 변환
   */
  toCookieString(cookies: CookieData[]): string {
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /**
   * Cookie 헤더 문자열에서 쿠키 파싱
   */
  fromCookieString(cookieString: string, domain: string = ""): CookieData[] {
    return cookieString.split(";").map((part) => {
      const [name, ...valueParts] = part.trim().split("=");
      return {
        name: name.trim(),
        value: valueParts.join("="),
        domain,
        path: "/",
        httpOnly: false,
        secure: false,
      };
    });
  }

  /**
   * 쿠키 비교 (두 세션 간)
   */
  compareCookies(
    cookiesA: CookieData[],
    cookiesB: CookieData[]
  ): {
    added: CookieData[];
    removed: CookieData[];
    modified: Array<{ old: CookieData; new: CookieData }>;
  } {
    const mapA = new Map(cookiesA.map((c) => [`${c.domain}:${c.name}`, c]));
    const mapB = new Map(cookiesB.map((c) => [`${c.domain}:${c.name}`, c]));

    const added: CookieData[] = [];
    const removed: CookieData[] = [];
    const modified: Array<{ old: CookieData; new: CookieData }> = [];

    // B에만 있는 것 (추가됨)
    for (const [key, cookie] of Array.from(mapB)) {
      if (!mapA.has(key)) {
        added.push(cookie);
      } else {
        const oldCookie = mapA.get(key)!;
        if (oldCookie.value !== cookie.value) {
          modified.push({ old: oldCookie, new: cookie });
        }
      }
    }

    // A에만 있는 것 (제거됨)
    for (const [key, cookie] of Array.from(mapA)) {
      if (!mapB.has(key)) {
        removed.push(cookie);
      }
    }

    return { added, removed, modified };
  }

  /**
   * 기본 도메인 추출
   */
  private getBaseDomain(domain: string): string {
    // 앞의 점 제거
    const clean = domain.startsWith(".") ? domain.slice(1) : domain;
    const parts = clean.split(".");

    if (parts.length <= 2) return clean;
    return parts.slice(-2).join(".");
  }
}
