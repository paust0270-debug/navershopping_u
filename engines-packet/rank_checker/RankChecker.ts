/**
 * Rank Checker
 * 네이버 쇼핑 검색 결과에서 특정 상품의 순위 체크
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "patchright";
import type {
  RankCheckInput,
  RankResult,
  RankCheckerConfig,
} from "./types";
import { extractMid, isValidMid } from "./MidExtractor";
import {
  parseProductsFromDOM,
  checkIfBlocked,
  checkNoResults,
  findMidInList,
} from "./PageParser";

const DEFAULT_CONFIG: Required<RankCheckerConfig> = {
  headless: false,
  timeout: 30000,
  userAgent: "",
};

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_DELAY = 2500; // ms

export class RankChecker {
  private config: Required<RankCheckerConfig>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private log: (msg: string) => void;

  constructor(config?: RankCheckerConfig, logFn?: (msg: string) => void) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = logFn || console.log;
  }

  /**
   * 브라우저 초기화
   */
  async initialize(): Promise<void> {
    this.log("[RankChecker] Initializing browser...");

    this.browser = await chromium.launch({
      channel: "chrome",
      headless: this.config.headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    // 실제 User-Agent 가져오기
    const tempPage = await this.browser.newPage();
    const realUserAgent = await tempPage.evaluate(() => navigator.userAgent);
    const chromeVersion = realUserAgent.match(/Chrome\/(\d+)/)?.[1] || "131";
    await tempPage.close();

    // BrowserContext 생성
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent: this.config.userAgent || realUserAgent,
      extraHTTPHeaders: {
        "sec-ch-ua": `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-platform-version": '"15.0.0"',
        "sec-ch-ua-arch": '"x86"',
        "sec-ch-ua-bitness": '"64"',
        "sec-ch-ua-full-version-list": `"Chromium";v="${chromeVersion}.0.0.0", "Google Chrome";v="${chromeVersion}.0.0.0", "Not-A.Brand";v="99.0.0.0"`,
        "sec-ch-ua-wow64": "?0",
      },
    });

    this.page = await this.context.newPage();

    // Anti-detection 스크립트 주입
    await this.injectAntiDetection();

    this.log("[RankChecker] Browser initialized");
  }

  /**
   * Anti-detection 스크립트 주입
   */
  private async injectAntiDetection(): Promise<void> {
    if (!this.page) return;

    await this.page.addInitScript(() => {
      // navigator.webdriver 숨기기
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      // Chrome 객체 에뮬레이션
      (window as any).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };

      // Permissions API 패치
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "prompt" } as PermissionStatus)
          : originalQuery(parameters);

      // navigator 속성 패치
      Object.defineProperty(navigator, "maxTouchPoints", {
        get: () => 0,
      });
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 8,
      });
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8,
      });
      Object.defineProperty(navigator, "platform", {
        get: () => "Win32",
      });
    });
  }

  /**
   * 순위 체크 메인 함수
   */
  async checkRank(input: RankCheckInput): Promise<RankResult> {
    const startTime = Date.now();
    const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
    const pageDelay = input.pageDelay ?? DEFAULT_PAGE_DELAY;

    // 1. 브라우저 초기화 (MID 추출에 필요할 수 있음)
    if (!this.page) {
      await this.initialize();
    }

    // 2. MID 추출 (스마트스토어는 페이지 방문 필요)
    let mid = await this.extractNvMid(input.productUrl);
    if (!isValidMid(mid)) {
      return {
        found: false,
        totalScanned: 0,
        keyword: input.keyword,
        mid: mid || "INVALID",
        timestamp: startTime,
        error: "Invalid MID: Could not extract nvMid from URL",
      };
    }

    this.log(`[RankChecker] Target nvMid: ${mid}`);
    this.log(`[RankChecker] Keyword: ${input.keyword}`);

    let totalScanned = 0;

    try {
      // 3. 네이버 메인 → 검색 → 쇼핑탭 (자연스러운 흐름)
      this.log(`[RankChecker] Navigating via Naver main...`);

      // 네이버 메인 접속
      await this.page!.goto("https://www.naver.com", {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeout,
      });
      await this.delay(1500);

      // 검색창에 키워드 입력 후 검색
      await this.page!.fill('input[name="query"]', input.keyword);
      await this.delay(500);
      await this.page!.press('input[name="query"]', 'Enter');
      await this.page!.waitForLoadState("domcontentloaded");
      await this.delay(1500);

      // 쇼핑 검색 페이지로 이동 (더보기 링크 클릭 방식)
      // Naver 통합검색의 쇼핑 탭은 SPA 방식이라 URL이 변경되지 않음
      // "더보기" 링크를 클릭하면 새 탭으로 열림 - 새 탭을 감지하여 전환해야 함
      let navigatedToShopping = false;

      // 방법 1: 쇼핑 섹션의 "더보기" 링크 찾기 (새 탭 열림 처리)
      try {
        this.log(`[RankChecker] Looking for shopping section "더보기" link...`);

        // 페이지를 스크롤하면서 쇼핑 섹션 찾기
        for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
          // search.shopping.naver.com/search/all 링크 찾기 (더보기 링크)
          const moreLink = this.page!.locator('a[href*="search.shopping.naver.com/search/all"]').first();

          if (await moreLink.isVisible({ timeout: 1000 }).catch(() => false)) {
            this.log(`[RankChecker] Found shopping "더보기" link`);
            await moreLink.scrollIntoViewIfNeeded();
            await this.delay(500);

            // 링크 클릭 시 새 탭이 열릴 수 있으므로 popup 이벤트 리스너 설정
            const [newPage] = await Promise.all([
              this.context!.waitForEvent('page', { timeout: 10000 }),
              moreLink.click(),
            ]);

            // 새 페이지로 전환
            this.page = newPage;
            await this.page.waitForLoadState("domcontentloaded");
            await this.delay(1500);
            this.log(`[RankChecker] Navigated to shopping via "더보기" link (new tab)`);
            navigatedToShopping = true;
            break;
          }

          // 스크롤 다운
          await this.page!.evaluate(() => window.scrollBy(0, 500));
          await this.delay(800);
        }
      } catch (error) {
        this.log(`[RankChecker] "더보기" link click failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 방법 2: "네이버 가격비교 더보기" 텍스트로 찾기 (새 탭 열림 처리)
      if (!navigatedToShopping) {
        try {
          this.log(`[RankChecker] Trying to find "더보기" by text...`);

          const moreTexts = ['네이버 가격비교 더보기', '네이버플러스 스토어 더보기', '쇼핑 더보기'];
          for (const text of moreTexts) {
            const link = this.page!.locator(`a:has-text("${text}")`).first();
            if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
              this.log(`[RankChecker] Found link with text: ${text}`);
              await link.scrollIntoViewIfNeeded();
              await this.delay(500);

              // 새 탭 열림 처리
              const [newPage] = await Promise.all([
                this.context!.waitForEvent('page', { timeout: 10000 }),
                link.click(),
              ]);

              this.page = newPage;
              await this.page.waitForLoadState("domcontentloaded");
              await this.delay(1500);
              this.log(`[RankChecker] Navigated to shopping via "${text}" link (new tab)`);
              navigatedToShopping = true;
              break;
            }
          }
        } catch (error) {
          this.log(`[RankChecker] Text-based "더보기" search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // 방법 3: 쇼핑 탭 클릭 시도 (일부 경우 동작할 수 있음)
      if (!navigatedToShopping) {
        try {
          this.log(`[RankChecker] Trying shopping tab click as fallback...`);
          const shoppingTab = this.page!.getByRole('tab', { name: '쇼핑' });
          await shoppingTab.click();
          await this.delay(2000);

          // 탭 클릭 후 URL 확인
          const urlAfterTab = this.page!.url();
          if (urlAfterTab.includes('shopping.naver.com')) {
            navigatedToShopping = true;
            this.log(`[RankChecker] Shopping tab click worked`);
          }
        } catch {
          this.log(`[RankChecker] Shopping tab click failed`);
        }
      }

      // 쇼핑 페이지인지 확인
      const currentUrl = this.page!.url();
      if (!navigatedToShopping || !currentUrl.includes('shopping.naver.com')) {
        this.log(`[RankChecker] Not on shopping page (URL: ${currentUrl})`);
        this.log(`[RankChecker] Cannot proceed - direct navigation would be blocked`);
        return {
          found: false,
          totalScanned: 0,
          keyword: input.keyword,
          mid,
          timestamp: startTime,
          error: "Failed to navigate to shopping page via natural flow",
        };
      }

      this.log(`[RankChecker] Current URL: ${this.page!.url()}`);

      // 4. 페이지별 검색 (버튼 클릭 방식)
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        this.log(`[RankChecker] Scanning page ${pageNum}...`);

        // 차단 확인
        const blockCheck = await this.page!.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const url = window.location.href;

          // URL에 captcha가 포함되면 차단
          if (url.includes('captcha') || url.includes('challenge')) {
            return { blocked: true, reason: 'captcha URL', url };
          }

          // 특정 차단 문구 확인
          const blockedPhrases = [
            '서비스 접속이 일시적으로 제한되었습니다',
            '비정상적인 접근이 감지',
            '실제 사용자임을 확인',
            '영수증의 가게 위치는',
          ];

          for (const phrase of blockedPhrases) {
            if (bodyText.includes(phrase)) {
              return { blocked: true, reason: phrase, url };
            }
          }

          return { blocked: false, url };
        });

        if (blockCheck.blocked) {
          this.log(`[RankChecker] Access blocked: ${blockCheck.reason}`);
          this.log(`[RankChecker] URL: ${blockCheck.url}`);
          return {
            found: false,
            totalScanned,
            keyword: input.keyword,
            mid,
            timestamp: startTime,
            error: "Access blocked by Naver Shopping",
          };
        }

        // 검색 결과 없음 확인
        const noResults = await this.page!.evaluate(checkNoResults);
        if (noResults) {
          this.log("[RankChecker] No search results");
          return {
            found: false,
            totalScanned,
            keyword: input.keyword,
            mid,
            timestamp: startTime,
            error: "No search results for keyword",
          };
        }

        // 무한 스크롤로 모든 상품 로드 (각 페이지마다 실행)
        await this.scrollToLoadAllProducts();

        // DOM에서 MID 목록 추출
        const { mids, hasMore } = await this.page!.evaluate(parseProductsFromDOM);
        this.log(`[RankChecker] Page ${pageNum}: Found ${mids.length} products`);

        // 목표 MID 찾기
        const rank = findMidInList(mids, mid, totalScanned);
        if (rank !== -1) {
          this.log(`[RankChecker] Found! Rank: ${rank}`);
          return {
            found: true,
            rank,
            page: pageNum,
            totalScanned: totalScanned + mids.indexOf(mid) + 1,
            keyword: input.keyword,
            mid,
            timestamp: startTime,
          };
        }

        totalScanned += mids.length;

        // 다음 페이지 없으면 종료
        if (!hasMore || mids.length === 0) {
          this.log("[RankChecker] No more pages");
          break;
        }

        // 페이지 간 딜레이 (차단 방지)
        if (pageNum < maxPages) {
          this.log(`[RankChecker] Waiting ${pageDelay}ms before next page...`);
          await this.delay(pageDelay);

          // 다음 페이지로 버튼 클릭 이동
          const nextClicked = await this.clickNextPageButton(pageNum + 1);
          if (!nextClicked) {
            this.log("[RankChecker] Failed to click next page button");
            break;
          }

          // 페이지 로드 대기
          await this.delay(2000);
        }
      }

      // 모든 페이지 검색 완료, 상품 미발견
      this.log(`[RankChecker] Not found in ${maxPages} pages (${totalScanned} products scanned)`);
      return {
        found: false,
        totalScanned,
        keyword: input.keyword,
        mid,
        timestamp: startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`[RankChecker] Error: ${errorMsg}`);
      return {
        found: false,
        totalScanned,
        keyword: input.keyword,
        mid,
        timestamp: startTime,
        error: errorMsg,
      };
    }
  }

  /**
   * 검색 URL 생성 (첫 페이지 전용)
   */
  private buildSearchUrl(keyword: string): string {
    const encodedKeyword = encodeURIComponent(keyword);
    return `https://search.shopping.naver.com/search/all?query=${encodedKeyword}`;
  }

  /**
   * URL에서 실제 nvMid 추출
   * 스마트스토어/브랜드스토어는 페이지 방문하여 nvMid 추출
   */
  private async extractNvMid(url: string): Promise<string | null> {
    if (!url) return null;

    // 이미 nvMid가 있는 URL (네이버쇼핑 URL)
    const nvMidMatch = url.match(/[?&](?:nv_mid|nvMid)=(\d+)/i);
    if (nvMidMatch) {
      return nvMidMatch[1];
    }

    // 스마트스토어/브랜드스토어 URL인 경우 페이지 방문 필요
    const isSmartStore = url.includes('smartstore.naver.com') || url.includes('brand.naver.com');
    if (isSmartStore && this.page) {
      this.log(`[RankChecker] Fetching nvMid from smartstore page...`);

      try {
        await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.timeout,
        });
        await this.delay(1500);

        // 페이지에서 nvMid 추출
        const nvMid = await this.page.evaluate(() => {
          const html = document.documentElement.outerHTML;
          // nvMid 패턴 찾기
          const match = html.match(/nvMid["'\s:=]+["']?(\d+)/i);
          return match ? match[1] : null;
        });

        if (nvMid) {
          this.log(`[RankChecker] Found nvMid: ${nvMid}`);
          // 스마트스토어에서 네이버쇼핑으로 이동 전 딜레이
          await this.delay(2000);
          return nvMid;
        }

        // productNo는 있지만 nvMid가 없는 경우 로그
        const productNo = url.match(/\/products\/(\d+)/)?.[1];
        this.log(`[RankChecker] nvMid not found in page (productNo: ${productNo})`);
        return null;
      } catch (error) {
        this.log(`[RankChecker] Failed to fetch nvMid: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }

    // 기존 extractMid 함수로 폴백
    return extractMid(url);
  }

  /**
   * 다음 페이지 버튼 클릭
   * @param targetPage 이동할 페이지 번호
   * @returns 클릭 성공 여부
   */
  private async clickNextPageButton(targetPage: number): Promise<boolean> {
    if (!this.page) return false;

    try {
      // 먼저 페이지 하단으로 스크롤하여 페이지네이션 영역 표시
      this.log(`[RankChecker] Scrolling to pagination area...`);
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.delay(500);

      // 방법 1: 페이지네이션 영역에서 정확한 페이지 번호 링크 찾기
      // 네이버 쇼핑 페이지네이션: 숫자만 있는 링크 (예: "2", "3")
      const pageLink = await this.page.evaluate((target) => {
        // 페이지네이션 영역의 모든 링크 찾기
        const links = document.querySelectorAll('a');
        for (const link of links) {
          const text = link.textContent?.trim();
          // 정확히 페이지 번호만 있는 링크 찾기
          if (text === String(target)) {
            // 페이지네이션 영역인지 확인 (주변에 다른 숫자 링크가 있는지)
            const parent = link.parentElement?.parentElement;
            if (parent) {
              const siblingLinks = parent.querySelectorAll('a');
              const hasOtherNumbers = Array.from(siblingLinks).some(
                (s) => /^\d+$/.test(s.textContent?.trim() || '') && s !== link
              );
              if (hasOtherNumbers) {
                return true; // 페이지네이션 링크 발견
              }
            }
          }
        }
        return false;
      }, targetPage);

      if (pageLink) {
        // 페이지네이션 영역으로 스크롤 후 클릭
        this.log(`[RankChecker] Clicking page ${targetPage} link...`);

        // 페이지네이션 버튼 클릭 (더 구체적인 셀렉터 사용)
        const clicked = await this.page.evaluate((target) => {
          const links = document.querySelectorAll('a');
          for (const link of links) {
            const text = link.textContent?.trim();
            if (text === String(target)) {
              // 페이지네이션 영역인지 확인
              const parent = link.closest('[class*="pagination"]') ||
                link.closest('[class*="Pagination"]') ||
                link.parentElement?.parentElement;
              if (parent) {
                const siblingLinks = parent.querySelectorAll('a');
                const hasOtherNumbers = Array.from(siblingLinks).some(
                  (s) => /^\d+$/.test(s.textContent?.trim() || '') && s !== link
                );
                if (hasOtherNumbers) {
                  (link as HTMLElement).click();
                  return true;
                }
              }
            }
          }
          return false;
        }, targetPage);

        if (clicked) {
          await this.page.waitForLoadState("domcontentloaded");
          await this.delay(1000);
          return true;
        }
      }

      // 방법 2: "다음" 링크 클릭 (text가 "다음"인 링크)
      const hasNextLink = await this.page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent?.trim() === '다음') {
            return true;
          }
        }
        return false;
      });

      if (hasNextLink) {
        this.log(`[RankChecker] Clicking "다음" (next) link...`);
        await this.page.click('a:text-is("다음")');
        await this.page.waitForLoadState("domcontentloaded");
        return true;
      }

      this.log(`[RankChecker] No pagination button found for page ${targetPage}`);
      return false;
    } catch (error) {
      this.log(`[RankChecker] Click error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 딜레이 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 무한 스크롤로 모든 상품 로드
   * 네이버 쇼핑은 스크롤 시 추가 상품이 로드됨
   */
  private async scrollToLoadAllProducts(): Promise<void> {
    if (!this.page) return;

    this.log(`[RankChecker] Scrolling to load all products...`);

    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 15; // 최대 스크롤 횟수 (무한 루프 방지)

    while (scrollAttempts < maxScrollAttempts) {
      // 현재 페이지 높이 확인
      const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);

      // 더 이상 새 콘텐츠가 로드되지 않으면 종료
      if (currentHeight === previousHeight) {
        this.log(`[RankChecker] Scroll complete (no new content)`);
        break;
      }

      previousHeight = currentHeight;
      scrollAttempts++;

      // 페이지 끝으로 스크롤
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // 콘텐츠 로드 대기
      await this.delay(800);
    }

    // 스크롤 후 페이지 상단으로 복귀 (선택적)
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.delay(300);

    this.log(`[RankChecker] Scroll finished after ${scrollAttempts} attempts`);
  }

  /**
   * 브라우저 종료
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
    this.log("[RankChecker] Browser closed");
  }

  /**
   * 현재 페이지 반환 (디버깅용)
   */
  getPage(): Page | null {
    return this.page;
  }
}
