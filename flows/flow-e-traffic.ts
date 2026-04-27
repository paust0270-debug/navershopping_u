import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { buildAckeySearchUrl, pickQueryWords } from "./traffic-keywords";

export async function runTrafficFlowE(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, productName, keyword, workerId, engine } = input;
  const firstKeyword = (keyword || "").trim() || "상품";
  const query = pickQueryWords(firstKeyword, productName);
  const searchUrl = buildAckeySearchUrl(query);

  deps.log(`[Worker ${workerId}] E모드 ackey URL: query="${query}"`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: query };
}
