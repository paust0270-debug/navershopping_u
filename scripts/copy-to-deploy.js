/**
 * 배포 자동화 스크립트
 *
 * 역할:
 * 1. 빌드된 .exe 파일을 deploy/ 폴더로 복사
 * 2. version.txt 생성 (커밋 해시, 빌드 시간)
 *
 * 실행: node scripts/copy-to-deploy.js <launcher-name>
 * 예시: node scripts/copy-to-deploy.js test-launcher
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const launcherName = process.argv[2] || 'test-launcher';
const exeFile = `${launcherName}.exe`;
const deployDir = path.join(__dirname, '..', 'deploy');

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  배포 자동화 스크립트');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Launcher:', launcherName);
console.log('  EXE:', exeFile);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// deploy 폴더 생성
if (!fs.existsSync(deployDir)) {
  fs.mkdirSync(deployDir, { recursive: true });
  console.log('✅ deploy/ 폴더 생성');
}

// exe 파일 복사
const srcPath = path.join(__dirname, '..', exeFile);
const destPath = path.join(deployDir, exeFile);

if (!fs.existsSync(srcPath)) {
  console.error(`❌ ${exeFile} not found`);
  console.error('');
  console.error('먼저 빌드를 실행하세요:');
  console.error(`  npm run build:${launcherName}-exe`);
  console.error('');
  process.exit(1);
}

fs.copyFileSync(srcPath, destPath);
console.log(`✅ Copied ${exeFile} to deploy/`);

// 파일 크기 확인
const stats = fs.statSync(destPath);
const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`   Size: ${fileSizeMB} MB`);

// version.txt 생성
try {
  const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim().split('\n')[0];
  const timestamp = new Date().toISOString();
  const versionContent = `version: ${timestamp.replace(/[-:]/g, '').split('.')[0]}
commit: ${commitHash}
build_date: ${timestamp}
launcher: ${launcherName}
commit_message: ${commitMessage}
`;

  fs.writeFileSync(path.join(deployDir, 'version.txt'), versionContent, 'utf8');
  console.log(`✅ Created version.txt`);
  console.log(`   Commit: ${commitHash}`);
  console.log(`   Date: ${timestamp.split('T')[0]} ${timestamp.split('T')[1].split('.')[0]}`);
} catch (e) {
  console.error('⚠️ version.txt 생성 실패 (git 정보 없음):', e.message);
  // 최소한의 version.txt 생성
  const timestamp = new Date().toISOString();
  const versionContent = `version: ${timestamp.replace(/[-:]/g, '').split('.')[0]}
commit: unknown
build_date: ${timestamp}
launcher: ${launcherName}
`;
  fs.writeFileSync(path.join(deployDir, 'version.txt'), versionContent, 'utf8');
  console.log(`✅ Created version.txt (without git info)`);
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  배포 준비 완료!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('다음 단계:');
console.log('  git add deploy/');
console.log(`  git commit -m "deploy: Update ${launcherName}"`);
console.log('  git push');
console.log('');
console.log('또는 한 번에:');
console.log(`  npm run deploy:${launcherName}`);
console.log('');
