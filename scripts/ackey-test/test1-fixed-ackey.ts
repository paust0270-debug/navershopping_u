/**
 * 테스트 1: 고정 ackey (캡처값 재사용)
 *
 * 상품: 차이팟
 * 키워드: 차이팟
 * ackey: captured/ackey_차이팟_YYYY-MM-DD.json 에서 로드
 *
 * 자동완성 URL 형식으로 진입 (sm=mtp_sug.top)
 * query만 상품명 풀네임으로 변경
 *
 * 실행: npx tsx scripts/ackey-test/test1-fixed-ackey.ts
 */

import "dotenv/config";
import { chromium } from "patchright";
import { MultiSendEngine } from "../../packet-engine/replay/MultiSendEngine";
import { BehaviorLogBuilder } from "../../packet-engine/builders/BehaviorLogBuilder";
import { applyMobileStealth } from "../../shared/mobile-stealth";
import * as fs from "fs";
import * as path from "path";

const SAVE_DIR = path.join(__dirname, "captured");
const RESULT_DIR = path.join(__dirname, "results");

interface CapturedAckey {
  ackey: string;
  keyword: string;
  capturedAt: string;
  capturedDate: string;
  expiryTestDate: string;
  searchUrl: string;
  productInfo: {
    productName: string;
    nvMid: string;
    storeId: string;
    productId: string;
  };
}

interface TestResult {
  testName: string;
  testDate: string;
  ackey: string;
  ackeyType: "fixed" | "random";
  ackeySource: string;  // 캡처 날짜 or "random"
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

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

// 가장 최근 캡처된 ackey 파일 찾기
function findLatestAckeyFile(keyword: string): string | null {
  if (!fs.existsSync(SAVE_DIR)) return null;

  const files = fs.readdirSync(SAVE_DIR)
    .filter(f => f.startsWith(`ackey_${keyword}_`) && f.endsWith(".json"))
    .sort()
    .reverse();

  return files.length > 0 ? path.join(SAVE_DIR, files[0]) : null;
}

async function test1FixedAckey() {
  log("=== 테스트 1: 고정 ackey (캡처값 재사용) ===\n");

  // 캡처된 ackey 로드
  const ackeyFile = findLatestAckeyFile("차이팟");
  if (!ackeyFile) {
    log("❌ 캡처된 ackey 파일이 없습니다!");
    log("먼저 capture-ackey.ts를 실행하세요.");
    return;
  }

  const captured: CapturedAckey = JSON.parse(fs.readFileSync(ackeyFile, "utf-8"));
  const daysSinceCapture = Math.floor(
    (Date.now() - new Date(captured.capturedAt).getTime()) / (24 * 60 * 60 * 1000)
  );

  log(`캡처된 ackey 로드: ${ackeyFile}`);
  log(`  ackey: ${captured.ackey}`);
  log(`  캡처 날짜: ${captured.capturedDate}`);
  log(`  경과일: ${daysSinceCapture}일`);
  log(`  상품: ${captured.productInfo.productName}`);

  const { productInfo } = captured;

  // 자동완성 URL 생성 (고정 ackey 사용)
  const searchUrl = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${encodeURIComponent(productInfo.productName)}&ackey=${captured.ackey}&acq=${encodeURIComponent(captured.keyword)}&acr=1&qdt=0`;

  log(`\n검색 URL (자동완성 형식):`);
  log(`  sm=mtp_sug.top (자동완성)`);
  log(`  ackey=${captured.ackey} (고정)`);
  log(`  acq=${captured.keyword}`);
  log(`  query=${productInfo.productName.substring(0, 20)}...`);

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
    // smartstore 직접 접근 (자동완성 URL을 referer로)
    const smartstoreUrl = `https://m.smartstore.naver.com/${productInfo.storeId}/products/${productInfo.productId}`;
    log(`\nsmartstore 접근: ${smartstoreUrl}`);

    await page.goto(smartstoreUrl, {
      waitUntil: "load",
      timeout: 30000,
      referer: searchUrl
    });

    await page.waitForTimeout(3000);

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
    } catch {}

    // 패킷 100회 전송
    const builder = new BehaviorLogBuilder(log);
    const engine = new MultiSendEngine(builder, log);
    engine.setPage(page);

    log("\n패킷 100회 전송 시작...");

    let accumulatedDwell = 0;
    for (let i = 0; i < 100; i++) {
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
        log(`  진행: ${i + 1}/100 (성공: ${packetsSuccess})`);
      }

      await page.waitForTimeout(30);
    }

    log(`\n=== 테스트 1 결과 ===`);
    log(`ackey: ${captured.ackey} (고정, ${daysSinceCapture}일 전 캡처)`);
    log(`성공: ${packetsSuccess}/${packetsSent}`);
    log(`성공률: ${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`);

    const conclusion = packetsSuccess >= 95 ? "✅ 고정 ackey 유효!" : "❌ 고정 ackey 무효";
    log(`결론: ${conclusion}`);

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const testResult: TestResult = {
      testName: "test1-fixed-ackey",
      testDate: new Date().toISOString().split("T")[0],
      ackey: captured.ackey,
      ackeyType: "fixed",
      ackeySource: captured.capturedDate,
      daysSinceCapture,
      product: {
        keyword: captured.keyword,
        productName: productInfo.productName,
        nvMid: productInfo.nvMid
      },
      packetsSent,
      packetsSuccess,
      successRate: `${((packetsSuccess / packetsSent) * 100).toFixed(1)}%`,
      conclusion
    };

    const resultFile = path.join(RESULT_DIR, `test1_${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(testResult, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } finally {
    log("\n5초 후 브라우저 종료...");
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

test1FixedAckey();
