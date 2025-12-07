const fs = require('fs');
let content = fs.readFileSync('auto-updater.ts', 'utf-8');

// run() 메서드 시작 부분에 비동기 설정 로드 추가
const oldRun = "async run(): Promise<void> {\n    console.log";
const newRun = `async run(): Promise<void> {
    // DB에서 설정 로드 (hostname으로 nodeType 조회)
    this.config = await loadConfigAsync();
    console.log`;

if (content.includes(oldRun)) {
  content = content.replace(oldRun, newRun);
  fs.writeFileSync('auto-updater.ts', content);
  console.log('run() 메서드에 loadConfigAsync() 추가 완료');
} else {
  console.log('패턴 못찾음, 수동 확인 필요');
}
