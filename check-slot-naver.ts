import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function check() {
  // slot_naver 테이블 샘플 조회
  const { data, error } = await supabase
    .from("slot_naver")
    .select("*")
    .not("mid", "is", null)
    .limit(3);

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  console.log("=== slot_naver 샘플 (mid 있는 것) ===");
  console.log(JSON.stringify(data, null, 2));

  // 컬럼 목록
  if (data && data.length > 0) {
    console.log("\n=== slot_naver 컬럼 목록 ===");
    console.log(Object.keys(data[0]));
  }

  // traffic_navershopping과 매칭 테스트
  const { data: trafficData } = await supabase
    .from("traffic_navershopping")
    .select("*")
    .eq("slot_type", "네이버쇼핑")
    .limit(1);

  if (trafficData && trafficData.length > 0) {
    const traffic = trafficData[0];
    console.log("\n=== traffic_navershopping 샘플 ===");
    console.log(JSON.stringify(traffic, null, 2));

    // slot_id로 slot_naver 매칭 시도
    console.log("\n=== slot_id로 매칭 시도 ===");
    const { data: matchedSlot } = await supabase
      .from("slot_naver")
      .select("*")
      .eq("id", traffic.slot_id)
      .single();

    console.log("slot_id 매칭 결과:", matchedSlot ? "성공" : "실패");
    if (matchedSlot) {
      console.log(JSON.stringify(matchedSlot, null, 2));
    }
  }
}

check();
