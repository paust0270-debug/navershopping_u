import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { buildIntegratedSearchUrl, pickQueryWords } from "./traffic-keywords";

export async function runTrafficFlowF(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, productName, keyword, workerId, engine } = input;
  const firstKeyword = (keyword || "").trim() || "상품";
  const query = (productName || firstKeyword || "").trim() || pickQueryWords(firstKeyword, productName);

  deps.log(`[Worker ${workerId}] F모드 상품명 전체 통합검색: "${query}"`);
  await page.goto(buildIntegratedSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: query };
}
