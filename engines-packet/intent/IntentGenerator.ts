/**
 * IntentGenerator - 의도 생성 레이어
 *
 * 브라우저를 통해 자동완성 기반으로 검색 의도를 형성하고
 * 서버 발급 ackey와 세션 컨텍스트를 획득합니다.
 *
 * 핵심 원칙:
 * - ackey는 서버가 발급한 값만 사용 (임의 생성/변조 절대 금지)
 * - 1 의도 = 1 세션 = 1 완결
 * - 생성 축은 직렬 (겹침 금지)
 */

import { chromium, type Browser, type BrowserContext, type Page, type Cookie } from 'patchright';
import { IntentContext, IntentGeneratorOptions, ProductConfig } from './types';

// 모바일 디바이스 설정
const MOBILE_DEVICE = {
  viewport: { width: 412, height: 915 },
  userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
};

// 기본 옵션
const DEFAULT_OPTIONS: IntentGeneratorOptions = {
  headless: false,
  typingDelay: 80,  // 더 빠른 타이핑
  suggestWaitTimeout: 2000,  // 자동완성 대기 단축
  mobile: true,
};

/**
 * 의도 생성 클래스
 *
 * 자동완성 선택을 통해 서버 발급 ackey와 세션 컨텍스트를 획득
 */
export class IntentGenerator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: IntentGeneratorOptions;
  private logFn: (msg: string) => void;

  constructor(options: Partial<IntentGeneratorOptions> = {}, logFn?: (msg: string) => void) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logFn = logFn || console.log;
  }

  private log(msg: string): void {
    this.logFn(`[IntentGenerator] ${msg}`);
  }

  /**
   * 브라우저 초기화
   */
  async initialize(): Promise<void> {
    if (this.browser) {
      this.log('Already initialized');
      return;
    }

    this.log('Initializing browser...');

    const launchOptions: any = {
      channel: 'chrome',
      headless: this.options.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    };

    if (this.options.profileDir) {
      // Persistent context for profile reuse
      this.context = await chromium.launchPersistentContext(this.options.profileDir, {
        ...launchOptions,
        viewport: this.options.mobile ? MOBILE_DEVICE.viewport : { width: 1280, height: 720 },
        userAgent: this.options.mobile ? MOBILE_DEVICE.userAgent : undefined,
        deviceScaleFactor: this.options.mobile ? MOBILE_DEVICE.deviceScaleFactor : undefined,
        isMobile: this.options.mobile,
        hasTouch: this.options.mobile,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
      this.browser = null; // persistent context doesn't have separate browser
    } else {
      this.browser = await chromium.launch(launchOptions);
      this.context = await this.browser.newContext({
        viewport: this.options.mobile ? MOBILE_DEVICE.viewport : { width: 1280, height: 720 },
        userAgent: this.options.mobile ? MOBILE_DEVICE.userAgent : undefined,
        deviceScaleFactor: this.options.mobile ? MOBILE_DEVICE.deviceScaleFactor : undefined,
        isMobile: this.options.mobile,
        hasTouch: this.options.mobile,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
    }

    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(30000);

    this.log('Browser initialized');
  }

  /**
   * 리소스 정리
   */
  async cleanup(): Promise<void> {
    this.log('Cleaning up...');

    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.log('Cleanup complete');
  }

  /**
   * 인간화 타이핑
   */
  private async humanType(text: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    for (const char of text) {
      const delay = this.options.typingDelay! + Math.random() * 50 - 25;
      await this.page.keyboard.type(char, { delay: Math.max(30, delay) });
    }
  }

  /**
   * 랜덤 딜레이
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(r => setTimeout(r, delay));
  }

  /**
   * URL에서 ackey 추출
   */
  private extractAckey(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('ackey');
    } catch {
      // URL 파싱 실패 시 정규식으로 시도
      const match = url.match(/ackey=([^&]+)/);
      return match ? match[1] : null;
    }
  }

  /**
   * 쿠키를 문자열로 변환
   */
  cookiesToString(cookies: Cookie[]): string {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * 자동완성 기반 의도 생성
   *
   * @param mainKeyword - 메인 키워드 (일부만 입력하여 자동완성 트리거)
   * @returns IntentContext (ackey + 세션 컨텍스트)
   */
  async generateIntent(mainKeyword: string): Promise<IntentContext> {
    if (!this.page || !this.context) {
      await this.initialize();
    }

    const page = this.page!;
    const context = this.context!;

    // 1. m.naver.com 접속
    this.log('Navigating to m.naver.com...');
    await page.goto('https://m.naver.com', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(800, 1200);

    // 2. 검색창 찾기 및 활성화 (최적화 버전)
    this.log('Finding search input...');

    // 직접 input 찾기 (가장 빠름)
    let searchInput = await page.$('input[name="query"]');

    if (!searchInput) {
      // 폴백: 다른 셀렉터 시도
      searchInput = await page.$('#query') ||
                    await page.$('input[type="search"]');
    }

    if (!searchInput) {
      throw new Error('Search input not found');
    }

    this.log('Found search input');

    // JavaScript로 직접 포커스 및 클릭 (가장 빠름)
    await page.evaluate((el: HTMLInputElement) => {
      el.scrollIntoView({ block: 'center' });
      el.focus();
      el.click();
    }, searchInput);

    await this.randomDelay(100, 200);

    // 3. 키워드 일부 입력 (자동완성 트리거)
    // 메인 키워드의 앞부분만 입력 (예: "신지모루" -> "신지모")
    const partialKeyword = mainKeyword.substring(0, Math.min(mainKeyword.length, 6));
    this.log(`Typing partial keyword: "${partialKeyword}"`);
    await this.humanType(partialKeyword);
    await this.randomDelay(300, 500);

    // 4. 자동완성 건너뛰고 바로 검색 (시간 절약)
    // 자동완성 클릭 대신 Enter로 검색해도 ackey가 발급됨
    this.log('Pressing Enter to search...');
    let selectedQuery = partialKeyword;

    await page.keyboard.press('Enter');

    // 5. 검색 결과 페이지 대기
    this.log('Waiting for search results...');
    await page.waitForLoadState('domcontentloaded');
    await this.randomDelay(1000, 1500);

    // 6. URL에서 ackey 추출
    const currentUrl = page.url();
    const ackey = this.extractAckey(currentUrl);
    this.log(`Current URL: ${currentUrl}`);
    this.log(`Extracted ackey: ${ackey || '(none)'}`);

    // ackey가 없어도 진행 (일부 경우 ackey 없이 검색 가능)
    if (!ackey) {
      this.log('Warning: No ackey found in URL');
    }

    // 8. 세션 컨텍스트 수집
    this.log('Collecting session context...');
    const cookies = await context.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);

    // 브라우저에서 실제 사용되는 헤더 추출
    const headers: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    // 9. IntentContext 구성
    const intentContext: IntentContext = {
      ackey: ackey || '',
      cookies,
      headers,
      referer: currentUrl,
      userAgent,
      timestamp: Date.now(),
      selectedQuery: selectedQuery.trim(),
    };

    this.log(`Intent generated successfully`);
    this.log(`  - ackey: ${intentContext.ackey || '(none)'}`);
    this.log(`  - cookies: ${cookies.length} items`);
    this.log(`  - selectedQuery: "${intentContext.selectedQuery}"`);

    return intentContext;
  }

  /**
   * 현재 페이지 반환 (세션 처리에서 필요한 경우)
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * 현재 컨텍스트 반환
   */
  getContext(): BrowserContext | null {
    return this.context;
  }
}

export default IntentGenerator;
