/**
 * MID Extractor
 * 상품 URL에서 MID(상품 고유 ID) 추출
 */

/**
 * URL에서 MID 추출
 * 지원 URL 패턴:
 * - smartstore.naver.com/xxx/products/12345678
 * - brand.naver.com/xxx/products/12345678
 * - shopping.naver.com/...nv_mid=12345678
 * - search.shopping.naver.com/...nvMid=12345678
 *
 * @param url 상품 URL
 * @returns MID 문자열 또는 null
 */
export function extractMid(url: string): string | null {
  if (!url) return null;

  try {
    // 패턴 1: /products/숫자 (smartstore, brand)
    const productsMatch = url.match(/\/products\/(\d+)/);
    if (productsMatch) {
      return productsMatch[1];
    }

    // 패턴 2: nv_mid=숫자 또는 nvMid=숫자 (쿼리 파라미터)
    const nvMidMatch = url.match(/[?&](?:nv_mid|nvMid)=(\d+)/i);
    if (nvMidMatch) {
      return nvMidMatch[1];
    }

    // 패턴 3: URL 객체로 파싱해서 쿼리 파라미터 확인
    const urlObj = new URL(url);
    const nvMid = urlObj.searchParams.get('nv_mid') || urlObj.searchParams.get('nvMid');
    if (nvMid) {
      return nvMid;
    }

    return null;
  } catch (error) {
    // URL 파싱 실패 시 정규식으로 재시도
    const fallbackMatch = url.match(/(?:products\/|nv_mid=|nvMid=)(\d+)/i);
    return fallbackMatch ? fallbackMatch[1] : null;
  }
}

/**
 * MID 유효성 검증
 * @param mid MID 문자열
 * @returns 유효 여부
 */
export function isValidMid(mid: string | null): mid is string {
  if (!mid) return false;
  // MID는 숫자로만 구성되어야 함
  return /^\d+$/.test(mid) && mid.length >= 5;
}

/**
 * URL이 네이버 쇼핑 관련 URL인지 확인
 * @param url URL 문자열
 * @returns 네이버 쇼핑 URL 여부
 */
export function isNaverShoppingUrl(url: string): boolean {
  const naverDomains = [
    'smartstore.naver.com',
    'brand.naver.com',
    'shopping.naver.com',
    'search.shopping.naver.com',
    'shoppinglive.naver.com'
  ];

  try {
    const urlObj = new URL(url);
    return naverDomains.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}
