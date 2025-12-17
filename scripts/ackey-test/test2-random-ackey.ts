/**
 * 테스트 2: 랜덤 ackey 생성
 *
 * 상품: 건초염 손목보호대 터널증후군 얇은 아대
 * 키워드: 손목보호대
 * ackey: 랜덤 생성 (8자리 영숫자)
 *
 * 자동완성 URL 형식으로 진입 (sm=mtp_sug.top)
 * query만 상품명 풀네임으로 변경
 *
 * 실행: npx tsx scripts/ackey-test/test2-random-ackey.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import { MultiSendEngine } from "../../packet-engine/replay/MultiSendEngine";
import { BehaviorLogBuilder } from "../../packet-engine/builders/BehaviorLogBuilder";
import { applyMobileStealth } from "../../shared/mobile-stealth";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 2 상품 정보
const PRODUCT_2 = {
  keyword: "전동드릴",
  productName: "켈슨 무선해머드릴 12V 리튬이온배터리",
  nvMid: "88976737010",
  storeId: "",
  productId: ""
};

interface TestResult {
  testName: string;
  testDate: string;
  ackey: string;
  ackeyType: "fixed" | "random";
  ackeySource: string;
  daysSinceCapture: number;
  product: {
    keyword: string;
    productName: string;
    nvMid: string;
  };
  packetsSent: number;
  packetsSuccess: number;
  successRate: string;
  conclusion: string;
}

// 랜덤 ackey 생성 (8자리 영숫자)
function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

async function test2RandomAckey() {
  log("=== 테스트 2: 랜덤 ackey 생성 ===\n");

  // 랜덤 ackey 생성
  const randomAckey = generateAckey();
  log(`생성된 랜덤 ackey: ${randomAckey}`);
  log(`상품: ${PRODUCT_2.productName}`);
  log(`키워드: ${PRODUCT_2.keyword}`);
  log(`MID: ${PRODUCT_2.nvMid}`);

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

  // 모바일 스텔스 스크립트 적용
  await applyMobileStealth(context);

  const page = await context.newPage();

  let capturedLog: any = null;

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
          log("✅ product-logs 캡처!");
        } catch {}
      }
    }
  });

  let packetsSent = 0;
  let packetsSuccess = 0;

  try {
    // 테스트 1과 동일한 방식: smartstore 직접 접근 (referer에 자동완성 URL)
    // 초기 ackey는 정상적으로 캡처된 값 사용, 이후 패킷에서만 랜덤 ackey 테스트

    // 1단계: m.naver.com → 자동완성으로 ackey 캡처
    log("\n1단계: m.naver.com에서 ackey 캡처...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

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

    // 검색창 활성화
    log("검색창 활성화...");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 키워드 입력 (자동완성 트리거)
    log(`키워드 입력: ${PRODUCT_2.keyword}`);
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of PRODUCT_2.keyword) {
        await page.keyboard.type(char, { delay: 150 });
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

    // URL에서 ackey 확인
    try {
      const url = new URL(page.url());
      capturedAckey = url.searchParams.get("ackey") || capturedAckey;
    } catch {}

    if (!capturedAckey) {
      log("❌ ackey 캡처 실패!");
      return;
    }

    log(`캡처된 ackey: ${capturedAckey}`);

    // 2단계: 자동완성 URL 생성 (캡처된 ackey 사용)
    const searchUrl = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${encodeURIComponent(PRODUCT_2.productName)}&ackey=${capturedAckey}&acq=${encodeURIComponent(PRODUCT_2.keyword)}&acr=1&qdt=0`;

    log(`\n2단계: smartstore 직접 접근 (테스트 1과 동일 방식)`);
    log(`  referer의 ackey: ${capturedAckey} (정상 캡처값)`);

    // 검색 URL로 이동 (네이버플러스스토어 컴포넌트에서 MID 찾기)
    log(`\n검색 URL로 이동...`);
    await page.goto(searchUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 네이버플러스스토어 컴포넌트에서 MID 일치 상품 찾기 (쇼핑탭 X)
    log(`네이버플러스스토어에서 MID ${PRODUCT_2.nvMid} 상품 검색...`);

    let foundProduct = false;
    for (let scroll = 0; scroll < 20; scroll++) {
      // MID가 포함된 링크 찾기
      const productLink = await page.$(`a[href*="${PRODUCT_2.nvMid}"]`);
      if (productLink) {
        log(`✅ MID 상품 발견!`);
        await productLink.click();
        await page.waitForTimeout(3000);
        foundProduct = true;
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
    }

    if (!foundProduct) {
      log("❌ MID 상품 못 찾음!");
      return;
    }

    // product-logs 캡처 확인
    if (!capturedLog) {
      log("product-logs 캡처 대기중... 리로드");
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(3000);
    }

    if (!capturedLog) {
      log("❌ product-logs 캡처 실패!");
      return;
    }

    // referer 확인
    log("\n캡처된 referer 분석:");
    try {
      const refUrl = new URL(capturedLog.referer);
      log(`  sm: ${refUrl.searchParams.get("sm")}`);
      log(`  ackey: ${refUrl.searchParams.get("ackey")}`);
      log(`  acq: ${refUrl.searchParams.get("acq")}`);
      log(`  랜덤 ackey 일치: ${refUrl.searchParams.get("ackey") === randomAckey ? "✅ YES" : "❌ NO"}`);
    } catch {}

    // 패킷 100회 전송 - 매번 랜덤 ackey로 변경!
    const builder = new BehaviorLogBuilder(log);
    const engine = new MultiSendEngine(builder, log);
    engine.setPage(page);

    log("\n패킷 100회 전송 시작 (매번 랜덤 ackey)...");

    let accumulatedDwell = 0;
    for (let i = 0; i < 100; i++) {
      accumulatedDwell += Math.floor(Math.random() * 15000) + 5000;

      // 매번 새로운 랜덤 ackey 생성
      const newRandomAckey = generateAckey();

      // referer의 ackey를 랜덤값으로 변경
      const modifiedBody = { ...capturedLog.body };
      if (modifiedBody.referer) {
        try {
          const refUrl = new URL(modifiedBody.referer);
          refUrl.searchParams.set("ackey", newRandomAckey);
          modifiedBody.referer = refUrl.toString();
        } catch {}
      }

      const result = await engine.sendProductLogPost(
        {
          url: capturedLog.url,
          headers: capturedLog.headers,
          body: modifiedBody  // 변경된 referer (랜덤 ackey)
        },
        {
          dwellTime: accumulatedDwell,
          scrollDepth: Math.floor(Math.random() * 80) + 10
        }
      );

      packetsSent++;
      if (result.success) packetsSuccess++;

      if ((i + 1) % 20 === 0) {
        log(`  진행: ${i + 1}/100 (성공: ${packetsSuccess}) [ackey=${newRandomAckey}]`);
      }

      await page.waitForTimeout(30);
    }

    log(`\n=== 테스트 2 결과 ===`);
    log(`ackey: ${randomAckey} (랜덤 생성)`);
    log(`성공: ${packetsSuccess}/${packetsSent}`);
    log(`성공률: ${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`);

    const conclusion = packetsSuccess >= 95 ? "✅ 랜덤 ackey 유효!" : "❌ 랜덤 ackey 무효";
    log(`결론: ${conclusion}`);

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const testResult: TestResult = {
      testName: "test2-random-ackey",
      testDate: new Date().toISOString().split("T")[0],
      ackey: randomAckey,
      ackeyType: "random",
      ackeySource: "random-generated",
      daysSinceCapture: 0,
      product: {
        keyword: PRODUCT_2.keyword,
        productName: PRODUCT_2.productName,
        nvMid: PRODUCT_2.nvMid
      },
      packetsSent,
      packetsSuccess,
      successRate: `${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`,
      conclusion
    };

    const resultFile = path.join(RESULT_DIR, `test2_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(testResult, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

test2RandomAckey();
