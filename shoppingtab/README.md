# shoppingtab — 네이버 쇼핑 상세페이지 진입 테스트

## 스크립트

| 파일 | 경로 | 설명 |
|------|------|------|
| `route1-search-tab.ts` | m.naver.com → 검색 → 쇼핑탭 → 상품 | 통합검색 후 쇼핑탭 클릭으로 진입 |
| `route2-store-search.ts` | m.naver.com → 스토어 → 쇼핑홈 → 검색 → 상품 | 스토어 링크 터치로 쇼핑홈 진입 후 검색 |

## 실행

```bash
# 경로 1
npx tsx shoppingtab/route1-search-tab.ts

# 경로 2
npx tsx shoppingtab/route2-store-search.ts
```

## 설정

스크립트 상단에서 변경:
- `KEYWORD` — 검색 키워드 (기본: "장난감")
- `TARGET_PRODUCT_INDEX` — N번째 상품 (기본: 2, 광고 제외)
- `ANTHROPIC_API_KEY` — Claude Vision CAPTCHA 솔버용 (환경변수 또는 .env)

## 기능

- **CDP Fetch 인터셉트**: 모든 Document 요청에 `Sec-Fetch-User: ?1` 동적 주입
- **모바일 스텔스**: UA, viewport, touch, webdriver 우회
- **CAPTCHA 자동 풀기**: 영수증 이미지 셀렉터 추출 → Claude Vision API → 자동 답변
- **매 단계 상태 체크**: CAPTCHA/차단 즉시 감지
- **인간화**: 베지어 타이핑, CDP 터치 스크롤
- **스크린샷**: `./screenshots/route1/`, `./screenshots/route2/`

## 경로별 특성

### 경로 1 (검색 → 쇼핑탭)
- `msearch.shopping.naver.com` 경유
- 장점: 자연스러운 검색 flow
- 단점: 쇼핑탭 URL이 하드블록 가능 (CAPTCHA 없이 차단)

### 경로 2 (스토어 → 검색)
- `shopping.naver.com` 경유
- 장점: CAPTCHA가 나와서 풀 수 있음
- 단점: 쇼핑홈 검색창 셀렉터가 변할 수 있음

## 필요 패키지

```bash
npm install puppeteer-real-browser puppeteer-core tsx
```
