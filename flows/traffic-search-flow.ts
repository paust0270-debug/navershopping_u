import type { TrafficSearchFlowDeps, TrafficSearchFlowInput, TrafficSearchFlowSetup } from "./types";
import { runTrafficFlowA } from "./flow-a-traffic";
import { runTrafficFlowB } from "./flow-b-traffic";
import { runTrafficFlowC } from "./flow-c-traffic";
import { runTrafficFlowE } from "./flow-e-traffic";
import { runTrafficFlowF } from "./flow-f-traffic";

function trafficFlowLabel(flow: string): string {
  return flow === "A" ? "A 통합1+2차" :
    flow === "B" ? "B 통합메인" :
    flow === "C" ? "C 통합2차" :
    flow === "E" ? "E ackey위장URL" :
    flow === "F" ? "F 통합상품명" : flow;
}

export async function prepareTrafficSearchFlow(
  input: TrafficSearchFlowInput,
  deps: TrafficSearchFlowDeps
): Promise<TrafficSearchFlowSetup> {
  const flow = input.engine.searchFlowVersion;
  const flowLabel = trafficFlowLabel(flow);

  deps.log(`[Worker ${input.workerId}] 검색 시작 (작업 모드: ${flowLabel})`);

  if (flow === "A") return runTrafficFlowA(input, deps, flowLabel);
  if (flow === "C") return runTrafficFlowC(input, deps, flowLabel);
  if (flow === "E") return runTrafficFlowE(input, deps, flowLabel);
  if (flow === "F") return runTrafficFlowF(input, deps, flowLabel);
  return runTrafficFlowB(input, deps, flowLabel);
}
