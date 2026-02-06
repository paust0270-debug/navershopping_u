# Test Launcher 배포 가이드

## 개요

이 폴더는 **test-launcher.exe** 배포용 폴더입니다.
Git에 .exe 파일을 포함시켜 원격 PC에서 `git pull`만으로 최신 런처를 받을 수 있도록 합니다.

---

## 최초 설치 (원격 PC)

### 방법 1: Git Clone (권장)

```bash
git clone https://github.com/mim1012/turafic_update.git
cd turafic_update
deploy\test-launcher.exe
```

### 방법 2: 수동 다운로드

1. GitHub에서 `deploy/test-launcher.exe` 다운로드
2. 빈 폴더에 복사
3. `test-launcher.exe` 실행
4. 자동으로 git clone 수행됨

---

## 런처 기능

`test-launcher.exe` 실행 시 자동으로:

1. **Git/Node.js 설치 확인** (없으면 안내)
2. **Git clone** (최초) 또는 **git pull** (업데이트)
3. **환경변수 자동 생성** (.env 파일이 없을 경우)
   - SUPABASE_URL/KEY는 기본값 사용
   - EQUIPMENT_NAME은 PC 이름 + MAC 주소로 자동 생성
4. **npm install + patchright 설치**
5. **unified-runner-shopping-tab-test.ts 실행**
6. **3분마다 자동 git pull** (백그라운드)
7. **에러 시 5초 후 재시작**

---

## 업데이트 방법

### 런처 업데이트 (수동)

```bash
cd D:\Project\turafic_update
git pull
deploy\test-launcher.exe
```

### Runner 코드 업데이트 (자동)

런처가 자동으로 3분마다 git pull 수행 → 별도 작업 불필요

---

## 자동 시작 설정

### Windows 시작 프로그램 등록

1. `Win+R` → `shell:startup` 입력
2. 바로가기 생성: `D:\Project\turafic_update\deploy\test-launcher.exe`

### PM2 사용 (Node.js 있는 경우)

```bash
pm2 start deploy/test-launcher.exe --name "test-launcher"
pm2 save
pm2 startup
```

---

## 개발자용 - 배포 워크플로우

### 배포 방법 1: 자동 배포 (권장)

```bash
npm run deploy:test-launcher
```

이 명령은 다음을 자동 실행:
1. test-launcher.ts → esbuild → pkg → test-launcher.exe
2. test-launcher.exe 복사 → deploy/test-launcher.exe
3. version.txt 생성 (커밋 해시, 빌드 시간)
4. git add + commit + push

### 배포 방법 2: 수동 배포

```bash
# 1. 빌드 및 복사
npm run build:test-launcher-deploy

# 2. Git 커밋
git add deploy/test-launcher.exe deploy/version.txt
git commit -m "deploy: Update test-launcher"
git push
```

---

## 환경변수 설정

### 자동 생성 (.env 파일 없을 때)

런처가 자동으로 다음 내용으로 .env 파일을 생성합니다:

```env
# Supabase Production DB (기본값)
SUPABASE_PRODUCTION_URL=https://sltckvbyzntxwutsyvfb.supabase.co
SUPABASE_PRODUCTION_KEY=eyJhbGci...

# Supabase Control DB (기본값 - 옵션)
SUPABASE_CONTROL_URL=https://rwqvgqhlzthwbqoxhmsd.supabase.co
SUPABASE_CONTROL_KEY=eyJhbGci...

# 장비 고유 이름 (자동 생성)
EQUIPMENT_NAME=PC1_A1B2C3  # PC이름_MAC주소

# 옵션 설정
IP_ROTATION_METHOD=auto
NETWORK_CAPTURE=false
```

### 수동 설정 (필요시)

이미 .env 파일이 있으면 기존 설정을 유지합니다.
수동으로 변경하려면 `.env` 파일을 직접 편집하세요.

---

## 파일 구조

```
deploy/
├── test-launcher.exe       ← 배포용 빌드 (git 추적)
├── version.txt             ← 버전 정보 (커밋, 날짜)
└── README.md               ← 이 파일
```

---

## 버전 확인

`version.txt` 파일에서 현재 배포된 버전 확인:

```
version: 20260206140000
commit: a5bf837c
build_date: 2026-02-06T14:00:00+09:00
launcher: test-launcher
commit_message: feat: Add auto-env setup
```

---

## 트러블슈팅

### 문제 1: Git이 설치되지 않았습니다

**해결:**
1. https://git-scm.com/download/win 에서 Git 다운로드
2. 설치 후 컴퓨터 재시작

### 문제 2: Node.js가 설치되지 않았습니다

**해결:**
1. https://nodejs.org 에서 Node.js LTS 버전 다운로드
2. 설치 후 컴퓨터 재시작

### 문제 3: 런처가 실행 중일 때 업데이트 안 됨

**원인:** Windows는 실행 중인 .exe 파일을 교체할 수 없음

**해결:**
1. `taskkill /F /IM test-launcher.exe`
2. `git pull`
3. `deploy\test-launcher.exe`

### 문제 4: .env 파일이 자동 생성 안 됨

**해결:**
1. 기존 .env 파일이 있는지 확인 (`ls .env`)
2. 수동 생성: `setup-env.bat` 실행
3. 또는 위 "환경변수 설정" 섹션 참고하여 수동 작성

---

## 주의사항

### 1. .exe 파일 크기
- test-launcher.exe: ~36MB
- git history에 추가될 때마다 저장소 크기 증가
- **권장:** 런처 변경이 확정될 때만 커밋

### 2. 바이너리 충돌
- git pull 시 .exe 파일 충돌 가능성
- **해결:** `git reset --hard origin/main`

### 3. 보안
- Supabase anon key는 공개 가능한 키여야 함 (RLS 정책으로 보호)
- 민감한 키는 .env 파일에 저장 (git에 포함 안 됨)

---

## 롤백 방법

이전 버전으로 되돌리기:

```bash
# 1. 이전 버전 확인
git log deploy/test-launcher.exe

# 2. 특정 커밋으로 되돌리기
git checkout <commit-hash> deploy/test-launcher.exe

# 3. 커밋 및 푸시
git commit -m "rollback: Revert test-launcher to <commit-hash>"
git push
```

---

## 지원

문제가 발생하면:
1. `test-launcher.log` 파일 확인 (작업 디렉토리 내부)
2. GitHub Issues에 로그 첨부하여 문의
3. 급한 경우 수동 설치: `npm install && npx patchright install chromium && npx tsx unified-runner-shopping-tab-test.ts`
