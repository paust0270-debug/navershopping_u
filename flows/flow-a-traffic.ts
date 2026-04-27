import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { buildIntegratedSearchUrl, pickSecondSearchPhraseAvoidingBlacklist } from "./traffic-keywords";

export async function runTrafficFlowA(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, mid, productName, keyword, workerId, engine, keywordName, catalogMid } = input;
  const firstKeyword = (keyword || "").trim() || "상품";

  deps.log(`[Worker ${workerId}] 1차 통합검색: ${firstKeyword}`);
  await page.goto(buildIntegratedSearchUrl(firstKeyword), { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));

  let secondSearchKeyword: string;
  if (catalogMid && productName && productName.length > 10) {
    secondSearchKeyword = productName;
    deps.log(`[Worker ${workerId}] A모드 2차 통합검색 (풀네임): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
  } else {
    const nameForSecond = (keywordName || productName || "").trim() || firstKeyword;
    secondSearchKeyword = pickSecondSearchPhraseAvoidingBlacklist(
      engine,
      mid,
      firstKeyword,
      nameForSecond,
      workerId,
      deps
    );
    deps.log(`[Worker ${workerId}] A모드 2차 통합검색 (3단조합): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
  }

  await page.goto(buildIntegratedSearchUrl(secondSearchKeyword), { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterSecondSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: secondSearchKeyword };
}
