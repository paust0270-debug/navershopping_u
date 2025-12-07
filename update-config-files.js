const fs = require('fs');
let content = fs.readFileSync('config.ts', 'utf-8');

const oldFiles = "files: ['experiment-runner.js', 'worker-runner.js', 'parallel-ip-rotation-playwright.ts', 'playwright-save-login.ts', 'playwright-real-traffic.ts', 'unified-runner.ts', 'save-account.ts', 'version.json'],";

const newFiles = `files: [
    // PRB 엔진 (기본)
    'unified-runner.ts',
    'engines/v7_engine.ts',
    'runner/types.ts',
    'ipRotation.ts',
    'profiles/pc_v7.json',
    // Playwright 엔진
    'parallel-ip-rotation-playwright.ts',
    // 기타
    'version.json'
  ],`;

if (content.includes(oldFiles)) {
  content = content.replace(oldFiles, newFiles);
  fs.writeFileSync('config.ts', content);
  console.log('config.ts files 목록 업데이트 완료');
} else {
  console.log('패턴 못찾음');
}
