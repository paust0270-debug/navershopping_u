/**
 * ackey 캡처 및 저장
 *
 * 실제 자동완성에서 ackey를 캡처해서 JSON 파일로 저장
 * 3일 후 재사용 테스트를 위해 날짜와 함께 저장
 *
 * 실행: npx tsx scripts/ackey-test/capture-ackey.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import * as fs from "fs";
import * as path from "path";

const SAVE_DIR = path.join(__dirname, "captured");

interface CapturedAckey {
  ackey: string;
  keyword: string;
  capturedAt: string;       // ISO 날짜
  capturedDate: string;     // YYYY-MM-DD
  expiryTestDate: string;   // 3일 후 테스트 날짜
  searchUrl: string;
  productInfo: {
    productName: string;
    nvMid: string;
    storeId: string;
    productId: string;
  };
}

// 차이팟 상품 정보
const PRODUCT_1 = {
  keyword: "차이팟",
  productName: "프리미엄 블루투스 이어팟 차이팟 무선이어폰 충전케이스무료",
  nvMid: "83539482665",
  storeId: "sunsaem",
  productId: "5994983177"
};

const log = (msg: string) => {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
};

async function captureAckey() {
  log("=== ackey 캡처 시작 ===");
  log(`상품: ${PRODUCT_1.productName}`);
  log(`키워드: ${PRODUCT_1.keyword}`);

  // 저장 디렉토리 생성
  if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--window-position=50,50", "--window-size=450,900"]
  });

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  const page = await context.newPage();

  let capturedAckey: string | null = null;

  // 자동완성 API에서 ackey 캡처
  page.on("request", req => {
    const url = req.url();
    if (url.includes("mac.search.naver.com") && url.includes("ackey=")) {
      try {
        const u = new URL(url);
        const ackey = u.searchParams.get("ackey");
        if (ackey && !capturedAckey) {
          capturedAckey = ackey;
          log(`🔑 ackey 캡처: ${ackey}`);
        }
      } catch {}
    }
  });

  try {
    log("m.naver.com 접속...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 검색창 활성화
    log("검색창 활성화...");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 키워드 입력
    log(`키워드 입력: ${PRODUCT_1.keyword}`);
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of PRODUCT_1.keyword) {
        await page.keyboard.type(char, { delay: 150 });
        await page.waitForTimeout(50);
      }
    }
    await page.waitForTimeout(2000);

    // 자동완성 클릭
    const items = await page.$$("li.u_atcp_l");
    log(`자동완성 항목: ${items.length}개`);

    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(2000);
    }

    // 최종 URL에서 ackey 확인
    const finalUrl = page.url();
    log(`최종 URL: ${finalUrl}`);

    try {
      const url = new URL(finalUrl);
      const urlAckey = url.searchParams.get("ackey");
      if (urlAckey) {
        capturedAckey = urlAckey;
        log(`URL에서 ackey 확인: ${urlAckey}`);
      }
    } catch {}

    if (!capturedAckey) {
      log("❌ ackey 캡처 실패!");
      return;
    }

    // 날짜 계산
    const now = new Date();
    const capturedDate = now.toISOString().split("T")[0];  // YYYY-MM-DD
    const expiryDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const expiryTestDate = expiryDate.toISOString().split("T")[0];

    // 자동완성 URL 빌드
    const searchUrl = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${encodeURIComponent(PRODUCT_1.productName)}&ackey=${capturedAckey}&acq=${encodeURIComponent(PRODUCT_1.keyword)}&acr=1&qdt=0`;

    // 저장할 데이터
    const data: CapturedAckey = {
      ackey: capturedAckey,
      keyword: PRODUCT_1.keyword,
      capturedAt: now.toISOString(),
      capturedDate,
      expiryTestDate,
      searchUrl,
      productInfo: PRODUCT_1
    };

    // 파일 저장
    const filename = `ackey_${PRODUCT_1.keyword}_${capturedDate}.json`;
    const filepath = path.join(SAVE_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");

    log(`\n=== 캡처 완료 ===`);
    log(`ackey: ${capturedAckey}`);
    log(`캡처 날짜: ${capturedDate}`);
    log(`재사용 테스트 날짜: ${expiryTestDate} (3일 후)`);
    log(`저장 경로: ${filepath}`);

    console.log("\n저장된 데이터:");
    console.log(JSON.stringify(data, null, 2));

  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

captureAckey();
