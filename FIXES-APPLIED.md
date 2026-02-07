# Bug Fixes Applied - 2026-02-06

## Issues Fixed

### 1. ✅ EPERM Permission Error (Temp Folder Cleanup)
**Status**: Already handled, error suppressed

**Error**:
```
Error: EPERM, Permission denied: \\?\D:\temp\lighthouse.14495235
```

**Cause**: `puppeteer-real-browser` uses `chrome-launcher` which tries to delete temp directories synchronously. Windows denies permission when Chrome hasn't fully released file locks.

**Solution**: Error handler already in place (lines 1482-1492):
```typescript
process.on('uncaughtException', (error) => {
  if ((msg.includes('EPERM') || msg.includes('ENOENT')) &&
      (msg.includes('temp') || msg.includes('lighthouse') || msg.includes('puppeteer'))) {
    return; // Suppress error
  }
  // Log other errors
});
```

**Note**: This is harmless - temp folders are cleaned periodically by `cleanupChromeTempFolders()` function.

---

### 2. ✅ API Mismatch (Playwright APIs in Puppeteer Code)
**Status**: FIXED

**Error**:
```
FAIL(page.locator(...).first is not a function)
```

**Cause**: Code uses `puppeteer-real-browser` but calls Playwright-style APIs:
- `page.locator()` → Doesn't exist in Puppeteer
- `.first()` → Playwright method
- `.isVisible()` → Playwright method
- `page.waitForLoadState()` → Playwright method

**Fixed Locations**:

#### Line 844 - Search Input
```typescript
// BEFORE (Playwright)
const searchInput = page.locator('#query.sch_input').first();
await searchInput.type(keyword, { delay: randomBetween(80, 150) });

// AFTER (Puppeteer)
const searchInput = await page.$('#query.sch_input');
if (!searchInput) throw new Error('검색창 없음');
await searchInput.type(keyword, { delay: randomBetween(80, 150) });
```

#### Line 851 - Navigation Wait
```typescript
// BEFORE (Playwright)
await page.waitForLoadState('domcontentloaded');

// AFTER (Puppeteer)
await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
```

#### Lines 1063-1088 - MID Product Click (3 strategies)
```typescript
// BEFORE (Playwright)
const linkByAttr = page.locator(`a[data-shp-contents-id="${mid}"]`).first();
const attrVisible = await linkByAttr.isVisible({ timeout: 2000 }).catch(() => false);
if (attrVisible) {
  await linkByAttr.click();
}

// AFTER (Puppeteer)
const linkByAttr = await page.$(`a[data-shp-contents-id="${mid}"]`);
const attrVisible = linkByAttr ? await linkByAttr.isIntersectingViewport() : false;
if (attrVisible && linkByAttr) {
  await linkByAttr.click();
}
```

#### Line 1100 - Product Page Navigation
```typescript
// BEFORE (Playwright)
await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

// AFTER (Puppeteer)
await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
```

---

### 3. ⚠️ Missing Database Table
**Status**: Non-critical warning (already handled gracefully)

**Error**:
```
[WARN] [History] 기록 실패: Could not find the table 'public.slot_rank_navertest_history' in the schema cache
```

**Cause**: Table `slot_rank_navertest_history` doesn't exist in Supabase.

**Impact**: History recording fails but doesn't break the script. Error is caught and logged.

**Options**:

#### Option A: Create the Missing Table (Recommended)
Run this SQL in Supabase:

```sql
CREATE TABLE IF NOT EXISTS public.slot_rank_navertest_history (
  id BIGSERIAL PRIMARY KEY,
  slot_status_id BIGINT,
  keyword TEXT,
  link_url TEXT,
  mid TEXT,
  product_name TEXT,

  -- 순위 정보
  current_rank INT,
  start_rank INT,
  rank_change INT,
  previous_rank INT,
  rank_diff INT,

  -- 실행 결과
  success BOOLEAN DEFAULT FALSE,
  captcha_solved BOOLEAN DEFAULT FALSE,
  fail_reason TEXT,
  execution_duration_ms INT,

  -- 메타데이터
  worker_id TEXT,
  equipment_name TEXT,
  ip_address TEXT,
  rank_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- 분류
  customer_id TEXT,
  distributor TEXT,
  slot_type TEXT,
  source_table TEXT,
  source_row_id BIGINT
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_history_slot_status_id
  ON public.slot_rank_navertest_history(slot_status_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at
  ON public.slot_rank_navertest_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_keyword
  ON public.slot_rank_navertest_history(keyword);
```

#### Option B: Disable History Recording
If you don't need history tracking, comment out the history call:

```typescript
// Line 1254 in unified-runner-shopping-tab-test.ts
// await recordHistory(work, engineResult, workerId, executionTime);
```

---

## Summary

| Issue | Severity | Status | Impact |
|-------|----------|--------|--------|
| EPERM temp cleanup | Low | Handled | No crash, just error logs |
| Playwright API mismatch | **Critical** | **FIXED** | Script would fail on every task |
| Missing DB table | Low | Warning only | History not recorded |

## Testing

After these fixes, test with:
```bash
npx tsx unified-runner-shopping-tab-test.ts
```

Expected behavior:
- ✅ No more `page.locator(...).first is not a function` errors
- ✅ Script runs successfully
- ⚠️ Still see EPERM warnings (harmless)
- ⚠️ Still see history table warnings (unless table created)

---

# 쇼핑탭 봇탐지 우회 - 자동화 인수인계서 (2026-02-07)

## 1. 문제 정의

네이버 쇼핑 페이지 진입 시 "접근 제한" 또는 CAPTCHA 봇탐지 발생.

### 봇탐지 원인 분석

| 방식 | navigation type | Sec-Fetch-User | 결과 |
|------|----------------|----------------|------|
| 수동 클릭 (사람) | link | `?1` | 정상 통과 |
| `page.goto(url)` | navigate | 없음 | **접근 제한** |
| `touchscreen.tap()` | link | **없음** | CAPTCHA |
| `touchscreen.tap()` + 헤더 주입 | link | `?1` (강제) | CAPTCHA (IP 블랙리스트) |

**핵심 발견**: Chrome은 CDP(DevTools Protocol)로 발생시킨 터치/클릭 이벤트를 "진짜 유저 행동"으로 인정하지 않아서 `Sec-Fetch-User: ?1` 헤더를 붙이지 않음.

## 2. 현재까지 적용된 수정 (커밋 317cc607)

### 2-1. Puppeteer API 수정
```typescript
// BEFORE (Playwright API - 에러 발생)
const client = await page.context().newCDPSession(page);

// AFTER (Puppeteer API)
const client = await (page as any).createCDPSession();
```

### 2-2. 모바일 viewport 설정 보완
```typescript
// BEFORE (터치 미활성화)
await page.setViewport(MOBILE_CONTEXT_OPTIONS.viewport);
// → { width: 400, height: 700 } 만 전달 (isMobile, hasTouch 누락)

// AFTER (터치 활성화)
await page.setViewport({
  ...MOBILE_CONTEXT_OPTIONS.viewport,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
```

### 2-3. 쇼핑 진입 flow 변경
```
BEFORE: m.naver.com → 검색 입력 → 쇼핑탭 클릭(page.goto) → 쇼핑 검색결과
AFTER:  m.naver.com → 스토어 링크 터치(touchscreen.tap) → 쇼핑 홈
```

스토어 링크 셀렉터:
```typescript
'a[data-clk="shortsho"]'                  // 1순위
'a[href*="shopping.naver.com/ns/home"]'    // 2순위
'a.chm_service[href*="shopping"]'          // 3순위
```

### 2-4. ElementHandle 호환성
puppeteer-real-browser에서 `page.$()` 반환값에 `getAttribute()`, `textContent()`, `boundingBox()` 등 직접 호출 불가 → 모두 `evaluate()` 방식으로 통일.

```typescript
// BEFORE (에러)
const text = await el.textContent();
const href = await el.getAttribute('href');

// AFTER (정상)
const text = await el.evaluate((node: Element) => node.textContent || '');
const href = await el.evaluate((el: Element) => el.getAttribute('href') || '');
```

## 3. 테스트 결과 요약

| 시도 | 결과 | 상세 |
|------|------|------|
| `page.goto(쇼핑URL)` | 접근 제한 | navigation type이 "navigate" (주소창 입력 패턴) |
| 검색→쇼핑탭 `touchscreen.tap()` | 쇼핑 진입 성공 → CAPTCHA | Sec-Fetch-User 헤더 없음 |
| 스토어 링크 `touchscreen.tap()` | 쇼핑 진입 성공 → CAPTCHA | 동일 |
| 스토어 + `Sec-Fetch-User: ?1` 주입 | 쇼핑 진입 성공 → CAPTCHA | IP 블랙리스트 상태 (3700+ 실패) |

**결론**: 현재 IP(27.113.13.22)가 누적 실패로 블랙리스트 상태. IP 로테이션 후 재테스트 필요.

## 4. 다음 단계 (우선순위순)

### 4-1. [필수] IP 로테이션 후 재테스트
```bash
# IP 로테이션 (ADB 또는 어댑터)
# 이후 실행:
npx tsx test-sec-fetch.ts
```
- 새 IP에서 CAPTCHA 없이 통과하면 → **Sec-Fetch-User 주입이 핵심 해결책**
- 새 IP에서도 CAPTCHA 나오면 → 다른 봇탐지 요소 추가 조사 필요

### 4-2. [필수] ANTHROPIC_API_KEY 갱신
CAPTCHA solver가 `401 invalid x-api-key` 에러. `.env`의 `ANTHROPIC_API_KEY` 유효한 키로 교체 필요.

### 4-3. [권장] Sec-Fetch-User 주입을 메인 러너에 적용
`test-sec-fetch.ts`에서 검증된 CDP Fetch 인터셉트 코드를 `unified-runner-shopping-tab-test.ts`에 적용:

```typescript
// getCDPSession() 후 Fetch 인터셉트 설정
const client = await getCDPSession(page);
await client.send('Fetch.enable', {
  patterns: [{ urlPattern: '*shopping.naver.com*', requestStage: 'Request' }],
});
client.on('Fetch.requestPaused', async (params) => {
  const headers = [
    ...Object.entries(params.request.headers)
      .filter(([k]) => !k.toLowerCase().startsWith('sec-fetch'))
      .map(([name, value]) => ({ name, value })),
    { name: 'Sec-Fetch-Dest', value: 'document' },
    { name: 'Sec-Fetch-Mode', value: 'navigate' },
    { name: 'Sec-Fetch-Site', value: 'cross-site' },
    { name: 'Sec-Fetch-User', value: '?1' },
  ];
  await client.send('Fetch.continueRequest', {
    requestId: params.requestId,
    headers,
  });
});
```

### 4-4. [선택] 쇼핑 홈 진입 후 검색 flow 구현
현재 쇼핑 홈(`shopping.naver.com/ns/home`) 진입까지 성공. 이후:
1. 쇼핑 홈 검색창 셀렉터 확인 (기존 `#gnb-gnb` 셀렉터가 안 먹힘 → 새 셀렉터 필요)
2. 키워드 입력 → 검색 → MID 상품 찾기 flow 구현

### 4-5. [선택] production 스크립트 반영
테스트 완료 후 `unified-runner-shopping-tab.ts` (프로덕션)에도 동일 수정 적용.

## 5. 관련 파일

| 파일 | 용도 |
|------|------|
| `unified-runner-shopping-tab-test.ts` | 메인 테스트 러너 (수정 완료) |
| `test-sec-fetch.ts` | Sec-Fetch-User 헤더 확인/주입 테스트 도구 |
| `shared/mobile-stealth.ts` | 모바일 스텔스 설정 (viewport, UA, 핑거프린트) |
| `test-sec-fetch-result.png` | 마지막 테스트 스크린샷 |

## 6. 디버깅 팁

```bash
# Sec-Fetch 헤더 확인 테스트
npx tsx test-sec-fetch.ts

# 메인 러너 테스트 (1회만 실행)
# unified-runner-shopping-tab-test.ts 내 TEST_MODE_ONE_RUN = true 설정 후:
npx tsx unified-runner-shopping-tab-test.ts

# 잔여 Chrome 프로세스 정리
powershell -Command "Get-Process chrome -EA SilentlyContinue | Stop-Process -Force"
```
