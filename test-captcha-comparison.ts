/**
 * CAPTCHA 비교 테스트: Playwright vs PRB
 *
 * 각 10회씩 실행하여 CAPTCHA 발생률/해결률 비교
 *
 * 실행: npx tsx test-captcha-comparison.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { chromium, Page as PlaywrightPage, Browser as PlaywrightBrowser } from "playwright";
import { connect } from "puppeteer-real-browser";
import type { Page as PuppeteerPage, Browser as PuppeteerBrowser } from "puppeteer";
import { createClient } from "@supabase/supabase-js";
import { ReceiptCaptchaSolver } from "./ReceiptCaptchaSolver";

// ============ 설정 ============
const TEST_COUNT = 10;
const SUPABASE_URL = process.env.SUPABASE_PRODUCTION_URL!;
const SUPABASE_KEY = process.env.SUPABASE_PRODUCTION_KEY!;

interface Product {
  id: number;
  keyword: string;
  product_name: string;
  mid: string;
}

interface TestResult {
  index: number;
  product: string;
  mid: string;
  captchaDetected: boolean;
  captchaSolved: boolean;
  midMatched: boolean;
  error?: string;
  duration: number;
}

interface Summary {
  total: number;
  captchaCount: number;
  captchaSolvedCount: number;
  midSuccessCount: number;
  avgDuration: number;
}

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

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

// ============ Supabase ============
async function fetchProducts(): Promise<Product[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabase
    .from("slot_naver")
    .select("id, keyword, product_name, mid")
    .not("mid", "is", null)
    .not("product_name", "is", null)
    .limit(TEST_COUNT);

  if (error) {
    console.error("Failed to fetch products:", error.message);
    return [];
  }

  return data || [];
}

// ============ CAPTCHA 감지 ============
async function detectCaptcha(page: any): Promise<boolean> {
  try {
    const hasCaptcha = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return bodyText.includes("보안 확인") ||
             bodyText.includes("영수증") ||
             bodyText.includes("무엇입니까") ||
             bodyText.includes("일시적으로 제한") ||
             bodyText.includes("[?]");
    });
    return hasCaptcha;
  } catch {
    return false;
  }
}

// ============ MID 검증 ============
async function verifyMid(page: any, targetMid: string): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes(targetMid)) return true;

    const matched = await page.evaluate((mid: string) => {
      const elements = document.querySelectorAll('[data-nv-mid], [data-nvmid], [data-product-id]');
      for (const el of Array.from(elements)) {
        const dataMid = el.getAttribute('data-nv-mid') ||
                       el.getAttribute('data-nvmid') ||
                       el.getAttribute('data-product-id');
        if (dataMid === mid) return true;
      }
      return false;
    }, targetMid);

    return matched;
  } catch {
    return false;
  }
}

// ============ 랜덤 유틸 ============
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// ============ 418 완전 우회 Stealth 스크립트 (7대 요소) ============
const STEALTH_SCRIPT = `
  // ========== 1. Navigator 핵심 패치 (418 주요 원인) ==========
  // webdriver 숨김
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // maxTouchPoints (0~1이 정상)
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

  // hardwareConcurrency (4~8이 정상, 16은 의심)
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${randomInt(4, 8)} });

  // deviceMemory (4 또는 8이 정상)
  Object.defineProperty(navigator, 'deviceMemory', { get: () => ${[4, 8][randomInt(0, 1)]} });

  // platform
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

  // languages
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });

  // ========== 2. plugins / mimeTypes 패치 (핵심 누락 요소) ==========
  // 실제 Chrome plugins 구조 완벽 위장
  const mockPlugin = (name, description, filename, mimeTypes) => {
    const plugin = { name, description, filename, length: mimeTypes.length };
    mimeTypes.forEach((mt, i) => {
      plugin[i] = mt;
      plugin[mt.type] = mt;
    });
    return plugin;
  };

  const pdfMime = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null };
  const chromePdfPlugin = mockPlugin('Chrome PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer', [pdfMime]);
  const chromePdfViewer = mockPlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', [pdfMime]);
  const nativeClient = mockPlugin('Native Client', '', 'internal-nacl-plugin', []);

  const pluginsArray = [chromePdfPlugin, chromePdfViewer, nativeClient];
  pluginsArray.item = (i) => pluginsArray[i];
  pluginsArray.namedItem = (name) => pluginsArray.find(p => p.name === name);
  pluginsArray.refresh = () => {};

  Object.defineProperty(navigator, 'plugins', { get: () => pluginsArray });

  const mimeTypesArray = [pdfMime];
  mimeTypesArray.item = (i) => mimeTypesArray[i];
  mimeTypesArray.namedItem = (name) => mimeTypesArray.find(m => m.type === name);

  Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypesArray });

  // ========== 3. navigator.connection 패치 (일정한 값 방지) ==========
  const connectionTypes = ['4g', '4g', '4g', '3g'];
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      downlink: ${randomFloat(5, 15).toFixed(1)},
      effectiveType: connectionTypes[Math.floor(Math.random() * connectionTypes.length)],
      rtt: ${randomInt(50, 150)},
      saveData: false,
      onchange: null
    })
  });

  // ========== 4. JS Error Stack 위장 (자동화 흔적 제거) ==========
  Error.stackTraceLimit = 0;

  // 원본 Error 저장
  const OriginalError = Error;
  window.Error = function(...args) {
    const error = new OriginalError(...args);
    // 스택에서 playwright/puppeteer 흔적 제거
    if (error.stack) {
      error.stack = error.stack
        .split('\\n')
        .filter(line => !line.includes('playwright') && !line.includes('puppeteer') && !line.includes('__playwright'))
        .join('\\n');
    }
    return error;
  };
  window.Error.prototype = OriginalError.prototype;

  // ========== 5. Chrome 객체 완벽 위장 ==========
  window.chrome = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
    },
    runtime: {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
    },
    loadTimes: function() {
      return {
        commitLoadTime: Date.now() / 1000 - Math.random() * 5,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 2,
        finishLoadTime: Date.now() / 1000 - Math.random(),
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 - Math.random() * 3,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - Math.random() * 6,
        startLoadTime: Date.now() / 1000 - Math.random() * 5,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
      };
    },
    csi: function() {
      return {
        onloadT: Date.now(),
        pageT: Math.random() * 5000 + 1000,
        startE: Date.now() - Math.random() * 10000,
        tran: 15
      };
    }
  };

  // ========== 6. Permissions API 위장 ==========
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission, onchange: null });
    }
    return originalQuery.call(navigator.permissions, parameters);
  };

  // ========== 7. WebGL Vendor/Renderer 위장 ==========
  const getParameterProto = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel(R) UHD Graphics 630';
    if (parameter === 7937) return 'WebKit WebGL';
    return getParameterProto.call(this, parameter);
  };

  // WebGL2도 패치
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel(R) UHD Graphics 630';
      if (parameter === 7937) return 'WebKit WebGL';
      return getParameter2Proto.call(this, parameter);
    };
  }

  // ========== 8. Canvas Fingerprint 노이즈 ==========
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    if (type === 'image/png' && this.width > 16 && this.height > 16) {
      const ctx = this.getContext('2d');
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] ^= (Math.random() > 0.99 ? 1 : 0);
        }
        ctx.putImageData(imageData, 0, 0);
      }
    }
    return originalToDataURL.apply(this, arguments);
  };

  // ========== 9. AudioContext Fingerprint 위장 ==========
  const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
  AudioContext.prototype.createAnalyser = function() {
    const analyser = originalCreateAnalyser.call(this);
    const originalGetFloatFrequencyData = analyser.getFloatFrequencyData;
    analyser.getFloatFrequencyData = function(array) {
      originalGetFloatFrequencyData.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] += (Math.random() - 0.5) * 0.1;
      }
    };
    return analyser;
  };

  // ========== 10. Iframe contentWindow 보호 ==========
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() {
      return null;
    }
  });

  console.log('[Stealth] 418 완전 우회 패치 적용됨');
`;

// ============ 인간적인 타이핑 ============
async function humanType(page: PlaywrightPage, selector: string, text: string): Promise<void> {
  // 요소 위치 찾기
  const element = await page.$(selector);
  if (!element) return;

  const box = await element.boundingBox();
  if (!box) return;

  // 요소 중앙으로 마우스 이동 (사람형 이벤트 흐름)
  const x = box.x + box.width / 2 + randomInt(-10, 10);
  const y = box.y + box.height / 2 + randomInt(-5, 5);

  await page.mouse.move(x, y, { steps: randomInt(10, 20) });
  await sleep(randomInt(50, 150));

  // 사람형 클릭: pointerover → mousedown → mouseup → click
  await page.mouse.down();
  await sleep(randomInt(50, 100));
  await page.mouse.up();
  await sleep(randomInt(100, 300));

  // 타이핑
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(50, 150) });
    // 가끔 잠깐 멈춤 (사람은 생각함)
    if (Math.random() < 0.1) {
      await sleep(randomInt(200, 500));
    }
    // 가끔 오타 수정 시뮬레이션
    if (Math.random() < 0.02) {
      await page.keyboard.press('Backspace');
      await sleep(randomInt(100, 200));
      await page.keyboard.type(char, { delay: randomInt(80, 120) });
    }
  }
}

// ============ 인간적인 마우스 이동 ============
async function humanMouseMove(page: PlaywrightPage): Promise<void> {
  const moves = randomInt(2, 5);
  for (let i = 0; i < moves; i++) {
    const x = randomInt(100, 1100);
    const y = randomInt(100, 600);
    await page.mouse.move(x, y, { steps: randomInt(5, 15) });
    await sleep(randomInt(100, 300));
  }
}

// ============ rAF 기반 인간적인 스크롤 (네이버 감지 우회) ============
async function humanScroll(page: PlaywrightPage): Promise<void> {
  const scrolls = randomInt(3, 6);

  for (let i = 0; i < scrolls; i++) {
    const distance = randomInt(200, 500);

    // rAF 기반 스크롤 (브라우저 렌더러 스레드에서 실행)
    await page.evaluate((targetDistance: number) => {
      return new Promise<void>((resolve) => {
        let scrolled = 0;
        const step = targetDistance / 30;  // 30프레임에 나눠서

        function scroll() {
          if (scrolled < targetDistance) {
            // 이징 함수 적용 (ease-out)
            const remaining = targetDistance - scrolled;
            const delta = Math.min(step + Math.random() * 5, remaining);
            window.scrollBy(0, delta);
            scrolled += delta;
            requestAnimationFrame(scroll);
          } else {
            resolve();
          }
        }

        requestAnimationFrame(scroll);
      });
    }, distance);

    await sleep(randomInt(500, 1500));

    // 가끔 위로 스크롤 (사람 행동 패턴)
    if (Math.random() < 0.2) {
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let scrolled = 0;
          const target = 80 + Math.random() * 40;

          function scroll() {
            if (scrolled < target) {
              const delta = Math.min(10 + Math.random() * 5, target - scrolled);
              window.scrollBy(0, -delta);
              scrolled += delta;
              requestAnimationFrame(scroll);
            } else {
              resolve();
            }
          }

          requestAnimationFrame(scroll);
        });
      });
      await sleep(randomInt(300, 700));
    }

    // 가끔 스크롤 중 마우스 이동 (네이버 로깅 API 타이밍 시뮬레이션)
    if (Math.random() < 0.3) {
      await page.mouse.move(
        randomInt(200, 1000),
        randomInt(200, 600),
        { steps: randomInt(5, 10) }
      );
    }
  }
}

// ============ Playwright 테스트 ============
async function runPlaywrightTest(product: Product, index: number): Promise<TestResult> {
  const startTime = Date.now();
  let browser: PlaywrightBrowser | null = null;

  const result: TestResult = {
    index,
    product: product.product_name.substring(0, 30),
    mid: product.mid,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false,
    duration: 0
  };

  try {
    // 랜덤 viewport (일정한 패턴 방지)
    const viewportWidth = randomInt(1200, 1400);
    const viewportHeight = randomInt(700, 900);

    // 실제 User-Agent
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    ];
    const userAgent = userAgents[randomInt(0, userAgents.length - 1)];

    // 실제 Chrome 채널 사용 시도 (TLS fingerprint 개선)
    browser = await chromium.launch({
      headless: false,
      channel: 'chrome',  // 실제 설치된 Chrome 사용
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-infobars",
        "--window-size=1920,1080",
        "--disable-extensions",
        "--disable-gpu",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-default-browser-check"
      ]
    });

    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      userAgent,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      geolocation: { latitude: 37.5665, longitude: 126.9780 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      }
    });

    // Stealth 스크립트 주입
    await context.addInitScript(STEALTH_SCRIPT);

    const page = await context.newPage();

    // 네이버 메인
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(randomInt(1500, 3000));  // 랜덤 대기

    // 인간적인 마우스 이동
    await humanMouseMove(page);

    // 검색 (상품명 셔플 + 인간적인 타이핑)
    const searchQuery = shuffleWords(product.product_name).substring(0, 50);
    await humanType(page, 'input[name="query"]', searchQuery);
    await sleep(randomInt(300, 800));
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded");
    await sleep(randomInt(2000, 4000));

    // 인간적인 스크롤 (쇼핑 영역 로드 대기)
    try {
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 400));
        await sleep(800);
      }
    } catch (scrollErr) {
      console.log(`  스크롤 에러: ${scrollErr}`);
    }

    // 통합검색 쇼핑 영역에서 상품 클릭
    console.log("  상품 클릭 시도 중...");

    // 쇼핑 영역 로드 대기 (중요!)
    await sleep(3000);

    // 상품 링크 찾아서 클릭 (새 탭으로 열리므로 처리 필요)
    let productPage: PlaywrightPage | null = null;
    try {
      // #shp_gui_root에서 smartstore 링크 찾기
      const linkSelector = '#shp_gui_root a[href*="smartstore.naver.com"]';
      const links = await page.$$(linkSelector);

      for (const link of links) {
        const href = await link.getAttribute('href');
        if (href && href.includes('/products/')) {
          console.log(`  찾은 URL: ${href.substring(0, 60)}...`);

          // 새 탭 대기 + 클릭
          const [newPage] = await Promise.all([
            context.waitForEvent('page', { timeout: 10000 }),
            link.click()
          ]);

          productPage = newPage;
          await productPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
          await sleep(2000);
          break;
        }
      }

      // Fallback: 전체 페이지에서 찾기
      if (!productPage) {
        const allLinks = await page.$$('a[href*="smartstore.naver.com"]');
        for (const link of allLinks) {
          const href = await link.getAttribute('href');
          if (href && href.includes('/products/')) {
            console.log(`  (Fallback) 찾은 URL: ${href.substring(0, 60)}...`);

            const [newPage] = await Promise.all([
              context.waitForEvent('page', { timeout: 10000 }),
              link.click()
            ]);

            productPage = newPage;
            await productPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
            await sleep(2000);
            break;
          }
        }
      }
    } catch (clickErr) {
      console.log(`  링크 클릭 에러: ${clickErr}`);
    }

    if (productPage) {
      try {
        // 새 탭의 URL 확인
        const currentUrl = productPage.url();
        console.log(`  상품 페이지 URL: ${currentUrl.substring(0, 60)}...`);

        // 페이지 내용으로 상태 감지 (새 탭에서)
        const pageCheck = await productPage.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const title = document.title || '';

          return {
            hasCaptcha: bodyText.includes('보안 확인') ||
                       bodyText.includes('영수증') ||
                       bodyText.includes('자동입력방지') ||
                       bodyText.includes('[?]'),
            hasBlock: bodyText.includes('비정상적인 접근') ||
                     bodyText.includes('일시적으로 제한') ||
                     bodyText.includes('접근이 차단') ||
                     title.includes('차단'),
            has418: bodyText.includes('418') || title.includes('418'),
            has429: bodyText.includes('429') || bodyText.includes('Too Many') ||
                   bodyText.includes('요청이 너무 많습니다'),
            hasError: title.includes('에러') || title.includes('오류') ||
                     bodyText.includes('시스템오류') || bodyText.includes('에러페이지'),
            isProductPage: bodyText.includes('구매하기') ||
                          bodyText.includes('장바구니') ||
                          bodyText.includes('찜하기') ||
                          bodyText.includes('바로구매'),
            title: title.substring(0, 50),
            bodyPreview: bodyText.substring(0, 200)
          };
        });

        console.log(`  페이지 제목: ${pageCheck.title}`);

        // 상태 판단
        if (pageCheck.has418) {
          console.log(`  ❌ 418 봇 감지됨`);
          result.error = '418 Bot detected';
        } else if (pageCheck.has429) {
          console.log(`  ❌ 429 Rate Limited`);
          result.error = '429 Rate Limited';
        } else if (pageCheck.hasCaptcha) {
          console.log(`  ⚠️ CAPTCHA 감지됨`);
          result.captchaDetected = true;
        } else if (pageCheck.hasBlock) {
          console.log(`  ❌ 차단 페이지`);
          result.error = 'Blocked page';
        } else if (pageCheck.hasError) {
          console.log(`  ❌ 에러 페이지: ${pageCheck.title}`);
          result.error = `Error page: ${pageCheck.title}`;
        } else if (pageCheck.isProductPage) {
          console.log(`  ✅ 정상 상품 페이지 진입`);
        } else {
          console.log(`  ⚠️ 알 수 없는 페이지: ${pageCheck.bodyPreview.substring(0, 80)}...`);
          result.error = 'Unknown page';
        }

      } catch (checkErr) {
        console.log(`  페이지 확인 에러: ${checkErr}`);
        result.error = `Page check error: ${checkErr}`;
      }
    } else {
      console.log(`  상품 페이지 열기 실패`);
      result.error = 'Failed to open product page';
    }

    // CAPTCHA 발생 시 해결 시도
    if (result.captchaDetected && productPage) {
      console.log(`  [${index}] CAPTCHA detected, solving...`);
      try {
        const solver = new ReceiptCaptchaSolver();
        result.captchaSolved = await solver.solve(productPage);
        await sleep(2000);
      } catch (e: any) {
        console.log(`  [${index}] CAPTCHA solve error: ${e.message}`);
      }
    }

    // MID 검증 (새 탭에서)
    if (productPage) {
      result.midMatched = await verifyMid(productPage, product.mid);
      await productPage.close().catch(() => {});
    }

  } catch (e: any) {
    result.error = e.message;
  } finally {
    if (browser) await browser.close().catch(() => {});
    result.duration = Date.now() - startTime;
  }

  return result;
}

// ============ PRB 인간적인 동작 ============
async function humanTypePRB(page: PuppeteerPage, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await sleep(randomInt(100, 300));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(50, 150) });
    if (Math.random() < 0.1) {
      await sleep(randomInt(200, 500));
    }
  }
}

async function humanMouseMovePRB(page: PuppeteerPage): Promise<void> {
  const moves = randomInt(2, 5);
  for (let i = 0; i < moves; i++) {
    const x = randomInt(100, 1100);
    const y = randomInt(100, 600);
    await page.mouse.move(x, y, { steps: randomInt(5, 15) });
    await sleep(randomInt(100, 300));
  }
}

async function humanScrollPRB(page: PuppeteerPage): Promise<void> {
  const scrolls = randomInt(3, 6);

  for (let i = 0; i < scrolls; i++) {
    const distance = randomInt(200, 500);

    // rAF 기반 스크롤
    await page.evaluate((targetDistance: number) => {
      return new Promise<void>((resolve) => {
        let scrolled = 0;
        const step = targetDistance / 30;

        function scroll() {
          if (scrolled < targetDistance) {
            const remaining = targetDistance - scrolled;
            const delta = Math.min(step + Math.random() * 5, remaining);
            window.scrollBy(0, delta);
            scrolled += delta;
            requestAnimationFrame(scroll);
          } else {
            resolve();
          }
        }

        requestAnimationFrame(scroll);
      });
    }, distance);

    await sleep(randomInt(500, 1500));

    if (Math.random() < 0.2) {
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let scrolled = 0;
          const target = 80 + Math.random() * 40;

          function scroll() {
            if (scrolled < target) {
              const delta = Math.min(10 + Math.random() * 5, target - scrolled);
              window.scrollBy(0, -delta);
              scrolled += delta;
              requestAnimationFrame(scroll);
            } else {
              resolve();
            }
          }

          requestAnimationFrame(scroll);
        });
      });
      await sleep(randomInt(300, 700));
    }

    if (Math.random() < 0.3) {
      await page.mouse.move(
        randomInt(200, 1000),
        randomInt(200, 600),
        { steps: randomInt(5, 10) }
      );
    }
  }
}

// ============ PRB 테스트 ============
async function runPRBTest(product: Product, index: number): Promise<TestResult> {
  const startTime = Date.now();
  let browser: PuppeteerBrowser | null = null;

  const result: TestResult = {
    index,
    product: product.product_name.substring(0, 30),
    mid: product.mid,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false,
    duration: 0
  };

  try {
    // 랜덤 viewport
    const viewportWidth = randomInt(1200, 1400);
    const viewportHeight = randomInt(700, 900);

    const response = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-infobars",
        "--no-first-run"
      ]
    });

    browser = response.browser;
    const page = response.page;

    await page.setViewport({ width: viewportWidth, height: viewportHeight });

    // 네이버 메인
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(randomInt(1500, 3000));

    // 인간적인 마우스 이동
    await humanMouseMovePRB(page);

    // 검색 (상품명 셔플 + 인간적인 타이핑)
    const searchQuery = shuffleWords(product.product_name).substring(0, 50);
    await humanTypePRB(page, 'input[name="query"]', searchQuery);
    await sleep(randomInt(300, 800));
    await page.keyboard.press("Enter");
    await sleep(randomInt(2000, 4000));

    // 인간적인 스크롤 (쇼핑 영역 로드 대기)
    try {
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 400));
        await sleep(800);
      }
    } catch (scrollErr) {
      console.log(`  스크롤 에러: ${scrollErr}`);
    }

    // 통합검색 쇼핑 영역에서 상품 클릭
    console.log("  상품 클릭 시도 중...");

    // 쇼핑 영역 로드 대기 (중요!)
    await sleep(3000);

    // 상품 링크 찾아서 클릭 (새 탭 감지 포함) - Puppeteer용
    let productPage: PuppeteerPage | null = null;
    try {
      // #shp_gui_root에서 smartstore 링크 찾기
      const linkInfo = await page.evaluate(() => {
        const shpRoot = document.querySelector('#shp_gui_root');
        if (shpRoot) {
          const links = shpRoot.querySelectorAll('a[href*="smartstore.naver.com"]');
          for (const link of Array.from(links)) {
            const href = (link as HTMLAnchorElement).href;
            if (href.includes('/products/')) {
              // 링크의 위치 정보 반환
              const rect = link.getBoundingClientRect();
              return { href, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
          }
        }

        // Fallback
        const allLinks = document.querySelectorAll('a[href*="smartstore.naver.com"]');
        for (const link of Array.from(allLinks)) {
          const href = (link as HTMLAnchorElement).href;
          if (href.includes('/products/')) {
            const rect = link.getBoundingClientRect();
            return { href, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        return null;
      });

      if (linkInfo) {
        console.log(`  찾은 URL: ${linkInfo.href.substring(0, 60)}...`);

        // 새 탭 감지를 위한 Promise 설정 (클릭 전에!)
        const newTabPromise = new Promise<PuppeteerPage>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('New tab timeout'));
          }, 10000);

          browser!.once('targetcreated', async (target) => {
            clearTimeout(timeout);
            if (target.type() === 'page') {
              const newPage = await target.page();
              if (newPage) {
                resolve(newPage);
              } else {
                reject(new Error('Failed to get new page'));
              }
            }
          });
        });

        // 클릭 실행
        await page.mouse.click(linkInfo.x, linkInfo.y);

        // 새 탭 대기
        try {
          productPage = await newTabPromise;
          console.log(`  ✅ 새 탭 감지됨`);

          // 새 탭 로드 대기
          await sleep(3000);
        } catch (tabErr) {
          console.log(`  새 탭 감지 실패, 현재 페이지 사용: ${tabErr}`);
          // 새 탭이 안 열렸으면 현재 페이지가 이동했을 수 있음
          productPage = page;
        }
      }
    } catch (clickErr) {
      console.log(`  링크 클릭 에러: ${clickErr}`);
    }

    if (productPage) {
      try {
        // 현재 페이지 URL 확인
        const currentUrl = productPage.url();
        console.log(`  현재 URL: ${currentUrl.substring(0, 60)}...`);

        // 페이지 내용으로 상태 감지
        const pageCheck = await productPage.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const title = document.title || '';

          return {
            hasCaptcha: bodyText.includes('보안 확인') ||
                       bodyText.includes('영수증') ||
                       bodyText.includes('자동입력방지') ||
                       bodyText.includes('[?]'),
            hasBlock: bodyText.includes('비정상적인 접근') ||
                     bodyText.includes('일시적으로 제한') ||
                     bodyText.includes('접근이 차단') ||
                     title.includes('차단'),
            has418: bodyText.includes('418') || title.includes('418'),
            has429: bodyText.includes('429') || bodyText.includes('Too Many') ||
                   bodyText.includes('요청이 너무 많습니다'),
            hasError: title.includes('에러') || title.includes('오류') ||
                     bodyText.includes('시스템오류') || bodyText.includes('에러페이지'),
            isProductPage: bodyText.includes('구매하기') ||
                          bodyText.includes('장바구니') ||
                          bodyText.includes('찜하기') ||
                          bodyText.includes('바로구매'),
            title: title.substring(0, 50),
            bodyPreview: bodyText.substring(0, 200)
          };
        });

        console.log(`  페이지 제목: ${pageCheck.title}`);

        // 상태 판단
        if (pageCheck.has418) {
          console.log(`  ❌ 418 봇 감지됨`);
          result.error = '418 Bot detected';
        } else if (pageCheck.has429) {
          console.log(`  ❌ 429 Rate Limited`);
          result.error = '429 Rate Limited';
        } else if (pageCheck.hasCaptcha) {
          console.log(`  ⚠️ CAPTCHA 감지됨`);
          result.captchaDetected = true;
        } else if (pageCheck.hasBlock) {
          console.log(`  ❌ 차단 페이지`);
          result.error = 'Blocked page';
        } else if (pageCheck.hasError) {
          console.log(`  ❌ 에러 페이지: ${pageCheck.title}`);
          result.error = `Error page: ${pageCheck.title}`;
        } else if (pageCheck.isProductPage) {
          console.log(`  ✅ 정상 상품 페이지 진입`);
        } else {
          console.log(`  ⚠️ 알 수 없는 페이지: ${pageCheck.bodyPreview.substring(0, 80)}...`);
          result.error = 'Unknown page';
        }

      } catch (checkErr) {
        console.log(`  페이지 확인 에러: ${checkErr}`);
        result.error = `Page check error: ${checkErr}`;
      }

      // CAPTCHA 발생 시 해결 시도
      if (result.captchaDetected) {
        console.log(`  [${index}] CAPTCHA detected, solving...`);
        try {
          const solver = new ReceiptCaptchaSolver();
          result.captchaSolved = await solver.solve(productPage as any);
          await sleep(2000);
        } catch (e: any) {
          console.log(`  [${index}] CAPTCHA solve error: ${e.message}`);
        }
      }

      // MID 검증 (새 탭에서)
      result.midMatched = await verifyMid(productPage, product.mid);

      // 새 탭이면 닫기
      if (productPage !== page) {
        await productPage.close().catch(() => {});
      }
    } else {
      console.log(`  상품 링크를 찾지 못함`);
      result.error = 'No product link found';
    }

  } catch (e: any) {
    result.error = e.message;
  } finally {
    if (browser) await browser.close().catch(() => {});
    result.duration = Date.now() - startTime;
  }

  return result;
}

// ============ 결과 출력 ============
function printResults(label: string, results: TestResult[]): Summary {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${label} 테스트 결과`);
  console.log("=".repeat(50));

  let captchaCount = 0;
  let captchaSolvedCount = 0;
  let midSuccessCount = 0;
  let totalDuration = 0;

  for (const r of results) {
    const status = r.midMatched ? "✅" : r.error ? "❌" : "⚠️";
    const captcha = r.captchaDetected ? (r.captchaSolved ? "🔓해결" : "🔐발생") : "없음";
    console.log(`  [${r.index}] ${status} ${r.product}... | CAPTCHA: ${captcha} | ${(r.duration / 1000).toFixed(1)}s`);

    if (r.captchaDetected) captchaCount++;
    if (r.captchaSolved) captchaSolvedCount++;
    if (r.midMatched) midSuccessCount++;
    totalDuration += r.duration;
  }

  const summary: Summary = {
    total: results.length,
    captchaCount,
    captchaSolvedCount,
    midSuccessCount,
    avgDuration: totalDuration / results.length / 1000
  };

  console.log(`\n--- ${label} 요약 ---`);
  console.log(`총 테스트: ${summary.total}회`);
  console.log(`CAPTCHA 발생: ${summary.captchaCount}회 (${(summary.captchaCount / summary.total * 100).toFixed(0)}%)`);
  console.log(`CAPTCHA 해결: ${summary.captchaSolvedCount}/${summary.captchaCount}회`);
  console.log(`MID 성공: ${summary.midSuccessCount}회 (${(summary.midSuccessCount / summary.total * 100).toFixed(0)}%)`);
  console.log(`평균 시간: ${summary.avgDuration.toFixed(1)}초`);

  return summary;
}

// ============ 메인 ============
async function main() {
  console.log("=".repeat(50));
  console.log("  CAPTCHA 비교 테스트: Playwright vs PRB");
  console.log("=".repeat(50));

  // 상품 조회
  console.log("\n[1] Supabase에서 상품 조회...");
  const products = await fetchProducts();

  if (products.length < TEST_COUNT) {
    console.error(`상품 부족: ${products.length}개 (필요: ${TEST_COUNT}개)`);
    return;
  }

  console.log(`  ${products.length}개 상품 로드됨\n`);

  // Playwright 테스트
  console.log("[2] Playwright 테스트 시작...");
  const playwrightResults: TestResult[] = [];

  for (let i = 0; i < TEST_COUNT; i++) {
    console.log(`  테스트 ${i + 1}/${TEST_COUNT}: ${products[i].product_name.substring(0, 30)}...`);
    const result = await runPlaywrightTest(products[i], i + 1);
    playwrightResults.push(result);
    await sleep(2000); // 테스트 간 휴식
  }

  const playwrightSummary = printResults("Playwright", playwrightResults);

  // PRB 테스트
  console.log("\n[3] PRB 테스트 시작...");
  const prbResults: TestResult[] = [];

  for (let i = 0; i < TEST_COUNT; i++) {
    console.log(`  테스트 ${i + 1}/${TEST_COUNT}: ${products[i].product_name.substring(0, 30)}...`);
    const result = await runPRBTest(products[i], i + 1);
    prbResults.push(result);
    await sleep(2000);
  }

  const prbSummary = printResults("PRB", prbResults);

  // 최종 비교
  console.log("\n" + "=".repeat(50));
  console.log("  최종 비교");
  console.log("=".repeat(50));
  console.log(`
| 항목           | Playwright | PRB     |
|----------------|------------|---------|
| CAPTCHA 발생률 | ${(playwrightSummary.captchaCount / playwrightSummary.total * 100).toFixed(0)}%       | ${(prbSummary.captchaCount / prbSummary.total * 100).toFixed(0)}%    |
| MID 성공률     | ${(playwrightSummary.midSuccessCount / playwrightSummary.total * 100).toFixed(0)}%       | ${(prbSummary.midSuccessCount / prbSummary.total * 100).toFixed(0)}%    |
| 평균 시간      | ${playwrightSummary.avgDuration.toFixed(1)}s      | ${prbSummary.avgDuration.toFixed(1)}s   |
`);

  // 추천
  const recommend = prbSummary.captchaCount < playwrightSummary.captchaCount ? "PRB" : "Playwright";
  console.log(`\n→ 추천: ${recommend}`);
  console.log(`  이유: CAPTCHA 발생률이 더 낮음\n`);
}

main().catch(console.error);
