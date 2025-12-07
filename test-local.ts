/**
 * 로컬 테스트 - PRB 엔진 단일 실행
 *
 * 실행: npx tsx test-local.ts
 *
 * IP 로테이션 없이 단일 브라우저로 테스트
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// .env 로드
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env'),
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}

import { connect } from "puppeteer-real-browser";
import type { Page, Browser } from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import { runV7Engine } from "./engines/v7_engine";

// ============ 설정 ============
const TEST_COUNT = 3;  // 테스트 횟수

const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ 타입 ============
interface WorkItem {
  taskId: number;
  slotId: number;
  keyword: string;
  productName: string;
  mid: string;
}

interface Profile {
  name: string;
  prb_options?: {
    headless?: boolean;
    turnstile?: boolean;
  };
}

interface RunContext {
  log: (event: string, data?: any) => void;
  profile: Profile;
  login: boolean;
}

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg: string) {
  const time = new Date().toISOString().substring(11, 19);
  console.log(`[${time}] ${msg}`);
}

// ============ 프로필 로드 ============
function loadProfile(profileName: string): Profile {
  const profilePath = path.join(__dirname, 'profiles', `${profileName}.json`);
  if (fs.existsSync(profilePath)) {
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  }
  return {
    name: profileName,
    prb_options: { headless: false, turnstile: true }
  };
}

// ============ 작업 가져오기 (삭제 안함 - 테스트용) ============
async function getTestWork(): Promise<WorkItem | null> {
  // 1. traffic_navershopping에서 작업 가져오기
  const { data: tasks, error } = await supabase
    .from("traffic_navershopping")
    .select("id, slot_id, keyword")
    .eq("slot_type", "네이버쇼핑")
    .limit(10);

  if (error || !tasks || tasks.length === 0) {
    log(`작업 없음: ${error?.message || 'empty'}`);
    return null;
  }

  // 2. mid/product_name 있는 작업 찾기
  for (const task of tasks) {
    const { data: slot } = await supabase
      .from("slot_naver")
      .select("mid, product_name")
      .eq("id", task.slot_id)
      .single();

    if (slot?.mid && slot?.product_name) {
      return {
        taskId: task.id,
        slotId: task.slot_id,
        keyword: task.keyword,
        productName: slot.product_name,
        mid: slot.mid
      };
    }
  }

  return null;
}

// ============ 메인 ============
async function main() {
  console.log("\n" + "=".repeat(50));
  console.log("  PRB 로컬 테스트 (IP 로테이션 없음)");
  console.log("=".repeat(50));
  console.log(`  테스트 횟수: ${TEST_COUNT}회`);
  console.log("=".repeat(50) + "\n");

  const profile = loadProfile("pc_v7");
  log(`Profile: ${profile.name}`);

  let successCount = 0;
  let captchaCount = 0;
  let failCount = 0;

  for (let i = 1; i <= TEST_COUNT; i++) {
    log(`\n--- 테스트 ${i}/${TEST_COUNT} ---`);

    let browser: Browser | null = null;

    try {
      // 1. 작업 가져오기
      const work = await getTestWork();
      if (!work) {
        log("작업 없음, 스킵");
        continue;
      }

      log(`상품: ${work.productName.substring(0, 40)}...`);
      log(`MID: ${work.mid}`);
      log(`키워드: ${work.keyword}`);

      // 2. 브라우저 시작 (PRB)
      log("브라우저 시작 중...");
      const response = await connect({
        headless: false,
        turnstile: true,
      });

      browser = response.browser as Browser;
      const page = response.page as Page;
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);

      log("브라우저 시작됨 (PRB + turnstile)");

      // 3. Context
      const ctx: RunContext = {
        log: (event: string, data?: any) => {
          if (data) {
            log(`  [Engine] ${event}: ${JSON.stringify(data)}`);
          } else {
            log(`  [Engine] ${event}`);
          }
        },
        profile,
        login: false
      };

      // 4. Product
      const product = {
        id: work.slotId,
        keyword: work.keyword,
        product_name: work.productName,
        mid: work.mid
      };

      // 5. V7 엔진 실행
      log("V7 엔진 실행...");
      const startTime = Date.now();
      const result = await runV7Engine(page, browser, product, ctx);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      // 6. 결과
      if (result.productPageEntered) {
        successCount++;
        log(`✅ SUCCESS (${duration}s)`);
      } else if (result.captchaDetected) {
        captchaCount++;
        log(`⚠️ CAPTCHA (${duration}s)`);
      } else {
        failCount++;
        log(`❌ FAILED: ${result.error} (${duration}s)`);
      }

      // 7. 결과 확인 후 대기
      log("5초 대기 후 브라우저 종료...");
      await sleep(5000);

    } catch (e: any) {
      failCount++;
      log(`❌ ERROR: ${e.message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
        log("브라우저 종료됨");
      }
    }

    // 다음 테스트 전 대기
    if (i < TEST_COUNT) {
      log("3초 대기...");
      await sleep(3000);
    }
  }

  // 최종 결과
  console.log("\n" + "=".repeat(50));
  console.log("  테스트 결과");
  console.log("=".repeat(50));
  console.log(`  성공: ${successCount}/${TEST_COUNT} (${(successCount/TEST_COUNT*100).toFixed(0)}%)`);
  console.log(`  CAPTCHA: ${captchaCount}/${TEST_COUNT} (${(captchaCount/TEST_COUNT*100).toFixed(0)}%)`);
  console.log(`  실패: ${failCount}/${TEST_COUNT} (${(failCount/TEST_COUNT*100).toFixed(0)}%)`);
  console.log("=".repeat(50) + "\n");
}

main().catch(console.error);
