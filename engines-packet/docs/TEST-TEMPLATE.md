# Test Template & Guidelines

> 테스트 코드 작성 가이드 및 템플릿

## 테스트 파일 구조

```
scripts/
├── test-layer1-network.ts      # L1 네트워크 계층 테스트
├── test-layer2-browser.ts      # L2 브라우저 계층 테스트
├── test-layer3-device.ts       # L3 디바이스 계층 테스트
├── test-layer4-session.ts      # L4 세션/쿠키 계층 테스트
├── test-layer5-behavior.ts     # L5 행동 계층 테스트
├── test-hybrid-mode.ts         # 하이브리드 모드 테스트
├── test-full-flow.ts           # 전체 플로우 테스트
└── test-comparison.ts          # PRB vs Patchright 비교
```

---

## 테스트 코드 템플릿

### 기본 템플릿

```typescript
/**
 * Test: [테스트명]
 * Layer: [L1/L2/L3/L4/L5/Hybrid]
 * Date: YYYY-MM-DD
 * Version: v1.0
 *
 * 목적: [테스트 목적]
 * 예상 결과: [예상 결과]
 */

import { chromium } from "patchright";
// 또는 import puppeteer from "puppeteer-real-browser";

// ============================================================
//  설정 (Configuration)
// ============================================================

const TEST_CONFIG = {
  // 테스트 대상
  targetUrl: "https://www.naver.com",
  targetMid: "12345678",

  // 브라우저 설정
  headless: false,
  timeout: 30000,

  // 테스트 반복
  iterations: 1,
};

// ============================================================
//  1. 네트워크 계층 (Network Layer)
// ============================================================
//
//  - IP 타입 (mobile / residential / datacenter)
//  - TLS ClientHello Fingerprint
//  - SNI / ALPN
//  - HTTP/2 Frame 패턴
//  - Connection 재사용 패턴 (keep-alive)
//  - 프록시 지문 (SOCKS/HTTP/Residential 여부)
//  - 패킷 지연/RTT 패턴
//  - ASN / 지리 기반 점수
//
// ============================================================

async function testNetworkLayer() {
  console.log("\n========== L1: Network Layer ==========\n");

  // IP 확인
  // TLS fingerprint 확인
  // ...
}

// ============================================================
//  2. 브라우저 계층 (Browser Layer)
// ============================================================
//
//  - User-Agent
//  - sec-ch-ua / platform / full-version-list
//  - navigator.* 전역 값들
//  - WebGL fingerprint
//  - Canvas fingerprint
//  - AudioContext fingerprint
//  - headless 여부
//  - webdriver 탐지
//  - CDP 관련 패치 탐지
//  - 브라우저 버전·엔진 정합성
//
// ============================================================

async function testBrowserLayer(page: any) {
  console.log("\n========== L2: Browser Layer ==========\n");

  const browserInfo = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    webdriver: navigator.webdriver,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory,
    languages: navigator.languages,
  }));

  console.log("Browser Info:", browserInfo);
  return browserInfo;
}

// ============================================================
//  3. 디바이스 지문 계층 (Device Fingerprint Layer)
// ============================================================
//
//  - CPU 코어/스레드 수
//  - GPU 모델
//  - RAM 용량
//  - 화면 해상도
//  - 화면 DPI / PixelRatio
//  - Touch 지원 여부
//  - Battery API 값
//  - Sensor API 값
//  - 플랫폼별 전형적 분포와의 일치도
//
// ============================================================

async function testDeviceLayer(page: any) {
  console.log("\n========== L3: Device Layer ==========\n");

  const deviceInfo = await page.evaluate(() => ({
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    },
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
  }));

  console.log("Device Info:", deviceInfo);
  return deviceInfo;
}

// ============================================================
//  4. 세션/쿠키 계층 (Session/Cookie Layer)
// ============================================================
//
//  - NID 등 서비스별 세션 쿠키
//  - 쿠키 timestamp
//  - 쿠키 생성/갱신 주기 패턴
//  - 방문 이력 / referer 흐름
//  - localStorage 값
//  - sessionStorage 값
//  - IndexedDB 스키마
//  - 세션 지속성(연속 접속 기록)
//
// ============================================================

async function testSessionLayer(page: any) {
  console.log("\n========== L4: Session Layer ==========\n");

  const cookies = await page.context().cookies();
  console.log("Cookies:", cookies.map((c: any) => c.name));

  const storage = await page.evaluate(() => ({
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
  }));

  console.log("Storage:", storage);
  return { cookies, storage };
}

// ============================================================
//  5. 행동 계층 (Behavior Layer)
// ============================================================
//
//  - 스크롤 속도
//  - 스크롤 간격 패턴
//  - 스크롤 깊이 분포
//  - 마우스 이동 곡률
//  - 마우스 가속도 패턴
//  - 클릭 지연/간격
//  - dwell time(머문 시간)
//  - 페이지 이동 경로
//  - 입력 타이핑 패턴
//
// ============================================================

// 베지어 곡선 마우스 이동 (Production과 동일)
function cubicBezier(t: number, p0: any, p1: any, p2: any, p3: any) {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

async function testBehaviorLayer(page: any) {
  console.log("\n========== L5: Behavior Layer ==========\n");

  // 인간화 스크롤
  console.log("Testing humanized scroll...");
  let scrolled = 0;
  while (scrolled < 1000) {
    const step = 100 + Math.random() * 150;
    await page.mouse.wheel(0, step);
    scrolled += step;
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 60));
  }

  // 인간화 타이핑
  console.log("Testing humanized typing...");
  // ...
}

// ============================================================
//  메인 실행
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("  Test: [테스트명]");
  console.log("  Date:", new Date().toISOString());
  console.log("  Config:", TEST_CONFIG);
  console.log("=".repeat(60));

  const browser = await chromium.launch({
    headless: TEST_CONFIG.headless,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(TEST_CONFIG.targetUrl);

    // 계층별 테스트 실행
    await testNetworkLayer();
    const browserInfo = await testBrowserLayer(page);
    const deviceInfo = await testDeviceLayer(page);
    const sessionInfo = await testSessionLayer(page);
    await testBehaviorLayer(page);

    // 결과 출력
    console.log("\n" + "=".repeat(60));
    console.log("  Test Results");
    console.log("=".repeat(60));
    console.log("Browser:", browserInfo.userAgent.substring(0, 50));
    console.log("webdriver:", browserInfo.webdriver);
    console.log("Cookies:", sessionInfo.cookies.length);
    console.log("=".repeat(60));

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
```

---

## PRB vs Patchright 비교 템플릿

```typescript
/**
 * Test: PRB vs Patchright Comparison
 * Date: YYYY-MM-DD
 *
 * 목적: 두 브라우저 라이브러리의 탐지 우회 차이 비교
 */

interface ComparisonResult {
  library: "PRB" | "Patchright";
  layer: string;
  item: string;
  value: any;
  status: "pass" | "fail" | "warning";
}

const results: ComparisonResult[] = [];

async function runPRBTest() {
  // PRB 테스트
  const { connect } = await import("puppeteer-real-browser");
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
  });

  // ... 테스트 실행

  await browser.close();
}

async function runPatchrightTest() {
  // Patchright 테스트
  const { chromium } = await import("patchright");
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // ... 테스트 실행

  await browser.close();
}

function printComparison() {
  console.log("\n" + "=".repeat(70));
  console.log("  PRB vs Patchright Comparison Results");
  console.log("=".repeat(70));

  const layers = ["L1-Network", "L2-Browser", "L3-Device", "L4-Session", "L5-Behavior"];

  for (const layer of layers) {
    console.log(`\n--- ${layer} ---`);
    const layerResults = results.filter((r) => r.layer === layer);

    for (const item of new Set(layerResults.map((r) => r.item))) {
      const prb = layerResults.find((r) => r.library === "PRB" && r.item === item);
      const patch = layerResults.find((r) => r.library === "Patchright" && r.item === item);

      console.log(`  ${item}:`);
      console.log(`    PRB:       ${prb?.value} [${prb?.status}]`);
      console.log(`    Patchright: ${patch?.value} [${patch?.status}]`);
    }
  }
}
```

---

## 테스트 결과 로깅 형식

### 파일명 규칙

```
logs/
├── test-YYYY-MM-DD-HHMMSS-layer1.json
├── test-YYYY-MM-DD-HHMMSS-layer2.json
├── test-YYYY-MM-DD-HHMMSS-comparison.json
└── test-YYYY-MM-DD-HHMMSS-full-flow.json
```

### JSON 로그 형식

```json
{
  "testName": "Layer2 Browser Test",
  "date": "2024-12-11T10:30:00Z",
  "version": "v1.0",
  "library": "Patchright",
  "config": {
    "headless": false,
    "timeout": 30000
  },
  "results": {
    "L2-Browser": {
      "userAgent": { "value": "...", "status": "pass" },
      "webdriver": { "value": false, "status": "pass" },
      "secChUa": { "value": "...", "status": "pass" }
    }
  },
  "summary": {
    "total": 10,
    "pass": 9,
    "fail": 0,
    "warning": 1
  }
}
```

---

## 버전 백업 가이드

### 백업 시점

1. **테스트 성공 시** - 안정 버전 백업
2. **Production 배포 전** - 롤백 대비
3. **주요 변경 후** - 변경 추적

### 백업 스크립트

```bash
# backup.sh
DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_DIR="D:/Project/turafic_archive/v${VERSION}_${DATE}"

mkdir -p "$BACKUP_DIR"
cp -r unified-runner.ts "$BACKUP_DIR/"
cp -r engines-packet/ "$BACKUP_DIR/"
cp -r engines/ "$BACKUP_DIR/"

echo "Backup created: $BACKUP_DIR"
```

### 복원 방법

```bash
# 특정 버전 복원
cp -r "D:/Project/turafic_archive/v1.0_2024-12-10/" ./
```

---

## 체크리스트

### 테스트 전

```
□ 테스트 목적 명확히 정의
□ 예상 결과 문서화
□ 테스트 환경 확인 (브라우저 버전 등)
□ 현재 버전 백업
```

### 테스트 후

```
□ 모든 계층 테스트 완료
□ 결과 JSON 로그 저장
□ PRB/Patchright 차이 기록
□ 실패 항목 원인 분석
□ unified-runner.ts 반영 여부 결정
```

### Production 반영 전

```
□ 테스트 환경에서 성공 확인
□ 변경된 계층 명시 (커밋 메시지)
□ 롤백 계획 수립
□ 버전 백업 완료
```

---

## Version History

| 날짜 | 버전 | 변경사항 |
|------|------|---------|
| 2024-12-11 | v1.0 | 초기 문서 작성 |
