/**
 * Shuffle Test Packet - 패킷 기반 셔플 테스트
 *
 * IntentGenerator + SessionProcessor를 활용한 셔플 검색 테스트
 * - 상품명 셔플 → 자동완성/엔터 검색 → ackey 획득
 * - 원본 상품명으로 재검색 → MID 상품 클릭
 *
 * 실행:
 *   npx tsx scripts/shuffle-test-packet/index.ts
 *   npx tsx scripts/shuffle-test-packet/index.ts --headless
 *   npx tsx scripts/shuffle-test-packet/index.ts --debug
 *   npx tsx scripts/shuffle-test-packet/index.ts --count=10
 */

import * as dotenv from "dotenv";
import * as path from "path";

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

import { createClient } from "@supabase/supabase-js";
import { IntentGenerator } from "../../packet-engine/intent/IntentGenerator";
import { SessionProcessor } from "../../packet-engine/intent/SessionProcessor";
import type { ProductConfig, IntentContext, SessionResult } from "../../packet-engine/intent/types";

// ============ Supabase 설정 ============
const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ CLI 옵션 ============
const IS_HEADLESS = process.argv.includes("--headless");
const IS_DEBUG = process.argv.includes("--debug");
const countArg = process.argv.find((a) => a.startsWith("--count="));
const TEST_COUNT = countArg ? parseInt(countArg.split("=")[1]) : 10;

// ============ 테스트 결과 타입 ============
interface ShuffleTestResult {
  testNum: number;
  success: boolean;
  shuffledKeyword: string;
  autocompleteUsed: boolean;
  ackey: string | null;
  productUrl?: string;
  reason?: string;
  duration: number;
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

// ============ 작업 가져오기 ============

interface WorkItem {
  taskId: number;
  slotId: number;
  keyword: string;
  productName: string;
  mid: string;
}

async function fetchWorkItems(count: number): Promise<WorkItem[]> {
  const workItems: WorkItem[] = [];

  // 작업 가져오기
  const { data: tasks, error: taskError } = await supabase
    .from("traffic_navershopping")
    .select("id, slot_id, keyword, link_url")
    .eq("slot_type", "네이버쇼핑")
    .order("id", { ascending: true })
    .limit(count * 2);

  if (taskError || !tasks) {
    log(`작업 가져오기 실패: ${taskError?.message}`, "error");
    return [];
  }

  for (const task of tasks) {
    if (workItems.length >= count) break;

    const { data: slot } = await supabase
      .from("slot_naver")
      .select("mid, product_name")
      .eq("id", task.slot_id)
      .single();

    if (!slot || !slot.mid || !slot.product_name) {
      await supabase.from("traffic_navershopping").delete().eq("id", task.id);
      continue;
    }

    // 작업 삭제
    await supabase.from("traffic_navershopping").delete().eq("id", task.id);

    workItems.push({
      taskId: task.id,
      slotId: task.slot_id,
      keyword: task.keyword,
      productName: slot.product_name,
      mid: slot.mid,
    });
  }

  return workItems;
}

// ============ 단일 테스트 실행 ============

async function runOneShuffleTest(
  testNum: number,
  work: WorkItem
): Promise<ShuffleTestResult> {
  const startTime = Date.now();

  // 셔플된 키워드 (최대 30자)
  const shuffledKeyword = shuffleWords(work.productName).substring(0, 30);

  log(`\n========== [${testNum}] 테스트 시작 ==========`);
  log(`상품: ${work.productName.substring(0, 40)}...`);
  log(`MID: ${work.mid}`);
  log(`셔플: "${shuffledKeyword}"`);

  const intentGenerator = new IntentGenerator(
    {
      headless: IS_HEADLESS,
      mobile: true,
      typingDelay: 100,
    },
    IS_DEBUG ? log : undefined
  );

  const sessionProcessor = new SessionProcessor(
    {
      debug: IS_DEBUG,
      requestDelay: 500,
      sendLogs: false,
    },
    IS_DEBUG ? log : undefined
  );

  let intent: IntentContext | null = null;

  try {
    // Phase 1: 셔플 키워드로 의도 생성
    log(`[Phase 1] 셔플 키워드로 의도 생성...`);
    await intentGenerator.initialize();

    // 셔플된 키워드로 검색 (자동완성 트리거)
    intent = await intentGenerator.generateIntent(shuffledKeyword);

    const autocompleteUsed = intent.selectedQuery !== shuffledKeyword;
    log(`[Phase 1 완료]`);
    log(`  - ackey: ${intent.ackey || "(없음)"}`);
    log(`  - 자동완성: ${autocompleteUsed ? "사용" : "엔터검색"}`);
    log(`  - selectedQuery: "${intent.selectedQuery}"`);

    // Phase 2: 원본 상품명으로 재검색 및 MID 클릭 (직접 구현)
    log(`[Phase 2] 원본 상품명으로 재검색...`);

    const page = intentGenerator.getPage();
    if (!page) {
      throw new Error("Page not available");
    }

    // URL에서 ackey 유지하면서 query만 원본 상품명으로 변경
    const currentUrl = page.url();
    try {
      const urlObj = new URL(currentUrl);
      urlObj.searchParams.set("query", work.productName);
      log(`변경된 URL로 이동...`);
      await page.goto(urlObj.toString(), { waitUntil: "domcontentloaded" });
      await sleep(randomBetween(2000, 3000));
    } catch (e: any) {
      throw new Error(`URL 변경 실패: ${e.message}`);
    }

    // MID 상품 찾기 + 클릭
    log(`MID=${work.mid} 상품 찾기...`);
    const MAX_SCROLL = 10;
    let productClicked = false;
    let finalUrl = "";

    for (let i = 0; i < MAX_SCROLL; i++) {
      const productLink = page.locator(`a[href*="nv_mid=${work.mid}"]`).first();
      const isVisible = await productLink.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        log("MID 일치 상품 발견!");

        // 클릭 (새 탭/같은 탭 처리)
        const context = page.context();
        const pagesBefore = context.pages().length;

        await productLink.click();
        await sleep(2000);

        const pagesAfter = context.pages();
        let activePage = page;

        if (pagesAfter.length > pagesBefore) {
          // 새 탭이 열림
          const newPage = pagesAfter[pagesAfter.length - 1];
          await newPage.waitForLoadState("domcontentloaded").catch(() => {});
          activePage = newPage;
          log(`새 탭 열림: ${newPage.url().substring(0, 60)}...`);
        } else {
          // 같은 탭에서 이동
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          log(`같은 탭 이동: ${page.url().substring(0, 60)}...`);
        }

        // 리다이렉트 대기 (bridge URL 처리)
        for (let j = 0; j < 10; j++) {
          finalUrl = activePage.url();
          if (!finalUrl.includes("/bridge") && !finalUrl.includes("cr.shopping")) {
            break;
          }
          await sleep(500);
        }

        finalUrl = activePage.url();
        productClicked = true;

        // 체류 시간
        log("3초 체류...");
        await sleep(3000);

        break;
      }

      // 스크롤
      await page.mouse.wheel(0, 500);
      await sleep(randomBetween(500, 800));
    }

    const duration = Date.now() - startTime;

    if (!productClicked) {
      return {
        testNum,
        success: false,
        shuffledKeyword,
        autocompleteUsed,
        ackey: intent.ackey || null,
        reason: `MID ${work.mid} 상품 못 찾음`,
        duration,
      };
    }

    // 성공 판정: smartstore 또는 brand URL이면 성공
    const isSuccess =
      finalUrl.includes("smartstore.naver.com") || finalUrl.includes("brand.naver.com");

    if (isSuccess) {
      log(`[SUCCESS] ${duration}ms`);
      log(`  - productUrl: ${finalUrl.substring(0, 60)}...`);
    } else {
      log(`[FAIL] URL이 상품 페이지 아님: ${finalUrl.substring(0, 50)}`, "warn");
    }

    return {
      testNum,
      success: isSuccess,
      shuffledKeyword,
      autocompleteUsed,
      ackey: intent.ackey || null,
      productUrl: finalUrl,
      reason: isSuccess ? undefined : `Unexpected URL: ${finalUrl.substring(0, 50)}`,
      duration,
    };
  } catch (error: any) {
    log(`[ERROR] ${error.message}`, "error");
    return {
      testNum,
      success: false,
      shuffledKeyword,
      autocompleteUsed: false,
      ackey: intent?.ackey || null,
      reason: error.message,
      duration: Date.now() - startTime,
    };
  } finally {
    await intentGenerator.cleanup();
  }
}

// ============ 메인 ============

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  패킷 기반 셔플 테스트");
  console.log("  IntentGenerator + SessionProcessor");
  console.log("=".repeat(60));
  console.log(`  모드: ${IS_HEADLESS ? "Headless" : "Visible"}`);
  console.log(`  디버그: ${IS_DEBUG ? "ON" : "OFF"}`);
  console.log(`  테스트 횟수: ${TEST_COUNT}`);
  console.log("=".repeat(60) + "\n");

  // 작업 가져오기
  log(`Supabase에서 ${TEST_COUNT}개 작업 가져오는 중...`);
  const workItems = await fetchWorkItems(TEST_COUNT);

  if (workItems.length === 0) {
    log(`가져온 작업이 없습니다!`, "error");
    process.exit(1);
  }

  log(`${workItems.length}개 작업 가져옴`);

  const results: ShuffleTestResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < workItems.length; i++) {
    const work = workItems[i];
    const testNum = i + 1;

    const result = await runOneShuffleTest(testNum, work);
    results.push(result);

    // 중간 통계 (10회마다)
    if (testNum % 10 === 0) {
      const successCount = results.filter((r) => r.success).length;
      const autocompleteCount = results.filter((r) => r.autocompleteUsed).length;
      console.log(`\n--- 중간 통계 (${testNum}회) ---`);
      console.log(
        `성공: ${successCount}/${testNum} (${((successCount / testNum) * 100).toFixed(1)}%)`
      );
      console.log(`자동완성 사용: ${autocompleteCount}/${testNum}`);
    }

    // 다음 테스트 전 대기
    if (i < workItems.length - 1) {
      const delay = randomBetween(3000, 5000);
      log(`다음 테스트까지 ${Math.round(delay / 1000)}초 대기...`);
      await sleep(delay);
    }
  }

  // 최종 결과
  const totalTime = (Date.now() - startTime) / 1000 / 60;
  const successCount = results.filter((r) => r.success).length;
  const autocompleteCount = results.filter((r) => r.autocompleteUsed).length;
  const ackeyCount = results.filter((r) => r.ackey).length;
  const successResults = results.filter((r) => r.success && r.duration);
  const avgDuration =
    successResults.length > 0
      ? successResults.reduce((sum, r) => sum + r.duration, 0) / successResults.length
      : 0;

  // 실패 원인 분석
  const failReasons: Record<string, number> = {};
  results
    .filter((r) => !r.success)
    .forEach((r) => {
      const reason = r.reason || "Unknown";
      failReasons[reason] = (failReasons[reason] || 0) + 1;
    });

  console.log("\n" + "=".repeat(60));
  console.log(`  최종 결과 (${totalTime.toFixed(1)}분 소요)`);
  console.log("=".repeat(60));
  console.log(
    `  성공: ${successCount}/${results.length} (${((successCount / results.length) * 100).toFixed(1)}%)`
  );
  console.log(`  평균 소요시간: ${Math.round(avgDuration)}ms`);
  console.log(`  자동완성 사용: ${autocompleteCount}/${results.length}`);
  console.log(`  ackey 발급: ${ackeyCount}/${results.length}`);
  console.log(`\n  실패 원인:`);
  Object.entries(failReasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      console.log(`    - ${reason.substring(0, 50)}: ${count}회`);
    });
  console.log("=".repeat(60) + "\n");

  // 상세 결과
  console.log("상세 결과:");
  results.forEach((r) => {
    const status = r.success ? "O" : "X";
    const detail = r.success
      ? `${r.duration}ms${r.autocompleteUsed ? " (자동완성)" : " (엔터)"}`
      : r.reason?.substring(0, 40);
    console.log(`  [${String(r.testNum).padStart(3)}] ${status} ${detail}`);
  });

  process.exit(successCount >= results.length / 2 ? 0 : 1);
}

// CLI 실행
main().catch((e) => {
  log(`치명적 오류: ${e.message}`, "error");
  console.error(e);
  process.exit(1);
});
