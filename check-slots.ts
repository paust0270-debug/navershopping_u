import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_PRODUCTION_URL!,
  process.env.SUPABASE_PRODUCTION_KEY!
);

async function check() {
  console.log("\n=== 슬롯 및 작업 현황 ===\n");

  // 1. slot_naver에서 mid 있는 슬롯
  const { count: slotCount } = await supabase
    .from('slot_naver')
    .select('*', { count: 'exact', head: true })
    .not('mid', 'is', null);

  console.log(`slot_naver (mid 있음): ${slotCount}개`);

  // 2. traffic_navershopping 작업
  const { count: taskCount } = await supabase
    .from('traffic_navershopping')
    .select('*', { count: 'exact', head: true });

  console.log(`traffic_navershopping: ${taskCount}개`);

  // 3. 샘플 슬롯 (작업 생성용)
  const { data: slots } = await supabase
    .from('slot_naver')
    .select('id, mid, product_name, keyword')
    .not('mid', 'is', null)
    .not('product_name', 'is', null)
    .not('keyword', 'is', null)
    .limit(5);

  console.log("\n작업 생성 가능한 슬롯 샘플:");
  slots?.forEach(s => {
    console.log(`  - id: ${s.id}, keyword: ${s.keyword}, mid: ${s.mid}`);
  });
}

check().catch(console.error);
