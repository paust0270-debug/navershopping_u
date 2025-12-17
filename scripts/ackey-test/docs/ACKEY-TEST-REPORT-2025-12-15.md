# ackey 테스트 보고서 (2025-12-15)

## 1. 테스트 개요

### 목적
네이버 모바일 자동완성 검색에서 사용되는 **ackey 값이 서버에서 검증되는지** 확인

### 배경
- ackey: 자동완성 API 호출 시 생성되는 8자리 영숫자 세션키
- 질문: "ackey를 랜덤으로 생성해도 product-logs가 정상 처리되는가?"

### 테스트 환경
- 플랫폼: 모바일 (Android UA)
- 브라우저: Patchright (Chrome)
- 진입 흐름: m.naver.com → 자동완성 클릭 → 검색결과 → 상품 클릭

---

## 2. 테스트 케이스 및 결과

### Test 1: 고정 ackey (캡처값 재사용)
| 항목 | 값 |
|------|-----|
| 상품 | 차이팟 (프리미엄 블루투스 이어팟) |
| MID | 83539482665 |
| ackey | rjtod6i2 (실제 캡처) |
| 전송 횟수 | 100회 |
| **성공** | **100/100 (100%)** |

### Test 2: 랜덤 ackey (매 요청마다 새로 생성)
| 항목 | 값 |
|------|-----|
| 상품 | 전동드릴 (켈슨 무선해머드릴) |
| MID | 88976737010 |
| ackey | 매회 랜덤 8자리 생성 |
| 전송 횟수 | 100회 |
| **성공** | **100/100 (100%)** |

### Test 3: 전체 흐름 반복 (WCS + ambulance + product-logs)
| 항목 | 값 |
|------|-----|
| 상품 | 디월트 전기톱 |
| MID | 86683606603 |
| 반복 횟수 | 100회 |
| **성공** | **100/100 (100%)** |

---

## 3. Product-logs 구조 분석

### API 엔드포인트
```
POST https://m.smartstore.naver.com/i/v1/product-logs/{productId}
```

### 요청 헤더
| 헤더 | 값 | 설명 |
|------|-----|------|
| x-client-version | 20251215234500 | 클라이언트 빌드 버전 (YYYYMMDDhhmmss) |
| useshopfegw | true | 쇼핑 FE Gateway 사용 |
| content-type | application/json | JSON 본문 |

### 요청 본문 (Body)
```json
{
  "id": "83539482665",
  "channel": {
    "accountNo": 4853244,
    "channelNo": "1000022994",
    "channelUid": "sunsaem",
    "channelName": "선샘"
    // ... 스토어 상세 정보
  },
  "category": {
    "categoryId": "50002652",
    "categoryName": "블루투스이어폰"
    // ... 카테고리 상세 정보
  },
  "referer": "https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=...&ackey=rjtod6i2&acq=차이팟&acr=1&qdt=0",
  "tr": "sls",
  "planNo": ""
}
```

### referer URL 파라미터 (자동완성 관련)
| 파라미터 | 의미 | 예시 값 |
|----------|------|---------|
| **sm** | Source Module | `mtp_sug.top` (자동완성) |
| **ackey** | Autocomplete Key | `rjtod6i2` (8자리 영숫자) |
| **acq** | Autocomplete Query | `차이팟` (원래 입력 키워드) |
| **acr** | Autocomplete Result | `1` (선택함) |
| **qdt** | Query Delay Time | `0` |
| where | 검색 위치 | `m` (모바일) |
| query | 검색어 | 상품명 (풀네임) |

---

## 4. 핵심 발견

### ackey 검증 여부
> **결론: 네이버 서버는 ackey 값을 검증하지 않음**

- 캡처된 실제 ackey: 100% 성공
- 랜덤 생성 ackey: 100% 성공
- 매 요청마다 다른 랜덤 ackey: 100% 성공

### 자동완성 진입 표시
- `sm=mtp_sug.top`: 자동완성으로 진입했음을 나타냄
- `sm=mtp_hty`: 일반 검색으로 진입했음을 나타냄
- referer에 포함된 sm 값으로 진입 경로 구분

### 요청 흐름
```
1. GET /products/{id}       - 페이지 로드
2. POST wcs.naver.com/b    - 상거래 추적 비콘
3. POST ambulance/pages    - 앰뷸런스 로그
4. GET nlog.naver.com      - 네이버 로그
5. POST product-logs       - 상품 조회 로그 (★ 핵심)
```

---

## 5. 재현 방법

### 테스트 실행
```bash
# Test 1: 고정 ackey
npx tsx scripts/ackey-test/test1-fixed-ackey.ts

# Test 2: 랜덤 ackey
npx tsx scripts/ackey-test/test2-random-ackey.ts

# Test 3: 전체 흐름
npx tsx scripts/ackey-test/test3-full-flow.ts
```

### 상품 정보 변경
각 테스트 파일의 `TEST_PRODUCT` 상수 수정:
```typescript
const TEST_PRODUCT = {
  keyword: "자동완성 키워드",      // 자동완성에 입력할 키워드
  productName: "상품 전체 이름",   // 검색 쿼리 (상품명)
  nvMid: "12345678901",           // 네이버 상품 고유 ID
  storeId: "",                    // 자동 탐지
  productId: ""                   // 자동 탐지
};
```

---

## 6. 파일 구조

```
scripts/ackey-test/
├── capture-ackey.ts              # ackey 캡처
├── test1-fixed-ackey.ts          # 고정 ackey 테스트
├── test2-random-ackey.ts         # 랜덤 ackey 테스트
├── test3-full-flow.ts            # 전체 흐름 테스트
├── analyze-request-flow.ts       # 요청 순서 분석
├── find-mid-url.ts               # MID → URL 찾기
├── captured/
│   └── ackey_차이팟_2025-12-15.json
├── results/
│   ├── test1_2025-12-15.json
│   ├── test2_2025-12-15.json
│   └── test3_2025-12-15.json
└── docs/
    └── ACKEY-TEST-REPORT-2025-12-15.md (이 문서)
```

---

## 7. 다음 단계

### 미해결 질문
> "sm=mtp_sug.top + 랜덤 ackey만 있으면 **실제로 자동완성 유입으로 집계되는가?**"

### 검증 방법 (test4)
3가지 진입 방식의 product-logs 응답 비교:
- Case A: 정상 자동완성 (실제 자동완성 클릭)
- Case B: URL 직접 접근 (sm=mtp_sug.top + 랜덤 ackey)
- Case C: 일반 검색 (sm=mtp_hty, ackey 없음)

---

## 8. 요약

| 테스트 | ackey | 결과 | 결론 |
|--------|-------|------|------|
| Test 1 | 고정 (캡처) | 100% | ✅ |
| Test 2 | 랜덤 (매회) | 100% | ✅ |
| Test 3 | 전체 흐름 | 100% | ✅ |

**핵심 결론**:
- ackey는 서버에서 검증하지 않음 (랜덤값도 통과)
- sm, ackey, acq 파라미터는 referer URL에 포함됨
- 자동완성 진입 여부는 sm 파라미터로 구분

---

*문서 작성일: 2025-12-15*
*테스트 환경: Windows, Chrome, Patchright*
