import { rotateIP, getCurrentIP, getTetheringAdapter } from './ipRotation';

async function test() {
  console.log('=== IP 로테이션 테스트 ===');

  const adapter = await getTetheringAdapter();
  console.log('테더링 어댑터:', adapter);

  const currentIP = await getCurrentIP();
  console.log('현재 IP:', currentIP);

  console.log('\nIP 로테이션 시도...');
  const result = await rotateIP(adapter || undefined);
  console.log('결과:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
