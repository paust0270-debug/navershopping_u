/**
 * SessionProcessor - 세션 처리 레이어
 *
 * 브라우저 UI 렌더링 없이 패킷 기반으로 세션을 완결합니다.
 * 의도 생성 시 형성된 실행 맥락(ackey, 쿠키, 헤더)과 논리적으로 연속됩니다.
 *
 * 핵심 원칙:
 * - ackey 유지 (의도 생성 시 서버가 발급한 값 그대로)
 * - 1 의도 = 1 세션 = 1 완결
 * - 각 흐름 내부 순서(검색 → 선택 → 전환) 보존 필수
 * - Chrome TLS 보장을 위해 page.evaluate(fetch) 사용
 */

import type { Page, BrowserContext, Cookie } from 'patchright';
import { IntentContext, SessionResult, ProductConfig, SessionProcessorOptions } from './types';

// 기본 옵션
const DEFAULT_OPTIONS: SessionProcessorOptions = {
  requestDelay: 500,
  timeout: 30000,
  sendLogs: false,
  debug: false,
};

/**
 * 세션 처리 클래스
 *
 * 의도 컨텍스트를 사용하여 검색 → 선택 → 전환 흐름을 완결
 */
export class SessionProcessor {
  private page: Page | null = null;
  private context: BrowserContext | null = null;
  private options: SessionProcessorOptions;
  private logFn: (msg: string) => void;

  constructor(options: Partial<SessionProcessorOptions> = {}, logFn?: (msg: string) => void) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logFn = logFn || console.log;
  }

  private log(msg: string): void {
    if (this.options.debug) {
      this.logFn(`[SessionProcessor] ${msg}`);
    }
  }

  /**
   * 페이지 설정 (IntentGenerator에서 받은 페이지 재사용)
   */
  setPage(page: Page): void {
    this.page = page;
    this.context = page.context();
    this.log('Page set');
  }

  /**
   * 랜덤 딜레이
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(r => setTimeout(r, delay));
  }

  /**
   * 쿠키를 문자열로 변환
   */
  private cookiesToString(cookies: Cookie[]): string {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * ackey 유지하여 검색 URL 구성
   */
  private buildSearchUrl(ackey: string, query: string): string {
    const params = new URLSearchParams({
      where: 'm',
      query: query,
    });

    // ackey가 있으면 추가
    if (ackey) {
      params.set('ackey', ackey);
    }

    return `https://m.search.naver.com/search.naver?${params.toString()}`;
  }

  /**
   * 브라우저 내부에서 fetch 실행 (Chrome TLS 보장)
   */
  private async browserFetch(
    url: string,
    intent: IntentContext,
    options: {
      method?: string;
      body?: string;
      referer?: string;
    } = {}
  ): Promise<{ ok: boolean; status: number; body: string; finalUrl: string }> {
    if (!this.page) {
      return { ok: false, status: 0, body: '', finalUrl: url };
    }

    const { method = 'GET', body, referer = intent.referer } = options;

    const result = await this.page.evaluate(
      async ({ url, method, headers, body, timeout }) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
            credentials: 'include',
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          let responseBody = '';
          try {
            responseBody = await response.text();
          } catch {}

          return {
            ok: response.ok,
            status: response.status,
            body: responseBody,
            finalUrl: response.url,
          };
        } catch (error: any) {
          clearTimeout(timeoutId);
          return {
            ok: false,
            status: 0,
            body: error.message || 'Unknown error',
            finalUrl: url,
          };
        }
      },
      {
        url,
        method,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Referer': referer,
          'User-Agent': intent.userAgent,
          ...intent.headers,
        },
        body,
        timeout: this.options.timeout,
      }
    );

    return result;
  }

  /**
   * HTML에서 nvMid 일치 상품 링크 추출
   */
  private extractProductLink(html: string, nvMid: string): string | null {
    // 패턴 1: href에 nv_mid=MID 포함
    const pattern1 = new RegExp(`href=["']([^"']*nv_mid=${nvMid}[^"']*)["']`, 'i');
    const match1 = html.match(pattern1);
    if (match1) {
      return this.normalizeUrl(match1[1]);
    }

    // 패턴 2: data-nv-mid="MID" 형태
    const pattern2 = new RegExp(`data-nv-mid=["']${nvMid}["'][^>]*href=["']([^"']+)["']`, 'i');
    const match2 = html.match(pattern2);
    if (match2) {
      return this.normalizeUrl(match2[1]);
    }

    // 패턴 3: href 다음에 data-nv-mid
    const pattern3 = new RegExp(`href=["']([^"']+)["'][^>]*data-nv-mid=["']${nvMid}["']`, 'i');
    const match3 = html.match(pattern3);
    if (match3) {
      return this.normalizeUrl(match3[1]);
    }

    // 패턴 4: 링크에서 MID 추출
    const allLinks = html.match(/href=["']([^"']*nv_mid=\d+[^"']*)["']/gi) || [];
    for (const linkMatch of allLinks) {
      const hrefMatch = linkMatch.match(/href=["']([^"']+)["']/i);
      if (hrefMatch && hrefMatch[1].includes(`nv_mid=${nvMid}`)) {
        return this.normalizeUrl(hrefMatch[1]);
      }
    }

    return null;
  }

  /**
   * URL 정규화
   */
  private normalizeUrl(url: string): string {
    // HTML 엔티티 디코드
    url = url.replace(/&amp;/g, '&');

    // 상대 URL 처리
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    if (url.startsWith('/')) {
      return 'https://m.search.naver.com' + url;
    }

    return url;
  }

  /**
   * 세션 처리 (검색 → 선택 → 전환)
   *
   * @param intent - 의도 컨텍스트 (IntentGenerator에서 획득)
   * @param product - 상품 설정
   * @returns 세션 처리 결과
   */
  async processSession(
    intent: IntentContext,
    product: ProductConfig
  ): Promise<SessionResult> {
    const startTime = Date.now();

    if (!this.page) {
      return {
        success: false,
        reason: 'Page not set. Call setPage() first.',
      };
    }

    this.log('=== Session Processing Start ===');
    this.log(`ackey: ${intent.ackey || '(none)'}`);
    this.log(`product: ${product.fullProductName}`);
    this.log(`nvMid: ${product.nvMid}`);

    try {
      // === Step 1: ackey 유지 + 풀네임 검색 요청 ===
      const searchUrl = this.buildSearchUrl(intent.ackey, product.fullProductName);
      this.log(`[Step 1] Search URL: ${searchUrl}`);

      await this.randomDelay(this.options.requestDelay!, this.options.requestDelay! * 2);

      const searchResponse = await this.browserFetch(searchUrl, intent);

      if (!searchResponse.ok) {
        this.log(`[Step 1] Search failed: ${searchResponse.status}`);
        return {
          success: false,
          ackey: intent.ackey,
          reason: `Search request failed: ${searchResponse.status}`,
          duration: Date.now() - startTime,
        };
      }

      this.log(`[Step 1] Search OK: ${searchResponse.body.length} bytes`);

      // === Step 2: nvMid 일치 상품 링크 추출 ===
      const productLink = this.extractProductLink(searchResponse.body, product.nvMid);

      if (!productLink) {
        this.log(`[Step 2] Product link not found for nvMid: ${product.nvMid}`);

        // 디버그: HTML에서 발견된 MID들 출력
        const foundMids = searchResponse.body.match(/nv_mid=(\d+)/g) || [];
        const uniqueMids = Array.from(new Set(foundMids.map(m => m.replace('nv_mid=', ''))));
        this.log(`[Step 2] Found MIDs: ${uniqueMids.slice(0, 10).join(', ')}`);

        return {
          success: false,
          ackey: intent.ackey,
          reason: `Product not found: nvMid=${product.nvMid}`,
          duration: Date.now() - startTime,
        };
      }

      this.log(`[Step 2] Product link found: ${productLink.substring(0, 80)}...`);

      // === Step 3: 상품 상세 페이지 요청 (정상 전환) ===
      await this.randomDelay(this.options.requestDelay!, this.options.requestDelay! * 2);

      // referer를 검색 결과 URL로 설정 (전환 추적 정상화)
      const productResponse = await this.browserFetch(productLink, intent, {
        referer: searchResponse.finalUrl || searchUrl,
      });

      if (!productResponse.ok) {
        this.log(`[Step 3] Product page failed: ${productResponse.status}`);
        return {
          success: false,
          ackey: intent.ackey,
          productUrl: productLink,
          reason: `Product page request failed: ${productResponse.status}`,
          duration: Date.now() - startTime,
        };
      }

      // Bridge URL 체크 (리다이렉트 따라가기)
      let finalProductUrl = productResponse.finalUrl || productLink;

      // Bridge URL이면 스마트스토어로 리다이렉트된 것
      if (finalProductUrl.includes('/bridge') || finalProductUrl.includes('cr.shopping')) {
        this.log(`[Step 3] Bridge detected, following redirect...`);
        // 리다이렉트된 URL에서 실제 스토어 URL 추출
        const storeUrlMatch = productResponse.body.match(/location\.href\s*=\s*["']([^"']+)["']/);
        if (storeUrlMatch) {
          finalProductUrl = storeUrlMatch[1];
        }
      }

      this.log(`[Step 3] Product page OK: ${finalProductUrl.substring(0, 80)}...`);

      // === Step 4: 세션 완결 ===
      // 로그 전송은 선택적 (기본적으로 비활성화)
      // 정상 방문은 브라우저 자체 로그로 충분
      let logCount = 0;

      if (this.options.sendLogs) {
        // 여기에 product-logs 전송 로직 추가 가능
        // 단, 계획서에 따르면 "반복 로그 금지" 원칙 적용
        logCount = 1;
      }

      const duration = Date.now() - startTime;
      this.log(`=== Session Complete (${duration}ms) ===`);

      return {
        success: true,
        ackey: intent.ackey,
        productUrl: finalProductUrl,
        duration,
        logCount,
      };

    } catch (error: any) {
      this.log(`Session error: ${error.message}`);
      return {
        success: false,
        ackey: intent.ackey,
        reason: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 브라우저 기반 세션 처리 (UI 렌더링 포함)
   *
   * IntentGenerator의 페이지를 사용하여 실제 네비게이션 수행
   * 이미 검색 결과 페이지에 있는 상태에서 시작
   */
  async processSessionWithNavigation(
    intent: IntentContext,
    product: ProductConfig
  ): Promise<SessionResult> {
    const startTime = Date.now();

    if (!this.page) {
      return {
        success: false,
        reason: 'Page not set',
      };
    }

    this.log('=== Session Processing (Navigation Mode) ===');
    this.log(`Current URL: ${this.page.url()}`);

    try {
      // 풀네임으로 재검색 (ackey 유지)
      // 의도 생성 시에는 짧은 키워드로 검색했으므로 풀네임으로 다시 검색
      const searchUrl = this.buildSearchUrl(intent.ackey, product.fullProductName);
      this.log(`Navigating to full product search`);
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(1000, 1500);

      // 상품 찾기 및 클릭
      const selector = `a[href*="nv_mid=${product.nvMid}"]`;
      this.log(`Finding product: ${selector}`);

      let productClicked = false;

      // 스크롤하면서 찾기
      for (let i = 0; i < 15; i++) {
        const productElement = await this.page.$(selector);

        if (productElement) {
          this.log(`Product found at scroll ${i}`);
          await productElement.scrollIntoViewIfNeeded();
          await this.randomDelay(200, 300);

          // 새 탭에서 열릴 수 있으므로 이벤트 대기
          const context = this.page.context();
          const [newPage] = await Promise.all([
            context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
            productElement.click(),
          ]);

          if (newPage) {
            // 새 탭이 열렸으면 해당 탭으로 전환
            this.log('New page opened');
            await newPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
            this.page = newPage as Page;
          }

          productClicked = true;
          break;
        }

        // 스크롤
        await this.page.mouse.wheel(0, 600);
        await this.randomDelay(300, 500);
      }

      if (!productClicked) {
        // 디버그: 찾은 MID들 출력
        const foundMids = await this.page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="nv_mid="]'));
          return links.slice(0, 10).map(a => {
            const match = (a as HTMLAnchorElement).href.match(/nv_mid=(\d+)/);
            return match ? match[1] : null;
          }).filter(Boolean);
        }).catch(() => []);

        this.log(`Product not found. Available MIDs: ${foundMids.join(', ')}`);
        return {
          success: false,
          ackey: intent.ackey,
          reason: `Product not found: nvMid=${product.nvMid}`,
          duration: Date.now() - startTime,
        };
      }

      // 페이지 로드 대기
      await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await this.randomDelay(1000, 1500);

      // Bridge URL 대기 (리다이렉트 완료까지)
      this.log('Waiting for redirect...');
      for (let i = 0; i < 10; i++) {
        const url = this.page.url();
        if (!url.includes('/bridge') && !url.includes('cr.shopping') && !url.includes('searchGate')) {
          break;
        }
        await this.randomDelay(500, 800);
      }

      const finalUrl = this.page.url();
      const duration = Date.now() - startTime;

      // 최종 URL이 스마트스토어인지 확인
      const isSuccess = finalUrl.includes('smartstore.naver.com') ||
                        finalUrl.includes('shopping.naver.com') ||
                        finalUrl.includes('brand.naver.com');

      if (isSuccess) {
        this.log(`=== Session Complete (Navigation Mode, ${duration}ms) ===`);
        this.log(`Final URL: ${finalUrl.substring(0, 80)}...`);

        return {
          success: true,
          ackey: intent.ackey,
          productUrl: finalUrl,
          duration,
        };
      } else {
        this.log(`Unexpected final URL: ${finalUrl}`);
        return {
          success: false,
          ackey: intent.ackey,
          productUrl: finalUrl,
          reason: `Unexpected final URL: ${finalUrl.substring(0, 60)}`,
          duration,
        };
      }

    } catch (error: any) {
      this.log(`Navigation error: ${error.message}`);
      return {
        success: false,
        ackey: intent.ackey,
        reason: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 페이지 유효성 확인
   */
  hasPage(): boolean {
    return this.page !== null && !this.page.isClosed();
  }
}

export default SessionProcessor;
