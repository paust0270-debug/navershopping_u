/**
 * Request Builder - 각 엔드포인트별 요청 생성
 *
 * 실제 네이버 요청을 분석하여 동일한 형식으로 생성
 */

import { UserIdentity } from "./IdentityGenerator";
import { ReplayTask } from "./MassReplayEngine";

// ============================================================
//  타입 정의
// ============================================================

interface HeaderOptions {
  referer?: string;
  origin?: string;
  contentType?: string;
}

// ============================================================
//  RequestBuilder 클래스
// ============================================================

export class RequestBuilder {
  /**
   * HTTP 헤더 생성
   */
  buildHeaders(identity: UserIdentity, options: HeaderOptions = {}): Record<string, string> {
    const headers: Record<string, string> = {
      // 기본 헤더
      "accept": "application/json, text/plain, */*",
      "accept-encoding": "gzip, deflate, br, zstd",
      "accept-language": identity.languages.join(",") + ";q=0.9",
      "content-type": options.contentType || "application/json",
      "user-agent": identity.userAgent,

      // Origin/Referer
      "origin": options.origin || "https://smartstore.naver.com",
      "referer": options.referer || "https://smartstore.naver.com/",

      // 보안 헤더
      "sec-ch-ua": this.buildSecChUa(identity.userAgent),
      "sec-ch-ua-mobile": identity.platform.includes("arm") ? "?1" : "?0",
      "sec-ch-ua-platform": `"${this.getPlatformName(identity.platform)}"`,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",

      // 연결
      "connection": "keep-alive",
    };

    return headers;
  }

  /**
   * product-logs 요청 body 생성
   */
  buildProductLogBody(task: ReplayTask, identity: UserIdentity): object {
    return {
      id: task.productId,
      channel: {
        accountNo: parseInt(task.merchantId) || 0,
        channelNo: task.channelNo,
        channelUid: this.generateChannelUid(),
        channelName: "",
        representName: "",
        channelSiteUrl: "",
        channelSiteFullUrl: `https://smartstore.naver.com/`,
        channelSiteMobileUrl: `https://m.smartstore.naver.com/`,
        accountId: `ncp_${this.randomString(6)}_01`,
        naverPaySellerNo: task.merchantId,
        sellerExternalStatusType: "NORMAL",
        channelTypeCode: "STOREFARM",
      },
      channelServiceType: "STOREFARM",
      category: {
        categoryId: task.categoryId,
        categoryName: "",
        wholeCategoryId: task.categoryId,
        wholeCategoryName: "",
        categoryLevel: 3,
        lastLevel: true,
      },
      groupId: null,
      tr: task.searchKeyword || "",
      planNo: "",
      referer: task.referer || "",
    };
  }

  /**
   * wcs.naver.com/b 요청 body 생성
   */
  buildWcsBody(task: ReplayTask, identity: UserIdentity): object {
    const [screenW, screenH] = identity.screenResolution.split("x").map(Number);
    const [viewW, viewH] = identity.viewportSize.split("x").map(Number);

    return {
      wa: this.generateWa(),
      u: `https://smartstore.naver.com/shop/products/${task.productId}`,
      e: "",
      bt: -1,
      vtyp: "DET",  // Detail page
      pid: task.productId,
      pnm: "",  // Product name (optional)
      lcatid: task.categoryId.split(">")[0] || task.categoryId,
      mid: task.merchantId,
      chno: task.channelNo,
      mtyp: "STF",
      os: identity.platform,
      ln: identity.language,
      sr: identity.screenResolution,
      bw: viewW,
      bh: viewH,
      c: identity.colorDepth,
      j: "N",
      jv: "1.8",
      k: "Y",
      ct: "",
      cs: "UTF-8",
      tl: encodeURIComponent(task.searchKeyword || "상품"),
      vs: "0.8.17",
      nt: Date.now(),
      fwb: identity.fwb,
      ui: JSON.stringify({ nac: identity.nac }),
      ext: JSON.stringify({ wot: Math.floor(Math.random() * 500) + 500 }),
    };
  }

  /**
   * nlog.naver.com/n 요청 body 생성 (impression)
   */
  buildNlogBody(task: ReplayTask, identity: UserIdentity, eventType: string = "custom.impression"): object {
    const [screenW, screenH] = identity.screenResolution.split("x").map(Number);
    const [viewW, viewH] = identity.viewportSize.split("x").map(Number);

    return {
      corp: "naver",
      svc: "shopping",
      location: "korea_real/korea",
      svc_tags: {},
      send_ts: Date.now(),
      tool: {
        name: "ntm-web",
        ver: "nlogLibVersion=v0.1.59; verName=v2.0.10; ntmVersion=v1.4.10",
      },
      usr: {},
      env: {
        os: identity.platform,
        br_ln: identity.language,
        br_sr: `${viewW}x${viewH}`,
        device_sr: identity.screenResolution,
        platform_type: "web",
        device_pr: String(identity.devicePixelRatio),
        timezone: identity.timezone,
        ch_pltf: this.getPlatformName(identity.platform),
        ch_mob: identity.platform.includes("arm"),
        ch_mdl: "",
        ch_arch: identity.platform.includes("arm") ? "arm" : "x86",
        ch_pltfv: "10.0",
        ch_fvls: this.buildClientHints(identity.userAgent),
      },
      evts: [
        {
          type: eventType,
          page_url: `https://smartstore.naver.com/shop/products/${task.productId}`,
          page_ref: task.referer || "",
          page_id: this.generatePageId(),
          DocumentScrollTop: "0",
          DocumentScrollHeight: String(Math.floor(Math.random() * 2000) + 1500),
          DocumentClientHeight: String(viewH),
          DocumentScrollVerticalPercentage: "0",
          evt_ts: Date.now(),
          nlog_id: this.generateUuid(),
        },
      ],
    };
  }

  // ============================================================
  //  헬퍼 메서드
  // ============================================================

  private buildSecChUa(userAgent: string): string {
    // Chrome 버전 추출
    const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
    if (chromeMatch) {
      const version = chromeMatch[1];
      return `"Chromium";v="${version}", "Google Chrome";v="${version}", "Not-A.Brand";v="24"`;
    }

    // Firefox
    if (userAgent.includes("Firefox")) {
      return `"Firefox";v="133", "Not-A.Brand";v="24"`;
    }

    // Safari
    if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      return `"Safari";v="18", "Not-A.Brand";v="24"`;
    }

    return `"Chromium";v="131", "Not-A.Brand";v="24"`;
  }

  private getPlatformName(platform: string): string {
    if (platform === "Win32") return "Windows";
    if (platform === "MacIntel") return "macOS";
    if (platform.includes("arm")) return "Android";
    if (platform.includes("iPhone")) return "iOS";
    return "Windows";
  }

  private buildClientHints(userAgent: string): Array<{ brand: string; version: string }> {
    const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
    if (chromeMatch) {
      return [
        { brand: "Chromium", version: chromeMatch[1] },
        { brand: "Google Chrome", version: chromeMatch[1] },
        { brand: "Not-A.Brand", version: "24" },
      ];
    }
    return [{ brand: "Not-A.Brand", version: "24" }];
  }

  private generateWa(): string {
    return `s_${this.randomHex(12)}`;
  }

  private generateChannelUid(): string {
    return this.randomAlphanumeric(21);
  }

  private generatePageId(): string {
    return this.randomHex(32);
  }

  private generateUuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private randomString(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }

  private randomHex(length: number): string {
    const chars = "0123456789abcdef";
    return Array.from({ length }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }

  private randomAlphanumeric(length: number): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }
}

export default RequestBuilder;
