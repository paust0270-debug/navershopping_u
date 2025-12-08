/**
 * IP Rotation Module
 *
 * IP 로테이션 기능 (ADB 우선, 네트워크 어댑터 fallback)
 * - ADB: USB 연결된 휴대폰의 모바일 데이터 on/off
 * - Adapter: Windows 네트워크 어댑터 enable/disable
 *
 * 환경변수:
 * - IP_ROTATION_METHOD: adb | adapter | auto | disabled (기본: auto)
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============ 설정 ============
const ADB_DATA_OFF_DELAY = 5000;   // 데이터 끄고 5초 대기
const ADB_DATA_ON_DELAY = 5000;    // 데이터 켜고 5초 대기
const ADAPTER_OFF_DELAY = 3000;    // 어댑터 끄고 3초 대기
const ADAPTER_ON_DELAY = 5000;     // 어댑터 켜고 5초 대기
const IP_CHECK_RETRY = 3;
const IP_CHECK_RETRY_DELAY = 2000;

// ============ 타입 정의 ============
export interface IPRotationResult {
  success: boolean;
  oldIP: string;
  newIP: string;
  method?: "adb" | "adapter" | "skipped";
  error?: string;
}

type RotationMethod = "adb" | "adapter" | "auto" | "disabled";

// ============ 유틸 ============
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  console.log(`[IPRotation] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[IPRotation] [ERROR] ${msg}`);
}

// ============ 설정 로드 ============
function getRotationMethod(): RotationMethod {
  const method = (process.env.IP_ROTATION_METHOD || "auto").toLowerCase();
  if (["adb", "adapter", "auto", "disabled"].includes(method)) {
    return method as RotationMethod;
  }
  return "auto";
}

// ============ IP 확인 ============
export async function getCurrentIP(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = (await response.json()) as { ip: string };
    return data.ip;
  } catch {
    // 백업 API
    try {
      const response = await fetch("https://ifconfig.me/ip");
      return (await response.text()).trim();
    } catch {
      throw new Error("IP 확인 실패: 네트워크 연결 확인 필요");
    }
  }
}

// ============ ADB 관련 ============

/**
 * ADB 기기 상태 확인
 * @returns "device" (정상), "unauthorized" (권한 미허용), null (기기 없음)
 */
async function checkAdbDeviceStatus(): Promise<"device" | "unauthorized" | null> {
  try {
    const { stdout, stderr } = await execAsync("adb devices", {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });

    const lines = stdout.trim().split("\n").slice(1); // 첫 줄 "List of devices attached" 스킵

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const status = parts[1];
        if (status === "device") {
          log(`ADB device connected: ${parts[0]}`);
          return "device";
        } else if (status === "unauthorized") {
          log(`ADB device unauthorized: ${parts[0]} - Please allow USB debugging`);
          return "unauthorized";
        }
      }
    }

    log("No ADB device found");
    return null;
  } catch (e: any) {
    // ADB not installed or not in PATH
    const errMsg = e.message || "";
    if (errMsg.includes("not recognized") || errMsg.includes("not found") || errMsg.includes("ENOENT")) {
      logError("ADB not installed or not in PATH");
    } else {
      logError(`ADB check failed: ${errMsg.substring(0, 100)}`);
    }
    return null;
  }
}

/**
 * ADB로 모바일 데이터 제어
 */
async function setMobileData(enable: boolean): Promise<boolean> {
  try {
    const action = enable ? "ON" : "OFF";
    log(`[ADB] Mobile data ${action}...`);

    const cmd = enable ? "adb shell svc data enable" : "adb shell svc data disable";
    await execAsync(cmd, {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    log(`[ADB] Mobile data ${action} - OK`);
    return true;
  } catch (e: any) {
    logError(`Mobile data ${enable ? "ON" : "OFF"} failed: ${e.message}`);
    return false;
  }
}

/**
 * ADB를 통한 IP 로테이션 (모바일 데이터 on/off)
 */
async function rotateIPWithAdb(oldIP: string): Promise<IPRotationResult> {
  log("Method: ADB (Mobile Data)");

  // 1. 모바일 데이터 끄기
  log("Mobile Data OFF...");
  if (!(await setMobileData(false))) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adb",
      error: "ADB control failed",
    };
  }

  log(`Waiting ${ADB_DATA_OFF_DELAY / 1000}s...`);
  await sleep(ADB_DATA_OFF_DELAY);

  // 2. 모바일 데이터 켜기
  log("Mobile Data ON...");
  if (!(await setMobileData(true))) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adb",
      error: "ADB control failed",
    };
  }

  log(`Waiting for network (${ADB_DATA_ON_DELAY / 1000}s)...`);
  await sleep(ADB_DATA_ON_DELAY);

  // 3. 새 IP 확인
  let newIP = "";
  for (let i = 0; i < IP_CHECK_RETRY; i++) {
    try {
      newIP = await getCurrentIP();
      break;
    } catch {
      log(`IP 확인 재시도 ${i + 1}/${IP_CHECK_RETRY}...`);
      await sleep(IP_CHECK_RETRY_DELAY);
    }
  }

  if (!newIP) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adb",
      error: "새 IP 확인 실패",
    };
  }

  // 4. IP 변경 확인
  if (oldIP === newIP) {
    console.log(`\n${"!".repeat(50)}`);
    console.log(`  [ADB] IP NOT CHANGED: ${oldIP}`);
    console.log(`${"!".repeat(50)}\n`);
    return {
      success: false,
      oldIP,
      newIP,
      method: "adb",
      error: "IP NOT CHANGED",
    };
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  [ADB] IP CHANGED: ${oldIP} -> ${newIP}`);
  console.log(`${"=".repeat(50)}\n`);
  return {
    success: true,
    oldIP,
    newIP,
    method: "adb",
  };
}

// ============ 네트워크 어댑터 관련 ============

/**
 * 테더링 어댑터 감지 (IfIndex 반환)
 */
export async function getTetheringAdapter(): Promise<string | null> {
  try {
    // IfIndex를 반환 (숫자는 인코딩 문제 없음)
    const { stdout: keywordResult } = await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -like '*NDIS*' -or $_.InterfaceDescription -like '*USB*' -or $_.InterfaceDescription -like '*Android*' -or $_.InterfaceDescription -like '*SAMSUNG*' -or $_.InterfaceDescription -like '*Tethering*') } | Select-Object -First 1 -ExpandProperty ifIndex"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );

    if (keywordResult.trim()) {
      const ifIndex = keywordResult.trim();
      log(`테더링 어댑터 감지 (IfIndex: ${ifIndex})`);
      return ifIndex;
    }

    // 방법 2: 이더넷 N (N > 1) 패턴 검색
    const { stdout: ethernetResult } = await execAsync(
      `powershell -NoProfile -Command "$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }; $tethering = $adapters | Where-Object { $_.Name -match '^.+\\s*[2-9]$|^.+\\s*[1-9][0-9]+$' -and $_.Name -notmatch 'Wi-Fi|WiFi|Wireless' }; if ($tethering) { $tethering | Select-Object -First 1 -ExpandProperty ifIndex }"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );

    if (ethernetResult.trim()) {
      const ifIndex = ethernetResult.trim();
      log(`테더링 어댑터 감지 (IfIndex: ${ifIndex})`);
      return ifIndex;
    }

    log("테더링 어댑터를 찾을 수 없음");
    return null;
  } catch (error: any) {
    logError(`어댑터 감지 실패: ${error.message}`);
    return null;
  }
}

/**
 * 어댑터 비활성화
 */
async function disableAdapter(ifIndex: string): Promise<boolean> {
  try {
    log(`어댑터 비활성화 (IfIndex: ${ifIndex})`);
    await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter -InterfaceIndex ${ifIndex} | Disable-NetAdapter -Confirm:$false"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );
    return true;
  } catch (error: any) {
    if (!error.message.includes("already")) {
      logError(`어댑터 비활성화 실패: ${error.message}`);
      return false;
    }
    return true;
  }
}

/**
 * 어댑터 활성화
 */
async function enableAdapter(ifIndex: string): Promise<boolean> {
  try {
    log(`어댑터 활성화 (IfIndex: ${ifIndex})`);
    await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter -InterfaceIndex ${ifIndex} | Enable-NetAdapter -Confirm:$false"`,
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );
    return true;
  } catch (error: any) {
    if (!error.message.includes("already")) {
      logError(`어댑터 활성화 실패: ${error.message}`);
      return false;
    }
    return true;
  }
}

/**
 * 네트워크 어댑터를 통한 IP 로테이션
 */
async function rotateIPWithAdapter(oldIP: string, adapterIndex?: string): Promise<IPRotationResult> {
  log("방식: 네트워크 어댑터");

  // 1. 어댑터 인덱스 확인
  const adapter = adapterIndex || (await getTetheringAdapter());
  if (!adapter) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adapter",
      error: "테더링 어댑터를 찾을 수 없음",
    };
  }

  // 2. 어댑터 비활성화
  if (!(await disableAdapter(adapter))) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adapter",
      error: "어댑터 비활성화 실패",
    };
  }

  log(`${ADAPTER_OFF_DELAY / 1000}초 대기...`);
  await sleep(ADAPTER_OFF_DELAY);

  // 3. 어댑터 활성화
  if (!(await enableAdapter(adapter))) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adapter",
      error: "어댑터 활성화 실패",
    };
  }

  log(`네트워크 재연결 대기 (${ADAPTER_ON_DELAY / 1000}초)...`);
  await sleep(ADAPTER_ON_DELAY);

  // 4. 새 IP 확인
  let newIP = "";
  for (let i = 0; i < IP_CHECK_RETRY; i++) {
    try {
      newIP = await getCurrentIP();
      break;
    } catch {
      log(`IP 확인 재시도 ${i + 1}/${IP_CHECK_RETRY}...`);
      await sleep(IP_CHECK_RETRY_DELAY);
    }
  }

  if (!newIP) {
    return {
      success: false,
      oldIP,
      newIP: "",
      method: "adapter",
      error: "새 IP 확인 실패",
    };
  }

  // 5. IP 변경 확인
  if (oldIP === newIP) {
    log(`[RESULT] IP NOT CHANGED: ${oldIP}`);
    return {
      success: false,
      oldIP,
      newIP,
      method: "adapter",
      error: "IP NOT CHANGED",
    };
  }

  log(`[RESULT] IP CHANGED: ${oldIP} -> ${newIP}`);
  return {
    success: true,
    oldIP,
    newIP,
    method: "adapter",
  };
}

// ============ 통합 IP 로테이션 ============

/**
 * IP 로테이션 (ADB 우선, 어댑터 fallback)
 * @param adapterIndex 네트워크 어댑터 IfIndex (옵션)
 */
export async function rotateIP(adapterIndex?: string): Promise<IPRotationResult> {
  const method = getRotationMethod();

  // 비활성화된 경우
  if (method === "disabled") {
    log("IP 로테이션 비활성화됨 (IP_ROTATION_METHOD=disabled)");
    const currentIP = await getCurrentIP().catch(() => "");
    return {
      success: true,
      oldIP: currentIP,
      newIP: currentIP,
      method: "skipped",
    };
  }

  // 1. 현재 IP 확인
  let oldIP: string;
  try {
    oldIP = await getCurrentIP();
    log(`현재 IP: ${oldIP}`);
  } catch (error: any) {
    return {
      success: false,
      oldIP: "",
      newIP: "",
      error: `현재 IP 확인 실패: ${error.message}`,
    };
  }

  // 2. ADB 방식 시도 (auto 또는 adb 모드)
  if (method === "auto" || method === "adb") {
    const adbStatus = await checkAdbDeviceStatus();

    if (adbStatus === "device") {
      // ADB 기기가 정상적으로 연결됨
      const result = await rotateIPWithAdb(oldIP);
      if (result.success) {
        return result;
      }
      // ADB 실패 시 auto 모드면 어댑터로 fallback
      if (method === "auto") {
        log("ADB 실패, 어댑터 방식으로 전환...");
      } else {
        return result; // adb 모드면 실패 반환
      }
    } else if (adbStatus === "unauthorized") {
      log("ADB 권한 미허용 - 휴대폰에서 USB 디버깅을 허용해주세요");
      if (method === "adb") {
        // adb 모드인데 권한 없음 -> 스킵
        return {
          success: true,
          oldIP,
          newIP: oldIP,
          method: "skipped",
          error: "ADB 권한 미허용",
        };
      }
      // auto 모드면 어댑터로 fallback
      log("어댑터 방식으로 전환...");
    } else {
      // 기기 없음
      if (method === "adb") {
        log("ADB 기기 없음 - IP 로테이션 스킵");
        return {
          success: true,
          oldIP,
          newIP: oldIP,
          method: "skipped",
          error: "ADB 기기 없음",
        };
      }
      // auto 모드면 어댑터로 fallback
    }
  }

  // 3. 어댑터 방식 시도 (auto 또는 adapter 모드)
  if (method === "auto" || method === "adapter") {
    const result = await rotateIPWithAdapter(oldIP, adapterIndex);
    if (result.success) {
      return result;
    }

    // 어댑터도 실패
    if (method === "auto") {
      log("모든 IP 로테이션 방식 실패 - 현재 IP로 계속 진행");
      return {
        success: true,
        oldIP,
        newIP: oldIP,
        method: "skipped",
        error: "모든 방식 실패",
      };
    }

    return result;
  }

  // 여기까지 오면 뭔가 잘못됨
  return {
    success: false,
    oldIP,
    newIP: "",
    error: "알 수 없는 오류",
  };
}

// ============ 기존 API 호환성 ============

/**
 * 테더링 비활성화 (기존 코드 호환)
 */
export async function disableTethering(adapterIndex: string): Promise<void> {
  const success = await disableAdapter(adapterIndex);
  if (!success) {
    throw new Error("테더링 비활성화 실패");
  }
}

/**
 * 테더링 활성화 (기존 코드 호환)
 */
export async function enableTethering(adapterIndex: string): Promise<void> {
  const success = await enableAdapter(adapterIndex);
  if (!success) {
    throw new Error("테더링 활성화 실패");
  }
}
