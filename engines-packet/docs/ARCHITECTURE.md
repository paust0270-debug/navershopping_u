# Packet Engine Architecture

> 네이버 트래픽 탐지 우회를 위한 5계층 구조

## Overview

```mermaid
graph TB
    subgraph "Detection Bypass Layers"
        L1[1. 네트워크 계층<br/>Network Layer]
        L2[2. 브라우저 계층<br/>Browser Layer]
        L3[3. 디바이스 지문 계층<br/>Device Fingerprint Layer]
        L4[4. 세션/쿠키 계층<br/>Session/Cookie Layer]
        L5[5. 행동 계층<br/>Behavior Layer]
    end

    L1 --> L2
    L2 --> L3
    L3 --> L4
    L4 --> L5

    style L1 fill:#e1f5fe
    style L2 fill:#fff3e0
    style L3 fill:#f3e5f5
    style L4 fill:#e8f5e9
    style L5 fill:#fce4ec
```

---

## 1. 네트워크 계층 (Network Layer)

> IP, TLS, 연결 패턴 관련 탐지 요소

```mermaid
graph LR
    subgraph "Network Layer Elements"
        IP[IP 타입<br/>mobile/residential/datacenter]
        TLS[TLS ClientHello<br/>Fingerprint]
        SNI[SNI / ALPN]
        H2[HTTP/2 Frame 패턴]
        KA[Connection 재사용<br/>keep-alive]
        PROXY[프록시 지문<br/>SOCKS/HTTP/Residential]
        RTT[패킷 지연/RTT 패턴]
        ASN[ASN / 지리 기반 점수]
    end
```

### 체크리스트

| 요소 | 설명 | 탐지 위험도 | 대응 방안 |
|------|------|------------|----------|
| IP 타입 | mobile > residential > datacenter 순 신뢰도 | 🔴 높음 | 모바일 테더링 사용 |
| TLS ClientHello | JA3/JA4 fingerprint | 🔴 높음 | Chrome TLS 사용 (BrowserFetch) |
| SNI/ALPN | TLS 확장 필드 | 🟡 중간 | 브라우저 기본값 유지 |
| HTTP/2 Frame | SETTINGS, WINDOW_UPDATE 패턴 | 🟡 중간 | Chrome 기본 패턴 |
| Connection 재사용 | keep-alive 패턴 | 🟢 낮음 | 자연스러운 재사용 |
| 프록시 지문 | X-Forwarded-For 등 | 🔴 높음 | 직접 연결 또는 Residential |
| RTT 패턴 | 네트워크 지연 일관성 | 🟡 중간 | IP 로테이션 주기 조절 |
| ASN/지리 | IP 평판, 위치 | 🟡 중간 | 국내 IP 사용 |

### 관련 파일

```
engines-packet/
├── replay/BrowserFetch.ts      # Chrome TLS 보장
├── verification/TLSVerifier.ts # TLS 검증
└── session/HeaderBuilder.ts    # HTTP/2 헤더
```

---

## 2. 브라우저 계층 (Browser Layer)

> 브라우저 식별 및 자동화 탐지 요소

```mermaid
graph LR
    subgraph "Browser Layer Elements"
        UA[User-Agent]
        CH[sec-ch-ua<br/>Client Hints]
        NAV[navigator.*<br/>전역 값들]
        WEBGL[WebGL fingerprint]
        CANVAS[Canvas fingerprint]
        AUDIO[AudioContext fingerprint]
        HL[headless 여부]
        WD[webdriver 탐지]
        CDP[CDP 패치 탐지]
        VER[버전·엔진 정합성]
    end
```

### 체크리스트

| 요소 | 설명 | 탐지 위험도 | 대응 방안 |
|------|------|------------|----------|
| User-Agent | 브라우저 식별 문자열 | 🟡 중간 | 최신 Chrome UA |
| sec-ch-ua | Client Hints 헤더 | 🔴 높음 | 정확한 버전 일치 필수 |
| navigator.* | platform, hardwareConcurrency 등 | 🟡 중간 | 실제 값 사용 |
| WebGL | GPU 렌더링 fingerprint | 🟢 낮음 | 실제 GPU 사용 |
| Canvas | 2D 렌더링 fingerprint | 🟢 낮음 | 실제 렌더링 |
| AudioContext | 오디오 처리 fingerprint | 🟢 낮음 | 기본값 |
| headless | Headless 모드 탐지 | 🔴 높음 | headless: false |
| webdriver | navigator.webdriver | 🔴 높음 | Patchright/PRB 패치 |
| CDP | DevTools Protocol 탐지 | 🔴 높음 | Patchright/PRB 패치 |
| 버전 정합성 | UA ↔ sec-ch-ua 일치 | 🔴 높음 | 자동 생성 |

### 관련 파일

```
engines-packet/
├── session/HeaderBuilder.ts       # Client Hints 생성
├── session/DeviceIdGenerator.ts   # 디바이스 ID
└── hybrid/HybridContext.ts        # 브라우저 컨텍스트
```

### PRB vs Patchright 차이

| 기능 | PRB | Patchright | 비고 |
|------|-----|------------|------|
| webdriver 패치 | ✅ | ✅ | 동일 |
| CDP 탐지 우회 | ✅ | ✅ | 동일 |
| realCursor | ✅ | ❌ | PRB만 지원 |
| ghost-cursor | ✅ 내장 | ❌ 별도 | PRB 우위 |
| Turnstile 우회 | ✅ | ❌ | PRB만 지원 |
| 안정성 | 🟡 | ✅ | Patchright 우위 |

---

## 3. 디바이스 지문(Entropy) 계층

> 하드웨어/환경 기반 fingerprint 요소

```mermaid
graph LR
    subgraph "Device Fingerprint Elements"
        CPU[CPU 코어/스레드 수]
        GPU[GPU 모델]
        RAM[RAM 용량]
        RES[화면 해상도]
        DPI[화면 DPI/PixelRatio]
        TOUCH[Touch 지원 여부]
        BAT[Battery API]
        SENSOR[Sensor API]
        DIST[플랫폼별 분포 일치도]
    end
```

### 체크리스트

| 요소 | 설명 | 탐지 위험도 | 대응 방안 |
|------|------|------------|----------|
| CPU 코어 | hardwareConcurrency | 🟢 낮음 | 실제 값 (4~16) |
| GPU 모델 | WebGL RENDERER | 🟢 낮음 | 실제 GPU |
| RAM | deviceMemory | 🟢 낮음 | 실제 값 (4~32GB) |
| 해상도 | screen.width/height | 🟡 중간 | 일반적 해상도 |
| DPI | devicePixelRatio | 🟡 중간 | 1 또는 1.25 |
| Touch | maxTouchPoints | 🟢 낮음 | 0 (데스크톱) |
| Battery | getBattery() | 🟢 낮음 | 미지원 또는 실제값 |
| Sensor | DeviceMotion 등 | 🟢 낮음 | 미지원 (데스크톱) |
| 분포 일치도 | 전형적 조합 여부 | 🟡 중간 | 일반적 조합 유지 |

### 관련 파일

```
engines-packet/
├── session/DeviceIdGenerator.ts  # 디바이스 ID 생성
└── types.ts                      # ClientHintsConfig
```

---

## 4. 세션/쿠키 계층 (Session/Cookie Layer)

> 세션 지속성 및 쿠키 패턴 관련 요소

```mermaid
graph LR
    subgraph "Session/Cookie Elements"
        NID[NID 세션 쿠키]
        TS[쿠키 timestamp]
        CYCLE[생성/갱신 주기]
        REF[방문 이력/referer]
        LS[localStorage]
        SS[sessionStorage]
        IDB[IndexedDB]
        PERSIST[세션 지속성]
    end
```

### 체크리스트

| 요소 | 설명 | 탐지 위험도 | 대응 방안 |
|------|------|------------|----------|
| NID 쿠키 | 네이버 세션 쿠키 | 🔴 높음 | 브라우저에서 획득 |
| 쿠키 timestamp | 생성 시간 일관성 | 🟡 중간 | 자연스러운 흐름 |
| 생성/갱신 주기 | 쿠키 라이프사이클 | 🟡 중간 | 실제 패턴 모방 |
| referer 흐름 | 페이지 이동 경로 | 🔴 높음 | 정상 경로 유지 |
| localStorage | 클라이언트 저장소 | 🟢 낮음 | 브라우저 동기화 |
| sessionStorage | 세션 저장소 | 🟢 낮음 | 브라우저 동기화 |
| IndexedDB | 구조화 저장소 | 🟢 낮음 | 브라우저 동기화 |
| 세션 지속성 | 연속 접속 기록 | 🟡 중간 | 프로필 재사용 |

### 관련 파일

```
engines-packet/
├── session/SessionManager.ts      # 세션 상태 관리
├── session/CookieExtractor.ts     # 쿠키 추출/파싱
├── hybrid/BrowserSync.ts          # 브라우저 동기화
└── verification/CookieChainVerifier.ts
```

---

## 5. 행동 계층 (Behavior Layer)

> 사용자 행동 패턴 관련 요소

```mermaid
graph LR
    subgraph "Behavior Layer Elements"
        SCROLL_V[스크롤 속도]
        SCROLL_I[스크롤 간격 패턴]
        SCROLL_D[스크롤 깊이 분포]
        MOUSE_C[마우스 이동 곡률]
        MOUSE_A[마우스 가속도]
        CLICK[클릭 지연/간격]
        DWELL[dwell time]
        NAV[페이지 이동 경로]
        TYPE[입력 타이핑 패턴]
    end
```

### 체크리스트

| 요소 | 설명 | 탐지 위험도 | 대응 방안 |
|------|------|------------|----------|
| 스크롤 속도 | wheel deltaY 크기 | 🟡 중간 | 100~250px 랜덤 |
| 스크롤 간격 | 스크롤 이벤트 간격 | 🟡 중간 | 80~140ms 랜덤 |
| 스크롤 깊이 | 최종 스크롤 위치 | 🟡 중간 | 상품까지 스크롤 |
| 마우스 곡률 | 베지어 곡선 | 🔴 높음 | cubicBezier 사용 |
| 마우스 가속도 | easing 패턴 | 🟡 중간 | easeInOutQuad |
| 클릭 지연 | mousedown~up 간격 | 🟡 중간 | 30~80ms |
| dwell time | 페이지 체류 시간 | 🔴 높음 | 1~3초 랜덤 |
| 페이지 경로 | 검색→상품 흐름 | 🔴 높음 | 정상 경로 유지 |
| 타이핑 패턴 | keydown 간격 | 🟡 중간 | 30~60ms 랜덤 |

### 관련 파일

```
engines-packet/
├── builders/BehaviorLogBuilder.ts  # 행동 로그 생성
├── builders/ProductLogBuilder.ts   # 상품 로그 생성
├── replay/TimingSimulator.ts       # 타이밍 시뮬레이션
└── capture/BehaviorLogCaptor.ts    # 행동 캡처
```

---

## 계층 간 의존성

```mermaid
graph TB
    subgraph "Layer Dependencies"
        N[네트워크]
        B[브라우저]
        D[디바이스]
        S[세션/쿠키]
        BH[행동]
    end

    N -->|TLS/IP| B
    B -->|navigator| D
    B -->|쿠키 획득| S
    S -->|세션 유지| BH
    D -->|fingerprint| S

    subgraph "Output"
        LOG[행동 로그 전송]
    end

    BH --> LOG
    S --> LOG
```

---

## 실행 환경별 차이

### Production (unified-runner.ts)

```
추가 모듈:
- IP Rotation (ipRotation.ts)
- CAPTCHA Solver (ReceiptCaptchaSolverPRB.ts)
- 병렬 브라우저 (PARALLEL_BROWSERS = 4)
- 브라우저 지연 (BROWSER_LAUNCH_DELAY = 3000ms)
```

### Test 환경

```
제외 모듈:
- IP Rotation ❌
- CAPTCHA Solver ❌
- 병렬 브라우저 ❌ (단일 실행)
- 브라우저 지연 ❌

동일 모듈:
- 5계층 탐지 우회 로직 ✅
- 세션 관리 ✅
- 행동 시뮬레이션 ✅
```

---

## Version History

| 날짜 | 버전 | 변경사항 |
|------|------|---------|
| 2024-12-11 | v1.0 | 초기 문서 작성 |
