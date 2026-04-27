/**
 * 네이버 쇼핑탭 순위 체크
 * - www.naver.com → 검색 → 실제 데스크톱 쇼핑탭 링크 클릭
 * - data-shp-contents-dtl JSON에서 chnl_prod_no / catalog_nv_mid 매칭
 * (sellermate_naver_rank_1 parallel-rank-checker 로직 기반)
 */
export interface RankCheckLog {
  (msg: string, level?: string): void;
}

/** Patchright Page | puppeteer-real-browser Page (API가 달라 any 유지) */
export type RankCheckPage = any;

/** CAPTCHA 솔버 콜백 — rank-check-shopping 이 외부 의존성 없이 주입받음 */
export type CaptchaSolverFn = (page: RankCheckPage) => Promise<boolean>;

export interface ShoppingRankDetail {
  rank: number | null;
  reviewCount: number | null;
  starRating: number | null;
  /** 상세페이지에서 추출한 상품명(2차 키워드 자동 채움용) */
  productTitle: string | null;
  /** 쇼핑 검색용 Catalog MID (catalog_nv_mid 또는 data-shp-contents-id) */
  catalogMid: string | null;
  /** 순위가 잡힌 결과의 실제 상세페이지 URL */
  detailUrl: string | null;
}

export interface VisibleSearchMidCardDebug {
  tag: string;
  cls: string | null;
  dataSlog: string | null;
  ids: string[];
  hrefs: string[];
  title: string;
}

export interface VisibleSearchMidDebug {
  mids: string[];
  cards: VisibleSearchMidCardDebug[];
}

/** 쇼핑탭 전환 후 통합검색 카드는 없으므로 stub */
export async function collectVisibleSearchMidDebug(_page: RankCheckPage, _limit = 12): Promise<VisibleSearchMidDebug> {
  return { mids: [], cards: [] };
}

/** 쇼핑탭 1페이지당 노출 개수 */
const ITEMS_PER_PAGE = 40;

const TITLE_MAX = 300;

/** parallel-rank-checker SAFE_DELAY_MS 와 동일 */
const SAFE_DELAY_MS = 1500;
/** hydrateCurrentPage: SCROLL_STEPS(18) * 550 */
const HYDRATE_SCROLL_TOTAL = 18 * 550;
const PAGE_EVALUATE_NAME_POLYFILL = "window.__name = window.__name || ((fn) => fn);";

function microDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureEvaluateNamePolyfill(page: RankCheckPage): Promise<void> {
  await page.evaluate(PAGE_EVALUATE_NAME_POLYFILL).catch(() => {});
}

/** rank_1 humanType 과 동일 (봇 탐지 회피) */
async function humanType(page: RankCheckPage, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char);
    await microDelay(50 + Math.random() * 100);
    if (Math.random() < 0.05) {
      await microDelay(200 + Math.random() * 300);
    }
  }
}

/** rank_1 humanScroll 과 동일 */
async function humanScroll(page: RankCheckPage, totalDistance: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < totalDistance) {
    const scrollAmount = 300 + Math.random() * 300;
    const actualScroll = Math.min(scrollAmount, totalDistance - scrolled);
    await page.evaluate((y: number) => window.scrollBy(0, y), actualScroll);
    scrolled += actualScroll;
    await microDelay(50 + Math.random() * 100);
    if (Math.random() < 0.03) {
      await microDelay(200 + Math.random() * 300);
    }
  }
}

const SHOPPING_HOST = "search.shopping.naver.com";

async function tripleClickSearchInput(page: RankCheckPage, log: RankCheckLog): Promise<boolean> {
  try {
    if (typeof page.locator === "function") {
      const raw = page.locator('input[name="query"]');
      if (raw && typeof raw.first === "function") {
        const searchInput = raw.first();
        await searchInput.waitFor({ state: "visible", timeout: 15000 });
        await searchInput.click({ clickCount: 3 });
        return true;
      }
    }
    if (typeof page.waitForSelector === "function") {
      const el = await page.waitForSelector('input[name="query"]', { visible: true, timeout: 15000 });
      if (!el) {
        log("검색 입력창 없음", "warn");
        return false;
      }
      await el.click({ clickCount: 3 });
      return true;
    }
  } catch {
    log("검색 입력창 없음", "warn");
    return false;
  }
  log("검색 입력창 API 미지원", "warn");
  return false;
}

async function isShoppingBlocked(page: RankCheckPage): Promise<boolean> {
  return page.evaluate(() => {
    const body = document.body?.innerText ?? "";
    return (
      body.includes("보안 확인") ||
      body.includes("자동 입력 방지") ||
      body.includes("일시적으로 제한")
    );
  });
}

function normalizeDetailTitle(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/ /g, " ")
    .trim();
}

async function extractDetailPageTitle(page: RankCheckPage): Promise<string | null> {
  try {
    const title = await page.evaluate(() => {
      const clean = (value: unknown): string => String(value || "").replace(/\s+/g, " ").replace(/ /g, " ").trim();
      const stripSuffix = (value: string): string => {
        let text = clean(value);
        text = text.replace(/\s*(?:\||·|:|\-|—)\s*(?:네이버.*|Naver.*|SmartStore.*)$/i, "").trim();
        text = text.replace(/\s*\|\s*$/, "").trim();
        return text;
      };
      const seen = new Set<string>();
      const candidates: string[] = [];
      const push = (value: unknown) => {
        const text = stripSuffix(String(value || ""));
        if (!text || seen.has(text)) return;
        seen.add(text);
        candidates.push(text);
      };
      const bodyText = clean(document.body?.innerText || "");
      const isErrorPage = /에러페이지|시스템오류|현재 서비스 접속이 불가합니다|Too Many Requests|접속이 불가합니다/i.test(
        `${document.title} ${bodyText}`
      );

      push(document.querySelector('meta[property="og:title"]')?.getAttribute("content"));
      push(document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"));
      push(document.querySelector('meta[name="title"]')?.getAttribute("content"));

      for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
        const raw = script.textContent?.trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            const anyItem = item as any;
            push(anyItem.name);
            push(anyItem.headline);
            push(anyItem.title);
          }
        } catch { /* ignore */ }
      }

      push(document.title);

      for (const sel of ["h1", "h2", "h3", "strong", "[itemprop='name']"]) {
        document.querySelectorAll(sel).forEach((el) => push(el.textContent));
      }

      if (isErrorPage) return null;

      for (const text of candidates) {
        if (text.length >= 4) return text;
      }
      return null;
    });
    return title ? normalizeDetailTitle(title) : null;
  } catch {
    return null;
  }
}

/**
 * 네이버 메인 → 통검 → 데스크톱 쇼핑 탭.
 * parallel-rank-checker와 동일하게 실제 쇼핑탭 링크만 클릭하고 직접 쇼핑 URL goto 폴백은 사용하지 않는다.
 */
async function enterShoppingTab(
  page: RankCheckPage,
  kw: string,
  _shoppingSearchPhrase: string,
  log: RankCheckLog,
  sleepMs: (ms: number) => Promise<void>,
  solveCaptcha?: CaptchaSolverFn
): Promise<boolean> {
  log("네이버 메인 진입…");
  try {
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch {
    log("네이버 메인 진입 실패", "warn");
    return false;
  }

  await sleepMs(SAFE_DELAY_MS);
  await ensureEvaluateNamePolyfill(page);

  const inputOk = await tripleClickSearchInput(page, log);
  if (!inputOk) return false;

  log(`네이버 검색어 입력: ${kw}`);
  await humanType(page, kw);
  await page.keyboard.press("Enter");

  log("검색 결과 대기 중…");
  if (typeof page.waitForNavigation === "function") {
    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      /* SPA 등으로 navigation 이벤트 없을 수 있음 */
    }
  } else {
    try {
      await page.waitForLoadState?.("domcontentloaded", { timeout: 15000 });
    } catch {
      /* ignore */
    }
  }
  await sleepMs(1000);
  await ensureEvaluateNamePolyfill(page);

  log("쇼핑탭으로 이동");
  let clicked = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    clicked = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('a[href*="search.shopping.naver.com"]');
      if (link) {
        link.removeAttribute("target");
        link.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (clicked) break;
    log(`쇼핑탭 대기 중… (${attempt}/5)`);
    await sleepMs(2000);
  }

  if (!clicked) {
    log("쇼핑탭 링크 없음", "warn");
    return false;
  }

  await sleepMs(SAFE_DELAY_MS + 800);
  await ensureEvaluateNamePolyfill(page);
  if (!page.url().includes(SHOPPING_HOST)) {
    log(`쇼핑탭 URL 미확인: ${page.url().substring(0, 100)}`, "warn");
    return false;
  }
  log(`쇼핑탭 진입 완료: ${page.url().substring(0, 100)}`);

  if (await isShoppingBlocked(page)) {
    log("보안/차단 페이지 감지", "warn");
    if (solveCaptcha) {
      const solved = await solveCaptcha(page).catch(() => false);
      if (!solved || await isShoppingBlocked(page)) {
        log("CAPTCHA 해결 실패 또는 차단 상태 유지", "warn");
        return false;
      }
    } else {
      return false;
    }
  }

  try {
    await page.waitForSelector("[data-shp-contents-id]", { timeout: 15000 });
  } catch { /* 없어도 진행 */ }
  await sleepMs(500);

  return true;
}

/**
 * 현재 쇼핑탭 페이지에서 data-shp-contents-dtl JSON 파싱으로 productId 매칭
 * parallel-rank-checker findRankByProductIdOnPage 와 동일한 로직
 */
async function findRankOnCurrentPage(
  page: RankCheckPage,
  targetMid: string,
  pageNum: number
): Promise<{ found: boolean; rank: number | null; reviewCount: number | null; starRating: number | null; productTitle: string | null; catalogMid: string | null; detailUrl: string | null }> {
  return page.evaluate(
    ({ targetId, pageNum, itemsPerPage, titleMax }: { targetId: string; pageNum: number; itemsPerPage: number; titleMax: number }) => {
      const clip = (s: string): string => {
        const t = s.replace(/\s+/g, " ").trim();
        return t.length > titleMax ? t.substring(0, titleMax) : t;
      };

      const extractFromProductItem = (productItem: Element) => {
        let reviewCount: number | null = null;
        let starRating: number | null = null;

        const reviewElements = productItem.querySelectorAll('.product_etc__Z7jnS, [class*="product_etc__"]');
        for (const elem of reviewElements) {
          const text = elem.textContent || "";
          if (text.includes("리뷰")) {
            const reviewMatch = text.match(/리뷰\s*(\d+)|\((\d+(?:,\d+)*)\)/);
            if (reviewMatch) {
              const reviewNum = reviewMatch[1] || reviewMatch[2];
              reviewCount = parseInt(reviewNum.replace(/,/g, ""), 10) || null;
              break;
            }
          }
        }

        const starEl =
          productItem.querySelector(".product_grade__O_5f5") ||
          productItem.querySelector('[class*="product_grade__"]');
        if (starEl) {
          const starText = starEl.textContent?.trim() || "";
          const starMatch = starText.match(/(\d+\.?\d*)/);
          if (starMatch) starRating = parseFloat(starMatch[1]) || null;
        }

        return { reviewCount, starRating };
      };

      const titleFromProductItem = (productItem: Element, fromJson: string | null): string | null => {
        if (fromJson && fromJson.trim()) return clip(fromJson);
        const img = productItem.querySelector<HTMLImageElement>(
          'img[src*="shopping-phinf.pstatic.net"], img[src*="shop-phinf.pstatic.net"], img[alt]'
        );
        const alt = img?.getAttribute("alt")?.trim();
        if (alt) return clip(alt);
        const titleEl =
          productItem.querySelector('[class*="product_title__"]') ||
          productItem.querySelector('[class*="product_name__"]');
        const tx = titleEl?.textContent?.trim();
        return tx ? clip(tx) : null;
      };

      const anchors = document.querySelectorAll(
        "a[data-shp-contents-id][data-shp-contents-rank][data-shp-contents-dtl]"
      );

      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        const dtl = anchor.getAttribute("data-shp-contents-dtl");
        const rankStr = anchor.getAttribute("data-shp-contents-rank");
        if (!dtl || !rankStr) continue;

        try {
          const normalized = dtl.replace(/&quot;/g, '"');
          const parsed = JSON.parse(normalized);
          if (!Array.isArray(parsed)) continue;

          let chnlProdNo: string | null = null;
          let catalogNvMid: string | null = null;
          let prodNm: string | null = null;

          for (const item of parsed) {
            if (item.key === "chnl_prod_no" && item.value) chnlProdNo = String(item.value);
            if (item.key === "catalog_nv_mid" && item.value) catalogNvMid = String(item.value);
            if (item.key === "prod_nm" && item.value) prodNm = String(item.value);
          }

          if (chnlProdNo !== targetId && catalogNvMid !== targetId) continue;

          const pageRank = parseInt(rankStr, 10);
          const rank = (pageNum - 1) * itemsPerPage + (Number.isFinite(pageRank) ? pageRank : i + 1);

          const productItem =
            anchor.closest(".product_item__KQayS") || anchor.closest('[class*="product_item__"]');
          const extra = productItem ? extractFromProductItem(productItem) : { reviewCount: null, starRating: null };
          const productTitle = productItem ? titleFromProductItem(productItem, prodNm) : prodNm ? clip(prodNm) : null;
          const catalogMid = catalogNvMid || anchor.getAttribute("data-shp-contents-id") || null;

          return {
            found: true,
            rank,
            reviewCount: extra.reviewCount,
            starRating: extra.starRating,
            productTitle,
            catalogMid,
            detailUrl: (anchor as HTMLAnchorElement).href || null,
          };
        } catch { /* 다음 앵커 */ }
      }

      return { found: false, rank: null, reviewCount: null, starRating: null, productTitle: null, catalogMid: null, detailUrl: null };
    },
    { targetId: targetMid, pageNum, itemsPerPage: ITEMS_PER_PAGE, titleMax: TITLE_MAX }
  );
}

async function goToNextPage(page: RankCheckPage, targetPage: number): Promise<boolean> {
  const paginationSelector = 'a.pagination_btn_page__utqBz, a[class*="pagination_btn"]';

  try {
    await page.waitForSelector(paginationSelector, { timeout: 10000 });
  } catch {
    return false;
  }

  const buttonExists = await page.evaluate((nextPage: number) => {
    const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === String(nextPage)) return true;
    }
    return false;
  }, targetPage);

  if (!buttonExists) return false;

  let apiResponsePromise: Promise<any> | null = null;
  if (typeof page.waitForResponse === "function") {
    apiResponsePromise = page.waitForResponse(
      (response: any) => {
        const url = response.url();
        return url.includes("/api/search/all") && url.includes(`pagingIndex=${targetPage}`);
      },
      { timeout: 30000 }
    ).catch(() => null);
  }

  try {
    const clicked = await page.evaluate((nextPage: number) => {
      const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === String(nextPage)) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, targetPage);

    if (!clicked) return false;
  } catch {
    return false;
  }

  if (apiResponsePromise) await apiResponsePromise;
  await microDelay(1500);
  await ensureEvaluateNamePolyfill(page);
  return true;
}

/**
 * @param targetMid smartstore URL의 /products/(\d+) 상품 번호
 * @param solveCaptcha CAPTCHA 발생 시 호출할 솔버 콜백 (optional)
 */
export async function findNaverShoppingRankByMid(
  page: RankCheckPage,
  keyword: string,
  targetMid: string,
  maxPages: number,
  log: RankCheckLog,
  sleepMs: (ms: number) => Promise<void>,
  solveCaptcha?: CaptchaSolverFn,
  shoppingSearchPhrase?: string
): Promise<ShoppingRankDetail> {
  const empty: ShoppingRankDetail = {
    rank: null,
    reviewCount: null,
    starRating: null,
    productTitle: null,
    catalogMid: null,
    detailUrl: null,
  };

  const mid = targetMid.trim();
  const kw = keyword.trim();
  if (!mid || !kw) {
    log("키워드 또는 MID 비어 있음");
    return empty;
  }

  const entered = await enterShoppingTab(page, kw, shoppingSearchPhrase || kw, log, sleepMs, solveCaptcha);
  if (!entered) return empty;

  const out: ShoppingRankDetail = { ...empty };

  for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
    if (currentPage > 1) {
      await sleepMs(1000 + Math.random() * 1000);
      const moved = await goToNextPage(page, currentPage);
      if (!moved) {
        log(`${currentPage - 1}페이지까지 탐색 종료(다음 페이지 없음)`);
        break;
      }
      if (await isShoppingBlocked(page)) {
        log("보안/차단 페이지 감지");
        break;
      }
    }

    // lazy loading 트리거
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
      await humanScroll(page, HYDRATE_SCROLL_TOTAL);
      await sleepMs(150);
    } catch (e: any) {
      if (e?.message?.includes("Target closed") || e?.message?.includes("Protocol error") || e?.message?.includes("Session closed")) {
        log(`페이지 연결 끊김: ${e.message}`, "warn");
        break;
      }
      throw e;
    }

    let result: Awaited<ReturnType<typeof findRankOnCurrentPage>>;
    try {
      result = await findRankOnCurrentPage(page, mid, currentPage);
    } catch (e: any) {
      if (e?.message?.includes("Target closed") || e?.message?.includes("Protocol error") || e?.message?.includes("Session closed")) {
        log(`페이지 연결 끊김: ${e.message}`, "warn");
        break;
      }
      throw e;
    }

    log(`${currentPage}페이지 수집: ${result.found ? `발견 (${result.rank}위)` : "미발견"}`);

    if (result.found && result.rank != null) {
      out.rank = result.rank;
      out.reviewCount = result.reviewCount;
      out.starRating = result.starRating;
      out.productTitle = result.productTitle || null;
      out.catalogMid = result.catalogMid || null;

      if (result.detailUrl) {
        try {
          await page.goto(result.detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
          await sleepMs(SAFE_DELAY_MS);
          const detailTitle = await extractDetailPageTitle(page);
          if (detailTitle) {
            out.productTitle = detailTitle;
          } else if (!out.productTitle) {
            log("상세페이지 제목 추출 실패", "warn");
          }
        } catch {
          if (!out.productTitle) log("상세페이지 진입 실패", "warn");
        }
      }
      break;
    }

    if (currentPage < maxPages) await sleepMs(SAFE_DELAY_MS);
  }

  return out;
}
