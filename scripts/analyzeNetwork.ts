/**
 * Network Capture 분석 스크립트
 *
 * 사용법: npx tsx scripts/analyzeNetwork.ts
 *
 * logs/network/ 폴더에 저장된 캡처 파일들을 분석하여
 * CAPTCHA vs SUCCESS 시나리오의 네트워크 요청 차이점을 찾습니다.
 */

import * as fs from "fs";
import * as path from "path";

interface CapturedRequest {
  timestamp: number;
  url: string;
  method: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
}

interface CapturedResponse {
  timestamp: number;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  fromCache: boolean;
}

interface NetworkCaptureResult {
  scenario: 'captcha' | 'success' | 'unknown';
  startTime: number;
  endTime: number;
  requests: CapturedRequest[];
  responses: CapturedResponse[];
  finalUrl: string;
}

const LOG_DIR = path.join(process.cwd(), 'logs', 'network');

function loadCaptures(): { captcha: NetworkCaptureResult[]; success: NetworkCaptureResult[] } {
  const captcha: NetworkCaptureResult[] = [];
  const success: NetworkCaptureResult[] = [];

  if (!fs.existsSync(LOG_DIR)) {
    console.log(`로그 디렉토리가 없습니다: ${LOG_DIR}`);
    console.log(`NETWORK_CAPTURE=true 환경변수를 설정하고 unified-runner를 실행하세요.`);
    return { captcha, success };
  }

  const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
  console.log(`\n발견된 캡처 파일: ${files.length}개\n`);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
      const data: NetworkCaptureResult = JSON.parse(content);

      if (data.scenario === 'captcha') {
        captcha.push(data);
      } else if (data.scenario === 'success') {
        success.push(data);
      }
    } catch (e) {
      console.error(`파일 로드 실패: ${file}`);
    }
  }

  return { captcha, success };
}

function extractUrlPatterns(requests: CapturedRequest[]): Map<string, number> {
  const patterns = new Map<string, number>();

  for (const req of requests) {
    try {
      const url = new URL(req.url);
      // 쿼리 파라미터 제거한 경로만
      const pattern = `${url.hostname}${url.pathname}`;
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
    } catch {
      // ignore invalid URLs
    }
  }

  return patterns;
}

function analyze(captchaCaptures: NetworkCaptureResult[], successCaptures: NetworkCaptureResult[]): void {
  console.log('='.repeat(60));
  console.log('  CAPTCHA vs SUCCESS 네트워크 분석');
  console.log('='.repeat(60));

  console.log(`\n[데이터셋]`);
  console.log(`  CAPTCHA 샘플: ${captchaCaptures.length}개`);
  console.log(`  SUCCESS 샘플: ${successCaptures.length}개`);

  if (captchaCaptures.length === 0 || successCaptures.length === 0) {
    console.log('\n분석을 위해 양쪽 시나리오의 데이터가 필요합니다.');
    return;
  }

  // URL 패턴 추출
  const captchaPatterns = new Map<string, number>();
  const successPatterns = new Map<string, number>();

  for (const capture of captchaCaptures) {
    const patterns = extractUrlPatterns(capture.requests);
    for (const [pattern, count] of patterns) {
      captchaPatterns.set(pattern, (captchaPatterns.get(pattern) || 0) + count);
    }
  }

  for (const capture of successCaptures) {
    const patterns = extractUrlPatterns(capture.requests);
    for (const [pattern, count] of patterns) {
      successPatterns.set(pattern, (successPatterns.get(pattern) || 0) + count);
    }
  }

  // CAPTCHA에서만 높은 빈도로 나타나는 URL
  console.log('\n[CAPTCHA에서 더 자주 나타나는 URL]');
  const captchaOnly: [string, number, number][] = [];
  for (const [pattern, count] of captchaPatterns) {
    const successCount = successPatterns.get(pattern) || 0;
    const ratio = count / captchaCaptures.length;
    const successRatio = successCount / successCaptures.length;

    if (ratio > successRatio * 2 && ratio > 0.5) {
      captchaOnly.push([pattern, ratio, successRatio]);
    }
  }
  captchaOnly.sort((a, b) => b[1] - a[1]);
  for (const [pattern, cRatio, sRatio] of captchaOnly.slice(0, 15)) {
    console.log(`  ${(cRatio * 100).toFixed(0)}% vs ${(sRatio * 100).toFixed(0)}% | ${pattern}`);
  }

  // SUCCESS에서만 높은 빈도로 나타나는 URL
  console.log('\n[SUCCESS에서 더 자주 나타나는 URL]');
  const successOnly: [string, number, number][] = [];
  for (const [pattern, count] of successPatterns) {
    const captchaCount = captchaPatterns.get(pattern) || 0;
    const ratio = count / successCaptures.length;
    const captchaRatio = captchaCount / captchaCaptures.length;

    if (ratio > captchaRatio * 2 && ratio > 0.5) {
      successOnly.push([pattern, ratio, captchaRatio]);
    }
  }
  successOnly.sort((a, b) => b[1] - a[1]);
  for (const [pattern, sRatio, cRatio] of successOnly.slice(0, 15)) {
    console.log(`  ${(sRatio * 100).toFixed(0)}% vs ${(cRatio * 100).toFixed(0)}% | ${pattern}`);
  }

  // 응답 상태 코드 비교
  console.log('\n[응답 상태 코드 분포]');
  const captchaStatuses: Record<number, number> = {};
  const successStatuses: Record<number, number> = {};

  for (const capture of captchaCaptures) {
    for (const resp of capture.responses) {
      captchaStatuses[resp.status] = (captchaStatuses[resp.status] || 0) + 1;
    }
  }
  for (const capture of successCaptures) {
    for (const resp of capture.responses) {
      successStatuses[resp.status] = (successStatuses[resp.status] || 0) + 1;
    }
  }

  console.log(`  CAPTCHA: ${JSON.stringify(captchaStatuses)}`);
  console.log(`  SUCCESS: ${JSON.stringify(successStatuses)}`);

  // 특정 키워드 포함 URL 분석
  const keywords = ['captcha', 'security', 'verify', 'check', 'bot', 'challenge', 'proof'];
  console.log('\n[보안 관련 키워드 포함 URL]');

  const captchaSecurityUrls = new Set<string>();
  const successSecurityUrls = new Set<string>();

  for (const capture of captchaCaptures) {
    for (const req of capture.requests) {
      if (keywords.some(k => req.url.toLowerCase().includes(k))) {
        captchaSecurityUrls.add(req.url.split('?')[0]);
      }
    }
  }
  for (const capture of successCaptures) {
    for (const req of capture.requests) {
      if (keywords.some(k => req.url.toLowerCase().includes(k))) {
        successSecurityUrls.add(req.url.split('?')[0]);
      }
    }
  }

  console.log(`\n  CAPTCHA에서 발견 (${captchaSecurityUrls.size}개):`);
  for (const url of [...captchaSecurityUrls].slice(0, 10)) {
    console.log(`    ${url}`);
  }

  console.log(`\n  SUCCESS에서 발견 (${successSecurityUrls.size}개):`);
  for (const url of [...successSecurityUrls].slice(0, 10)) {
    console.log(`    ${url}`);
  }

  // 요청 타이밍 분석
  console.log('\n[요청 타이밍 분석]');
  const captchaTiming = captchaCaptures.map(c => c.endTime - c.startTime);
  const successTiming = successCaptures.map(c => c.endTime - c.startTime);

  const avgCaptcha = captchaTiming.reduce((a, b) => a + b, 0) / captchaTiming.length;
  const avgSuccess = successTiming.reduce((a, b) => a + b, 0) / successTiming.length;

  console.log(`  CAPTCHA 평균 소요 시간: ${(avgCaptcha / 1000).toFixed(1)}초`);
  console.log(`  SUCCESS 평균 소요 시간: ${(avgSuccess / 1000).toFixed(1)}초`);

  // Final URL 패턴
  console.log('\n[최종 URL 패턴]');
  console.log('  CAPTCHA:');
  const captchaFinalUrls = captchaCaptures.map(c => c.finalUrl);
  for (const url of [...new Set(captchaFinalUrls)].slice(0, 5)) {
    console.log(`    ${url.substring(0, 80)}`);
  }

  console.log('  SUCCESS:');
  const successFinalUrls = successCaptures.map(c => c.finalUrl);
  for (const url of [...new Set(successFinalUrls)].slice(0, 5)) {
    console.log(`    ${url.substring(0, 80)}`);
  }

  console.log('\n' + '='.repeat(60));
}

// 메인 실행
const { captcha, success } = loadCaptures();
analyze(captcha, success);
