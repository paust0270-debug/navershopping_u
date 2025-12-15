/**
 * Mobile Intent Session Runner - 모바일 네이버 정상 방문 세션 성립 프로토타입
 *
 * 핵심 원칙:
 * - 1 의도 = 1 세션 = 1 완결
 * - ackey는 서버 발급값 그대로 사용 (임의 생성/변조 금지)
 * - 생성 축(A): 직렬 (겹침 금지)
 * - 완결 축(B): 생성 직후 즉시 완결 (맥락 유지)
 *
 * 실행:
 *   npx tsx scripts/mobile-intent-session-runner.ts
 *   npx tsx scripts/mobile-intent-session-runner.ts --headless
 *   npx tsx scripts/mobile-intent-session-runner.ts --debug
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// .env 로드
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}

import { IntentGenerator } from '../engines-packet/intent/IntentGenerator';
import { SessionProcessor } from '../engines-packet/intent/SessionProcessor';
import { ProductConfig, IntentContext, SessionResult } from '../engines-packet/intent/types';

// ============ 설정 ============

// 테스트 상품
const TEST_PRODUCT: ProductConfig = {
  mainKeyword: '신지모루',
  fullProductName: '신지모루 Qi2 3in1 맥세이프 무선 충전기 M 윙터보 아이폰 에어팟 애플 워치 거치대',
  nvMid: '89029512267',
};

// 실행 옵션
const IS_HEADLESS = process.argv.includes('--headless');
const IS_DEBUG = process.argv.includes('--debug');

// ============ 유틸 ============

function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const time = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const prefix = { info: '[INFO]', warn: '[WARN]', error: '[ERROR]' }[level];
  console.log(`[${time}] ${prefix} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============ 핵심 로직 ============

/**
 * 단일 방문 처리
 *
 * 1 의도 = 1 세션 = 1 완결 패턴 구현
 * 의도 생성 직후 즉시 세션 처리하여 맥락(ackey, 쿠키, 타이밍) 유지
 */
async function processOneVisit(product: ProductConfig): Promise<SessionResult> {
  log(`=== 단일 방문 처리 시작 ===`);
  log(`상품: ${product.fullProductName.substring(0, 40)}...`);
  log(`MID: ${product.nvMid}`);

  const intentGenerator = new IntentGenerator(
    {
      headless: IS_HEADLESS,
      mobile: true,
      typingDelay: 120,
    },
    IS_DEBUG ? log : undefined
  );

  const sessionProcessor = new SessionProcessor(
    {
      debug: IS_DEBUG,
      requestDelay: 500,
      sendLogs: false, // 반복 로그 금지 원칙
    },
    IS_DEBUG ? log : undefined
  );

  let intent: IntentContext | null = null;
  let result: SessionResult = { success: false, reason: 'Not started' };

  try {
    // === Phase 1: 의도 생성 (브라우저 필수) ===
    log('[Phase 1] 의도 생성 시작...');
    await intentGenerator.initialize();

    intent = await intentGenerator.generateIntent(product.mainKeyword);

    log(`[Phase 1 완료]`);
    log(`  - ackey: ${intent.ackey || '(없음)'}`);
    log(`  - cookies: ${intent.cookies.length}개`);
    log(`  - selectedQuery: "${intent.selectedQuery}"`);
    log(`  - timestamp: ${new Date(intent.timestamp).toISOString()}`);

    // === Phase 2: 즉시 세션 처리 (맥락 유지) ===
    // 중요: 의도 생성 직후 즉시 처리하여 맥락(ackey, 쿠키, 타이밍) 유지
    log('[Phase 2] 세션 처리 시작...');

    // IntentGenerator의 페이지를 SessionProcessor에 전달
    const page = intentGenerator.getPage();
    if (!page) {
      throw new Error('Page not available from IntentGenerator');
    }
    sessionProcessor.setPage(page);

    // 세션 처리 방식 선택
    // 1. Navigation 방식 (UI 렌더링, 가장 안정적)
    // 2. browserFetch 방식 (패킷 기반, CORS/리다이렉트 이슈 있음)

    // 네비게이션 방식 사용 (bridge URL 등 리다이렉트 처리에 가장 안정적)
    log('[Phase 2] 네비게이션 방식 세션 처리...');
    result = await sessionProcessor.processSessionWithNavigation(intent, product);

    // === Phase 3: 완결 ===
    if (result.success) {
      log('[Phase 3 완결] 정상 방문 성립!');
      log(`  - ackey: ${result.ackey}`);
      log(`  - 상품 URL: ${result.productUrl?.substring(0, 60)}...`);
      log(`  - 처리 시간: ${result.duration}ms`);
    } else {
      log(`[Phase 3 실패] ${result.reason}`, 'warn');
    }

    return result;

  } catch (error: any) {
    log(`오류 발생: ${error.message}`, 'error');
    return {
      success: false,
      ackey: intent?.ackey,
      reason: error.message,
    };

  } finally {
    // IntentContext는 여기서 폐기 (재사용 금지)
    log('[종료] 브라우저 정리, IntentContext 폐기');
    await intentGenerator.cleanup();
  }
}

/**
 * 여러 상품 순차 처리
 *
 * 각 상품마다 별도의 의도 생성 (직렬)
 * 생성 축에서 겹침 방지
 */
async function processMultipleVisits(products: ProductConfig[]): Promise<SessionResult[]> {
  const results: SessionResult[] = [];

  log(`=== ${products.length}개 상품 순차 처리 ===`);

  for (let i = 0; i < products.length; i++) {
    log(`\n--- [${i + 1}/${products.length}] ---`);

    const result = await processOneVisit(products[i]);
    results.push(result);

    // 다음 생성 전 간격 (겹침 방지)
    if (i < products.length - 1) {
      const delay = randomBetween(3000, 5000);
      log(`다음 방문까지 ${delay}ms 대기...`);
      await sleep(delay);
    }
  }

  // 결과 요약
  const successCount = results.filter(r => r.success).length;
  log(`\n=== 처리 완료: ${successCount}/${products.length} 성공 ===`);

  return results;
}

// ============ 메인 ============

async function main(): Promise<void> {
  log('=== Mobile Intent Session Runner ===');
  log(`모드: ${IS_HEADLESS ? 'Headless' : 'Visible'}`);
  log(`디버그: ${IS_DEBUG ? 'ON' : 'OFF'}`);

  // 단일 상품 테스트
  const result = await processOneVisit(TEST_PRODUCT);

  // 결과 출력
  console.log('\n--- 최종 결과 ---');
  console.log(JSON.stringify(result, null, 2));

  // 종료 코드
  process.exit(result.success ? 0 : 1);
}

// 직접 실행 시
main().catch(error => {
  log(`치명적 오류: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});

export { processOneVisit, processMultipleVisits, TEST_PRODUCT };
