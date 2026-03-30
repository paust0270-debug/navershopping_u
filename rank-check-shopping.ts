/**
 * 네이버 통검 → 쇼핑 탭에서 상품 ID(/products/숫자) 기준 순위 + 리뷰·별점 + 목록 상품명
 * (sellermate_naver_rank_1 parallel-rank-checker DOM 추출 로직 참고)
 *
 * 페이지: Patchright(Playwright) 또는 start.bat과 동일한 puppeteer-real-browser Page
 */
export interface RankCheckLog {
  (msg: string): void;
}

/** Patchright Page | puppeteer-real-browser Page (API가 달라 any 유지) */
export type RankCheckPage = any;

export interface ShoppingRankDetail {
  rank: number | null;
  reviewCount: number | null;
  starRating: number | null;
  /** 목록 카드에서 추출한 상품명(2차 키워드 자동 채움용) */
  productTitle: string | null;
}

/** 쇼핑 목록 1페이지당 대략 노출 개수 (링크 스캔 폴백 순위 환산용) */
const ITEMS_PER_PAGE = 40;

const TITLE_MAX = 300;

/** rank_1 `parallel-rank-checker.ts` SAFE_DELAY_MS 와 동일 */
const SAFE_DELAY_MS = 1500;
/** `hydrateCurrentPage`: SCROLL_STEPS(18) * 550 */
const HYDRATE_SCROLL_TOTAL = 18 * 550;

function microDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** rank_1 `utils/humanBehavior.ts` humanType 과 동일 (봇 탐지 회피) */
async function humanType(page: RankCheckPage, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char);
    await microDelay(50 + Math.random() * 100);
    if (Math.random() < 0.05) {
      await microDelay(200 + Math.random() * 300);
    }
  }
}

/** rank_1 `utils/humanBehavior.ts` humanScroll 과 동일 */
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

/** sellermate_naver_rank_1 `parallel-rank-checker` enterShoppingTabForProductId 와 동일한 차단 문구 */
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

const SHOPPING_HOST = "search.shopping.naver.com";

async function tripleClickSearchInput(page: RankCheckPage, log: RankCheckLog): Promise<boolean> {
  try {
    // Patchright: locator().first() — PRB(puppeteer)는 locator 형태가 달라 waitForSelector 로만 처리
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
        log("검색 입력창 없음");
        return false;
      }
      await el.click({ clickCount: 3 });
      return true;
    }
  } catch {
    log("검색 입력창 없음");
    return false;
  }
  log("검색 입력창 API 미지원");
  return false;
}

/**
 * 네이버 메인 → 통검 → 쇼핑 탭 (rank_1 `parallel-rank-checker` enterShoppingTabForProductId 와 동일 흐름)
 * - humanType · triple-click · waitForNavigation · 탭 클릭 후 SAFE_DELAY_MS+800 만 대기
 * - 쇼핑 도메인 직접 goto 폴백 없음 (rank_1 과 동일; 직접 진입이 차단을 유발할 수 있음)
 */
async function enterNaverShoppingSearch(
  page: RankCheckPage,
  kw: string,
  log: RankCheckLog,
  sleepMs: (ms: number) => Promise<void>
): Promise<boolean> {
  log("네이버 메인 진입…");
  try {
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch {
    log("네이버 메인 진입 실패");
    return false;
  }

  await sleepMs(SAFE_DELAY_MS);

  const inputOk = await tripleClickSearchInput(page, log);
  if (!inputOk) return false;

  await humanType(page, kw);
  await page.keyboard.press("Enter");

  log("검색 결과 대기 중…");
  try {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
  } catch {
    /* SPA 등으로 navigation 이벤트 없을 수 있음 — rank_1 과 동일 */
  }

  await sleepMs(1000);

  log("쇼핑탭으로 이동");
  let clicked = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    clicked = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('a[href*="search.shopping.naver.com"]');
      if (!link) return false;
      link.removeAttribute("target");
      link.click();
      return true;
    });
    if (clicked) break;
    log(`쇼핑탭 대기 중… (${attempt}/5)`);
    await sleepMs(2000);
  }

  if (!clicked) {
    log("쇼핑탭 링크 없음");
    return false;
  }

  await sleepMs(SAFE_DELAY_MS + 800);
  if (!page.url().includes(SHOPPING_HOST)) {
    log("쇼핑탭 URL 미확인");
    return false;
  }

  if (await isShoppingBlocked(page)) {
    log("보안/차단 페이지 감지");
    return false;
  }
  return true;
}

/**
 * @param targetMid smartstore URL의 /products/(\d+) 상품 번호
 */
export async function findNaverShoppingRankByMid(
  page: RankCheckPage,
  keyword: string,
  targetMid: string,
  maxPages: number,
  log: RankCheckLog,
  sleepMs: (ms: number) => Promise<void>
): Promise<ShoppingRankDetail> {
  const empty: ShoppingRankDetail = {
    rank: null,
    reviewCount: null,
    starRating: null,
    productTitle: null,
  };

  const mid = targetMid.trim();
  const kw = keyword.trim();
  if (!mid || !kw) {
    log("키워드 또는 MID 비어 있음");
    return empty;
  }

  const entered = await enterNaverShoppingSearch(page, kw, log, sleepMs);
  if (!entered) {
    return empty;
  }

  const out: ShoppingRankDetail = { ...empty };
  let currentPage = 1;

  while (currentPage <= maxPages) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await humanScroll(page, HYDRATE_SCROLL_TOTAL);
    await sleepMs(150);

    const result = await page.evaluate(
      ({ targetId, pageNum, itemsPerPage, titleMax }: { targetId: string; pageNum: number; itemsPerPage: number; titleMax: number }) => {
        function clip(s: string): string {
          const t = s.replace(/\s+/g, " ").trim();
          return t.length > titleMax ? t.substring(0, titleMax) : t;
        }

        function titleFromProductItem(productItem: Element, fromJson: string | null): string | null {
          if (fromJson && fromJson.trim()) return clip(fromJson);
          const img = productItem.querySelector<HTMLImageElement>(
            'img[src*="shopping-phinf.pstatic.net"], img[src*="shop-phinf.pstatic.net"], img[alt]'
          );
          const alt = img?.getAttribute("alt")?.trim();
          if (alt) return clip(alt);
          const titleEl =
            productItem.querySelector(".product_title__") ||
            productItem.querySelector('[class*="product_title__"]');
          const tx = titleEl?.textContent?.trim();
          return tx ? clip(tx) : null;
        }

        function extractFromProductItem(productItem: Element) {
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
            if (starMatch) {
              starRating = parseFloat(starMatch[1]) || null;
            }
          }

          return { reviewCount, starRating };
        }

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
            let prodNm: string | null = null;
            for (const item of parsed) {
              if (item.key === "chnl_prod_no" && item.value) {
                chnlProdNo = String(item.value);
              }
              if (item.key === "prod_nm" && item.value) {
                prodNm = String(item.value);
              }
            }
            if (!chnlProdNo || chnlProdNo !== targetId) continue;

            const pageRank = parseInt(rankStr, 10);
            const rank = (pageNum - 1) * 40 + (Number.isFinite(pageRank) ? pageRank : i + 1);

            const productItem =
              anchor.closest(".product_item__KQayS") || anchor.closest('[class*="product_item__"]');
            const extra = productItem
              ? extractFromProductItem(productItem)
              : { reviewCount: null, starRating: null };
            const productTitle = productItem
              ? titleFromProductItem(productItem, prodNm)
              : prodNm
                ? clip(prodNm)
                : null;

            return {
              found: true,
              rank,
              reviewCount: extra.reviewCount,
              starRating: extra.starRating,
              productTitle,
            };
          } catch {
            /* 다음 앵커 */
          }
        }

        const mids: string[] = [];
        const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];
        document.querySelectorAll("a").forEach((a) => {
          const href = (a as HTMLAnchorElement).href || "";
          for (const p of patterns) {
            const hit = href.match(p);
            if (hit && !mids.includes(hit[1])) {
              mids.push(hit[1]);
              break;
            }
          }
        });
        const idx = mids.indexOf(targetId);
        if (idx === -1) {
          return {
            found: false,
            rank: null,
            reviewCount: null,
            starRating: null,
            productTitle: null,
          };
        }
        const rank = (pageNum - 1) * itemsPerPage + idx + 1;
        let reviewCount: number | null = null;
        let starRating: number | null = null;
        let productTitle: string | null = null;
        const linkEl = document.querySelector<HTMLAnchorElement>(
          `a[href*="/products/${targetId}"], a[href*="products%2F${targetId}"]`
        );
        const container =
          linkEl?.closest(".product_item__KQayS") || linkEl?.closest('[class*="product_item__"]');
        if (container) {
          const ex = extractFromProductItem(container);
          reviewCount = ex.reviewCount;
          starRating = ex.starRating;
          productTitle = titleFromProductItem(container, null);
        }
        return { found: true, rank, reviewCount, starRating, productTitle };
      },
      { targetId: mid, pageNum: currentPage, itemsPerPage: ITEMS_PER_PAGE, titleMax: TITLE_MAX }
    );

    log(`${currentPage}페이지 수집: ${result.found ? "발견" : "미발견"}`);

    if (result.found && result.rank != null) {
      out.rank = result.rank;
      out.reviewCount = result.reviewCount;
      out.starRating = result.starRating;
      out.productTitle = result.productTitle;
      break;
    }

    const nextClicked = await page.evaluate((nextPage: number) => {
      const selectors = [".pagination_num__B3C28", 'a[class*="pagination"]', 'a[href*="pagingIndex"]'];
      for (const sel of selectors) {
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
          if (btn.textContent?.trim() === String(nextPage)) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }
      const nextSelectors = [".pagination_next__pZuC6", 'a[class*="next"]'];
      for (const sel of nextSelectors) {
        const nextBtn = document.querySelector(sel);
        if (nextBtn && !(nextBtn as HTMLElement).classList.contains("pagination_disabled__qUdaH")) {
          (nextBtn as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, currentPage + 1);

    if (!nextClicked) {
      log(`${currentPage}페이지까지 탐색 종료(다음 페이지 없음)`);
      break;
    }
    await sleepMs(1000);
    currentPage++;
  }

  return out;
}
