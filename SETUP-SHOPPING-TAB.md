# 쇼핑탭 러너 설치 가이드

## 1. 시스템 요구사항

- Windows 10/11
- Node.js 18+ 설치
- Chrome 브라우저 설치
- USB 테더링용 안드로이드 폰 (IP 로테이션용)
- Git 설치

---

## 2. 프로젝트 클론

```bash
# 원하는 위치에 클론 (예: D:\Project)
cd D:\Project
git clone https://github.com/mim1012/turafic_update.git
cd turafic_update
```

---

## 3. 환경 설정

### 3.1. .env 파일 생성

프로젝트 루트에 `.env` 파일 생성:

```env
# Supabase Production DB
SUPABASE_PRODUCTION_URL=https://your-project.supabase.co
SUPABASE_PRODUCTION_KEY=your-anon-key

# 장비 식별
EQUIPMENT_NAME=PC-SHOPPING-01

# Claude API (CAPTCHA 해결용)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# IP 로테이션 (자동 감지)
IP_ROTATION_METHOD=auto

# 네트워크 캡처 (옵션)
NETWORK_CAPTURE=false
```

### 3.2. 의존성 설치

```bash
npm install
```

---

## 4. IP 로테이션 설정

### 4.1. USB 테더링 연결

1. 안드로이드 폰을 USB로 PC에 연결
2. 폰 설정 → 네트워크 및 인터넷 → 테더링 → USB 테더링 활성화
3. Windows에서 새 네트워크 어댑터 인식 확인

### 4.2. ADB 설정 (자동 IP 로테이션)

```bash
# ADB 드라이버 설치 (자동으로 설치되어야 함)
# adb devices 명령으로 폰 인식 확인
adb devices
```

**출력 예시:**
```
List of devices attached
R3CR70XXXXXX    device
```

---

## 5. 실행 방법

### 5.1. 로컬 테스트 (1회만)

```bash
# TEST_MODE_ONE_RUN = true로 설정 후
npx tsx unified-runner-shopping-tab.ts
```

### 5.2. 24시간 운영 모드

**방법 1: PM2 사용 (권장)**

```bash
# PM2 전역 설치
npm install -g pm2

# ecosystem.config.js 파일 확인 (이미 있음)

# PM2로 시작
pm2 start ecosystem.config.js --only turafic-shopping-tab

# 상태 확인
pm2 list

# 로그 확인
pm2 logs turafic-shopping-tab

# 재시작
pm2 restart turafic-shopping-tab

# 중지
pm2 stop turafic-shopping-tab

# PC 재부팅 시 자동 시작
pm2 startup
pm2 save
```

**방법 2: 직접 실행 (백그라운드)**

```bash
# PowerShell에서
Start-Process -NoNewWindow -FilePath "npx" -ArgumentList "tsx unified-runner-shopping-tab.ts"
```

**방법 3: 작업 스케줄러 등록**

1. Windows 작업 스케줄러 실행
2. 기본 작업 만들기
3. 트리거: "컴퓨터 시작 시"
4. 작업: `C:\Program Files\nodejs\npx.cmd tsx D:\Project\turafic_update\unified-runner-shopping-tab.ts`

---

## 6. PM2 Ecosystem 설정

`ecosystem.config.js` 파일에 추가:

```javascript
module.exports = {
  apps: [
    {
      name: 'turafic-shopping-tab',
      script: 'npx',
      args: 'tsx unified-runner-shopping-tab.ts',
      cwd: './',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: './logs/shopping-tab-error.log',
      out_file: './logs/shopping-tab-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      }
    }
  ]
};
```

---

## 7. 모니터링

### 7.1. 실시간 로그 확인

```bash
# PM2 사용 시
pm2 logs turafic-shopping-tab --lines 100

# 직접 실행 시 (콘솔 출력 확인)
```

### 7.2. 통계 확인

스크립트는 1분마다 통계를 출력합니다:

```
============================================================
  통계 (15.2분 경과)
============================================================
  총 실행: 45회 | 다음 IP 로테이션까지: 75건
  성공: 38 (84.4%) | CAPTCHA: 2 (4.4%)
  실패: 7 | 현재 IP: 123.45.67.89
  속도: 3.0회/분
============================================================
```

### 7.3. Supabase 대시보드

- `equipment_status` 테이블에서 장비 상태 확인
- `slot_naver` 테이블에서 성공/실패 카운트 확인

---

## 8. 트러블슈팅

### 8.1. IP 로테이션 안됨

```bash
# ADB 연결 확인
adb devices

# 테더링 어댑터 수동 확인
netsh interface show interface
```

### 8.2. Chrome 실행 안됨

```bash
# Chrome 경로 확인
where chrome

# Patchright Chrome 재설치
npx patchright install chrome
```

### 8.3. 작업이 없음

- Supabase `traffic_navershopping` 테이블에 데이터가 있는지 확인
- `slot_type = '네이버쇼핑'` 필터 확인

### 8.4. CAPTCHA 계속 발생

- `ANTHROPIC_API_KEY` 환경변수 확인
- Claude API 잔액 확인
- IP 변경 (수동으로 `rotateIP()` 실행)

---

## 9. 자동 업데이트 (Git Pull)

스크립트는 3분마다 자동으로 Git 업데이트를 확인하고 재시작합니다.

수동으로 업데이트하려면:

```bash
cd D:\Project\turafic_update
git pull origin main
pm2 restart turafic-shopping-tab
```

---

## 10. 중요 파일 위치

| 파일 | 경로 | 설명 |
|------|------|------|
| 메인 러너 | `unified-runner-shopping-tab.ts` | 쇼핑탭 러너 |
| 환경변수 | `.env` | Supabase, API Key 등 |
| PM2 설정 | `ecosystem.config.js` | PM2 프로세스 관리 |
| 프로필 | `profiles/pc_v7.json` | 브라우저 설정 |
| IP 로테이션 | `ipRotation.ts` | IP 변경 로직 |
| CAPTCHA 해결 | `captcha/ReceiptCaptchaSolverPRB.ts` | Claude Vision |

---

## 11. 운영 체크리스트

- [ ] .env 파일 설정 완료
- [ ] Supabase 연결 확인
- [ ] USB 테더링 연결 확인
- [ ] ADB 디바이스 인식 확인
- [ ] Chrome 브라우저 설치 확인
- [ ] PM2 설치 및 설정
- [ ] 로그 폴더 생성 (`logs/`)
- [ ] 테스트 실행 (1회) 성공 확인
- [ ] 24시간 운영 모드 시작
- [ ] 1시간 후 통계 확인
- [ ] equipment_status 테이블 heartbeat 확인

---

## 12. 성능 최적화

### 12.1. 워커 수 조정

`unified-runner-shopping-tab.ts` 파일에서:

```typescript
const PARALLEL_BROWSERS = 4;  // 2 → 4로 변경 (PC 사양에 따라)
```

### 12.2. IP 로테이션 주기 조정

```typescript
const TASKS_PER_ROTATION = 60;  // 120 → 60으로 변경 (더 자주 IP 변경)
```

### 12.3. 메모리 최적화

```bash
# PM2 메모리 제한 설정
pm2 start ecosystem.config.js --max-memory-restart 2G
```

---

## 문의

문제 발생 시 로그 파일과 함께 문의:
- PM2 로그: `logs/shopping-tab-error.log`
- 스크린샷: 브라우저 화면
- 통계 출력: 콘솔 마지막 통계
