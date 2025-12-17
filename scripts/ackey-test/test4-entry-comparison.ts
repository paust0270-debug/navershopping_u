/**
 * 테스트 4: 진입 방식별 product-logs 응답 비교
 *
 * 목적: 자동완성 진입 여부에 따라 product-logs 응답이 다른지 확인
 *
 * 3가지 케이스:
 * - Case A: 정상 자동완성 (m.naver.com → 자동완성 클릭 → 상품 클릭)
 * - Case B: URL 직접 접근 (sm=mtp_sug.top + 랜덤 ackey, 자동완성 API 호출 없음)
 * - Case C: 일반 검색 (sm=mtp_hty, ackey 없음)
 *
 * 비교 항목: HTTP 상태, 응답 헤더, 응답 본문, 응답 시간
 *
 * 실행: npx tsx scripts/ackey-test/test4-entry-comparison.ts
 */

import "dotenv/config";
import { chromium, type Page, type Response } from "patchright";
import * as fs from "fs";
import * as path from "path";

const RESULT_DIR = path.join(__dirname, "results");

// 테스트 상품 정보
const TEST_PRODUCT = {
  keyword: "플리바바",
  productName: "플리바바 단품팩 2매 내부 액정 보호필름 갤럭시Z 플립7",
  nvMid: "90150262649"
};

interface ResponseCapture {
  case: "A" | "B" | "C";
  caseName: string;
  timestamp: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
    referer: string;
    refererParams: {
      sm?: string;
      ackey?: string;
      acq?: string;
      acr?: string;
      qdt?: string;
    };
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string | null;
    timing: number;
  };
}

interface TestResult {
  testName: string;
  testDate: string;
  product: typeof TEST_PRODUCT;
  cases: {
    A: ResponseCapture[];
    B: ResponseCapture[];
    C: ResponseCapture[];
  };
  comparison: {
    statusDiff: boolean;
    headersDiff: string[];
    bodyDiff: boolean;
  };
  conclusion: string;
}

const log = (msg: string, data?: any) => {
  const ts = new Date().toLocaleTimeString();
  console.log(data ? `[${ts}] ${msg}` : `[${ts}] ${msg}`, data || "");
};

// 랜덤 ackey 생성
function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// referer URL에서 파라미터 추출
function parseRefererParams(referer: string): Record<string, string> {
  try {
    const url = new URL(referer);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    return params;
  } catch {
    return {};
  }
}

async function test4EntryComparison() {
  log("=== 테스트 4: 진입 방식별 응답 비교 ===\n");
  log(`상품: ${TEST_PRODUCT.productName}`);
  log(`키워드: ${TEST_PRODUCT.keyword}`);
  log(`MID: ${TEST_PRODUCT.nvMid}`);

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

  const testResult: TestResult = {
    testName: "test4-entry-comparison",
    testDate: new Date().toISOString().split("T")[0],
    product: TEST_PRODUCT,
    cases: { A: [], B: [], C: [] },
    comparison: { statusDiff: false, headersDiff: [], bodyDiff: false },
    conclusion: ""
  };

  try {
    // ========== Case A: 정상 자동완성 ==========
    log("\n========== Case A: 정상 자동완성 진입 ==========");
    const caseAResult = await runCaseA(context);
    if (caseAResult) {
      testResult.cases.A.push(caseAResult);
      log(`✅ Case A 완료: status=${caseAResult.response.status}, timing=${caseAResult.response.timing}ms`);
    }

    await context.clearCookies();

    // ========== Case B: URL 직접 접근 (자동완성 파라미터 위조) ==========
    log("\n========== Case B: URL 직접 접근 (자동완성 파라미터 위조) ==========");
    const caseBResult = await runCaseB(context);
    if (caseBResult) {
      testResult.cases.B.push(caseBResult);
      log(`✅ Case B 완료: status=${caseBResult.response.status}, timing=${caseBResult.response.timing}ms`);
    }

    await context.clearCookies();

    // ========== Case C: 일반 검색 ==========
    log("\n========== Case C: 일반 검색 (Enter) ==========");
    const caseCResult = await runCaseC(context);
    if (caseCResult) {
      testResult.cases.C.push(caseCResult);
      log(`✅ Case C 완료: status=${caseCResult.response.status}, timing=${caseCResult.response.timing}ms`);
    }

    // ========== 결과 비교 ==========
    log("\n========== 결과 비교 ==========\n");

    if (caseAResult && caseBResult && caseCResult) {
      // Status 비교
      const statusA = caseAResult.response.status;
      const statusB = caseBResult.response.status;
      const statusC = caseCResult.response.status;

      log(`Status 비교:`);
      log(`  Case A (정상 자동완성): ${statusA}`);
      log(`  Case B (URL 직접/위조): ${statusB}`);
      log(`  Case C (일반 검색):     ${statusC}`);

      testResult.comparison.statusDiff = !(statusA === statusB && statusB === statusC);
      log(`  차이점: ${testResult.comparison.statusDiff ? "있음 ❌" : "없음 ✅"}`);

      // Referer 파라미터 비교
      log(`\nReferer 파라미터 비교:`);
      log(`  Case A: sm=${caseAResult.request.refererParams.sm}, ackey=${caseAResult.request.refererParams.ackey}, acq=${caseAResult.request.refererParams.acq}`);
      log(`  Case B: sm=${caseBResult.request.refererParams.sm}, ackey=${caseBResult.request.refererParams.ackey}, acq=${caseBResult.request.refererParams.acq}`);
      log(`  Case C: sm=${caseCResult.request.refererParams.sm}, ackey=${caseCResult.request.refererParams.ackey || "없음"}, acq=${caseCResult.request.refererParams.acq || "없음"}`);

      // 응답 헤더 비교
      log(`\n응답 헤더 비교:`);
      const headersA = Object.keys(caseAResult.response.headers).sort();
      const headersB = Object.keys(caseBResult.response.headers).sort();
      const headersC = Object.keys(caseCResult.response.headers).sort();

      const allHeaders = new Set([...headersA, ...headersB, ...headersC]);
      const diffHeaders: string[] = [];

      allHeaders.forEach(h => {
        const vA = caseAResult.response.headers[h];
        const vB = caseBResult.response.headers[h];
        const vC = caseCResult.response.headers[h];
        if (vA !== vB || vB !== vC) {
          diffHeaders.push(h);
        }
      });

      if (diffHeaders.length > 0) {
        log(`  차이 있는 헤더: ${diffHeaders.join(", ")}`);
        testResult.comparison.headersDiff = diffHeaders;
      } else {
        log(`  차이점: 없음 ✅`);
      }

      // 응답 본문 비교
      log(`\n응답 본문 비교:`);
      log(`  Case A: ${caseAResult.response.body ? caseAResult.response.body.substring(0, 50) + "..." : "(비어있음)"}`);
      log(`  Case B: ${caseBResult.response.body ? caseBResult.response.body.substring(0, 50) + "..." : "(비어있음)"}`);
      log(`  Case C: ${caseCResult.response.body ? caseCResult.response.body.substring(0, 50) + "..." : "(비어있음)"}`);

      testResult.comparison.bodyDiff = caseAResult.response.body !== caseBResult.response.body ||
                                        caseBResult.response.body !== caseCResult.response.body;
      log(`  차이점: ${testResult.comparison.bodyDiff ? "있음" : "없음 ✅"}`);

      // 응답 시간 비교
      log(`\n응답 시간 비교:`);
      log(`  Case A: ${caseAResult.response.timing}ms`);
      log(`  Case B: ${caseBResult.response.timing}ms`);
      log(`  Case C: ${caseCResult.response.timing}ms`);

      // 결론
      const hasDiff = testResult.comparison.statusDiff ||
                      testResult.comparison.headersDiff.length > 0 ||
                      testResult.comparison.bodyDiff;

      if (hasDiff) {
        testResult.conclusion = "⚠️ 진입 방식에 따라 응답 차이 발견 - 서버가 구분할 가능성 있음";
      } else {
        testResult.conclusion = "✅ 모든 진입 방식의 응답이 동일 - referer 파라미터만으로 자동완성 위장 가능";
      }

      log(`\n========== 결론 ==========`);
      log(testResult.conclusion);
    }

    // 결과 저장
    if (!fs.existsSync(RESULT_DIR)) {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
    }

    const resultFile = path.join(RESULT_DIR, `test4_${testResult.testDate}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(testResult, null, 2), "utf-8");
    log(`\n결과 저장: ${resultFile}`);

  } finally {
    log("\n5초 후 브라우저 종료...");
    await new Promise(r => setTimeout(r, 5000));
    await browser.close();
  }
}

// Case A: 정상 자동완성 진입
async function runCaseA(context: any): Promise<ResponseCapture | null> {
  const page = await context.newPage();
  let captured: ResponseCapture | null = null;

  // product-logs 캡처
  page.on("request", async (req: any) => {
    const url = req.url();
    if (url.includes("product-logs") && req.method() === "POST") {
      const startTime = Date.now();
      const postData = req.postData();
      let body: any = null;
      try { body = JSON.parse(postData || "{}"); } catch {}

      const referer = body?.referer || "";
      const refererParams = parseRefererParams(referer);

      captured = {
        case: "A",
        caseName: "정상 자동완성",
        timestamp: new Date().toISOString(),
        request: {
          url,
          method: "POST",
          headers: req.headers(),
          body,
          referer,
          refererParams
        },
        response: {
          status: 0,
          statusText: "",
          headers: {},
          body: null,
          timing: 0
        }
      };
    }
  });

  page.on("response", async (res: Response) => {
    const url = res.url();
    if (url.includes("product-logs") && captured) {
      captured.response.status = res.status();
      captured.response.statusText = res.statusText();
      captured.response.headers = res.headers();
      try {
        captured.response.body = await res.text();
      } catch {}
      captured.response.timing = Date.now() - new Date(captured.timestamp).getTime();
    }
  });

  try {
    // m.naver.com 접속
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 검색창 활성화
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 키워드 입력
    log("  키워드 입력 중...");
    const input = await page.$("#query");
    if (input) {
      await input.click();
      for (const char of TEST_PRODUCT.keyword) {
        await page.keyboard.type(char, { delay: 150 });
      }
    }
    await page.waitForTimeout(2000);

    // 자동완성 클릭
    const items = await page.$$("li.u_atcp_l");
    log(`  자동완성 항목: ${items.length}개`);

    if (items.length > 0) {
      await items[0].click();
      await page.waitForTimeout(2000);
    }

    // MID 상품 찾기
    for (let i = 0; i < 15; i++) {
      const productLink = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log("  MID 상품 발견, 클릭");
        await productLink.click();
        await page.waitForTimeout(5000);
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(2000);
  } finally {
    await page.close();
  }

  return captured;
}

// Case B: URL 직접 접근 (자동완성 파라미터 위조)
async function runCaseB(context: any): Promise<ResponseCapture | null> {
  const page = await context.newPage();
  let captured: ResponseCapture | null = null;

  page.on("request", async (req: any) => {
    const url = req.url();
    if (url.includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      let body: any = null;
      try { body = JSON.parse(postData || "{}"); } catch {}

      const referer = body?.referer || "";
      const refererParams = parseRefererParams(referer);

      captured = {
        case: "B",
        caseName: "URL 직접 (자동완성 위조)",
        timestamp: new Date().toISOString(),
        request: {
          url,
          method: "POST",
          headers: req.headers(),
          body,
          referer,
          refererParams
        },
        response: {
          status: 0,
          statusText: "",
          headers: {},
          body: null,
          timing: 0
        }
      };
    }
  });

  page.on("response", async (res: Response) => {
    const url = res.url();
    if (url.includes("product-logs") && captured) {
      captured.response.status = res.status();
      captured.response.statusText = res.statusText();
      captured.response.headers = res.headers();
      try {
        captured.response.body = await res.text();
      } catch {}
      captured.response.timing = Date.now() - new Date(captured.timestamp).getTime();
    }
  });

  try {
    // 자동완성 URL 직접 생성 (ackey 랜덤)
    const fakeAckey = generateAckey();
    const searchUrl = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${encodeURIComponent(TEST_PRODUCT.productName)}&ackey=${fakeAckey}&acq=${encodeURIComponent(TEST_PRODUCT.keyword)}&acr=1&qdt=0`;

    log(`  위조 ackey: ${fakeAckey}`);
    log(`  URL 직접 접근...`);

    await page.goto(searchUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // MID 상품 찾기
    for (let i = 0; i < 15; i++) {
      const productLink = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log("  MID 상품 발견, 클릭");
        await productLink.click();
        await page.waitForTimeout(5000);
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(2000);
  } finally {
    await page.close();
  }

  return captured;
}

// Case C: 일반 검색 (Enter)
async function runCaseC(context: any): Promise<ResponseCapture | null> {
  const page = await context.newPage();
  let captured: ResponseCapture | null = null;

  page.on("request", async (req: any) => {
    const url = req.url();
    if (url.includes("product-logs") && req.method() === "POST") {
      const postData = req.postData();
      let body: any = null;
      try { body = JSON.parse(postData || "{}"); } catch {}

      const referer = body?.referer || "";
      const refererParams = parseRefererParams(referer);

      captured = {
        case: "C",
        caseName: "일반 검색 (Enter)",
        timestamp: new Date().toISOString(),
        request: {
          url,
          method: "POST",
          headers: req.headers(),
          body,
          referer,
          refererParams
        },
        response: {
          status: 0,
          statusText: "",
          headers: {},
          body: null,
          timing: 0
        }
      };
    }
  });

  page.on("response", async (res: Response) => {
    const url = res.url();
    if (url.includes("product-logs") && captured) {
      captured.response.status = res.status();
      captured.response.statusText = res.statusText();
      captured.response.headers = res.headers();
      try {
        captured.response.body = await res.text();
      } catch {}
      captured.response.timing = Date.now() - new Date(captured.timestamp).getTime();
    }
  });

  try {
    // m.naver.com 접속
    await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 검색창 활성화
    const searchBtn = await page.$("#MM_SEARCH_FAKE");
    if (searchBtn) await searchBtn.click();
    await page.waitForTimeout(1000);

    // 키워드 입력 (상품명 전체)
    log("  상품명 입력 중...");
    const input = await page.$("#query");
    if (input) {
      await input.click();
      // 상품명 전체 입력
      await input.fill(TEST_PRODUCT.productName);
    }
    await page.waitForTimeout(500);

    // Enter로 검색 (자동완성 클릭 X)
    log("  Enter 키로 검색 (자동완성 X)");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    // MID 상품 찾기
    for (let i = 0; i < 15; i++) {
      const productLink = await page.$(`a[href*="${TEST_PRODUCT.nvMid}"]`);
      if (productLink) {
        log("  MID 상품 발견, 클릭");
        await productLink.click();
        await page.waitForTimeout(5000);
        break;
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(2000);
  } finally {
    await page.close();
  }

  return captured;
}

test4EntryComparison();
