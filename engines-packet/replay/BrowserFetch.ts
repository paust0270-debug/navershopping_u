/**
 * Browser Fetch (Chrome TLS 보장)
 *
 * page.request.fetch()는 Node TLS를 쓸 수 있음
 * page.evaluate(() => fetch())는 100% Chrome/BoringSSL TLS 사용
 *
 * 이 모듈은 모든 HTTP 요청을 브라우저 내부 fetch()로 실행
 */

import type { Page } from "patchright";
import type { LogFunction } from "../types";

export interface BrowserFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
  url: string;
  redirected: boolean;
  error?: string;
}

export interface BrowserFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: "include" | "omit" | "same-origin";
  mode?: "cors" | "no-cors" | "same-origin";
  redirect?: "follow" | "manual" | "error";
  timeout?: number;
}

/**
 * 브라우저 내부 fetch 실행기
 * Chrome TLS/BoringSSL 100% 보장
 */
export class BrowserFetch {
  private log: LogFunction;
  private page: Page | null = null;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * Page 설정
   */
  setPage(page: Page): void {
    this.page = page;
    this.log("[BrowserFetch] Page set - using Chrome TLS (guaranteed)");
  }

  /**
   * 브라우저 내부에서 fetch 실행 (Chrome TLS 보장)
   */
  async fetch(url: string, options: BrowserFetchOptions = {}): Promise<BrowserFetchResponse> {
    if (!this.page) {
      return {
        ok: false,
        status: 0,
        statusText: "No Page",
        headers: {},
        body: null,
        url,
        redirected: false,
        error: "Page not set. Call setPage() first.",
      };
    }

    const {
      method = "GET",
      headers = {},
      body,
      credentials = "include",
      mode = "cors",
      redirect = "follow",
      timeout = 30000,
    } = options;

    try {
      // 브라우저 내부에서 fetch 실행
      const result = await this.page.evaluate(
        async ({
          url,
          method,
          headers,
          body,
          credentials,
          mode,
          redirect,
          timeout,
        }) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(url, {
              method,
              headers,
              body: method !== "GET" && method !== "HEAD" ? body : undefined,
              credentials,
              mode,
              redirect,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // 헤더 추출
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key.toLowerCase()] = value;
            });

            // Body 읽기 (text로)
            let responseBody: string | null = null;
            try {
              responseBody = await response.text();
            } catch {
              // body 읽기 실패 무시
            }

            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              headers: responseHeaders,
              body: responseBody,
              url: response.url,
              redirected: response.redirected,
            };
          } catch (error: any) {
            clearTimeout(timeoutId);
            return {
              ok: false,
              status: 0,
              statusText: "Network Error",
              headers: {},
              body: null,
              url,
              redirected: false,
              error: error.message || "Unknown error",
            };
          }
        },
        { url, method, headers, body, credentials, mode, redirect, timeout }
      );

      return result as BrowserFetchResponse;
    } catch (error: any) {
      this.log(`[BrowserFetch] Error: ${error.message}`);
      return {
        ok: false,
        status: 0,
        statusText: "Execution Error",
        headers: {},
        body: null,
        url,
        redirected: false,
        error: error.message,
      };
    }
  }

  /**
   * GET 요청
   */
  async get(url: string, headers?: Record<string, string>): Promise<BrowserFetchResponse> {
    return this.fetch(url, { method: "GET", headers, credentials: "include" });
  }

  /**
   * POST 요청
   */
  async post(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<BrowserFetchResponse> {
    return this.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body,
      credentials: "include",
    });
  }

  /**
   * 네이버 검색 요청 (브라우저 내부 fetch)
   */
  async naverSearch(keyword: string): Promise<BrowserFetchResponse> {
    const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    return this.get(url);
  }

  /**
   * NAC 토큰 획득 (브라우저 내부 fetch)
   */
  async getNacToken(): Promise<{ token: string | null; error?: string }> {
    if (!this.page) {
      return { token: null, error: "Page not set" };
    }

    try {
      const result = await this.page.evaluate(async () => {
        try {
          const response = await fetch("https://nam.veta.naver.com/nac/1", {
            method: "GET",
            credentials: "include",
          });
          const text = await response.text();
          return { token: text, error: null };
        } catch (e: any) {
          return { token: null, error: e.message };
        }
      });

      return result;
    } catch (error: any) {
      return { token: null, error: error.message };
    }
  }

  /**
   * 여러 요청 병렬 실행
   */
  async fetchAll(
    requests: Array<{ url: string; options?: BrowserFetchOptions }>
  ): Promise<BrowserFetchResponse[]> {
    if (!this.page) {
      return requests.map((r) => ({
        ok: false,
        status: 0,
        statusText: "No Page",
        headers: {},
        body: null,
        url: r.url,
        redirected: false,
        error: "Page not set",
      }));
    }

    // 브라우저 내에서 Promise.all로 병렬 실행
    const results = await this.page.evaluate(
      async (reqs) => {
        const promises = reqs.map(async ({ url, options }) => {
          const {
            method = "GET",
            headers = {},
            body,
            credentials = "include",
            timeout = 30000,
          } = options || {};

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(url, {
              method,
              headers,
              body: method !== "GET" && method !== "HEAD" ? body : undefined,
              credentials,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key.toLowerCase()] = value;
            });

            let responseBody: string | null = null;
            try {
              responseBody = await response.text();
            } catch {}

            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              headers: responseHeaders,
              body: responseBody,
              url: response.url,
              redirected: response.redirected,
            };
          } catch (error: any) {
            clearTimeout(timeoutId);
            return {
              ok: false,
              status: 0,
              statusText: "Error",
              headers: {},
              body: null,
              url,
              redirected: false,
              error: error.message,
            };
          }
        });

        return Promise.all(promises);
      },
      requests.map((r) => ({ url: r.url, options: r.options }))
    );

    return results as BrowserFetchResponse[];
  }

  /**
   * Page 유효성 확인
   */
  hasPage(): boolean {
    return this.page !== null;
  }
}
