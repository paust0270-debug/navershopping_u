# Hybrid Mode Architecture

> 브라우저 + HTTP 하이브리드 실행 모드

## 개요

하이브리드 모드는 **브라우저의 TLS fingerprint**와 **HTTP의 속도**를 결합한 방식입니다.

```mermaid
graph TB
    subgraph "Hybrid Mode"
        BROWSER[🌐 Browser Phase<br/>세션 획득, CAPTCHA 처리]
        HTTP[⚡ HTTP Phase<br/>고속 행동 로그 전송]
        VERIFY[✅ Verify Phase<br/>결과 검증]
    end

    BROWSER -->|cookies, tokens| HTTP
    HTTP -->|logs sent| VERIFY
    VERIFY -->|success| END[완료]
    VERIFY -->|retry| HTTP

    style BROWSER fill:#e3f2fd
    style HTTP fill:#fff8e1
    style VERIFY fill:#e8f5e9
```

---

## 실행 플로우

### 전체 시퀀스

```mermaid
sequenceDiagram
    participant C as Client
    participant PE as PacketEngine
    participant HC as HybridContext
    participant BR as Browser
    participant BF as BrowserFetch
    participant NV as Naver

    rect rgb(227, 242, 253)
        Note over BR: Browser Phase
        C->>PE: run(product)
        PE->>HC: initBrowser()
        HC->>BR: launch(headless: false)
        BR->>NV: GET naver.com
        NV-->>BR: HTML + Set-Cookie
        BR-->>HC: cookies, NID
    end

    rect rgb(255, 248, 225)
        Note over BF: HTTP Phase
        HC->>BF: createFetch(cookies)
        BF->>NV: POST viewProduct
        NV-->>BF: 200 OK
        BF->>NV: POST scroll
        BF->>NV: POST dwell
    end

    rect rgb(232, 245, 233)
        Note over PE: Verify Phase
        PE->>PE: checkSuccess()
        PE-->>C: EngineResult
    end
```

---

## Phase별 상세

### 1. Browser Phase

> 실제 브라우저로 세션 획득

```mermaid
flowchart TB
    START[시작] --> LAUNCH[브라우저 실행]
    LAUNCH --> GOTO[naver.com 접속]
    GOTO --> CHECK{CAPTCHA?}

    CHECK -->|Yes| SOLVE[CAPTCHA 해결]
    SOLVE --> CHECK

    CHECK -->|No| SEARCH[검색 실행]
    SEARCH --> CLICK[상품 클릭]
    CLICK --> EXTRACT[세션 추출]

    EXTRACT --> OUT[cookies, tokens]

    style START fill:#e3f2fd
    style OUT fill:#c8e6c9
```

**획득 데이터:**
```typescript
interface SessionData {
  cookies: Cookie[];      // NID, NACT 등
  nacToken: string;       // NAC 인증 토큰
  userAgent: string;      // 브라우저 UA
  deviceId: string;       // 디바이스 ID
  pageUid: string;        // 페이지 UID
}
```

### 2. HTTP Phase

> Chrome TLS로 고속 로그 전송

```mermaid
flowchart TB
    START[세션 데이터] --> BUILD[요청 빌드]

    subgraph "Parallel Requests"
        BUILD --> VP[viewProduct]
        BUILD --> SC[scroll]
        BUILD --> DW[dwell]
        BUILD --> EX[expose]
    end

    VP --> SEND[BrowserFetch 전송]
    SC --> SEND
    DW --> SEND
    EX --> SEND

    SEND --> RESULT[응답 수집]

    style START fill:#fff8e1
    style RESULT fill:#c8e6c9
```

**BrowserFetch 특징:**
```
✅ Chrome TLS fingerprint 유지
✅ HTTP/2 multiplexing
✅ Connection 재사용
✅ 쿠키 자동 전송
```

### 3. Verify Phase

> 성공 여부 검증

```mermaid
flowchart TB
    RESULT[HTTP 응답] --> CHECK{모든 요청 성공?}

    CHECK -->|Yes| VALID{세션 유효?}
    CHECK -->|No| RETRY{재시도?}

    RETRY -->|Yes| HTTP[HTTP Phase]
    RETRY -->|No| FAIL[실패]

    VALID -->|Yes| SUCCESS[성공]
    VALID -->|No| REFRESH[세션 갱신]

    REFRESH --> HTTP

    style SUCCESS fill:#c8e6c9
    style FAIL fill:#ffcdd2
```

---

## 상태 전이 다이어그램

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> BrowserPhase: start()

    BrowserPhase --> CaptchaSolving: CAPTCHA 감지
    CaptchaSolving --> BrowserPhase: 해결됨
    CaptchaSolving --> Failed: 해결 실패

    BrowserPhase --> HttpPhase: 세션 획득
    BrowserPhase --> Failed: 타임아웃

    HttpPhase --> VerifyPhase: 요청 완료
    HttpPhase --> BrowserPhase: 세션 만료
    HttpPhase --> Failed: 네트워크 에러

    VerifyPhase --> Success: 검증 통과
    VerifyPhase --> HttpPhase: 재시도 필요
    VerifyPhase --> Failed: 검증 실패

    Success --> [*]
    Failed --> [*]
```

---

## 모드별 비교

### Pure Browser Mode

```mermaid
graph LR
    BR[Browser] -->|모든 요청| NV[Naver]

    style BR fill:#e3f2fd
```

| 장점 | 단점 |
|------|------|
| 완벽한 fingerprint | 느림 |
| CAPTCHA 대응 | 리소스 많이 사용 |
| 안정적 | 병렬화 어려움 |

### Pure HTTP Mode

```mermaid
graph LR
    HTTP[HTTP Client] -->|모든 요청| NV[Naver]

    style HTTP fill:#fff8e1
```

| 장점 | 단점 |
|------|------|
| 빠름 | TLS fingerprint 노출 |
| 병렬화 쉬움 | CAPTCHA 대응 불가 |
| 리소스 적음 | 세션 관리 어려움 |

### Hybrid Mode (권장)

```mermaid
graph LR
    BR[Browser] -->|세션 획득| NV[Naver]
    BF[BrowserFetch] -->|로그 전송| NV

    style BR fill:#e3f2fd
    style BF fill:#fff8e1
```

| 장점 | 단점 |
|------|------|
| Chrome TLS 유지 | 구현 복잡 |
| 빠른 로그 전송 | 세션 동기화 필요 |
| CAPTCHA 대응 가능 | 상태 관리 필요 |
| 병렬화 가능 | |

---

## BrowserFetch vs 일반 HTTP

```mermaid
graph TB
    subgraph "일반 HTTP (Node.js fetch)"
        N_TLS[Node.js TLS]
        N_FP[❌ 탐지 가능한 fingerprint]
    end

    subgraph "BrowserFetch (Patchright)"
        C_TLS[Chrome TLS]
        C_FP[✅ 실제 브라우저 fingerprint]
    end

    N_TLS --> N_FP
    C_TLS --> C_FP

    style N_FP fill:#ffcdd2
    style C_FP fill:#c8e6c9
```

### TLS Fingerprint 비교

| 항목 | Node.js fetch | BrowserFetch |
|------|--------------|--------------|
| JA3 Hash | Node.js 고유값 | Chrome 동일 |
| Cipher Suite 순서 | 다름 | Chrome 동일 |
| Extensions | 다름 | Chrome 동일 |
| ALPN | h2, http/1.1 | Chrome 동일 |
| 탐지 위험 | 🔴 높음 | 🟢 낮음 |

---

## 에러 핸들링

```mermaid
flowchart TB
    ERROR[에러 발생] --> TYPE{에러 유형}

    TYPE -->|CAPTCHA| CAP[CaptchaSolver]
    TYPE -->|세션 만료| REFRESH[세션 갱신]
    TYPE -->|네트워크| RETRY[재시도]
    TYPE -->|타임아웃| TIMEOUT[타임아웃 처리]
    TYPE -->|차단| BLOCK[IP 로테이션]

    CAP --> RESUME[재개]
    REFRESH --> RESUME
    RETRY --> RESUME
    TIMEOUT --> FAIL[실패 처리]
    BLOCK --> ROTATE[IP 변경 후 재시도]

    ROTATE --> RESUME
```

---

## 설정 옵션

```typescript
interface HybridConfig {
  // Browser Phase
  headless: boolean;           // false 권장
  browserTimeout: number;      // 30000ms

  // HTTP Phase
  httpTimeout: number;         // 10000ms
  maxConcurrency: number;      // 6

  // CAPTCHA
  captchaSolverEnabled: boolean;
  maxCaptchaRetries: number;   // 2

  // Retry
  retryCount: number;          // 2
  retryDelay: number;          // 1000ms
}
```

---

## Version History

| 날짜 | 버전 | 변경사항 |
|------|------|---------|
| 2024-12-11 | v1.0 | 초기 문서 작성 |
