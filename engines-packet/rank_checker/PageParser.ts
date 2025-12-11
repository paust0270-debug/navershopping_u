/**
 * Page Parser
 * 네이버 쇼핑 검색 결과 페이지에서 상품 목록 파싱
 * page.evaluate() 내에서 실행되는 함수들
 */

import type { ProductItem, PageParseResult } from './types';

/**
 * DOM에서 상품 MID 목록 추출 (page.evaluate용)
 * 브라우저 컨텍스트에서 실행됨
 */
export function parseProductsFromDOM(): { mids: string[]; hasMore: boolean } {
  const mids: string[] = [];
  const seen = new Set<string>();

  // nv_mid 또는 nvMid 파라미터가 포함된 모든 링크 찾기
  // 네이버 쇼핑은 nv_mid= (언더스코어) 형식 사용
  const links = document.querySelectorAll('a[href*="nv_mid="], a[href*="nvMid="]');

  links.forEach((link) => {
    const href = (link as HTMLAnchorElement).href;
    // nv_mid= 또는 nvMid= 패턴 매칭
    const match = href.match(/(?:nv_mid|nvMid)=(\d+)/i);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      mids.push(match[1]);
    }
  });

  // 다음 페이지 존재 여부 확인 (페이지네이션 버튼)
  const nextButton = document.querySelector('a[class*="next"]') ||
    document.querySelector('button[class*="next"]') ||
    document.querySelector('[aria-label*="다음"]');
  const hasMore = nextButton !== null && !nextButton.hasAttribute('disabled');

  return { mids, hasMore };
}

/**
 * 페이지 차단 여부 확인 (page.evaluate용)
 * 더 정확한 차단 감지 (캡차 페이지, IP 차단 페이지)
 */
export function checkIfBlocked(): boolean {
  const bodyText = document.body?.innerText || '';
  const url = window.location.href;

  // URL에 captcha가 포함되면 차단
  if (url.includes('captcha') || url.includes('challenge')) {
    return true;
  }

  // 특정 차단 문구 확인 (더 구체적으로)
  const blockedPhrases = [
    '서비스 접속이 일시적으로 제한되었습니다',
    '비정상적인 접근이 감지',
    '실제 사용자임을 확인',
    '영수증의 가게 위치는',  // 캡차 문구
  ];
  return blockedPhrases.some(phrase => bodyText.includes(phrase));
}

/**
 * 페이지 로드 완료 확인 (page.evaluate용)
 */
export function checkPageLoaded(): boolean {
  // 상품 목록 컨테이너 존재 확인
  const productList = document.querySelector('[class*="productList"]') ||
    document.querySelector('[class*="product_list"]') ||
    document.querySelector('[class*="basicList"]');

  return productList !== null;
}

/**
 * 검색 결과 없음 확인 (page.evaluate용)
 */
export function checkNoResults(): boolean {
  const bodyText = document.body?.innerText || '';
  const noResultPhrases = [
    '검색 결과가 없습니다',
    '검색결과가 없습니다',
    '일치하는 상품이 없습니다'
  ];
  return noResultPhrases.some(phrase => bodyText.includes(phrase));
}

/**
 * MID 목록에서 특정 MID 찾기
 * @param mids MID 배열
 * @param targetMid 찾을 MID
 * @param baseRank 기본 순위 (이전 페이지 상품 수)
 * @returns 찾은 경우 순위, 없으면 -1
 */
export function findMidInList(mids: string[], targetMid: string, baseRank: number = 0): number {
  const index = mids.indexOf(targetMid);
  if (index === -1) return -1;
  return baseRank + index + 1; // 1-based rank
}

/**
 * 파싱 결과를 PageParseResult 형태로 변환
 */
export function toPageParseResult(
  mids: string[],
  pageNumber: number,
  hasMore: boolean,
  baseRank: number = 0
): PageParseResult {
  const products: ProductItem[] = mids.map((mid, index) => ({
    rank: baseRank + index + 1,
    nvMid: mid
  }));

  return {
    products,
    hasMore,
    pageNumber
  };
}
