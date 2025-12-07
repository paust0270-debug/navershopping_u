/**
 * 네이버 통합검색 상품 링크 디버깅
 */

import { chromium } from "playwright";

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome'
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR'
  });

  const page = await context.newPage();

  // 네이버 검색
  const query = "무선 그라인더";
  console.log(`검색어: ${query}`);

  await page.goto(`https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`);
  await sleep(3000);

  // 스크롤해서 쇼핑 영역 로드
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await sleep(500);
  }

  // 디버깅: 페이지 구조 분석
  const debugInfo = await page.evaluate(() => {
    const results: any = {
      shpGuiRoot: null,
      shoppingSection: null,
      allProductLinks: [],
      allSmartStoreLinks: []
    };

    // 1. #shp_gui_root 확인
    const shpRoot = document.querySelector('#shp_gui_root');
    if (shpRoot) {
      results.shpGuiRoot = {
        exists: true,
        innerHTML: shpRoot.innerHTML.substring(0, 500),
        linkCount: shpRoot.querySelectorAll('a').length
      };
    } else {
      results.shpGuiRoot = { exists: false };
    }

    // 2. 쇼핑 섹션 확인
    const shoppingSelectors = [
      '.sc_new.cs_shopping',
      '[data-section="shopping"]',
      '.shopping_wrap',
      '.shop_area'
    ];

    for (const sel of shoppingSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        results.shoppingSection = {
          selector: sel,
          linkCount: el.querySelectorAll('a').length
        };
        break;
      }
    }

    // 3. 전체 상품 링크 (/products/ 포함)
    const productLinks = document.querySelectorAll('a[href*="/products/"]');
    results.allProductLinks = Array.from(productLinks).slice(0, 10).map(a => ({
      href: (a as HTMLAnchorElement).href,
      text: a.textContent?.substring(0, 50)
    }));

    // 4. smartstore/brand 링크
    const allLinks = document.querySelectorAll('a');
    for (const link of Array.from(allLinks)) {
      const href = (link as HTMLAnchorElement).href || '';
      if ((href.includes('smartstore.naver.com') || href.includes('brand.naver.com'))) {
        results.allSmartStoreLinks.push({
          href,
          text: link.textContent?.substring(0, 50)
        });
        if (results.allSmartStoreLinks.length >= 10) break;
      }
    }

    return results;
  });

  console.log("\n===== 디버깅 결과 =====\n");
  console.log("1. #shp_gui_root:", JSON.stringify(debugInfo.shpGuiRoot, null, 2));
  console.log("\n2. 쇼핑 섹션:", JSON.stringify(debugInfo.shoppingSection, null, 2));
  console.log("\n3. /products/ 링크 (상위 10개):");
  debugInfo.allProductLinks.forEach((l: any, i: number) => {
    console.log(`  [${i}] ${l.href}`);
  });
  console.log("\n4. smartstore/brand 링크 (상위 10개):");
  debugInfo.allSmartStoreLinks.forEach((l: any, i: number) => {
    console.log(`  [${i}] ${l.href}`);
    console.log(`      텍스트: ${l.text}`);
  });

  // 5초 대기 후 종료
  console.log("\n5초 후 종료...");
  await sleep(5000);

  await browser.close();
}

main().catch(console.error);
