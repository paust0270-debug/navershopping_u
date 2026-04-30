import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { buildAckeySearchUrl } from "./traffic-keywords";

function buildAutocompleteInput(keyword: string, productName: string): string {
  const source = (keyword || productName || "상품").replace(/\s+/g, " ").trim();
  const words = source.split(" ").filter(Boolean);
  if (source.length <= 18 && words.length <= 3) return source;
  const picked = words.slice(0, Math.min(3, words.length)).join(" ");
  return picked || source.substring(0, 18);
}

export async function runTrafficFlowE(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, productName, keyword, workerId, engine } = input;
  const query = (productName || keyword || "").trim() || "상품";
  const acq = buildAutocompleteInput(keyword, query);

  deps.log(
    `[Worker ${workerId}] E모드 원본 자동완성 흐름: input="${acq.substring(0, 40)}${acq.length > 40 ? "..." : ""}" query="${query.substring(0, 40)}${query.length > 40 ? "..." : ""}"`
  );
  await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 30000 });
  await deps.sleep(Math.max(2000, engine.delay("portalAfterOpen")));

  const searchBtn = await page.$("#MM_SEARCH_FAKE");
  if (searchBtn) {
    await searchBtn.click();
  } else {
    deps.log(`[Worker ${workerId}] E모드 검색창 활성화 버튼 미발견(#MM_SEARCH_FAKE)`, "warn");
  }
  await deps.sleep(Math.max(1000, engine.delay("searchFakeClickGap")));

  const inputEl = await page.$("#query");
  if (!inputEl) {
    return {
      ok: false,
      flowLabel,
      failReason: "PAGE_NOT_LOADED",
      error: "E모드_검색입력창없음",
    };
  }

  await inputEl.click();
  for (const char of acq) {
    await page.keyboard.type(char, { delay: Math.max(80, engine.delay("firstKeywordTypingDelay")) });
    await deps.sleep(50);
  }
  await deps.sleep(2000);

  await page.waitForSelector("li.u_atcp_l", { timeout: 4000 }).catch(() => null);
  const items = await page.$$("li.u_atcp_l");
  deps.log(`[Worker ${workerId}] E모드 자동완성 항목: ${items.length}개`);
  if (items.length <= 0) {
    const fallbackUrl = buildAckeySearchUrl(query, acq, 1);
    deps.log(
      `[Worker ${workerId}] E모드 자동완성 없음 → turafic_update Case B ackey URL 검색 진입`,
      "warn"
    );
    await page.goto(fallbackUrl, { waitUntil: "load", timeout: 60000 });
    await deps.sleep(Math.max(3000, engine.delay("afterFirstSearchLoad")));
    return { ok: true, flowLabel, secondSearchPhraseUsed: query };
  }

  await items[0].click();
  await deps.sleep(Math.max(3000, engine.delay("afterFirstSearchLoad")));
  return { ok: true, flowLabel, secondSearchPhraseUsed: query };
}
