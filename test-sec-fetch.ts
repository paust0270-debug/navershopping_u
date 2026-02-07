/**
 * Sec-Fetch-User: ?1 헤더 강제 주입 테스트
 * CDP Fetch.requestPaused로 네비게이션 요청 가로채서 헤더 추가
 */
import { connect } from "puppeteer-real-browser";
import { applyMobileStealthPuppeteer, MOBILE_CONTEXT_OPTIONS } from "./shared/mobile-stealth";

async function main() {
  const response = await connect({
    headless: false,
    turnstile: true,
    args: [
      '--window-position=0,0',
      '--window-size=450,750',
      '--disable-blink-features=AutomationControlled',
      `--user-agent=${MOBILE_CONTEXT_OPTIONS.userAgent}`,
    ],
  });

  const browser = response.browser;
  const page = response.page;

  await page.setViewport({
    ...MOBILE_CONTEXT_OPTIONS.viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  await applyMobileStealthPuppeteer(page);

  const client = await (page as any).createCDPSession();

  // ===== Fetch 인터셉트: Sec-Fetch-User: ?1 주입 =====
  await client.send('Fetch.enable', {
    patterns: [{ urlPattern: '*shopping.naver.com*', requestStage: 'Request' }],
  });

  client.on('Fetch.requestPaused', async (params: any) => {
    const url = params.request.url;
    const headers = params.request.headers;

    // 기존 헤더에 Sec-Fetch-User, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site 추가/덮어쓰기
    const modifiedHeaders = [
      ...Object.entries(headers)
        .filter(([k]) => !['sec-fetch-user', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'].includes(k.toLowerCase()))
        .map(([name, value]) => ({ name, value: value as string })),
      { name: 'Sec-Fetch-Dest', value: 'document' },
      { name: 'Sec-Fetch-Mode', value: 'navigate' },
      { name: 'Sec-Fetch-Site', value: 'cross-site' },
      { name: 'Sec-Fetch-User', value: '?1' },
    ];

    console.log(`\n[Fetch] 헤더 주입: ${url.substring(0, 80)}`);
    modifiedHeaders
      .filter(h => h.name.toLowerCase().startsWith('sec-fetch'))
      .forEach(h => console.log(`  ${h.name}: ${h.value}${h.name === 'Sec-Fetch-User' ? ' ← 주입!' : ''}`));

    await client.send('Fetch.continueRequest', {
      requestId: params.requestId,
      headers: modifiedHeaders,
    });
  });

  // ===== 검증용: Network.requestWillBeSent로 최종 헤더 확인 =====
  await client.send('Network.enable');
  client.on('Network.requestWillBeSentExtraInfo', (params: any) => {
    const headers = params.headers || {};
    const url = Object.values(headers).toString();
    // requestWillBeSentExtraInfo에는 URL이 없으므로 Sec-Fetch 헤더 있는 것만 출력
    if (headers['Sec-Fetch-User']) {
      console.log(`[Network] ✅ Sec-Fetch-User: ${headers['Sec-Fetch-User']} (실제 전송 확인)`);
    }
  });

  // 1. m.naver.com 접속
  console.log('[1] m.naver.com 접속...');
  await page.goto('https://m.naver.com/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // 2. 스토어 링크 찾기
  console.log('[2] 스토어 링크 찾기...');
  const storeLink = await page.$('a[data-clk="shortsho"]');
  if (!storeLink) {
    console.log('❌ 스토어 링크 없음');
    await browser.close();
    return;
  }

  await storeLink.evaluate((el: HTMLElement) => el.removeAttribute('target'));

  const box = await storeLink.evaluate((el: Element) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  console.log(`[3] touchscreen.tap(${box.x.toFixed(0)}, ${box.y.toFixed(0)})...`);

  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.touchscreen.tap(box.x, box.y);
  await navPromise;

  const finalUrl = page.url();
  console.log(`[4] 최종 URL: ${finalUrl}`);

  // 페이지 내용 확인 (CAPTCHA인지 정상인지)
  await new Promise(r => setTimeout(r, 2000));
  const pageCheck = await page.evaluate(() => {
    const hasCaptcha = !!document.querySelector('#rcpt_answer, #vcpt_answer');
    const hasSearchInput = !!document.querySelector('input[placeholder*="검색"], input[type="search"]');
    const title = document.title;
    const bodyText = document.body?.innerText?.substring(0, 200) || '';
    return { hasCaptcha, hasSearchInput, title, bodyText };
  });

  console.log(`\n========== 페이지 결과 ==========`);
  console.log(`제목: ${pageCheck.title}`);
  console.log(`CAPTCHA: ${pageCheck.hasCaptcha ? '❌ 있음' : '✅ 없음'}`);
  console.log(`검색창: ${pageCheck.hasSearchInput ? '✅ 있음' : '❌ 없음'}`);
  console.log(`본문: ${pageCheck.bodyText.substring(0, 150)}`);
  console.log(`=================================\n`);

  await page.screenshot({ path: 'test-sec-fetch-result.png' });
  console.log('스크린샷: test-sec-fetch-result.png');

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  console.log('완료.');
}

main().catch(console.error);
