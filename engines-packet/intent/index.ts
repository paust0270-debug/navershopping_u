/**
 * Intent Module - 모바일 네이버 정상 방문 세션 성립 엔진
 *
 * 핵심 원칙:
 * - 1 의도 = 1 세션 = 1 완결
 * - ackey는 서버 발급값 그대로 사용 (임의 생성/변조 금지)
 * - 생성 축(A): 직렬 (겹침 금지)
 * - 완결 축(B): 병렬 가능 (각 흐름 내부 순서 보존 필수)
 */

export * from './types';
export { IntentGenerator } from './IntentGenerator';
export { SessionProcessor } from './SessionProcessor';
