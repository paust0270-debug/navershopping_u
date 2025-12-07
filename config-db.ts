/**
 * Auto-Updater 설정 모듈
 * 원격 PC에서 환경변수 또는 DB(workerNodes)에서 설정 로드
 *
 * 우선순위: 환경변수 > DB > config.json > 기본값
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

export type NodeType = 'experiment' | 'worker' | 'playwright' | 'prb';

export interface UpdaterConfig {
  nodeType: NodeType;
  nodeId: string;
  hostname: string;
  databaseUrl: string;
  serverUrl?: string;
  githubRawBase: string;
  checkIntervalMs: number;
  localDir: string;
  files: string[];
}

const DEFAULT_CONFIG: Partial<UpdaterConfig> = {
  githubRawBase: 'https://raw.githubusercontent.com/mim1012/turafic_update/main',
  checkIntervalMs: 3 * 60 * 1000,
  localDir: 'C:\\turafic',
  files: [
    'unified-runner.ts',
    'engines/v7_engine.ts',
    'runner/types.ts',
    'ipRotation.ts',
    'profiles/pc_v7.json',
    'parallel-ip-rotation-playwright.ts',
    'version.json'
  ],
};

/**
 * DB에서 노드 설정 가져오기
 */
async function getNodeConfigFromDB(hostname: string): Promise<{ nodeType: NodeType } | null> {
  const controlUrl = process.env.SUPABASE_CONTROL_URL;
  const controlKey = process.env.SUPABASE_CONTROL_KEY;

  if (!controlUrl || !controlKey) {
    console.log('[Config] SUPABASE_CONTROL_URL/KEY 없음, DB 조회 스킵');
    return null;
  }

  try {
    const supabase = createClient(controlUrl, controlKey);

    // hostname으로 노드 찾기
    const { data, error } = await supabase
      .from('workerNodes')
      .select('nodeType')
      .eq('hostname', hostname)
      .single();

    if (error || !data) {
      console.log('[Config] DB에서 노드 못찾음 (' + hostname + '), 기본값 사용');
      return null;
    }

    console.log('[Config] DB에서 노드 설정 로드: ' + hostname + ' -> ' + data.nodeType);
    return { nodeType: data.nodeType as NodeType };
  } catch (e: any) {
    console.log('[Config] DB 조회 실패: ' + e.message);
    return null;
  }
}

/**
 * 설정 로드 (비동기 - DB 조회 포함)
 */
export async function loadConfigAsync(): Promise<UpdaterConfig> {
  const hostname = os.hostname();
  const hostnameNormalized = hostname.toLowerCase().replace(/[^a-z0-9]/g, '-');

  // config.json 파일 읽기
  const configPath = path.join(process.cwd(), 'config.json');
  let fileConfig: Partial<UpdaterConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      console.log('[Config] config.json 로드됨');
    } catch (e) {
      console.warn('[Config] config.json 파싱 실패');
    }
  }

  // DB에서 노드 설정 가져오기
  const dbConfig = await getNodeConfigFromDB(hostname);

  // 우선순위: 환경변수 > DB > config.json > 기본값(prb)
  const nodeType = (
    process.env.NODE_TYPE ||
    dbConfig?.nodeType ||
    fileConfig.nodeType ||
    'prb'
  ) as NodeType;

  const config: UpdaterConfig = {
    nodeType,
    nodeId: process.env.NODE_ID || fileConfig.nodeId || (nodeType + '-' + hostnameNormalized),
    hostname,
    databaseUrl: process.env.DATABASE_URL || fileConfig.databaseUrl || '',
    serverUrl: process.env.SERVER_URL || fileConfig.serverUrl,
    githubRawBase: process.env.GITHUB_RAW_BASE || fileConfig.githubRawBase || DEFAULT_CONFIG.githubRawBase!,
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '') || fileConfig.checkIntervalMs || DEFAULT_CONFIG.checkIntervalMs!,
    localDir: process.env.LOCAL_DIR || fileConfig.localDir || DEFAULT_CONFIG.localDir!,
    files: fileConfig.files || DEFAULT_CONFIG.files!,
  };

  return config;
}

/**
 * 설정 로드 (동기 - 기존 호환)
 */
export function loadConfig(): UpdaterConfig {
  const hostname = os.hostname();
  const hostnameNormalized = hostname.toLowerCase().replace(/[^a-z0-9]/g, '-');

  const configPath = path.join(process.cwd(), 'config.json');
  let fileConfig: Partial<UpdaterConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {}
  }

  const nodeType = (process.env.NODE_TYPE || fileConfig.nodeType || 'prb') as NodeType;

  return {
    nodeType,
    nodeId: process.env.NODE_ID || fileConfig.nodeId || (nodeType + '-' + hostnameNormalized),
    hostname,
    databaseUrl: process.env.DATABASE_URL || fileConfig.databaseUrl || '',
    serverUrl: process.env.SERVER_URL || fileConfig.serverUrl,
    githubRawBase: process.env.GITHUB_RAW_BASE || fileConfig.githubRawBase || DEFAULT_CONFIG.githubRawBase!,
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '') || fileConfig.checkIntervalMs || DEFAULT_CONFIG.checkIntervalMs!,
    localDir: process.env.LOCAL_DIR || fileConfig.localDir || DEFAULT_CONFIG.localDir!,
    files: fileConfig.files || DEFAULT_CONFIG.files!,
  };
}

export function createSampleConfig(targetDir: string): void {
  const sampleConfig = {
    nodeType: 'prb',
    nodeId: 'worker-pc-001',
    localDir: 'C:\\turafic',
    githubRawBase: DEFAULT_CONFIG.githubRawBase,
    checkIntervalMs: DEFAULT_CONFIG.checkIntervalMs,
    files: DEFAULT_CONFIG.files,
  };

  const configPath = path.join(targetDir, 'config.sample.json');
  fs.writeFileSync(configPath, JSON.stringify(sampleConfig, null, 2), 'utf-8');
  console.log('[Config] 샘플 설정 파일 생성됨: ' + configPath);
}

export function printConfig(config: UpdaterConfig): void {
  console.log('\n========================================');
  console.log('  TURAFIC Auto-Updater 설정');
  console.log('========================================');
  console.log('  Hostname: ' + config.hostname);
  console.log('  Node Type: ' + config.nodeType);
  console.log('  Node ID: ' + config.nodeId);
  console.log('  Local Dir: ' + config.localDir);
  console.log('  Update URL: ' + config.githubRawBase);
  console.log('  Check Interval: ' + (config.checkIntervalMs / 1000) + '초');
  console.log('========================================\n');
}
