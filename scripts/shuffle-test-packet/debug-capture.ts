/**
 * Shuffle Test Packet - Debug Capture
 *
 * 셔플 검색 시 네트워크 요청 캡처 및 분석
 * - 자동완성 API (ac.search.naver.com)
 * - 검색 리다이렉트 체인
 * - ackey 발급/전달 경로
 * - product-logs POST 요청
 *
 * 실행:
 *   npx tsx scripts/shuffle-test-packet/debug-capture.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// .env 로드
const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, "..", "..", ".env"),
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}

import { chromium, type Browser, type Page, type Request, type Response } from "patchright";

// ============ 타입 정의 ============

interface CapturedRequest {
  timestamp: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  resourceType: string;
  category: RequestCategory;
}

interface CapturedResponse {
  timestamp: number;
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

type RequestCategory =
  | "autocomplete"
  | "search"
  | "product-log"
  | "nlog"
  | "commerce"
  | "redirect"
  | "other";

interface ShuffleTestConfig {
  mainKeyword: string;
  fullProductName: string;
  nvMid: string;
}

// ============ 유틸 ============

function log(msg: string, level: "info" | "warn" | "error" = "info"): void {
  const time = new Date().toISOString().substring(11, 19);
  const prefix = { info: "[INFO]", warn: "[WARN]", error: "[ERROR]" }[level];
  console.log(`[${time}] ${prefix} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Fisher-Yates 셔플
 */
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

// ============ 디버그 캡처 클래스 ============

class ShuffleDebugCapture {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private requests: CapturedRequest[] = [];
  private responses: CapturedResponse[] = [];
  private outputDir: string;

  constructor(outputDir: string = "./debug/shuffle-captures") {
    this.outputDir = outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * 요청 분류
   */
  private categorizeRequest(url: string): RequestCategory {
    if (url.includes("ac.search.naver.com") || url.includes("ac.naver.com")) {
      return "autocomplete";
    }
    if (url.includes("product-logs")) {
      return "product-log";
    }
    if (url.includes("nlog.commerce.naver.com")) {
      return "commerce";
    }
    if (url.includes("nlog.naver.com") || url.includes("lcs.naver.com")) {
      return "nlog";
    }
    if (
      url.includes("search.naver.com") ||
      url.includes("search.shopping.naver.com") ||
      url.includes("msearch.shopping.naver.com")
    ) {
      return "search";
    }
    return "other";
  }

  /**
   * 요청 핸들러
   */
  private async onRequest(request: Request): Promise<void> {
    const url = request.url();
    const category = this.categorizeRequest(url);

    // 관심 있는 요청만 캡처
    const isTracking =
      category !== "other" ||
      url.includes("log") ||
      url.includes("beacon") ||
      url.includes("siape") ||
      url.includes("wcs");

    if (!isTracking) return;

    const captured: CapturedRequest = {
      timestamp: Date.now(),
      url,
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
      resourceType: request.resourceType(),
      category,
    };

    this.requests.push(captured);

    // 카테고리별 상세 로그
    if (category === "autocomplete") {
      const urlObj = new URL(url);
      const q = urlObj.searchParams.get("q") || urlObj.searchParams.get("q_enc");
      console.log(`\n[AUTOCOMPLETE] GET ${url.substring(0, 80)}...`);
      console.log(`  - q: "${q}"`);
    } else if (category === "search") {
      const urlObj = new URL(url);
      console.log(`\n[SEARCH] ${request.method()} ${url.substring(0, 100)}...`);
      console.log(`  - query: "${urlObj.searchParams.get("query")}"`);
      console.log(`  - ackey: ${urlObj.searchParams.get("ackey")}`);
      console.log(`  - sm: ${urlObj.searchParams.get("sm")}`);
      console.log(`  - referer: ${captured.headers["referer"]?.substring(0, 80) || "(없음)"}`);
    } else if (category === "product-log") {
      console.log(`\n[PRODUCT-LOG] POST ${url.substring(0, 80)}...`);
      if (captured.postData) {
        try {
          const body = JSON.parse(captured.postData);
          console.log(`  - id: ${body.id}`);
          console.log(`  - tr: ${body.tr}`);
          console.log(`  - referer: ${body.referer?.substring(0, 100)}...`);
          console.log(`  - dwellTime: ${body.dwellTime}`);
          console.log(`  - scrollDepth: ${body.scrollDepth}`);

          // referer에서 ackey 추출
          if (body.referer) {
            try {
              const refererUrl = new URL(body.referer);
              console.log(`  - referer.ackey: ${refererUrl.searchParams.get("ackey")}`);
              console.log(`  - referer.query: ${refererUrl.searchParams.get("query")?.substring(0, 30)}`);
            } catch {}
          }
        } catch {}
      }
    } else if (category === "nlog" || category === "commerce") {
      console.log(`[${category.toUpperCase()}] ${url.substring(0, 100)}...`);
    }
  }

  /**
   * 응답 핸들러
   */
  private async onResponse(response: Response): Promise<void> {
    const url = response.url();
    const category = this.categorizeRequest(url);

    if (category === "other") return;

    const captured: CapturedResponse = {
      timestamp: Date.now(),
      url,
      status: response.status(),
      headers: response.headers(),
    };

    // 자동완성 응답 본문 캡처
    if (category === "autocomplete") {
      try {
        const body = await response.text();
        captured.body = body;

        // 자동완성 결과 파싱
        const match = body.match(/\[\[.*?\]\]/);
        if (match) {
          try {
            const suggestions = JSON.parse(match[0]);
            if (Array.isArray(suggestions) && suggestions.length > 0) {
              console.log(`[AUTOCOMPLETE RESPONSE] ${suggestions.length}개 제안:`);
              suggestions.slice(0, 5).forEach((s: any, i: number) => {
                console.log(`  ${i + 1}. "${Array.isArray(s) ? s[0] : s}"`);
              });
            }
          } catch {}
        }
      } catch {}
    }

    this.responses.push(captured);

    if (category === "product-log") {
      console.log(`[PRODUCT-LOG RESPONSE] Status: ${response.status()}`);
    }
  }

  /**
   * 브라우저 초기화
   */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: false,
      channel: "chrome",
    });

    const context = await this.browser.newContext({
      viewport: { width: 400, height: 700 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      isMobile: true,
    });

    this.page = await context.newPage();

    // 캡처 훅 설치
    this.page.on("request", (req) => this.onRequest(req));
    this.page.on("response", (res) => this.onResponse(res));

    log("Browser initialized (mobile)");
  }

  /**
   * 셔플 검색 테스트 실행
   */
  async runShuffleTest(config: ShuffleTestConfig): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");

    this.requests = [];
    this.responses = [];

    const shuffledKeyword = shuffleWords(config.fullProductName).substring(0, 30);

    console.log("\n" + "=".repeat(60));
    console.log("[셔플 테스트 시작]");
    console.log(`  원본: "${config.fullProductName}"`);
    console.log(`  셔플: "${shuffledKeyword}"`);
    console.log(`  MID: ${config.nvMid}`);
    console.log("=".repeat(60) + "\n");

    // 1. m.naver.com 접속
    log("m.naver.com 접속...");
    await this.page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(randomBetween(1500, 2500));

    // 2. 검색창 클릭
    log("검색창 클릭...");
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.locator("#MM_SEARCH_FAKE").click({ force: true });
    await sleep(randomBetween(800, 1200));

    // 3. 셔플된 키워드 입력 (자동완성 대기)
    log(`셔플 키워드 입력: "${shuffledKeyword}"`);
    const searchInput = this.page.locator("#query.sch_input").first();
    await searchInput.type(shuffledKeyword, { delay: randomBetween(80, 150) });
    await sleep(randomBetween(2000, 3000)); // 자동완성 로딩 대기

    // 4. 자동완성 선택 또는 엔터
    log("자동완성 확인...");
    const autocompleteItems = this.page.locator(
      '#sb-ac-recomm-wrap li.u_atcp_l[data-area="top"] a.u_atcp_a'
    );

    let autocompleteSelected = false;
    try {
      await autocompleteItems.first().waitFor({ state: "visible", timeout: 3000 });
      const count = await autocompleteItems.count();
      log(`자동완성 항목 ${count}개 발견`);

      if (count > 0) {
        const randomIndex = Math.min(Math.floor(Math.random() * count), count - 1);
        const selectedItem = autocompleteItems.nth(randomIndex);
        const text = await selectedItem.textContent();
        log(`자동완성 선택: "${text?.trim()}"`);
        await selectedItem.click();
        autocompleteSelected = true;
      }
    } catch {
      log("자동완성 없음, 엔터로 검색", "warn");
      await this.page.keyboard.press("Enter");
    }

    await this.page.waitForLoadState("domcontentloaded");
    await sleep(randomBetween(2000, 3000));

    // 5. URL에서 ackey 확인
    const currentUrl = this.page.url();
    log(`현재 URL: ${currentUrl.substring(0, 100)}...`);

    try {
      const urlObj = new URL(currentUrl);
      const ackey = urlObj.searchParams.get("ackey");
      const sm = urlObj.searchParams.get("sm");
      const query = urlObj.searchParams.get("query");
      console.log("\n[URL 분석]");
      console.log(`  - ackey: ${ackey}`);
      console.log(`  - sm: ${sm}`);
      console.log(`  - query: "${query}"`);
    } catch {}

    // 6. query를 원본 상품명으로 변경하여 재검색
    log("원본 상품명으로 query 변경...");
    try {
      const urlObj = new URL(currentUrl);
      urlObj.searchParams.set("query", config.fullProductName);
      const modifiedUrl = urlObj.toString();
      log(`변경된 URL로 이동...`);
      await this.page.goto(modifiedUrl, { waitUntil: "domcontentloaded" });
      await sleep(randomBetween(2000, 3000));
    } catch (e: any) {
      log(`URL 변경 실패: ${e.message}`, "error");
    }

    // 7. MID 상품 찾기 + 클릭
    log(`MID=${config.nvMid} 상품 찾기...`);
    const MAX_SCROLL = 10;

    for (let i = 0; i < MAX_SCROLL; i++) {
      const productLink = this.page.locator(`a[href*="nv_mid=${config.nvMid}"]`).first();
      const isVisible = await productLink.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        log("MID 일치 상품 발견!");

        // 클릭 (새 탭/같은 탭 둘 다 처리)
        const context = this.page.context();
        const pagesBefore = context.pages().length;

        await productLink.click();
        await sleep(2000); // 페이지 로딩 대기

        const pagesAfter = context.pages();
        if (pagesAfter.length > pagesBefore) {
          // 새 탭이 열림
          const newPage = pagesAfter[pagesAfter.length - 1];
          newPage.on("request", (req) => this.onRequest(req));
          newPage.on("response", (res) => this.onResponse(res));
          this.page = newPage;
          await newPage.waitForLoadState("domcontentloaded").catch(() => {});
          log(`새 탭 열림: ${newPage.url().substring(0, 60)}...`);
        } else {
          // 같은 탭에서 이동
          await this.page.waitForLoadState("domcontentloaded").catch(() => {});
          log(`같은 탭 이동: ${this.page.url().substring(0, 60)}...`);
        }

        // 체류 시간 + 스크롤
        log("5초 체류 + 스크롤...");
        for (let j = 0; j < 3; j++) {
          await this.page.mouse.wheel(0, 200);
          await sleep(1500);
        }

        break;
      }

      // 스크롤
      await this.page.mouse.wheel(0, 500);
      await sleep(randomBetween(500, 800));
    }

    // 8. 결과 저장
    this.saveResults(config, shuffledKeyword, autocompleteSelected);
  }

  /**
   * 결과 저장
   */
  private saveResults(
    config: ShuffleTestConfig,
    shuffledKeyword: string,
    autocompleteSelected: boolean
  ): void {
    const timestamp = Date.now();
    const filename = `shuffle_${timestamp}.json`;
    const filepath = path.join(this.outputDir, filename);

    // 통계 계산
    const autocompleteReqs = this.requests.filter((r) => r.category === "autocomplete");
    const searchReqs = this.requests.filter((r) => r.category === "search");
    const productLogReqs = this.requests.filter((r) => r.category === "product-log");

    // ackey 추출
    const ackeys = new Set<string>();
    for (const req of searchReqs) {
      try {
        const urlObj = new URL(req.url);
        const ackey = urlObj.searchParams.get("ackey");
        if (ackey) ackeys.add(ackey);
      } catch {}
    }

    const result = {
      config,
      shuffledKeyword,
      autocompleteSelected,
      timestamp,
      summary: {
        autocompleteRequests: autocompleteReqs.length,
        searchRequests: searchReqs.length,
        productLogRequests: productLogReqs.length,
        ackeys: Array.from(ackeys),
        ackeyConsistency: ackeys.size <= 1,
      },
      requests: this.requests,
      responses: this.responses,
    };

    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));

    console.log("\n" + "=".repeat(60));
    console.log("[결과 요약]");
    console.log(`  자동완성 요청: ${autocompleteReqs.length}회`);
    console.log(`  검색 요청: ${searchReqs.length}회`);
    console.log(`  product-log 요청: ${productLogReqs.length}회`);
    console.log(`  ackey: ${Array.from(ackeys).join(", ") || "(없음)"}`);
    console.log(`  ackey 일관성: ${ackeys.size <= 1 ? "Y" : "N"}`);
    console.log(`  저장: ${filepath}`);
    console.log("=".repeat(60) + "\n");
  }

  /**
   * 종료
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

// ============ 메인 ============

async function main(): Promise<void> {
  const capture = new ShuffleDebugCapture();

  // 테스트 상품 (Supabase에서 가져올 수도 있음)
  const testConfig: ShuffleTestConfig = {
    mainKeyword: "신지모루",
    fullProductName:
      "신지모루 Qi2 3in1 맥세이프 무선 충전기 M 윙터보 아이폰 에어팟 애플 워치 거치대",
    nvMid: "89029512267",
  };

  try {
    await capture.init();
    await capture.runShuffleTest(testConfig);
  } catch (error: any) {
    log(`오류: ${error.message}`, "error");
    console.error(error);
  } finally {
    await capture.close();
  }
}

// CLI 실행
main().catch(console.error);
