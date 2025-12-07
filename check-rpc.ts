import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function check() {
  console.log("=== RPC 함수 테스트 ===");

  // 1. 조건에 맞는 작업 수 확인
  const { data: countData, error: countError } = await supabase
    .from("traffic_navershopping")
    .select("id, slot_type, customer_id, slot_id")
    .eq("slot_type", "네이버쇼핑")
    .neq("customer_id", "master")
    .limit(10);

  console.log("\n[1] traffic_navershopping 조건 검색:");
  console.log("  조건: slot_type='네이버쇼핑', customer_id!='master'");
  console.log("  결과:", countData?.length || 0, "건");

  if (countError) {
    console.log("  에러:", countError.message);
  }

  if (countData && countData.length > 0) {
    console.log("  샘플:", JSON.stringify(countData[0], null, 2));

    // slot_naver에서 mid 확인
    const slotId = countData[0].slot_id;
    const { data: slotData } = await supabase
      .from("slot_naver")
      .select("id, mid, product_name")
      .eq("id", slotId)
      .single();

    console.log("\n[2] slot_naver 매칭 (slot_id=" + slotId + "):");
    console.log("  결과:", slotData);
  }

  // 2. RPC 함수 호출 테스트
  console.log("\n[3] RPC claim_and_delete_task() 호출:");
  const { data: rpcData, error: rpcError } = await supabase.rpc('claim_and_delete_task');

  if (rpcError) {
    console.log("  RPC 에러:", rpcError.message);
  } else {
    console.log("  결과:", rpcData);
  }

  // 3. 전체 작업 수 확인
  const { count } = await supabase
    .from("traffic_navershopping")
    .select("*", { count: "exact", head: true });

  console.log("\n[4] 전체 traffic_navershopping 레코드:", count, "건");
}

check().catch(console.error);
