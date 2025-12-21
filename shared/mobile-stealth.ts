/**
 * 모바일 스텔스 스크립트
 *
 * navigator.userAgentData, platform, webdriver 등 오버라이드
 * CreepJS 봇 탐지 우회용
 *
 * 사용법:
 *   import { MOBILE_STEALTH_SCRIPT, applyMobileStealth } from '../shared/mobile-stealth';
 *   await applyMobileStealth(context);
 *
 * 주의: unified-runner.ts의 MOBILE_CONTEXT와 버전 일치 필수!
 *   - Chrome: 131
 *   - Android: 14
 *   - Device: SM-S911B (Galaxy S23)
 */

import type { BrowserContext } from "patchright";

// ============================================
// 디바이스 프로필 (통합 관리)
// ============================================
export const DEVICE_PROFILE = {
  // 기기 정보
  device: 'SM-S911B',
  deviceName: 'Galaxy S23',
  platform: 'Android',
  platformVersion: '14.0.0',

  // 브라우저 버전
  chromeVersion: '131',
  chromeMajor: '131',
  chromeFullVersion: '131.0.0.0',

  // 아키텍처
  architecture: 'arm',
  bitness: '64',

  // GPU (Snapdragon 8 Gen 2)
  gpuVendor: 'Qualcomm',
  gpuRenderer: 'Adreno (TM) 740',
};

export const MOBILE_STEALTH_SCRIPT = `
// ============================================================
// 모바일 스텔스 스크립트 - navigator 및 API 오버라이드
// Chrome 131 / Android 14 / SM-S911B (Galaxy S23)
// ============================================================

// 1. navigator.userAgentData 오버라이드 (Client Hints API)
Object.defineProperty(navigator, 'userAgentData', {
  get: () => ({
    brands: [
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Not-A.Brand', version: '99' }
    ],
    mobile: true,
    platform: 'Android',
    getHighEntropyValues: async (hints) => ({
      brands: [
        { brand: 'Chromium', version: '131' },
        { brand: 'Google Chrome', version: '131' },
        { brand: 'Not-A.Brand', version: '99' }
      ],
      mobile: true,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      bitness: '64',
      model: 'SM-S911B',
      uaFullVersion: '131.0.0.0',
      fullVersionList: [
        { brand: 'Chromium', version: '131.0.0.0' },
        { brand: 'Google Chrome', version: '131.0.0.0' },
        { brand: 'Not-A.Brand', version: '99.0.0.0' }
      ]
    }),
    toJSON: function() {
      return {
        brands: this.brands,
        mobile: this.mobile,
        platform: this.platform
      };
    }
  })
});

// 2. navigator.platform 오버라이드
Object.defineProperty(navigator, 'platform', {
  get: () => 'Linux armv81'
});

// 3. navigator.webdriver 숨기기
Object.defineProperty(navigator, 'webdriver', {
  get: () => false
});

// 4. navigator.maxTouchPoints 설정 (모바일)
Object.defineProperty(navigator, 'maxTouchPoints', {
  get: () => 5
});

// 5. navigator.hardwareConcurrency (모바일 수준)
Object.defineProperty(navigator, 'hardwareConcurrency', {
  get: () => 8
});

// 6. navigator.deviceMemory (모바일 수준)
Object.defineProperty(navigator, 'deviceMemory', {
  get: () => 8
});

// 7. navigator.connection 모바일 설정
Object.defineProperty(navigator, 'connection', {
  get: () => ({
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
    type: 'cellular',
    addEventListener: () => {},
    removeEventListener: () => {}
  })
});

// 8. screen orientation (portrait)
if (screen.orientation) {
  try {
    Object.defineProperty(screen.orientation, 'type', {
      get: () => 'portrait-primary'
    });
    Object.defineProperty(screen.orientation, 'angle', {
      get: () => 0
    });
  } catch (e) {}
}

// 9. window.chrome 객체 (안드로이드 크롬)
window.chrome = {
  runtime: {},
  loadTimes: function() {},
  csi: function() {},
  app: {}
};

// 10. Permissions API 수정
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
}

// 11. WebGL Vendor/Renderer 스푸핑 (Snapdragon 8 Gen 2)
const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  // UNMASKED_VENDOR_WEBGL
  if (parameter === 37445) {
    return 'Qualcomm';
  }
  // UNMASKED_RENDERER_WEBGL
  if (parameter === 37446) {
    return 'Adreno (TM) 740';
  }
  return getParameterOrig.call(this, parameter);
};

const getParameterOrig2 = WebGL2RenderingContext.prototype.getParameter;
WebGL2RenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) {
    return 'Qualcomm';
  }
  if (parameter === 37446) {
    return 'Adreno (TM) 740';
  }
  return getParameterOrig2.call(this, parameter);
};

// 12. 배터리 API 모바일화
if (navigator.getBattery) {
  navigator.getBattery = () => Promise.resolve({
    charging: true,
    chargingTime: 0,
    dischargingTime: Infinity,
    level: 0.85 + Math.random() * 0.1,  // 85~95% 랜덤
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// 13. Playwright 전역 변수 제거
delete window.__playwright__binding__;
delete window.__pwInitScripts;
`;

/**
 * BrowserContext에 모바일 스텔스 스크립트 적용
 */
export async function applyMobileStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(MOBILE_STEALTH_SCRIPT);
}

/**
 * 모바일 컨텍스트 설정 (viewport, userAgent 등)
 * unified-runner.ts의 MOBILE_CONTEXT와 일치
 */
export const MOBILE_CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  viewport: { width: 400, height: 700 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  extraHTTPHeaders: {
    'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-ch-ua-platform-version': '"14.0.0"',
    'sec-ch-ua-model': '"SM-S911B"',
  },
};
