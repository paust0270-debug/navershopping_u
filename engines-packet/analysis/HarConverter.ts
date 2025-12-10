/**
 * HAR Converter
 *
 * NetworkCaptureResult를 HAR (HTTP Archive) 형식으로 변환
 * DevTools Network 패널에서 열 수 있는 표준 형식
 */

import * as fs from "fs";
import * as path from "path";
import type {
  NetworkCaptureResult,
  CapturedRequest,
  CapturedResponse,
  HarFile,
  HarLog,
  HarEntry,
  HarRequest,
  HarResponse,
  HarNameValue,
  HarTimings,
  LogFunction,
} from "../types";

export class HarConverter {
  private log: LogFunction;

  constructor(logFn?: LogFunction) {
    this.log = logFn || console.log;
  }

  /**
   * NetworkCaptureResult를 HAR 형식으로 변환
   */
  convert(capture: NetworkCaptureResult): HarFile {
    const entries = this.buildEntries(capture);

    const harLog: HarLog = {
      version: "1.2",
      creator: {
        name: "packet-engine",
        version: "1.0.0",
      },
      entries,
    };

    return { log: harLog };
  }

  /**
   * HAR 파일로 저장
   */
  exportToFile(capture: NetworkCaptureResult, outputPath: string): void {
    const har = this.convert(capture);
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(har, null, 2));
    this.log(`[HarConverter] Exported to: ${outputPath}`);
  }

  /**
   * 여러 캡처 파일을 일괄 변환
   */
  convertBatch(inputDir: string, outputDir: string): void {
    const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const inputPath = path.join(inputDir, file);
        const content = fs.readFileSync(inputPath, "utf-8");
        const capture: NetworkCaptureResult = JSON.parse(content);

        const outputFile = file.replace(".json", ".har");
        const outputPath = path.join(outputDir, outputFile);

        this.exportToFile(capture, outputPath);
      } catch (error) {
        this.log(`[HarConverter] Failed to convert ${file}: ${error}`);
      }
    }
  }

  /**
   * Request/Response를 HAR Entry로 변환
   */
  private buildEntries(capture: NetworkCaptureResult): HarEntry[] {
    const entries: HarEntry[] = [];
    const responseMap = this.buildResponseMap(capture.responses);

    for (const request of capture.requests) {
      const response = this.findMatchingResponse(request, responseMap);
      const entry = this.buildEntry(request, response, capture.startTime);
      entries.push(entry);
    }

    // 타임스탬프 순으로 정렬
    entries.sort(
      (a, b) =>
        new Date(a.startedDateTime).getTime() -
        new Date(b.startedDateTime).getTime()
    );

    return entries;
  }

  /**
   * URL 기반 응답 맵 생성
   */
  private buildResponseMap(
    responses: CapturedResponse[]
  ): Map<string, CapturedResponse[]> {
    const map = new Map<string, CapturedResponse[]>();

    for (const response of responses) {
      const existing = map.get(response.url) || [];
      existing.push(response);
      map.set(response.url, existing);
    }

    return map;
  }

  /**
   * 요청에 매칭되는 응답 찾기
   */
  private findMatchingResponse(
    request: CapturedRequest,
    responseMap: Map<string, CapturedResponse[]>
  ): CapturedResponse | undefined {
    const responses = responseMap.get(request.url);
    if (!responses || responses.length === 0) return undefined;

    // 타임스탬프가 가장 가까운 응답 찾기
    let closest: CapturedResponse | undefined;
    let minDiff = Infinity;

    for (const response of responses) {
      const diff = Math.abs(response.timestamp - request.timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = response;
      }
    }

    return closest;
  }

  /**
   * HAR Entry 생성
   */
  private buildEntry(
    request: CapturedRequest,
    response: CapturedResponse | undefined,
    baseTime: number
  ): HarEntry {
    const startTime = new Date(baseTime + request.timestamp);

    return {
      startedDateTime: startTime.toISOString(),
      time: response ? response.timestamp - request.timestamp : 0,
      request: this.buildHarRequest(request),
      response: this.buildHarResponse(response),
      cache: {},
      timings: this.buildTimings(request, response),
    };
  }

  /**
   * HAR Request 생성
   */
  private buildHarRequest(request: CapturedRequest): HarRequest {
    const url = new URL(request.url);
    const queryString = this.parseQueryString(url.search);

    const harRequest: HarRequest = {
      method: request.method,
      url: request.url,
      httpVersion: "HTTP/2.0",
      headers: this.objectToNameValue(request.headers),
      queryString,
      cookies: this.extractCookies(request.headers),
      headersSize: -1,
      bodySize: request.postData ? request.postData.length : 0,
    };

    if (request.postData) {
      harRequest.postData = {
        mimeType:
          request.headers["content-type"] || "application/x-www-form-urlencoded",
        text: request.postData,
      };
    }

    return harRequest;
  }

  /**
   * HAR Response 생성
   */
  private buildHarResponse(response?: CapturedResponse): HarResponse {
    if (!response) {
      return {
        status: 0,
        statusText: "No Response",
        httpVersion: "HTTP/2.0",
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: "text/plain" },
        redirectURL: "",
        headersSize: -1,
        bodySize: -1,
      };
    }

    return {
      status: response.status,
      statusText: response.statusText || "",
      httpVersion: "HTTP/2.0",
      headers: this.objectToNameValue(response.headers),
      cookies: this.extractSetCookies(response.headers),
      content: {
        size: -1,
        mimeType: response.headers["content-type"] || "text/plain",
      },
      redirectURL: response.headers["location"] || "",
      headersSize: -1,
      bodySize: -1,
    };
  }

  /**
   * HAR Timings 생성
   */
  private buildTimings(
    request: CapturedRequest,
    response?: CapturedResponse
  ): HarTimings {
    const total = response ? response.timestamp - request.timestamp : 0;

    return {
      blocked: 0,
      dns: 0,
      connect: 0,
      ssl: 0,
      send: 0,
      wait: total,
      receive: 0,
    };
  }

  /**
   * Object를 HAR NameValue 배열로 변환
   */
  private objectToNameValue(obj: Record<string, string>): HarNameValue[] {
    return Object.entries(obj).map(([name, value]) => ({ name, value }));
  }

  /**
   * Query string 파싱
   */
  private parseQueryString(search: string): HarNameValue[] {
    if (!search || search === "?") return [];

    const params = new URLSearchParams(search);
    const result: HarNameValue[] = [];

    params.forEach((value, name) => {
      result.push({ name, value });
    });

    return result;
  }

  /**
   * Cookie 헤더에서 쿠키 추출
   */
  private extractCookies(headers: Record<string, string>): HarNameValue[] {
    const cookieHeader = headers["cookie"] || headers["Cookie"];
    if (!cookieHeader) return [];

    return cookieHeader.split(";").map((cookie) => {
      const [name, ...valueParts] = cookie.trim().split("=");
      return { name: name.trim(), value: valueParts.join("=") };
    });
  }

  /**
   * Set-Cookie 헤더에서 쿠키 추출
   */
  private extractSetCookies(headers: Record<string, string>): HarNameValue[] {
    const setCookie = headers["set-cookie"] || headers["Set-Cookie"];
    if (!setCookie) return [];

    // Set-Cookie는 여러 개일 수 있음
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];

    return cookies.map((cookie) => {
      const [nameValue] = cookie.split(";");
      const [name, ...valueParts] = nameValue.split("=");
      return { name: name.trim(), value: valueParts.join("=") };
    });
  }
}
