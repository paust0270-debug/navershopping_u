import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { buildIntegratedSearchUrl } from "./traffic-keywords";

export async function runTrafficFlowB(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps,
  flowLabel: string
): Promise<TrafficSearchFlowSetup> {
  const { page, keyword, workerId, engine } = input;
  const firstKeyword = (keyword || "").trim() || "상품";

  deps.log(`[Worker ${workerId}] 1차 통합검색: ${firstKeyword}`);
  await page.goto(buildIntegratedSearchUrl(firstKeyword), { waitUntil: "domcontentloaded", timeout: 60000 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  deps.log(`[Worker ${workerId}] B모드 — 1차 통합검색 결과에서 상품 탐색`);
  return { ok: true, flowLabel };
}
