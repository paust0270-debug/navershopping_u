/**
 * V7 Engine - CAPTCHA 최소화 전략 (인간화 버전)
 *
 * 핵심 전략:
 * 1. fingerprint: false (PC 모드)
 * 2. 인간화 타이핑 (keydown 딜레이, 오타+백스페이스)
 * 3. 인간화 마우스 (move steps, down/up 분리)
 * 4. 최소 스크롤 (3번)
 * 5. Bridge URL 스킵, smartstore 직접 클릭만
 */

import type { Page, Browser } from "puppeteer-core";
import type { RunContext, EngineResult, Product } from "../runner/types";
import { ReceiptCaptchaSolverPRB } from "../captcha/ReceiptCaptchaSolverPRB";

// ============ 유틸리티 함수 ============

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// 30~60ms 랜덤 딜레이 (빠른 타이핑)
function randomKeyDelay(): number {
  return 30 + Math.random() * 30;
}

// 랜덤 범위
function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Dwell time 설정 (1~3초 랜덤)
function getDwellTime(): number {
  return randomBetween(1000, 3000);
}

// ============ Human Scroll (mouse.wheel 기반 - 탐지 우회) ============

/**
 * 인간화 스크롤 - mouse.wheel 기반 (scrollBy는 100% 탐지됨)
 */
async function humanScroll(page: Page, targetY: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < targetY) {
    const step = 100 + Math.random() * 150;
    await page.mouse.wheel({ deltaY: step });
    scrolled += step;
    await sleep(80 + Math.random() * 60);
  }
}

/**
 * 요소까지 스크롤 (mouse.wheel 기반)
 */
async function scrollToElement(page: Page, element: any): Promise<void> {
  const box = await element.boundingBox();
  if (!box) return;

  const viewport = page.viewport();
  const viewportHeight = viewport?.height || 720;

  // 요소가 화면 밖에 있으면 스크롤
  if (box.y > viewportHeight * 0.7 || box.y < 100) {
    const scrollAmount = box.y - viewportHeight / 2;
    if (scrollAmount > 0) {
      await humanScroll(page, scrollAmount);
    }
  }
}

// ============ 베지어 곡선 마우스 이동 ============

interface Point {
  x: number;
  y: number;
}

/**
 * 3차 베지어 곡선 계산
 * t: 0~1 사이 값
 */
function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
  };
}

/**
 * 베지어 곡선을 따라 마우스 이동 경로 생성
 * - 자연스러운 인간 마우스 움직임 시뮬레이션
 * - 시작/끝 부분은 느리게, 중간은 빠르게 (easing)
 */
function generateBezierPath(start: Point, end: Point, steps: number): Point[] {
  const path: Point[] = [];

  // 제어점 생성 (자연스러운 곡선을 위해 랜덤 오프셋)
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // 곡선의 굴곡 정도 (거리에 비례)
  const curvature = Math.min(distance * 0.3, 100);

  // 제어점 1: 시작점에서 약간 벗어남
  const cp1: Point = {
    x: start.x + dx * 0.25 + (Math.random() - 0.5) * curvature,
    y: start.y + dy * 0.1 + (Math.random() - 0.5) * curvature
  };

  // 제어점 2: 끝점 근처
  const cp2: Point = {
    x: start.x + dx * 0.75 + (Math.random() - 0.5) * curvature,
    y: start.y + dy * 0.9 + (Math.random() - 0.5) * curvature
  };

  // 경로 생성 (easing 적용 - 시작/끝 느리게)
  for (let i = 0; i <= steps; i++) {
    // easeInOutQuad로 t 변환
    let t = i / steps;
    t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const point = cubicBezier(t, start, cp1, cp2, end);

    // 미세한 떨림 추가 (인간적인 불안정성)
    point.x += (Math.random() - 0.5) * 2;
    point.y += (Math.random() - 0.5) * 2;

    path.push(point);
  }

  return path;
}

/**
 * 베지어 곡선으로 마우스 이동
 */
async function bezierMouseMove(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  const start: Point = { x: fromX, y: fromY };
  const end: Point = { x: toX, y: toY };

  // 거리에 따라 스텝 수 조정 (20~40)
  const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
  const steps = Math.floor(Math.min(40, Math.max(20, distance / 10)));

  const path = generateBezierPath(start, end, steps);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    // 가변 딜레이 (2~8ms)
    await sleep(randomBetween(2, 8));
  }
}

// 상품명 단어 셔플
function shuffleWords(productName: string): string {
  const cleaned = productName
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return cleaned;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(' ');
}

// ============ 인간화 함수들 ============

/**
 * 1) 빠른 타이핑 (30~60ms)
 * - 오타 시뮬레이션 제거
 * - focus() 후 250~600ms 기다리기
 * - PRB realClick 사용 (ghost-cursor 내장)
 */
async function humanizedType(page: Page, selector: string, text: string, ctx: RunContext): Promise<void> {
  ctx.log("human:type", { length: text.length });

  // focus 후 대기 - PRB realClick 사용 (있으면)
  const prbPage = page as any;
  if (typeof prbPage.realClick === 'function') {
    await prbPage.realClick(selector);
  } else {
    await page.click(selector);
  }
  await sleep(randomBetween(250, 600));

  // 빠른 타이핑 (오타 없이)
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomKeyDelay() });
  }
}

/**
 * 2) 마우스 클릭 (베지어 곡선)
 * - 자연스러운 곡선 경로로 마우스 이동
 * - 클릭 전 미세 딜레이
 */
async function humanizedClick(page: Page, selector: string, ctx: RunContext): Promise<void> {
  ctx.log("human:click", { selector: selector.substring(0, 30) });

  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`No bounding box: ${selector}`);
  }

  // 요소 중앙 + 약간의 랜덤 오프셋
  const targetX = box.x + box.width / 2 + randomBetween(-5, 5);
  const targetY = box.y + box.height / 2 + randomBetween(-3, 3);

  // 현재 마우스 위치 가져오기 (없으면 랜덤 시작점)
  const viewport = page.viewport();
  const startX = viewport ? randomBetween(0, viewport.width) : 500;
  const startY = viewport ? randomBetween(0, viewport.height * 0.3) : 200;

  // 베지어 곡선으로 마우스 이동
  await bezierMouseMove(page, startX, startY, targetX, targetY);
  await sleep(randomBetween(50, 120));

  // 클릭 (down/up 분리로 더 자연스럽게)
  await page.mouse.down();
  await sleep(randomBetween(30, 80));
  await page.mouse.up();
}

/**
 * 3) 요소 클릭 (hover → 대기 → 클릭 패턴)
 * - 네이버 쇼핑은 hover 시간/가속도까지 체크
 * - PRB realCursor 우선, fallback: 베지어 곡선
 */
async function humanizedClickElement(page: Page, element: any, ctx: RunContext): Promise<void> {
  // 1. mouse.wheel 기반 스크롤로 요소를 뷰포트로 이동
  await scrollToElement(page, element);
  await sleep(randomBetween(200, 400));

  // 2. PRB realCursor 사용 시도 (ghost-cursor 내장)
  const prbPage = page as any;
  if (typeof prbPage.realCursor === 'object' && prbPage.realCursor) {
    try {
      ctx.log("human:click:realCursor:hover");
      // hover 먼저
      await prbPage.realCursor.move(element);
      await sleep(randomBetween(200, 400));  // hover 대기 (네이버 탐지 핵심)
      // 클릭
      await prbPage.realCursor.click(element);
      return;
    } catch (e) {
      ctx.log("human:click:realCursor:failed");
    }
  }

  // 3. Fallback: 베지어 곡선 + hover 패턴
  const box = await element.boundingBox();
  if (!box) {
    ctx.log("human:click:fallback", { reason: "no bounding box" });
    await element.click();
    return;
  }

  const viewport = page.viewport();
  if (viewport && (box.y < 0 || box.y > viewport.height)) {
    ctx.log("human:click:fallback", { reason: "element outside viewport" });
    await element.click();
    return;
  }

  const targetX = box.x + box.width / 2 + randomBetween(-5, 5);
  const targetY = box.y + box.height / 2 + randomBetween(-3, 3);

  ctx.log("human:click:hover+bezier", { x: Math.round(targetX), y: Math.round(targetY) });

  const startX = viewport ? randomBetween(viewport.width * 0.3, viewport.width * 0.7) : 500;
  const startY = viewport ? randomBetween(100, viewport.height * 0.4) : 200;

  // 베지어 곡선으로 이동 (hover)
  await bezierMouseMove(page, startX, startY, targetX, targetY);

  // hover 대기 (네이버 탐지 핵심 포인트)
  await sleep(randomBetween(200, 400));

  // 클릭 (down/up 분리)
  await page.mouse.down();
  await sleep(randomBetween(40, 100));
  await page.mouse.up();
}

// ============ 메인 엔진 ============

export async function runV7Engine(
  page: Page,
  browser: Browser,
  product: Product,
  ctx: RunContext
): Promise<EngineResult> {
  const result: EngineResult = {
    success: false,
    captchaDetected: false,
    midMatched: false,
    productPageEntered: false,
    duration: 0,
    error: undefined
  };

  const startTime = Date.now();

  try {
    // 1. 네이버 메인
    ctx.log("engine:navigate", { url: "https://www.naver.com" });
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });

    // 4) 이미지 로딩 대기 (100~300ms)
    await sleep(randomBetween(100, 300));
    await sleep(1500 + Math.random() * 1000);

    // 2. 인간화 검색 입력
    const searchQuery = shuffleWords(product.product_name).substring(0, 50);
    ctx.log("engine:search", { query: searchQuery.substring(0, 30) });

    // 인간화 타이핑으로 검색어 입력
    await humanizedType(page, 'input[name="query"]', searchQuery, ctx);

    // 3) 제출 전 랜덤 지연 (300~900ms)
    await sleep(randomBetween(300, 900));

    // 엔터키로 검색 (form.submit 대신)
    await page.keyboard.press('Enter');

    // Navigation 대기
    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {}
    await sleep(2500 + Math.random() * 1000);

    // 3. CAPTCHA 체크 (검색 결과에서)
    const searchCaptcha = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      return bodyText.includes('보안 확인') ||
             bodyText.includes('자동입력방지') ||
             bodyText.includes('비정상적인 접근');
    });

    if (searchCaptcha) {
      ctx.log("engine:captcha", { stage: "search" });
      result.captchaDetected = true;
      result.error = "Search CAPTCHA";
      return result;
    }

    // 4. 스크롤 (mouse.wheel 기반 - scrollBy는 100% 탐지됨)
    ctx.log("behavior:scroll", { method: "mouse.wheel", target: 1200 });
    await humanScroll(page, 1200);
    await sleep(randomBetween(400, 700));

    // 5. 새 탭 핸들링 Promise 설정 (타임아웃 시 null 반환)
    let productPage: Page | null = null;
    const newTabPromise = new Promise<Page | null>((resolve) => {
      const timeout = setTimeout(() => {
        ctx.log("engine:newtab_timeout");
        resolve(null);  // 타임아웃 시 null 반환 (에러 대신)
      }, 30000);  // 30초로 여유있게

      browser.once('targetcreated', async (target: any) => {
        clearTimeout(timeout);
        if (target.type() === 'page') {
          const newPage = await target.page();
          resolve(newPage as Page || null);
        } else {
          resolve(null);
        }
      });
    });

    // 6. 인간화 클릭 (smartstore 링크 찾기)
    ctx.log("engine:click", { method: "humanized", target: "smartstore" });

    // 링크 찾기
    const linkInfo = await page.evaluate((targetMid: string) => {
      const links = Array.from(document.querySelectorAll('a'));

      // 1차: MID 포함된 smartstore 직접 링크
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href || '';
        if (href.includes('/bridge') || href.includes('cr.shopping') ||
            href.includes('cr2.shopping') || href.includes('cr3.shopping')) {
          continue;
        }
        if ((href.includes('smartstore.naver.com') || href.includes('brand.naver.com')) &&
            href.includes('/products/')) {
          if (href.includes(targetMid)) {
            return { found: true, index: i, href, method: 'direct-mid' };
          }
        }
      }

      // 2차: 아무 smartstore 링크
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href || '';
        if (href.includes('/bridge') || href.includes('cr.shopping')) continue;
        if ((href.includes('smartstore.naver.com') || href.includes('brand.naver.com')) &&
            href.includes('/products/')) {
          return { found: true, index: i, href, method: 'any-smartstore' };
        }
      }

      // 3차: Bridge URL도 허용
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const href = link.href || '';
        if (href.includes(targetMid)) {
          return { found: true, index: i, href, method: 'bridge-with-mid' };
        }
      }

      return { found: false };
    }, product.mid);

    if (!linkInfo.found) {
      result.error = "No product link found";
      ctx.log("engine:error", { error: result.error });
      return result;
    }

    // 인간화 클릭 실행
    const links = await page.$$('a');
    if (links[linkInfo.index!]) {
      await humanizedClickElement(page, links[linkInfo.index!], ctx);
    }

    ctx.log("engine:clicked", { method: linkInfo.method, href: linkInfo.href?.substring(0, 60) });

    // 7. 새 탭 대기 (타임아웃 시 현재 페이지 사용)
    productPage = await newTabPromise;

    if (productPage) {
      ctx.log("engine:newtab", { opened: true });
      try {
        await productPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 });
      } catch {}
      await sleep(1000);

      // 새 탭 열리자마자 캡챠 감지 (더 정확한 감지)
      const earlyCapchaCheck = await productPage.evaluate(() => {
        // 1. CAPTCHA 전용 요소가 있으면 확실한 CAPTCHA
        const hasCaptchaElement = !!(
          document.querySelector('#rcpt_form') ||
          document.querySelector('.captcha_wrap') ||
          document.querySelector('input[name*="captcha"]') ||
          document.querySelector('img[src*="captcha"]')
        );
        if (hasCaptchaElement) return true;

        // 2. 특정 조합의 텍스트가 있으면 CAPTCHA (단독 키워드는 무시)
        const bodyText = document.body.innerText || '';
        const hasSecurityCheck = bodyText.includes('보안 확인을 완료');
        const hasReceiptNumber = bodyText.includes('영수증 번호') || bodyText.includes('4자리');
        const hasRealUser = bodyText.includes('실제 사용자인지');

        return hasSecurityCheck || hasReceiptNumber || hasRealUser;
      });

      if (earlyCapchaCheck) {
        ctx.log("captcha:early_detect", { detected: true });
        try {
          const solver = new ReceiptCaptchaSolverPRB((msg) => ctx.log(msg));
          const solved = await solver.solve(productPage);
          if (solved) {
            ctx.log("captcha:solved", { early: true });
            await sleep(2000);
          }
        } catch (e: any) {
          ctx.log("captcha:early_error", { error: e.message });
        }
      }
    } else {
      ctx.log("engine:newtab", { opened: false, fallback: "current page" });
      productPage = page;
      try {
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 });
      } catch {}
      await sleep(1000);

      // 현재 페이지에서도 캡챠 감지 (더 정확한 감지)
      const earlyCapchaCheck = await page.evaluate(() => {
        // 1. CAPTCHA 전용 요소가 있으면 확실한 CAPTCHA
        const hasCaptchaElement = !!(
          document.querySelector('#rcpt_form') ||
          document.querySelector('.captcha_wrap') ||
          document.querySelector('input[name*="captcha"]') ||
          document.querySelector('img[src*="captcha"]')
        );
        if (hasCaptchaElement) return true;

        // 2. 특정 조합의 텍스트가 있으면 CAPTCHA (단독 키워드는 무시)
        const bodyText = document.body.innerText || '';
        const hasSecurityCheck = bodyText.includes('보안 확인을 완료');
        const hasReceiptNumber = bodyText.includes('영수증 번호') || bodyText.includes('4자리');
        const hasRealUser = bodyText.includes('실제 사용자인지');

        return hasSecurityCheck || hasReceiptNumber || hasRealUser;
      });

      if (earlyCapchaCheck) {
        ctx.log("captcha:early_detect", { detected: true });
        try {
          const solver = new ReceiptCaptchaSolverPRB((msg) => ctx.log(msg));
          const solved = await solver.solve(page);
          if (solved) {
            ctx.log("captcha:solved", { early: true });
            await sleep(2000);
          }
        } catch (e: any) {
          ctx.log("captcha:early_error", { error: e.message });
        }
      }
    }

    // 8. Bridge URL 리다이렉트 대기
    const targetPage = productPage || page;
    let finalUrl = targetPage.url();
    const isBridgeUrl = (url: string) =>
      url.includes('/bridge') || url.includes('cr.shopping') ||
      url.includes('cr2.shopping') || url.includes('cr3.shopping');

    if (isBridgeUrl(finalUrl)) {
      ctx.log("engine:bridge", { waiting: true });
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        finalUrl = targetPage.url();
        if (!isBridgeUrl(finalUrl)) {
          ctx.log("engine:bridge", { redirected: true, url: finalUrl.substring(0, 60) });
          break;
        }
      }
    }

    // 9. 상품 페이지 검증
    const pageCheck = await targetPage.evaluate((targetMid: string) => {
      const bodyText = document.body.innerText || '';
      const url = window.location.href;

      const isSmartStoreProduct = url.includes('smartstore.naver.com') && url.includes('/products/');

      // 캡챠 키워드 감지 (더 강화)
      const hasCaptchaKeywords = (
        bodyText.includes('보안 확인') ||
        bodyText.includes('자동입력방지') ||
        bodyText.includes('영수증 번호') ||
        bodyText.includes('문자를 순서대로') ||
        bodyText.includes('자동 입력 방지') ||
        bodyText.includes('가게 전화번호') ||
        bodyText.includes('정답을 입력') ||
        bodyText.includes('캡차이미지') ||
        (bodyText.includes('영수증') && bodyText.includes('4자리'))
      );

      // 캡챠 이미지/입력 요소 존재 체크
      const hasCaptchaElements = !!(
        document.querySelector('img[src*="captcha"]') ||
        document.querySelector('input[name*="captcha"]') ||
        document.querySelector('.captcha') ||
        document.querySelector('#captcha') ||
        document.querySelector('#rcpt_form') ||
        document.querySelector('.captcha_wrap')
      );

      const isProductPage = bodyText.includes('구매하기') ||
                           bodyText.includes('장바구니') ||
                           bodyText.includes('찜하기');

      // 캡챠 감지: 키워드나 요소가 있으면 캡챠 (상품페이지 여부 무관)
      const isCaptchaPage = hasCaptchaKeywords || hasCaptchaElements;

      return {
        hasCaptcha: isCaptchaPage,
        hasBlock: bodyText.includes('비정상적인 접근') ||
                 bodyText.includes('일시적으로 제한'),
        hasError: bodyText.includes('시스템오류') ||
                 document.title.includes('에러'),
        // 캡챠가 없을때만 상품페이지로 인정
        isProductPage: !isCaptchaPage && (isProductPage || isSmartStoreProduct),
        midInUrl: url.includes(targetMid),
        url: url.substring(0, 80),
        title: document.title.substring(0, 50)
      };
    }, product.mid);

    ctx.log("verify:page", {
      url: pageCheck.url,
      isProduct: pageCheck.isProductPage,
      captcha: pageCheck.hasCaptcha
    });

    if (pageCheck.hasCaptcha) {
      ctx.log("verify:captcha", { detected: true });
      
      // Claude Vision으로 캡챠 해결 시도
      try {
        ctx.log("captcha:solving", { attempting: true });
        const solver = new ReceiptCaptchaSolverPRB((msg) => ctx.log(msg));
        const solved = await solver.solve(targetPage);
        
        if (solved) {
          ctx.log("captcha:solved", { success: true });
          // 캡챠 해결 후 페이지 다시 확인
          await sleep(2000);
          const recheckPage = await targetPage.evaluate(() => {
            const bodyText = document.body.innerText || "";
            return {
              isProductPage: bodyText.includes("구매하기") || bodyText.includes("장바구니"),
              stillCaptcha: bodyText.includes("보안 확인") || bodyText.includes("영수증")
            };
          });
          
          if (recheckPage.isProductPage && !recheckPage.stillCaptcha) {
            ctx.log("verify:success", { afterCaptchaSolve: true });
            result.productPageEntered = true;
            result.success = true;
            result.captchaDetected = false;  // 해결됨
          } else {
            result.captchaDetected = true;
          }
        } else {
          ctx.log("captcha:failed", { solved: false });
          result.captchaDetected = true;
        }
      } catch (e: any) {
        ctx.log("captcha:error", { error: e.message });
        result.captchaDetected = true;
      }
    } else if (pageCheck.hasBlock) {
      result.error = "Blocked";
      ctx.log("verify:blocked", { blocked: true });
    } else if (pageCheck.hasError) {
      result.error = "Error page";
      ctx.log("verify:error", { error: true });
    } else if (pageCheck.isProductPage) {
      ctx.log("verify:success", { productPage: true });
      result.productPageEntered = true;
      result.success = true;
    }

    result.midMatched = pageCheck.midInUrl;

    // 체류 시간 (환경변수: 30~60초)
    if (result.productPageEntered) {
      const dwellTime = getDwellTime();
      ctx.log("dwell:start", { duration: Math.round(dwellTime / 1000) + "s" });
      await sleep(dwellTime);
      ctx.log("dwell:end", {});
    }

    // 새 탭 닫기
    if (productPage && productPage !== page) {
      await productPage.close().catch(() => {});
    }

  } catch (e: any) {
    result.error = e.message;
    ctx.log("engine:exception", { error: e.message });
  } finally {
    result.duration = Date.now() - startTime;
  }

  return result;
}
