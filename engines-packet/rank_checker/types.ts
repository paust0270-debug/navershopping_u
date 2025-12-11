/**
 * Rank Checker Types
 * 네이버 쇼핑 순위 체크 모듈 타입 정의
 */

/** 순위 체크 입력 */
export interface RankCheckInput {
  keyword: string;           // 검색 키워드 (예: "장난감")
  productUrl: string;        // 상품 URL (예: "https://smartstore.naver.com/xxx/products/12345678")
  maxPages?: number;         // 최대 검색 페이지 수 (기본: 10)
  pageDelay?: number;        // 페이지 간 딜레이 ms (기본: 2000)
}

/** 순위 체크 결과 */
export interface RankResult {
  found: boolean;            // 상품 발견 여부
  rank?: number;             // 순위 (1부터 시작)
  page?: number;             // 발견된 페이지 번호
  totalScanned: number;      // 스캔한 총 상품 수
  keyword: string;           // 검색 키워드
  mid: string;               // 상품 MID
  timestamp: number;         // 검색 시간
  error?: string;            // 에러 메시지 (있을 경우)
}

/** 페이지에서 추출한 상품 정보 */
export interface ProductItem {
  rank: number;              // 페이지 내 순위 (1부터 시작)
  nvMid: string;             // 상품 MID
  title?: string;            // 상품명 (옵션)
}

/** 페이지 파싱 결과 */
export interface PageParseResult {
  products: ProductItem[];   // 상품 목록
  hasMore: boolean;          // 다음 페이지 존재 여부
  pageNumber: number;        // 현재 페이지 번호
}

/** Rank Checker 설정 */
export interface RankCheckerConfig {
  headless?: boolean;        // 헤드리스 모드 (기본: true)
  timeout?: number;          // 페이지 로드 타임아웃 ms (기본: 30000)
  userAgent?: string;        // User-Agent 문자열
}
