/**
 * 네이버 통합검색에서 상품 ID(/products/숫자) 기준 순위 + 리뷰·별점 + 상세페이지 제목
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
  /** 상세페이지에서 추출한 상품명(2차 키워드 자동 채움용) */
  productTitle: string | null;
  /** 쇼핑 검색용 Catalog MID (data-shp-contents-id) — chnl_prod_no와 다를 수 있음 */
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

export async function collectVisibleSearchMidDebug(page: RankCheckPage, limit = 12): Promise<VisibleSearchMidDebug> {
  return page.evaluate(({ limit }: { limit: number }) => {
    const cards = Array.from(
      document.querySelectorAll("li._slog_visible, section._slog_visible, div._slog_visible")
    ) as HTMLElement[];
    const mids: string[] = [];
    const result: VisibleSearchMidCardDebug[] = [];

    const pushMid = (mid: string | null | undefined) => {
      if (!mid) return;
      if (!mids.includes(mid)) mids.push(mid);
    };

    for (const card of cards) {
      const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const hrefs: string[] = [];
      const ids: string[] = [];

      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (href) hrefs.push(href);
        for (const m of [
          href.match(/(?:nv_mid|nvMid)=(\d+)/),
          href.match(/\/main\/products\/(\d+)/),
          href.match(/\/products\/(\d+)/),
          href.match(/searchGate\?[^#]*nv_mid=(\d+)/),
        ]) {
          if (m) pushMid(m[1]);
        }
        const aria = a.getAttribute("aria-labelledby") || "";
        const m2 = aria.match(/(?:nstore_productId|view_type_guide)_(\d+)/);
        if (m2) pushMid(m2[1]);
      }

      for (const el of Array.from(card.querySelectorAll<HTMLElement>("[id]"))) {
        const id = el.id || "";
        if (!id) continue;
        const nm = id.match(/(?:nstore_productId|view_type_guide)_(\d+)/);
        if (nm) pushMid(nm[1]);
        if (ids.length < 4) ids.push(id);
      }

      if (!hrefs.length && !ids.length) continue;
      const titleEl = card.querySelector('strong span:last-child, [class*="title"], [class*="name"], img[alt]');
      const title = titleEl
        ? ((titleEl as HTMLImageElement).getAttribute?.("alt") || titleEl.textContent || "").trim().replace(/\s+/g, " ")
        : "";
      result.push({
        tag: card.tagName,
        cls: card.className || null,
        dataSlog: card.getAttribute("data-slog-content"),
        ids,
        hrefs: hrefs.slice(0, 3),
        title: title.slice(0, 140),
      });
      if (result.length >= limit) break;
    }

    return { mids, cards: result };
  }, { limit });
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

function normalizeDetailTitle(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

async function extractDetailPageTitle(page: RankCheckPage): Promise<string | null> {
  try {
    const title = await page.evaluate(() => {
      const clean = (value: unknown): string => String(value || "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
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
      push(document.querySelector('meta[property="product:price:amount"]')?.getAttribute("content"));

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
        } catch {
          /* ignore bad json-ld */
        }
      }

      push(document.title);

      for (const sel of ["h1", "h2", "h3", "strong", "[itemprop='name']"]) {
        document.querySelectorAll(sel).forEach((el) => push(el.textContent));
      }

      if (isErrorPage) return null;

      for (const text of candidates) {
        if (text.length >= 4) {
          return text;
        }
      }

      return null;
    });
    return title ? normalizeDetailTitle(title) : null;
  } catch {
    return null;
  }
}

const SEARCH_HOST = "search.naver.com";

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
 * 네이버 통합검색 진입 → 통합검색 결과 페이지에서 쇼핑 상품 카드 탐색
 * - 쇼핑탭 클릭 없이 통합검색 결과 페이지에서 바로 카드 셀렉터를 탐색한다.
 * - direct goto 방식을 사용한다.
 */
async function enterNaverShoppingSearch(
  page: RankCheckPage,
  kw: string,
  log: RankCheckLog,
  sleepMs: (ms: number) => Promise<void>
): Promise<boolean> {
  log("네이버 통합검색 진입…");
  try {
    await page.goto(`https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(kw)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
  } catch {
    log("네이버 통합검색 진입 실패");
    return false;
  }

  // esbuild/tsx __name polyfill (브라우저 컨텍스트)
  await page.evaluate(() => { (window as any).__name = (fn: any) => fn; }).catch(() => {});

  await sleepMs(SAFE_DELAY_MS);
  log("통합검색 결과 대기 중…");

  if (!page.url().includes(SEARCH_HOST)) {
    log("통합검색 URL 미확인");
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
    catalogMid: null,
    detailUrl: null,
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

  // esbuild/tsx가 page.evaluate 내부 함수에 __name() 래퍼를 주입하므로 브라우저에 polyfill 필요
  await page.evaluate(() => {
    (window as any).__name = (fn: any) => fn;
  }).catch(() => {});

  const out: ShoppingRankDetail = { ...empty };
  let currentPage = 1;

  while (currentPage <= maxPages) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await humanScroll(page, HYDRATE_SCROLL_TOTAL);
    await sleepMs(150);

    const result = await page.evaluate(
      ({ targetId, pageNum, itemsPerPage, titleMax }: { targetId: string; pageNum: number; itemsPerPage: number; titleMax: number }) => {
        const clip = (s: string): string => {
          const t = s.replace(/\s+/g, " ").trim();
          return t.length > titleMax ? t.substring(0, titleMax) : t;
        };

        const titleFromProductItem = (productItem: Element, fromJson: string | null): string | null => {
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
            let catalogNvMid: string | null = null;
            let prodNm: string | null = null;
            for (const item of parsed) {
              if (item.key === "chnl_prod_no" && item.value) {
                chnlProdNo = String(item.value);
              }
              if (item.key === "catalog_nv_mid" && item.value) {
                catalogNvMid = String(item.value);
              }
              if (item.key === "prod_nm" && item.value) {
                prodNm = String(item.value);
              }
            }
            // parallel-rank-checker와 동일: chnl_prod_no 또는 catalog_nv_mid로 매칭
            if (chnlProdNo !== targetId && catalogNvMid !== targetId) continue;

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

            // catalogNvMid (dtl 내부) 우선, 없으면 data-shp-contents-id
            const catalogMid = catalogNvMid || anchor.getAttribute("data-shp-contents-id") || null;
            return {
              found: true,
              rank,
              reviewCount: extra.reviewCount,
              starRating: extra.starRating,
              productTitle,
              catalogMid,
              detailUrl: anchor.href || null,
            };
          } catch {
            /* 다음 앵커 */
          }
        }

        // 통합검색 grid 영역(플러스스토어/가격비교/쇼핑 카드) 우선 탐색
        const integratedCards = Array.from(
          document.querySelectorAll("li._slog_visible, li[data-slog-content], div[data-slog-content], article[data-slog-content]")
        );
        for (let i = 0; i < integratedCards.length; i++) {
          const card = integratedCards[i] as HTMLElement;
          const anchor = card.querySelector<HTMLAnchorElement>("a[href]");
          const href = anchor?.href || "";
          const ids = [
            href.match(/(?:nv_mid|nvMid)=(\d+)/)?.[1] || null,
            href.match(/\/products\/(\d+)/)?.[1] || null,
            card.id.match(/nstore_productId_(\d+)/)?.[1] || null,
            card.id.match(/view_type_guide_(\d+)/)?.[1] || null,
            card.querySelector('[id^="nstore_productId_"]')?.id.match(/nstore_productId_(\d+)/)?.[1] || null,
            card.querySelector('[id^="view_type_guide_"]')?.id.match(/view_type_guide_(\d+)/)?.[1] || null,
          ].filter((v): v is string => Boolean(v));
          if (!ids.includes(targetId)) continue;

          const pageRank = i + 1;
          const rank = (pageNum - 1) * itemsPerPage + pageRank;
          const img = card.querySelector<HTMLImageElement>("img[alt]");
          const alt = img?.getAttribute("alt")?.trim();
          const titleEl =
            card.querySelector("strong span:last-child") ||
            card.querySelector('[class*="title"]') ||
            card.querySelector('[class*="name"]');
          const productTitle = alt || titleEl?.textContent?.trim() || null;
          const catalogMid = ids.find((id) => id !== targetId) || targetId;
          return {
            found: true,
            rank,
            reviewCount: null,
            starRating: null,
            productTitle: productTitle ? clip(productTitle) : null,
            catalogMid,
            detailUrl: anchor.href || null,
          };
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
            catalogMid: null,
            detailUrl: null,
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
        // fallback: 카드에서 data-shp-contents-id 추출 시도
        const card = linkEl?.closest('[data-shp-contents-id]') || container?.closest('[data-shp-contents-id]');
        const catalogMid = card?.getAttribute('data-shp-contents-id') || null;
        return { found: true, rank, reviewCount, starRating, productTitle, catalogMid, detailUrl: linkEl?.href || null };
      },
      { targetId: mid, pageNum: currentPage, itemsPerPage: ITEMS_PER_PAGE, titleMax: TITLE_MAX }
    );

    log(`${currentPage}페이지 수집: ${result.found ? "발견" : "미발견"}`);

    if (!result.found && process.env.NAVERSHOPPING_DEBUG_VISIBLE_MIDS === "1") {
      const debug = await collectVisibleSearchMidDebug(page, 12).catch(() => null);
      if (debug) {
        log(
          `[DEBUG] visible mids p${currentPage}: ${debug.mids.length ? debug.mids.join(", ") : "(none)"}`,
          "warn"
        );
        debug.cards.slice(0, 8).forEach((card, idx) => {
          log(
            `[DEBUG] card ${idx + 1}: tag=${card.tag} ids=${card.ids.join("|") || "-"} title=${card.title || "-"}`,
            "warn"
          );
        });
      }
    }

    if (result.found && result.rank != null) {
      out.rank = result.rank;
      out.reviewCount = result.reviewCount;
      out.starRating = result.starRating;
      out.productTitle = result.productTitle || null;
      out.catalogMid = result.catalogMid || null;

      if (result.detailUrl) {
        try {
          await page.goto(result.detailUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await sleepMs(SAFE_DELAY_MS);
          const detailTitle = await extractDetailPageTitle(page);
          if (detailTitle) {
            out.productTitle = detailTitle;
          } else if (out.productTitle) {
            log("상세페이지 제목 추출 실패 — 검색결과 제목 유지", "warn");
          } else {
            log("상세페이지 제목 추출 실패", "warn");
          }
        } catch {
          if (out.productTitle) {
            log("상세페이지 진입 실패 — 검색결과 제목 유지", "warn");
          }
        }
      }
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
    // 페이지 전환 대기 + __name polyfill 재주입 (PRB 세션 유지)
    await sleepMs(2000);
    await page.evaluate(() => { (window as any).__name = (fn: any) => fn; }).catch(() => {});
    currentPage++;
  }

  return out;
}
