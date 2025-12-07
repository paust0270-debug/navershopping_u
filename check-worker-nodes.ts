import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_CONTROL_URL!,
  process.env.SUPABASE_CONTROL_KEY!
);

async function check() {
  console.log("=== workerNodes 테이블 확인 ===\n");

  const { data, error } = await supabase
    .from('workerNodes')
    .select('*')
    .limit(5);

  if (error) {
    console.log('에러:', error.message);
    return;
  }

  console.log('샘플 데이터:');
  console.log(JSON.stringify(data, null, 2));

  if (data && data.length > 0) {
    console.log('\n컬럼 목록:', Object.keys(data[0]));
  }
}

check();
