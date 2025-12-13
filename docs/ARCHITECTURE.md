# Turafic 프로젝트 아키텍처

## 1. 프로젝트 개요

네이버 쇼핑 트래픽 자동화 시스템으로, **Patchright 브라우저**와 **패킷 리플레이** 하이브리드 방식을 사용하여 실제 사용자와 동일한 TLS 핑거프린트를 유지하면서 대량의 요청을 처리합니다.

## 2. 폴더 구조

```
turafic_update/
├── engines-packet/          # 핵심 패킷 엔진
│   ├── analysis/           # 네트워크 분석 도구
│   ├── builders/           # 요청 빌더
│   ├── capture/            # 로그 캡처
│   ├── hybrid/             # 브라우저-HTTP 하이브리드
│   ├── mass-replay/        # 대량 리플레이 시스템
│   ├── rank_checker/       # 순위 체크
│   ├── replay/             # 요청 리플레이
│   ├── session/            # 세션 관리
│   └── verification/       # 검증 도구
├── scripts/                 # 실행 스크립트
│   ├── mass-rotation-runner.ts   # 메인 실행기
│   └── scheduled-runner.ts       # 스케줄러
├── profiles/                # 브라우저 프로필 (20개)
├── captcha/                 # 캡차 솔버
├── engines/                 # 레거시 엔진
├── configs/                 # 설정 프리셋
├── logs/                    # 로그 디렉토리
└── docs/                    # 문서
```

## 3. 핵심 모듈 설명

### 3.1 engines-packet/mass-replay (대량 리플레이)

| 모듈 | 설명 |
|------|------|
| `ProfileManager` | 20개 브라우저 프로필 관리, 일일 사용량 추적 (80회/프로필) |
| `BatchScheduler` | 요청을 배치로 분할, 프로필별 할당 |
| `IdentityGenerator` | 고유 사용자 ID 생성 |
| `RequestBuilder` | HTTP 요청 빌드 |

### 3.2 engines-packet/replay (요청 리플레이)

| 모듈 | 설명 |
|------|------|
| `MultiSendEngine` | 다중 요청 전송 엔진 (핵심) |
| `BrowserFetch` | Chrome TLS 유지하며 fetch 실행 |
| `RequestReplayer` | 단일 요청 리플레이 |
| `TimingSimulator` | 사람같은 타이밍 시뮬레이션 |

### 3.3 engines-packet/capture (로그 캡처)

| 모듈 | 설명 |
|------|------|
| `BehaviorLogCaptor` | 페이지에서 nlog, product-logs 캡처 |

### 3.4 engines-packet/builders (빌더)

| 모듈 | 설명 |
|------|------|
| `BehaviorLogBuilder` | 행동 로그 URL 생성 |
| `ProductLogBuilder` | product-logs POST 요청 빌드 |

### 3.5 scripts/ (실행 스크립트)

| 스크립트 | 설명 |
|----------|------|
| `mass-rotation-runner.ts` | 메인 실행기 - 프로필 로테이션 대량 실행 |
| `scheduled-runner.ts` | PM2 스케줄러 - 정해진 시간에 자동 실행 |

## 4. 아키텍처 다이어그램

```mermaid
flowchart TB
    subgraph Scheduler["스케줄러 (PM2)"]
        SR[scheduled-runner.ts]
    end

    subgraph Runner["메인 실행기"]
        MRR[mass-rotation-runner.ts]
    end

    subgraph MassReplay["대량 리플레이 시스템"]
        PM[ProfileManager<br/>프로필 관리]
        BS[BatchScheduler<br/>배치 스케줄링]
    end

    subgraph Browser["브라우저 레이어"]
        PR[Patchright<br/>Real Chrome]
        P1[Profile 1]
        P2[Profile 2]
        PN[Profile N...]
    end

    subgraph Capture["캡처 시스템"]
        BLC[BehaviorLogCaptor<br/>로그 캡처]
    end

    subgraph Replay["리플레이 엔진"]
        MSE[MultiSendEngine<br/>다중 전송]
        BF[BrowserFetch<br/>Chrome TLS]
    end

    subgraph Builders["빌더"]
        PLB[ProductLogBuilder]
        BLB[BehaviorLogBuilder]
    end

    subgraph NaverAPI["네이버 API"]
        PL[product-logs<br/>POST]
        NL[nlog.naver.com<br/>GET Image]
        CL[nlog.commerce<br/>GET Image]
    end

    SR -->|3시간 간격| MRR
    MRR --> PM
    MRR --> BS
    PM --> PR
    PR --> P1
    PR --> P2
    PR --> PN

    P1 --> BLC
    P2 --> BLC
    PN --> BLC

    BLC -->|템플릿 추출| PLB
    BLC -->|템플릿 추출| BLB

    PLB --> MSE
    BLB --> MSE

    MSE --> BF
    BF -->|Chrome TLS| PL
    BF -->|Image Beacon| NL
    BF -->|Image Beacon| CL
```

## 5. 데이터 흐름

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant R as Runner
    participant PM as ProfileManager
    participant B as Browser
    participant C as Captor
    participant M as MultiSendEngine
    participant N as Naver API

    S->>R: 스케줄 트리거 (3시간마다)
    R->>PM: 프로필 요청
    PM->>B: 프로필 실행 (Patchright)
    B->>B: 네이버 접속 & 상품 검색
    B->>C: 페이지 로그 캡처
    C-->>R: 템플릿 반환 (product-logs, nlog)

    loop 반복 실행 (N회)
        R->>M: 요청 전송 지시
        M->>N: 1. product-logs POST (dwell=0, 최초 1회)
        M->>N: 2. nlog GET (Image Beacon)
        M->>N: 3. commerce GET (Image Beacon)
        Note over R,M: 행동 시뮬레이션 (스크롤, 대기)
        M->>N: 4. product-logs POST (dwell>0)
        M->>N: 5. nlog GET (Image Beacon)
    end

    R->>PM: 프로필 종료
    PM-->>S: 완료 보고
```

## 6. 요청 시퀀스 (봇 탐지 회피)

```mermaid
flowchart LR
    subgraph Initial["초기 (1회만)"]
        A[페이지 로드] --> B[200-600ms 대기]
        B --> C[product-logs POST<br/>dwell=0, scroll=0]
    end

    subgraph Loop["반복 N회"]
        D[nlog GET<br/>Image Beacon]
        E[commerce GET<br/>Image Beacon]
        F[행동 시뮬레이션<br/>스크롤, 대기]
        G[product-logs POST<br/>dwell 누적, scroll>0]
        H[nlog GET<br/>Image Beacon]

        D --> E --> F --> G --> H
        H -->|다음 반복| D
    end

    C --> D
```

## 7. 프로필 로테이션

```mermaid
flowchart TB
    subgraph Profiles["20개 프로필"]
        P1["Profile 1<br/>Windows 1920x1080"]
        P2["Profile 2<br/>Windows 1366x768"]
        P3["Profile 3<br/>Mac 1440x900"]
        P4["..."]
        P20["Profile 20"]
    end

    subgraph Limits["제한"]
        L1["일일 80회/프로필"]
        L2["배치당 40-120회"]
        L3["쿨다운 30초"]
    end

    subgraph Batches["배치 분배 (300회 예시)"]
        B1["Batch 1: 103회<br/>→ Profile 1"]
        B2["Batch 2: 59회<br/>→ Profile 2"]
        B3["Batch 3: 85회<br/>→ Profile 4"]
        B4["Batch 4: 53회<br/>→ Profile 3"]
    end

    P1 --> B1
    P2 --> B2
    P3 --> B4
    P4 --> B3
```

## 8. 스케줄러 구성

```mermaid
gantt
    title 일일 스케줄 (8회/일, 3시간 간격)
    dateFormat HH:mm
    axisFormat %H:%M

    section 스케줄
    실행 1 (00:00)     :a1, 00:00, 10m
    대기               :00:10, 170m
    실행 2 (03:00)     :a2, 03:00, 10m
    대기               :03:10, 170m
    실행 3 (06:00)     :a3, 06:00, 10m
    대기               :06:10, 170m
    실행 4 (09:00)     :a4, 09:00, 10m
    대기               :09:10, 170m
    실행 5 (12:00)     :a5, 12:00, 10m
    대기               :12:10, 170m
    실행 6 (15:00)     :a6, 15:00, 10m
    대기               :15:10, 170m
    실행 7 (18:00)     :a7, 18:00, 10m
    대기               :18:10, 170m
    실행 8 (21:00)     :a8, 21:00, 10m
```

## 9. TLS 핑거프린트 보장

```mermaid
flowchart LR
    subgraph Problem["문제점"]
        N[Node.js fetch] -->|다른 TLS| X[❌ 봇 탐지]
    end

    subgraph Solution["해결책"]
        P[Patchright] -->|Real Chrome| C[Chrome 브라우저]
        C -->|동일 TLS| V[✅ 정상 인식]
    end

    subgraph Method["BrowserFetch 방식"]
        M1[page.evaluate] --> M2[fetch in browser context]
        M2 --> M3[Chrome TLS/JA3 유지]
    end
```

## 10. 주요 설정

### scheduled-runner.ts
```typescript
CONFIG = {
  intervalHours: 3,        // 3시간 간격
  baseCount: 300,          // 기본 요청 수
  variance: 24,            // ±24 랜덤
}
```

### mass-rotation-runner.ts
```typescript
DEFAULT_CONFIG = {
  profile: {
    count: 20,             // 프로필 수
    maxDailyRequests: 80,  // 일일 한도
    cooldownMs: 30000,     // 쿨다운
  },
  batch: {
    minSize: 40,           // 최소 배치
    maxSize: 120,          // 최대 배치
  }
}
```

## 11. 로그 위치

| 로그 | 경로 |
|------|------|
| 스케줄러 로그 | `logs/scheduled/` |
| 실행 결과 | `logs/mass-rotation/` |
| PM2 로그 | `logs/scheduled/pm2-*.log` |

## 12. 빠른 시작

```bash
# 스케줄러 시작 (PM2)
pm2 start ecosystem.config.js

# 수동 테스트 (10회)
npx tsx scripts/mass-rotation-runner.ts --test

# 수동 실행 (300회)
npx tsx scripts/mass-rotation-runner.ts --count 300

# 상태 확인
pm2 list
pm2 logs turafic-scheduler
```
