/**
 * 셔플 테스트: product-logs만 전송
 *
 * 브라우저로 셔플 검색 → 상품 클릭 → product-logs 캡처
 * → MultiSendEngine으로 product-logs 100회 전송
 *
 * 실행: npx tsx scripts/shuffle-test-packet/test-productlogs-only.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import { MultiSendEngine } from "../../packet-engine/replay/MultiSendEngine";
import { BehaviorLogBuilder } from "../../packet-engine/builders/BehaviorLogBuilder";
import { applyMobileStealth } from "../../shared/mobile-stealth";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 상품
const TEST_PRODUCT = {
  keyword: "정품스타일 플립커버",
  productName: "정품스타일 스탠딩 클리어 미러뷰 플립커버 케이스 갤럭시 S21 S22 노트10 노트20 플립 뷰",
  nvMid: "84106913442",
};

const TOTAL_PACKETS = 100;

interface TestResult {
  testName: string;
  testDate: string;
  shuffledKeyword: string;
  originalKeyword: string;
  product: typeof TEST_PRODUCT;
  packetsSent: number;
  packetsSuccess: number;
  successRate: string;
  apiType: "product-logs-only";
}

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

// Fisher-Yates 셔플
function shuffleWords(productName: string): string {
  const cleaned = productName
    .replace(/[\[\](){}]/g, " ")
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return cleaned;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(" ");
}

async function runTest() {
  log("=== 셔플 테스트: product-logs만 전송 ===\n");

  const shuffledKeyword = shuffleWords(TEST_PRODUCT.productName);
  log(`원본: ${TEST_PRODUCT.productName}`);
  log(`셔플: ${shuffledKeyword}`);
  log(`MID: ${TEST_PRODUCT.nvMid}\n`);

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
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  // 모바일 스텔스 스크립트 적용
  await applyMobileStealth(context);

  const page = await context.newPage();

  let capturedLog: any = null;
  let capturedAckey: string | null = null;

  page.on("request", (req) => {
    if (req.url().includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      if (postData) {
        try {
          const body = JSON.parse(postData);
          capturedLog = {
            url: req.url(),
            headers: req.headers(),
            body,
            referer: body.referer || ""
          };
          log("product-logs 캡처!");

          // referer에서 ackey 추출
          try {
            const refUrl = new URL(capturedLog.referer);
            capturedAckey = refUrl.searchParams.get("ackey");
          } catch {}
        } catch {}
      }
    }
  });

  let packetsSent = 0;
  let packetsSuccess = 0;

  try {
    // 1. m.naver.com 접속
    log("1. m.naver.com 접속...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. 검색창 찾기 및 클릭
    log("2. 검색창 클릭...");
    const searchInput = await page.$('input[name="query"]') || await page.$("#query");
    if (!searchInput) {
      throw new Error("검색창 못 찾음");
    }
    await searchInput.click();
    await page.waitForTimeout(500);

    // 3. 셔플된 키워드 입력
    log(`3. 셔플 키워드 입력: ${shuffledKeyword.substring(0, 30)}...`);
    for (const char of shuffledKeyword) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 50 });
    }
    await page.waitForTimeout(1500);

    // 4. 자동완성 확인 후 엔터
    log("4. 엔터로 검색...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // ackey 캡처
    const currentUrl = page.url();
    try {
      const urlObj = new URL(currentUrl);
      capturedAckey = urlObj.searchParams.get("ackey");
      log(`  ackey: ${capturedAckey || "(없음)"}`);
      log(`  sm: ${urlObj.searchParams.get("sm")}`);
    } catch {}

    // 5. 원본 상품명으로 재검색
    log("5. 원본 상품명으로 재검색...");
    const urlObj = new URL(currentUrl);
    urlObj.searchParams.set("query", TEST_PRODUCT.productName);
    await page.goto(urlObj.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // 6. MID 상품 찾기
    log(`6. MID ${TEST_PRODUCT.nvMid} 상품 찾기...`);
    let found = false;
    for (let scroll = 0; scroll < 10; scroll++) {
      const productLink = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log("  상품 발견! 클릭...");
        await productLink.click();
        await page.waitForTimeout(3000);
        found = true;
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }

    if (!found) {
      throw new Error("MID 상품 못 찾음");
    }

    // 7. product-logs 캡처 대기
    if (!capturedLog) {
      log("product-logs 대기중...");
      await page.waitForTimeout(3000);
    }

    if (!capturedLog) {
      throw new Error("product-logs 캡처 실패");
    }

    log("\n캡처된 referer 분석:");
    try {
      const refUrl = new URL(capturedLog.referer);
      log(`  sm: ${refUrl.searchParams.get("sm")}`);
      log(`  ackey: ${refUrl.searchParams.get("ackey")}`);
    } catch {}

    // 8. 패킷 100회 전송
    const builder = new BehaviorLogBuilder(log);
    const engine = new MultiSendEngine(builder, log);
    engine.setPage(page);

    log(`\n패킷 ${TOTAL_PACKETS}회 전송 시작...`);

    let accumulatedDwell = 0;
    for (let i = 0; i < TOTAL_PACKETS; i++) {
      accumulatedDwell += Math.floor(Math.random() * 15000) + 5000;

      const result = await engine.sendProductLogPost(
        {
          url: capturedLog.url,
          headers: capturedLog.headers,
          body: capturedLog.body
        },
        {
          dwellTime: accumulatedDwell,
          scrollDepth: Math.floor(Math.random() * 80) + 10
        }
      );

      packetsSent++;
      if (result.success) packetsSuccess++;

      if ((i + 1) % 20 === 0) {
        log(`  진행: ${i + 1}/${TOTAL_PACKETS} (성공: ${packetsSuccess})`);
      }

      await page.waitForTimeout(30);
    }

    log(`\n=== 결과 ===`);
    log(`셔플 키워드: ${shuffledKeyword.substring(0, 30)}...`);
    log(`성공: ${packetsSuccess}/${packetsSent}`);
    log(`성공률: ${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`);

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const testResult: TestResult = {
      testName: "shuffle-productlogs-only",
      testDate: new Date().toISOString().split("T")[0],
      shuffledKeyword,
      originalKeyword: TEST_PRODUCT.productName,
      product: TEST_PRODUCT,
      packetsSent,
      packetsSuccess,
      successRate: `${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`,
      apiType: "product-logs-only"
    };

    const resultFile = path.join(RESULT_DIR, `shuffle_productlogs_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(testResult, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } catch (error: any) {
    log(`에러: ${error.message}`);
  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

runTest();
