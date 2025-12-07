import * as dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function check() {
  console.log("\n=== 대기 작업 확인 ===\n");

  // 1. 전체 작업 수
  const { count: total } = await supabase
    .from('traffic_navershopping')
    .select('*', { count: 'exact', head: true });

  console.log(`전체 대기 작업: ${total}개`);

  // 2. slot_type별
  const { data: all } = await supabase
    .from('traffic_navershopping')
    .select('slot_type');

  if (all) {
    const byType: Record<string, number> = {};
    all.forEach(t => {
      byType[t.slot_type] = (byType[t.slot_type] || 0) + 1;
    });
    console.log("\nslot_type별 작업 수:");
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}개`);
    });
  }

  // 3. 네이버쇼핑 작업 샘플
  const { data: sample } = await supabase
    .from('traffic_navershopping')
    .select('id, slot_id, keyword, slot_type')
    .eq('slot_type', '네이버쇼핑')
    .limit(5);

  console.log("\n네이버쇼핑 작업 샘플:");
  if (sample && sample.length > 0) {
    sample.forEach(s => {
      console.log(`  - ID: ${s.id}, slot_id: ${s.slot_id}, keyword: ${s.keyword}`);
    });
  } else {
    console.log("  (없음)");
  }

  // 4. mid/product_name 있는 작업 확인
  if (sample && sample.length > 0) {
    console.log("\nmid/product_name 확인:");
    for (const task of sample) {
      const { data: slot } = await supabase
        .from('slot_naver')
        .select('mid, product_name')
        .eq('id', task.slot_id)
        .single();

      const hasMid = slot?.mid ? '✅' : '❌';
      const hasName = slot?.product_name ? '✅' : '❌';
      console.log(`  - slot_id ${task.slot_id}: mid ${hasMid}, product_name ${hasName}`);
    }
  }
}

check().catch(console.error);
