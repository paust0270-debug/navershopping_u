/**
 * 모바일 네이버 정상 방문 세션 성립 엔진 - 타입 정의
 *
 * 핵심 원칙:
 * - ackey는 서버가 발급한 값만 사용 (임의 생성/변조 금지)
 * - 1 의도 = 1 세션 = 1 완결
 * - IntentContext는 단기 트랜잭션 (재사용/장기보관 금지)
 */

import type { Cookie } from 'patchright';

/**
 * 의도 컨텍스트 (Intent Context)
 *
 * 브라우저에서 자동완성 기반 의도 생성 후 획득되는 세션 정보.
 * "의도 형성 단계"에서만 생성되며, 완결 후 즉시 폐기.
 *
 * @remarks
 * - ackey는 절대 랜덤화/변조하지 않음
 * - 1회 사용 후 폐기 (재사용 금지)
 * - 장기 보관 금지 (맥락 단절 방지)
 */
export interface IntentContext {
  /** 서버 발급 ackey (자동완성 선택 시 URL에서 추출) */
  ackey: string;

  /** 브라우저 컨텍스트의 쿠키 (NACT, NAC, NNB, NID_AUT 등) */
  cookies: Cookie[];

  /** 요청 헤더 (Accept, Accept-Language 등) */
  headers: Record<string, string>;

  /** 마지막 페이지 URL (검색 결과 페이지) */
  referer: string;

  /** User-Agent */
  userAgent: string;

  /** 의도 생성 시각 (ms) */
  timestamp: number;

  /** 검색 쿼리 (자동완성으로 선택된 쿼리) */
  selectedQuery: string;
}

/**
 * 세션 처리 결과
 */
export interface SessionResult {
  /** 성공 여부 */
  success: boolean;

  /** 사용된 ackey */
  ackey?: string;

  /** 상품 상세 페이지 URL */
  productUrl?: string;

  /** 실패 사유 (실패 시) */
  reason?: string;

  /** 처리 시간 (ms) */
  duration?: number;

  /** 전송된 로그 수 */
  logCount?: number;
}

/**
 * 상품 설정
 */
export interface ProductConfig {
  /** 메인 키워드 (자동완성 트리거용, 일부만 입력) */
  mainKeyword: string;

  /** 상품 풀네임 (검색용) */
  fullProductName: string;

  /** 네이버 상품 MID */
  nvMid: string;

  /** 스마트스토어 ID (선택) */
  smartstoreId?: string;
}

/**
 * 의도 생성 옵션
 */
export interface IntentGeneratorOptions {
  /** 헤드리스 모드 */
  headless?: boolean;

  /** 타이핑 딜레이 (ms) */
  typingDelay?: number;

  /** 자동완성 대기 시간 (ms) */
  suggestWaitTimeout?: number;

  /** 프로필 디렉토리 (persistent context용) */
  profileDir?: string;

  /** 모바일 에뮬레이션 */
  mobile?: boolean;
}

/**
 * 세션 프로세서 옵션
 */
export interface SessionProcessorOptions {
  /** 요청 간 딜레이 (ms) */
  requestDelay?: number;

  /** 타임아웃 (ms) */
  timeout?: number;

  /** 로그 전송 여부 */
  sendLogs?: boolean;

  /** 디버그 모드 */
  debug?: boolean;
}

/**
 * 네트워크 요청 캡처 결과
 */
export interface CapturedRequest {
  /** 요청 URL */
  url: string;

  /** HTTP 메서드 */
  method: string;

  /** 요청 헤더 */
  headers: Record<string, string>;

  /** POST body (있는 경우) */
  body?: string;

  /** 타임스탬프 */
  timestamp: number;
}

/**
 * 세션 흐름 단계
 */
export type SessionPhase =
  | 'intent_generation'   // 의도 생성 (브라우저)
  | 'search_request'      // 검색 요청
  | 'product_selection'   // 상품 선택
  | 'detail_transition'   // 상세 전환
  | 'session_complete';   // 세션 완결

/**
 * 세션 로그 항목
 */
export interface SessionLogEntry {
  phase: SessionPhase;
  timestamp: number;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * 병렬 완결용 의도 큐 아이템
 *
 * @remarks
 * 병렬 완결 시 사용. 각 흐름 내부 순서(검색→선택→전환)는 반드시 보존.
 * 생성 축은 직렬, 완결 축은 병렬 가능.
 */
export interface IntentQueueItem {
  intent: IntentContext;
  product: ProductConfig;
  createdAt: number;
}
