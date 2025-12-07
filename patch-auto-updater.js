const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'auto-updater.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const oldCode = `    // nodeType에 따라 실행할 파일 결정
    if (this.config.nodeType === 'playwright') {
      runnerFile = 'parallel-ip-rotation-playwright.ts';
      useNpxTsx = true;  // TypeScript 파일은 npx tsx로 실행
    } else if (this.config.nodeType === 'experiment') {
      runnerFile = 'experiment-runner.js';
    } else {
      runnerFile = 'worker-runner.js';
    }`;

const newCode = `    // nodeType에 따라 실행할 파일 결정
    if (this.config.nodeType === 'prb') {
      runnerFile = 'unified-runner.ts';
      useNpxTsx = true;  // PRB (puppeteer-real-browser) 엔진
    } else if (this.config.nodeType === 'playwright') {
      runnerFile = 'parallel-ip-rotation-playwright.ts';
      useNpxTsx = true;  // TypeScript 파일은 npx tsx로 실행
    } else if (this.config.nodeType === 'experiment') {
      runnerFile = 'experiment-runner.js';
    } else {
      runnerFile = 'worker-runner.js';
    }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync(filePath, content);
  console.log('auto-updater.ts 패치 완료!');
} else {
  console.log('패턴을 찾을 수 없음. 이미 패치되었거나 코드가 다름.');
}
