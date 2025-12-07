import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_CONTROL_URL!,
  process.env.SUPABASE_CONTROL_KEY!
);

async function updateAll() {
  console.log("=== workerNodes nodeType 업데이트 ===\n");

  // 모든 노드의 nodeType을 prb로 업데이트
  const { error } = await supabase
    .from('workerNodes')
    .update({ nodeType: 'prb' })
    .neq('nodeType', 'prb');

  if (error) {
    console.log('에러:', error.message);
  } else {
    console.log('모든 노드 nodeType=prb로 업데이트 완료\n');
  }

  // 확인
  const { data: nodes } = await supabase
    .from('workerNodes')
    .select('nodeId, nodeType, hostname');

  console.log('현재 노드 목록:');
  nodes?.forEach(n => {
    console.log(`  - ${n.hostname}: ${n.nodeType}`);
  });
}

updateAll();
