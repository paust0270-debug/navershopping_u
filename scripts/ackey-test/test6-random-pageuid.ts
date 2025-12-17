/**
 * 테스트 6: page_uid 랜덤 생성 검증
 *
 * 목적: page_uid를 랜덤 생성해도 product-logs가 성공하는지 확인
 *
 * page_uid 형식 분석:
 * - 예: jRsoMsqps54ssUdGhUV-189793
 * - 앞 19자리: 랜덤 base62
 * - 하이픈
 * - 뒤 6자리: 숫자
 *
 * 테스트 시나리오:
 * 1. product-logs의 referer에 랜덤 page_uid 삽입
 * 2. 100회 전송 후 성공률 측정
 * 3. 성공하면 → 완전 랜덤 세션 생성 가능
 *
 * 실행: npx tsx scripts/ackey-test/test6-random-pageuid.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import { MultiSendEngine } from "../../packet-engine/replay/MultiSendEngine";
import { BehaviorLogBuilder } from "../../packet-engine/builders/BehaviorLogBuilder";
import { applyMobileStealth } from "../../shared/mobile-stealth";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 상품 정보
const TEST_PRODUCT = {
  keyword: "베이글",
  productName: "저당 저지방 다이어트 베이글 통밀 플레인 110g 12개",
  nvMid: "87148164533",
};

interface TestResult {
  testName: string;
  testDate: string;
  pageUidType: "fixed" | "random";
  product: {
    keyword: string;
    productName: string;
    nvMid: string;
  };
  packetsSent: number;
  packetsSuccess: number;
  successRate: string;
  samples: {
    original: string;
    generated: string[];
  };
  conclusion: string;
}

// page_uid 랜덤 생성
function generatePageUid(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let front = "";
  for (let i = 0; i < 19; i++) {
    front += chars[Math.floor(Math.random() * chars.length)];
  }
  const seq = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${front}-${seq}`;
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

async function test6RandomPageUid() {
  log("=== 테스트 6: page_uid 랜덤 생성 검증 ===\n");
  log(`상품: ${TEST_PRODUCT.productName}`);
  log(`키워드: ${TEST_PRODUCT.keyword}`);
  log(`MID: ${TEST_PRODUCT.nvMid}`);

  // page_uid 샘플 생성
  const samplePageUids = [generatePageUid(), generatePageUid(), generatePageUid()];
  log(`\n생성된 page_uid 샘플:`);
  samplePageUids.forEach((uid, i) => log(`  ${i + 1}. ${uid}`));

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
  let originalPageUid: string | null = null;

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

          // 원본 page_uid 추출
          if (body.referer) {
            try {
              const refUrl = new URL(body.referer);
              originalPageUid = refUrl.searchParams.get("p");
              if (originalPageUid) {
                log(`📋 원본 page_uid 캡처: ${originalPageUid}`);
              }
            } catch {}
          }

          log("✅ product-logs 캡처!");
        } catch {}
      }
    }
  });

  let packetsSent = 0;
  let packetsSuccess = 0;

  try {
    // 1단계: m.naver.com → 자동완성으로 진입
    log("\n1단계: m.naver.com에서 자동완성 진입...");
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 검색창 활성화
    log("검색창 활성화...");
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 키워드 입력 (자동완성 트리거)
    log(`키워드 입력: ${TEST_PRODUCT.keyword}`);
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 100 });
      }
    }
    await page.waitForTimeout(2000);

    // 자동완성 클릭
    const items = await page.$$("li.u_atcp_l");
    log(`자동완성 항목: ${items.length}개`);

    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(2000);
    } else {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
    }

    // URL 확인
    const searchUrl = page.url();
    log(`검색 결과 URL: ${searchUrl.substring(0, 80)}...`);

    // 2단계: 상품 찾기 및 클릭
    log(`\n2단계: MID ${TEST_PRODUCT.nvMid} 상품 검색...`);

    let foundProduct = false;
    for (let scroll = 0; scroll < 15; scroll++) {
      const productLink = await page.$(`a[href*="nv_mid=${TEST_PRODUCT.nvMid}"]`);
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
      log("❌ MID 상품 못 찾음! 상품명으로 검색 시도...");

      // 상품명으로 재검색
      const productSearchUrl = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(TEST_PRODUCT.productName)}&sm=mtp_sug.top`;
      await page.goto(productSearchUrl, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2000);

      for (let scroll = 0; scroll < 15; scroll++) {
        const productLink = await page.$(`a[href*="nv_mid=${TEST_PRODUCT.nvMid}"]`);
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
    }

    if (!foundProduct) {
      log("❌ 상품을 찾을 수 없습니다.");
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

    // 3단계: referer 분석
    log("\n3단계: 캡처된 referer 분석");
    try {
      const refUrl = new URL(capturedLog.referer);
      log(`  sm: ${refUrl.searchParams.get("sm")}`);
      log(`  ackey: ${refUrl.searchParams.get("ackey")}`);
      log(`  p (page_uid): ${refUrl.searchParams.get("p")}`);
    } catch {}

    // 4단계: 패킷 100회 전송 - 매번 랜덤 page_uid + 랜덤 ackey
    const builder = new BehaviorLogBuilder(log);
    const engine = new MultiSendEngine(builder, log);
    engine.setPage(page);

    log("\n4단계: 패킷 100회 전송 (매번 랜덤 page_uid + 랜덤 ackey)...");

    const generatedPageUids: string[] = [];
    let accumulatedDwell = 0;

    for (let i = 0; i < 100; i++) {
      accumulatedDwell += Math.floor(Math.random() * 15000) + 5000;

      // 매번 새로운 랜덤 page_uid 및 ackey 생성
      const newPageUid = generatePageUid();
      const newAckey = generateAckey();

      if (i < 5) {
        generatedPageUids.push(newPageUid);
      }

      // referer의 page_uid와 ackey를 랜덤값으로 변경
      const modifiedBody = { ...capturedLog.body };
      if (modifiedBody.referer) {
        try {
          const refUrl = new URL(modifiedBody.referer);
          refUrl.searchParams.set("p", newPageUid);
          refUrl.searchParams.set("ackey", newAckey);
          modifiedBody.referer = refUrl.toString();
        } catch {}
      }

      const result = await engine.sendProductLogPost(
        {
          url: capturedLog.url,
          headers: capturedLog.headers,
          body: modifiedBody
        },
        {
          dwellTime: accumulatedDwell,
          scrollDepth: Math.floor(Math.random() * 80) + 10
        }
      );

      packetsSent++;
      if (result.success) packetsSuccess++;

      if ((i + 1) % 20 === 0) {
        log(`  진행: ${i + 1}/100 (성공: ${packetsSuccess}) [p=${newPageUid.substring(0, 10)}...]`);
      }

      await page.waitForTimeout(30);
    }

    // 결과 출력
    log(`\n${"=".repeat(50)}`);
    log(`=== 테스트 6 결과 ===`);
    log(`${"=".repeat(50)}`);
    log(`원본 page_uid: ${originalPageUid || "N/A"}`);
    log(`테스트 방식: 매번 랜덤 page_uid + 랜덤 ackey`);
    log(`전송: ${packetsSent}회`);
    log(`성공: ${packetsSuccess}회`);
    log(`성공률: ${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`);

    const conclusion = packetsSuccess >= 95
      ? "✅ page_uid 랜덤 생성 가능! 서버에서 검증 안함"
      : "❌ page_uid 검증됨 - 실제 세션 필요";
    log(`\n결론: ${conclusion}`);

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const testResult: TestResult = {
      testName: "test6-random-pageuid",
      testDate: new Date().toISOString().split("T")[0],
      pageUidType: "random",
      product: {
        keyword: TEST_PRODUCT.keyword,
        productName: TEST_PRODUCT.productName,
        nvMid: TEST_PRODUCT.nvMid
      },
      packetsSent,
      packetsSuccess,
      successRate: `${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`,
      samples: {
        original: originalPageUid || "N/A",
        generated: generatedPageUids
      },
      conclusion
    };

    const resultFile = path.join(RESULT_DIR, `test6_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(testResult, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

test6RandomPageUid().catch(console.error);
