"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/dotenv/package.json
var require_package = __commonJS({
  "node_modules/dotenv/package.json"(exports2, module2) {
    module2.exports = {
      name: "dotenv",
      version: "16.6.1",
      description: "Loads environment variables from .env file",
      main: "lib/main.js",
      types: "lib/main.d.ts",
      exports: {
        ".": {
          types: "./lib/main.d.ts",
          require: "./lib/main.js",
          default: "./lib/main.js"
        },
        "./config": "./config.js",
        "./config.js": "./config.js",
        "./lib/env-options": "./lib/env-options.js",
        "./lib/env-options.js": "./lib/env-options.js",
        "./lib/cli-options": "./lib/cli-options.js",
        "./lib/cli-options.js": "./lib/cli-options.js",
        "./package.json": "./package.json"
      },
      scripts: {
        "dts-check": "tsc --project tests/types/tsconfig.json",
        lint: "standard",
        pretest: "npm run lint && npm run dts-check",
        test: "tap run --allow-empty-coverage --disable-coverage --timeout=60000",
        "test:coverage": "tap run --show-full-coverage --timeout=60000 --coverage-report=text --coverage-report=lcov",
        prerelease: "npm test",
        release: "standard-version"
      },
      repository: {
        type: "git",
        url: "git://github.com/motdotla/dotenv.git"
      },
      homepage: "https://github.com/motdotla/dotenv#readme",
      funding: "https://dotenvx.com",
      keywords: [
        "dotenv",
        "env",
        ".env",
        "environment",
        "variables",
        "config",
        "settings"
      ],
      readmeFilename: "README.md",
      license: "BSD-2-Clause",
      devDependencies: {
        "@types/node": "^18.11.3",
        decache: "^4.6.2",
        sinon: "^14.0.1",
        standard: "^17.0.0",
        "standard-version": "^9.5.0",
        tap: "^19.2.0",
        typescript: "^4.8.4"
      },
      engines: {
        node: ">=12"
      },
      browser: {
        fs: false
      }
    };
  }
});

// node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "node_modules/dotenv/lib/main.js"(exports2, module2) {
    var fs4 = require("fs");
    var path4 = require("path");
    var os2 = require("os");
    var crypto = require("crypto");
    var packageJson = require_package();
    var version = packageJson.version;
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.log(`[dotenv@${version}][WARN] ${message}`);
    }
    function _debug(message) {
      console.log(`[dotenv@${version}][DEBUG] ${message}`);
    }
    function _log(message) {
      console.log(`[dotenv@${version}] ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs4.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path4.resolve(process.cwd(), ".env.vault");
      }
      if (fs4.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path4.join(os2.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (debug || !quiet) {
        _log("Loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path4.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("No encoding is specified. UTF-8 is used by default");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path5 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs4.readFileSync(path5, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${path5} ${e.message}`);
          }
          lastError = e;
        }
      }
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsedAll, options);
      if (debug || !quiet) {
        const keysCount = Object.keys(parsedAll).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path4.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`Failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injecting env (${keysCount}) from ${shortPaths.join(",")}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config2(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
        }
      }
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config: config2,
      decrypt,
      parse,
      populate
    };
    module2.exports.configDotenv = DotenvModule.configDotenv;
    module2.exports._configVault = DotenvModule._configVault;
    module2.exports._parseVault = DotenvModule._parseVault;
    module2.exports.config = DotenvModule.config;
    module2.exports.decrypt = DotenvModule.decrypt;
    module2.exports.parse = DotenvModule.parse;
    module2.exports.populate = DotenvModule.populate;
    module2.exports = DotenvModule;
  }
});

// unified-runner.ts
var dotenv = __toESM(require_main());
var path3 = __toESM(require("path"));
var fs3 = __toESM(require("fs"));
var os = __toESM(require("os"));
var import_child_process2 = require("child_process");

// pw-version-override.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
if (!process.env.PW_VERSION_OVERRIDE) {
  const tryRead = (base) => {
    const p = path.join(base, "node_modules", "patchright-core", "package.json");
    try {
      const v2 = JSON.parse(fs.readFileSync(p, "utf8"))?.version;
      if (typeof v2 === "string" && v2.length)
        return v2;
    } catch {
    }
    return null;
  };
  const bases = [__dirname, path.resolve(__dirname, "..")];
  let v = null;
  for (const b of bases) {
    v = tryRead(b);
    if (v)
      break;
  }
  process.env.PW_VERSION_OVERRIDE = v || "1.49.1";
}

// unified-runner.ts
var import_patchright = require("patchright");

// ipRotation.ts
var import_child_process = require("child_process");
var import_util = require("util");
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var ADB_DATA_OFF_DELAY = 5e3;
var ADB_DATA_ON_DELAY = 5e3;
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function log(msg) {
  console.log(`[IPRotation] ${msg}`);
}
function logError(msg) {
  console.error(`[IPRotation] [ERROR] ${msg}`);
}
async function getCurrentIP() {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    return data.ip;
  } catch {
    try {
      const response = await fetch("https://ifconfig.me/ip");
      return (await response.text()).trim();
    } catch {
      throw new Error("IP \uD655\uC778 \uC2E4\uD328: \uB124\uD2B8\uC6CC\uD06C \uC5F0\uACB0 \uD655\uC778 \uD544\uC694");
    }
  }
}
async function checkAdbDeviceStatus() {
  try {
    const { stdout, stderr } = await execAsync("adb devices", {
      encoding: "utf8",
      timeout: 1e4,
      windowsHide: true
    });
    const lines = stdout.trim().split("\n").slice(1);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed)
        continue;
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
  } catch (e) {
    const errMsg = e.message || "";
    if (errMsg.includes("not recognized") || errMsg.includes("not found") || errMsg.includes("ENOENT")) {
      logError("ADB not installed or not in PATH");
    } else {
      logError(`ADB check failed: ${errMsg.substring(0, 100)}`);
    }
    return null;
  }
}
async function setMobileData(enable) {
  try {
    const action = enable ? "ON" : "OFF";
    log(`[ADB] Mobile data ${action}...`);
    const cmd = enable ? "adb shell svc data enable" : "adb shell svc data disable";
    await execAsync(cmd, {
      encoding: "utf8",
      timeout: 1e4,
      windowsHide: true
    });
    log(`[ADB] Mobile data ${action} - OK`);
    return true;
  } catch (e) {
    logError(`Mobile data ${enable ? "ON" : "OFF"} failed: ${e.message}`);
    return false;
  }
}
async function toggleAdbMobileDataOffOn(reason, cycles = 1) {
  const status = await checkAdbDeviceStatus();
  if (status !== "device") {
    if (status === "unauthorized") {
      log(`[ADB] ${reason}: \uBBF8\uC778\uC99D \u2014 USB \uB514\uBC84\uAE45 \uD5C8\uC6A9 \uD544\uC694. \uC2A4\uD0B5.`);
    } else {
      log(`[ADB] ${reason}: \uAE30\uAE30 \uC5C6\uC74C \u2014 \uC2A4\uD0B5.`);
    }
    return false;
  }
  let oldIP = "";
  try {
    oldIP = await getCurrentIP();
    log(`[ADB] ${reason}: \uBCC0\uACBD \uC804 IP = ${oldIP}`);
  } catch {
    log(`[ADB] ${reason}: \uBCC0\uACBD \uC804 IP \uD655\uC778 \uC2E4\uD328`);
  }
  const n = Math.max(1, Math.floor(cycles));
  for (let c = 0; c < n; c++) {
    log(`[ADB] ${reason}: \uBAA8\uBC14\uC77C \uB370\uC774\uD130 OFF \u2192 ON (${c + 1}/${n})`);
    if (!await setMobileData(false)) {
      logError(`[ADB] ${reason}: OFF \uC2E4\uD328`);
      return false;
    }
    await sleep(ADB_DATA_OFF_DELAY);
    if (!await setMobileData(true)) {
      logError(`[ADB] ${reason}: ON \uC2E4\uD328`);
      return false;
    }
    await sleep(ADB_DATA_ON_DELAY);
  }
  let newIP = "";
  try {
    newIP = await getCurrentIP();
    log(`[ADB] ${reason}: \uBCC0\uACBD \uD6C4 IP = ${newIP}`);
  } catch {
    log(`[ADB] ${reason}: \uBCC0\uACBD \uD6C4 IP \uD655\uC778 \uC2E4\uD328`);
  }
  if (oldIP && newIP) {
    if (oldIP === newIP) {
      log(`[ADB] ${reason}: IP \uB3D9\uC77C (${oldIP})`);
    } else {
      log(`[ADB] ${reason}: IP \uBCC0\uACBD (${oldIP} -> ${newIP})`);
    }
  }
  log(`[ADB] ${reason}: \uC7AC\uC5F0\uACB0 \uB300\uAE30 \uC644\uB8CC`);
  return true;
}

// engine-config.ts
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));
var CONFIG_CANDIDATES = [
  path2.join(process.cwd(), "engine-config.json"),
  path2.join(__dirname, "engine-config.json")
];
var DEFAULT_DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var DEFAULT_DELAY_SPECS = {
  browserLaunch: 2e3,
  browserLoad: { min: 2500, max: 4e3 },
  portalAfterOpen: { min: 1500, max: 2500 },
  searchFakeClickGap: { min: 800, max: 1200 },
  beforeFirstKeyword: { min: 300, max: 500 },
  firstKeywordTypingDelay: { min: 80, max: 150 },
  afterFirstKeywordType: { min: 500, max: 900 },
  afterFirstSearchLoad: { min: 2e3, max: 3e3 },
  secondSearchField: { min: 300, max: 500 },
  secondKeywordTypingDelay: { min: 80, max: 150 },
  afterSecondKeywordType: { min: 500, max: 800 },
  afterSecondSearchLoad: { min: 2e3, max: 3e3 },
  afterProductClick: 2e3,
  stayOnProduct: { min: 3e3, max: 6e3 },
  explorationBetweenScrolls: { min: 300, max: 500 },
  proxySetup: 3e3,
  taskGapRest: { min: 2e3, max: 3e3 }
};
var MOBILE_CONTEXT_OPTIONS = {
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
  viewport: { width: 400, height: 700 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
  extraHTTPHeaders: {
    "sec-ch-ua": '"Chromium";v="144", "Google Chrome";v="144", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"'
  }
};
function readConfigJson() {
  for (const p of CONFIG_CANDIDATES) {
    if (fs2.existsSync(p)) {
      try {
        const raw = fs2.readFileSync(p, "utf-8");
        return JSON.parse(raw);
      } catch {
        console.warn(`[EngineConfig] \uD30C\uC2F1 \uC2E4\uD328: ${p}`);
      }
    }
  }
  return {};
}
function delayMs(spec, fallback) {
  const s = spec ?? fallback;
  if (typeof s === "number")
    return Math.max(0, s);
  const min = Math.min(s.min, s.max);
  const max = Math.max(s.min, s.max);
  return min + Math.floor(Math.random() * (max - min + 1));
}
function parseSearchFlowVersion(v) {
  if (v === "B" || v === "C" || v === "D" || v === "E" || v === "F")
    return v;
  return "A";
}
function resolveEngineTaskFilePath(file) {
  if (process.env.ENGINE_TASK_FILE?.trim()) {
    const e = process.env.ENGINE_TASK_FILE.trim();
    return path2.isAbsolute(e) ? e : path2.join(process.cwd(), e);
  }
  const p = file.taskSource?.taskFilePath?.trim();
  if (p)
    return path2.isAbsolute(p) ? p : path2.join(process.cwd(), p);
  return path2.join(process.cwd(), "engine-next-task.json");
}
function resolveKeywordBlacklistPath(file) {
  const rel = file.search?.keywordBlacklistFile?.trim();
  const p = rel && rel.length > 0 ? rel : path2.join("data", "keyword-blacklist.json");
  return path2.isAbsolute(p) ? p : path2.join(process.cwd(), p);
}
function resolveEngineResultFilePath(file) {
  if (process.env.ENGINE_RESULT_FILE?.trim()) {
    const r = process.env.ENGINE_RESULT_FILE.trim();
    return path2.isAbsolute(r) ? r : path2.join(process.cwd(), r);
  }
  const p = file.taskSource?.resultFilePath?.trim();
  if (p)
    return path2.isAbsolute(p) ? p : path2.join(process.cwd(), p);
  return path2.join(process.cwd(), "engine-last-result.json");
}
function loadEngineConfig() {
  const file = readConfigJson();
  const mergedDelays = { ...DEFAULT_DELAY_SPECS, ...file.delays || {} };
  const delay = (key) => delayMs(file.delays?.[key], mergedDelays[key] ?? 0);
  const mobileUA = file.userAgents?.mobile?.filter(Boolean) || [];
  const desktopUA = file.userAgents?.desktop?.filter(Boolean) || [];
  return {
    file,
    delay,
    workMode: file.workMode === "desktop" || file.workMode === "random" || file.workMode === "mobile" ? file.workMode : "mobile",
    mobileUserAgents: mobileUA.length > 0 ? mobileUA : [MOBILE_CONTEXT_OPTIONS.userAgent],
    desktopUserAgents: desktopUA.length > 0 ? desktopUA : [DEFAULT_DESKTOP_UA],
    proxyEnabled: !!file.proxy?.enabled && (file.proxy?.entries?.length ?? 0) > 0,
    proxyRotatePerTask: file.proxy?.rotatePerTask !== false,
    proxyEntries: file.proxy?.entries || [],
    maxScrollAttempts: Math.max(1, file.search?.maxScrollAttempts ?? 4),
    explorationScrollPixels: Math.max(100, file.search?.explorationScrollPixels ?? 500),
    keywordBlacklistEnabled: file.search?.keywordBlacklistEnabled !== false,
    keywordBlacklistPath: resolveKeywordBlacklistPath(file),
    searchFlowVersion: parseSearchFlowVersion(file.search?.searchFlowVersion),
    /** 설정 생략 시 기본 false (USB 폰 미연결 환경에서 ADB 오류 방지) */
    airplaneBeforeTask: file.airplaneMode?.toggleBeforeEachTask === true,
    airplaneCycles: Math.max(1, file.airplaneMode?.offOnCycles ?? 1),
    logEngineEvents: file.logging?.engineEvents !== false,
    emptyQueueWaitMs: Math.max(1e3, file.scheduling?.emptyQueueWaitMs ?? 1e4),
    workerStartDelayMs: Math.max(0, file.scheduling?.workerStartDelayMs ?? 3e3),
    engineTaskFilePath: resolveEngineTaskFilePath(file),
    engineResultFilePath: resolveEngineResultFilePath(file),
    naverLoginEnabled: file.naverLoginEnabled === true
  };
}
function resolveMobileForTask(runtime) {
  if (runtime.workMode === "mobile")
    return true;
  if (runtime.workMode === "desktop")
    return false;
  return Math.random() < 0.5;
}
function pickUserAgent(runtime, isMobile) {
  const list = isMobile ? runtime.mobileUserAgents : runtime.desktopUserAgents;
  return list[Math.floor(Math.random() * list.length)] || DEFAULT_DESKTOP_UA;
}
function pickProxyConfig(runtime) {
  if (!runtime.proxyEnabled)
    return void 0;
  const entries = runtime.proxyEntries;
  if (!entries.length)
    return void 0;
  const e = runtime.proxyRotatePerTask ? entries[Math.floor(Math.random() * entries.length)] : entries[0];
  return {
    server: e.server,
    ...e.username ? { username: e.username } : {},
    ...e.password ? { password: e.password } : {}
  };
}
function buildBrowserContextOptions(isMobile, userAgent) {
  if (isMobile) {
    return {
      ...MOBILE_CONTEXT_OPTIONS,
      userAgent
    };
  }
  return {
    viewport: { width: 400, height: 700 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent,
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1
  };
}

// unified-runner.ts
var import_puppeteer_real_browser = require("puppeteer-real-browser");

// captcha/ReceiptCaptchaSolverPRB.ts
var import_sdk = __toESM(require("@anthropic-ai/sdk"));
var ReceiptCaptchaSolverPRB = class {
  constructor(logFn) {
    this.maxRetries = 3;
    this.logFn = logFn || console.log;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.log("ANTHROPIC_API_KEY not set - CAPTCHA solving disabled");
    }
    this.anthropic = new import_sdk.default({
      apiKey: apiKey || "dummy-key"
    });
  }
  log(msg) {
    this.logFn(`[CaptchaSolver] ${msg}`);
  }
  /**
   * CAPTCHA 해결 시도
   * @returns true if solved, false if failed or no CAPTCHA
   */
  async solve(page) {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.log("API key not configured, skipping");
      return false;
    }
    const hasSecurityPage = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return bodyText.includes("\uBCF4\uC548 \uD655\uC778") || bodyText.includes("\uC601\uC218\uC99D") && (bodyText.includes("[?]") || bodyText.includes("\uBB34\uC5C7\uC785\uB2C8\uAE4C") || bodyText.includes("\uBC88\uC9F8 \uC22B\uC790"));
    });
    if (hasSecurityPage) {
      this.log("\uBCF4\uC548 \uD655\uC778 \uD398\uC774\uC9C0 \uAC10\uC9C0\uB428 - CAPTCHA \uC9C8\uBB38 \uB300\uAE30 \uC911...");
      for (let i = 0; i < 10; i++) {
        const hasQuestion = await page.evaluate(() => {
          const bodyText = document.body.innerText || "";
          return bodyText.includes("\uBB34\uC5C7\uC785\uB2C8\uAE4C") || bodyText.includes("[?]") || bodyText.includes("\uBC88\uC9F8 \uC22B\uC790") || bodyText.includes("\uBC88\uC9F8 \uAE00\uC790") || bodyText.includes("\uBE48 \uCE78");
        });
        if (hasQuestion) {
          this.log("CAPTCHA \uC9C8\uBB38 \uAC10\uC9C0\uB428!");
          break;
        }
        await this.delay(1e3);
        this.log(`\uC9C8\uBB38 \uB300\uAE30 \uC911... (${i + 1}/10)`);
      }
    }
    const captchaInfo = await this.detectCaptcha(page);
    if (!captchaInfo.detected) {
      this.log("\uC601\uC218\uC99D CAPTCHA \uC544\uB2D8 - \uB2E4\uB978 \uC720\uD615\uC758 \uBCF4\uC548 \uD398\uC774\uC9C0");
      return false;
    }
    this.log("\uC601\uC218\uC99D CAPTCHA \uAC10\uC9C0\uB428");
    this.log(`\uC9C8\uBB38: ${captchaInfo.question}`);
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.log(`\uD574\uACB0 \uC2DC\uB3C4 ${attempt}/${this.maxRetries}`);
        const receiptImage = await this.captureReceiptImage(page);
        const answer = await this.askClaudeVision(
          receiptImage,
          captchaInfo.question
        );
        this.log(`Claude \uC751\uB2F5: "${answer}"`);
        await this.submitAnswer(page, answer);
        const solved = await this.verifySolved(page);
        if (solved) {
          this.log("CAPTCHA \uD574\uACB0 \uC131\uACF5!");
          return true;
        }
        this.log(`\uC2DC\uB3C4 ${attempt} \uC2E4\uD328, \uC7AC\uC2DC\uB3C4...`);
        await this.delay(1e3);
      } catch (error) {
        this.log(`\uC2DC\uB3C4 ${attempt} \uC5D0\uB7EC: ${error.message}`);
      }
    }
    this.log("\uBAA8\uB4E0 \uC2DC\uB3C4 \uC2E4\uD328");
    return false;
  }
  /**
   * CAPTCHA 페이지 감지
   */
  async detectCaptcha(page) {
    return await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const hasReceiptImage = bodyText.includes("\uC601\uC218\uC99D") || bodyText.includes("\uAC00\uC0C1\uC73C\uB85C \uC81C\uC791");
      const hasQuestion = bodyText.includes("\uBB34\uC5C7\uC785\uB2C8\uAE4C") || bodyText.includes("\uBE48 \uCE78\uC744 \uCC44\uC6CC\uC8FC\uC138\uC694") || bodyText.includes("[?]") || bodyText.includes("\uBC88\uC9F8 \uC22B\uC790");
      const hasSecurityCheck = bodyText.includes("\uBCF4\uC548 \uD655\uC778");
      const isReceiptCaptcha = (hasReceiptImage || hasSecurityCheck) && hasQuestion;
      const isCaptcha = isReceiptCaptcha || hasSecurityCheck || hasReceiptImage;
      if (!isCaptcha) {
        return { detected: false, question: "", questionType: "unknown" };
      }
      let question = "";
      const questionMatch = bodyText.match(/.+무엇입니까\??/);
      if (questionMatch) {
        question = questionMatch[0].trim();
      }
      if (!question) {
        const redElements = Array.from(document.querySelectorAll(
          '[style*="color: rgb(255, 68, 68)"], [style*="color:#ff4444"], [style*="color: red"]'
        ));
        for (const elem of redElements) {
          const text = elem.textContent?.trim();
          if (text && (text.includes("[?]") || text.includes("\uBB34\uC5C7\uC785\uB2C8\uAE4C") || text.includes("\uBC88\uC9F8"))) {
            question = text;
            break;
          }
        }
      }
      if (!question) {
        const match = bodyText.match(/영수증의\s+.+?\s+\[?\?\]?\s*입니다/);
        if (match) {
          question = match[0];
        }
      }
      if (!question) {
        const patterns = [
          /가게\s*위치는\s*.+?\s*\[?\?\]?\s*입니다/,
          /전화번호는\s*.+?\s*\[?\?\]?\s*입니다/,
          /상호명은\s*.+?\s*\[?\?\]?\s*입니다/,
          /.+번째\s*숫자는\s*무엇입니까/,
          /.+번째\s*글자는\s*무엇입니까/
        ];
        for (const pattern of patterns) {
          const m = bodyText.match(pattern);
          if (m) {
            question = m[0];
            break;
          }
        }
      }
      if (!question) {
        question = bodyText.substring(0, 300);
      }
      let questionType = "unknown";
      if (question.includes("\uC704\uCE58") || question.includes("\uC8FC\uC18C") || question.includes("\uAE38")) {
        questionType = "address";
      } else if (question.includes("\uC804\uD654") || question.includes("\uBC88\uD638")) {
        questionType = "phone";
      } else if (question.includes("\uC0C1\uD638") || question.includes("\uAC00\uAC8C \uC774\uB984")) {
        questionType = "store";
      }
      return { detected: true, question, questionType };
    });
  }
  /**
   * 영수증 이미지 캡처
   */
  async captureReceiptImage(page) {
    const selectors = [
      "#rcpt_img",
      ".captcha_img",
      ".captcha_img_cover img",
      'img[alt="\uCEA1\uCC28\uC774\uBBF8\uC9C0"]',
      'img[src*="captcha"]',
      'img[src*="receipt"]',
      ".captcha_image img",
      ".receipt_image img",
      '[class*="captcha"] img',
      '[class*="receipt"] img',
      ".security_check img",
      "#captcha_image"
    ];
    for (const selector of selectors) {
      const imageElement = await page.$(selector);
      if (imageElement) {
        try {
          const buffer2 = await imageElement.screenshot({ encoding: "base64" });
          this.log(`\uC774\uBBF8\uC9C0 \uCEA1\uCC98 \uC131\uACF5: ${selector}`);
          return buffer2;
        } catch {
          continue;
        }
      }
    }
    const captchaAreaSelectors = [
      ".captcha_area",
      '[class*="captcha"]',
      '[class*="security"]',
      ".verify_area"
    ];
    for (const selector of captchaAreaSelectors) {
      const area = await page.$(selector);
      if (area) {
        try {
          const buffer2 = await area.screenshot({ encoding: "base64" });
          this.log(`\uC601\uC5ED \uCEA1\uCC98 \uC131\uACF5: ${selector}`);
          return buffer2;
        } catch {
          continue;
        }
      }
    }
    this.log("\uC804\uCCB4 \uD398\uC774\uC9C0 \uCEA1\uCC98");
    const buffer = await page.screenshot({ encoding: "base64" });
    return buffer;
  }
  /**
   * 응답이 유효한 답인지 검증
   */
  isValidAnswer(answer) {
    const failPatterns = [
      "\uC778\uC2DD\uD560 \uC218 \uC5C6",
      "\uD655\uC778\uD560 \uC218 \uC5C6",
      "\uBCF4\uC774\uC9C0 \uC54A",
      "\uC77D\uC744 \uC218 \uC5C6",
      "\uC54C \uC218 \uC5C6",
      "\uBD88\uBA85\uD655",
      "\uC8C4\uC1A1",
      "sorry",
      "cannot",
      "unable",
      "\uC774\uBBF8\uC9C0"
    ];
    const lowerAnswer = answer.toLowerCase();
    for (const pattern of failPatterns) {
      if (lowerAnswer.includes(pattern))
        return false;
    }
    if (answer.length > 20)
      return false;
    if (answer.length === 0)
      return false;
    return true;
  }
  /**
   * Claude Vision API로 답 추출 (인식 실패 시 재시도)
   */
  async askClaudeVision(imageBase64, question) {
    const hasValidQuestion = question.length > 0 && question.length < 200 && (question.includes("\uBB34\uC5C7\uC785\uB2C8\uAE4C") || question.includes("[?]") || question.includes("\uBC88\uC9F8") || question.includes("\uBE48 \uCE78"));
    const prompt = hasValidQuestion ? `\uC774 \uC601\uC218\uC99D CAPTCHA \uC774\uBBF8\uC9C0\uB97C \uBCF4\uACE0 \uB2E4\uC74C \uC9C8\uBB38\uC5D0 \uB2F5\uD558\uC138\uC694.

\uC9C8\uBB38: ${question}

\uC601\uC218\uC99D\uC5D0\uC11C \uD574\uB2F9 \uC815\uBCF4\uB97C \uCC3E\uC544 [?] \uC704\uCE58\uC5D0 \uB4E4\uC5B4\uAC08 \uB2F5\uB9CC \uC815\uD655\uD788 \uC54C\uB824\uC8FC\uC138\uC694.
- "\uBC88\uC9F8 \uC22B\uC790\uB294 \uBB34\uC5C7\uC785\uB2C8\uAE4C" \uD615\uC2DD\uC774\uBA74: \uC601\uC218\uC99D\uC5D0\uC11C \uD574\uB2F9 \uC22B\uC790\uB97C \uCC3E\uC544 \uB2F5\uD558\uC138\uC694
- \uC8FC\uC18C \uAD00\uB828\uC774\uBA74: \uBC88\uC9C0\uC218\uB098 \uB3C4\uB85C\uBA85 \uBC88\uD638\uB9CC (\uC608: "794")
- \uC804\uD654\uBC88\uD638 \uAD00\uB828\uC774\uBA74: \uD574\uB2F9 \uC22B\uC790\uB9CC (\uC608: "5678")
- \uC0C1\uD638\uBA85 \uAD00\uB828\uC774\uBA74: \uD574\uB2F9 \uD14D\uC2A4\uD2B8\uB9CC

\uB2E4\uB978 \uC124\uBA85 \uC5C6\uC774 \uB2F5\uB9CC \uCD9C\uB825\uD558\uC138\uC694. \uC22B\uC790\uB098 \uD14D\uC2A4\uD2B8\uB9CC \uB2F5\uD558\uC138\uC694.` : `\uC774 \uC774\uBBF8\uC9C0\uB294 \uB124\uC774\uBC84 \uBCF4\uC548 \uD655\uC778(CAPTCHA) \uD398\uC774\uC9C0\uC785\uB2C8\uB2E4.

\uC774\uBBF8\uC9C0\uC5D0\uC11C:
1. \uC9C8\uBB38\uC744 \uCC3E\uC73C\uC138\uC694 (\uC608: "\uAC00\uAC8C \uC804\uD654\uBC88\uD638\uC758 \uB4A4\uC5D0\uC11C 1\uBC88\uC9F8 \uC22B\uC790\uB294 \uBB34\uC5C7\uC785\uB2C8\uAE4C?")
2. \uC601\uC218\uC99D \uC774\uBBF8\uC9C0\uC5D0\uC11C \uD574\uB2F9 \uC815\uBCF4\uB97C \uCC3E\uC73C\uC138\uC694
3. \uC815\uB2F5\uB9CC \uCD9C\uB825\uD558\uC138\uC694

\uB2E4\uB978 \uC124\uBA85 \uC5C6\uC774 \uC815\uB2F5\uB9CC \uCD9C\uB825\uD558\uC138\uC694 (\uC22B\uC790 \uD558\uB098 \uB610\uB294 \uC9E7\uC740 \uD14D\uC2A4\uD2B8).`;
    const maxApiRetries = 3;
    for (let attempt = 1; attempt <= maxApiRetries; attempt++) {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imageBase64
                }
              },
              {
                type: "text",
                text: prompt
              }
            ]
          }
        ]
      });
      const content = response.content[0];
      if (content.type === "text") {
        let answer = content.text.trim();
        answer = answer.replace(/입니다\.?$/, "").trim();
        answer = answer.replace(/^답\s*:\s*/i, "").trim();
        if (this.isValidAnswer(answer)) {
          return answer;
        }
        this.log(`API \uC751\uB2F5 \uBB34\uD6A8 (\uC2DC\uB3C4 ${attempt}/${maxApiRetries}): "${answer}"`);
        if (attempt < maxApiRetries) {
          await this.delay(500);
        }
      }
    }
    throw new Error("Claude Vision\uC774 \uC720\uD6A8\uD55C \uB2F5\uC744 \uBC18\uD658\uD558\uC9C0 \uBABB\uD568");
  }
  /**
   * 답 입력 및 제출
   */
  async submitAnswer(page, answer) {
    const inputSelectors = [
      'input[type="text"]',
      'input[placeholder*="\uC785\uB825"]',
      'input[placeholder*="\uC815\uB2F5"]',
      'input[name*="answer"]',
      'input[id*="answer"]',
      ".captcha_input input",
      "#captcha_answer"
    ];
    let inputFound = false;
    for (const selector of inputSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2e3 });
        const input = await page.$(selector);
        if (input) {
          await input.click();
          await this.delay(100);
          await page.keyboard.down("Control");
          await page.keyboard.press("KeyA");
          await page.keyboard.up("Control");
          await this.delay(50);
          await page.keyboard.press("Backspace");
          await this.delay(100);
        }
        await this.humanType(page, selector, answer);
        inputFound = true;
        this.log(`\uB2F5 \uC785\uB825 \uC644\uB8CC: ${selector}`);
        break;
      } catch {
        continue;
      }
    }
    if (!inputFound) {
      throw new Error("CAPTCHA input field not found");
    }
    await this.delay(500);
    const buttonSelectors = [
      'button:has-text("\uD655\uC778")',
      'input[type="submit"]',
      'button[type="submit"]',
      ".confirm_btn",
      ".submit_btn",
      'button[class*="confirm"]',
      'button[class*="submit"]'
    ];
    for (const selector of buttonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          this.log(`\uD655\uC778 \uBC84\uD2BC \uD074\uB9AD: ${selector}`);
          break;
        }
      } catch {
        continue;
      }
    }
    await page.keyboard.press("Enter");
    await this.delay(2e3);
  }
  /**
   * 사람처럼 타이핑
   */
  async humanType(page, selector, text) {
    const input = await page.$(selector);
    if (!input)
      throw new Error(`Input not found: ${selector}`);
    await input.click();
    await this.delay(150);
    for (const char of text) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
    }
    await this.delay(300);
  }
  /**
   * CAPTCHA 해결 여부 확인
   */
  async verifySolved(page) {
    const stillCaptcha = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return bodyText.includes("\uBE48 \uCE78\uC744 \uCC44\uC6CC\uC8FC\uC138\uC694") || bodyText.includes("\uB2E4\uC2DC \uC785\uB825") || bodyText.includes("\uC624\uB958") || bodyText.includes("\uC601\uC218\uC99D") && bodyText.includes("[?]");
    });
    return !stillCaptcha;
  }
  delay(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
};

// shared/mobile-stealth.ts
var MOBILE_STEALTH_SCRIPT = `
// ============================================================
// \uBAA8\uBC14\uC77C \uC2A4\uD154\uC2A4 \uC2A4\uD06C\uB9BD\uD2B8 - navigator \uBC0F API \uC624\uBC84\uB77C\uC774\uB4DC
// Chrome 144 / Android 14 / SM-S911B (Galaxy S23)
// ============================================================

// 1. navigator.userAgentData \uC624\uBC84\uB77C\uC774\uB4DC (Client Hints API)
Object.defineProperty(navigator, 'userAgentData', {
  get: () => ({
    brands: [
      { brand: 'Chromium', version: '144' },
      { brand: 'Google Chrome', version: '144' },
      { brand: 'Not-A.Brand', version: '99' }
    ],
    mobile: true,
    platform: 'Android',
    getHighEntropyValues: async (hints) => ({
      brands: [
        { brand: 'Chromium', version: '144' },
        { brand: 'Google Chrome', version: '144' },
        { brand: 'Not-A.Brand', version: '99' }
      ],
      mobile: true,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      bitness: '64',
      model: 'SM-S911B',
      uaFullVersion: '144.0.0.0',
      fullVersionList: [
        { brand: 'Chromium', version: '144.0.0.0' },
        { brand: 'Google Chrome', version: '144.0.0.0' },
        { brand: 'Not-A.Brand', version: '99.0.0.0' }
      ]
    }),
    toJSON: function() {
      return {
        brands: this.brands,
        mobile: this.mobile,
        platform: this.platform
      };
    }
  })
});

// 2. navigator.platform \uC624\uBC84\uB77C\uC774\uB4DC
Object.defineProperty(navigator, 'platform', {
  get: () => 'Linux armv81'
});

// 3. navigator.webdriver \uC228\uAE30\uAE30
Object.defineProperty(navigator, 'webdriver', {
  get: () => false
});

// 4. navigator.maxTouchPoints \uC124\uC815 (\uBAA8\uBC14\uC77C)
Object.defineProperty(navigator, 'maxTouchPoints', {
  get: () => 5
});

// 5. navigator.hardwareConcurrency (\uBAA8\uBC14\uC77C \uC218\uC900)
Object.defineProperty(navigator, 'hardwareConcurrency', {
  get: () => 8
});

// 6. navigator.deviceMemory (\uBAA8\uBC14\uC77C \uC218\uC900)
Object.defineProperty(navigator, 'deviceMemory', {
  get: () => 8
});

// 7. navigator.connection \uBAA8\uBC14\uC77C \uC124\uC815
Object.defineProperty(navigator, 'connection', {
  get: () => ({
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
    type: 'cellular',
    addEventListener: () => {},
    removeEventListener: () => {}
  })
});

// 8. screen orientation (portrait)
if (screen.orientation) {
  try {
    Object.defineProperty(screen.orientation, 'type', {
      get: () => 'portrait-primary'
    });
    Object.defineProperty(screen.orientation, 'angle', {
      get: () => 0
    });
  } catch (e) {}
}

// 9. window.chrome \uAC1D\uCCB4 (\uC548\uB4DC\uB85C\uC774\uB4DC \uD06C\uB86C)
window.chrome = {
  runtime: {},
  loadTimes: function() {},
  csi: function() {},
  app: {}
};

// 10. Permissions API \uC218\uC815
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
}

// 11. WebGL Vendor/Renderer \uC2A4\uD478\uD551 (Snapdragon 8 Gen 2)
const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  // UNMASKED_VENDOR_WEBGL
  if (parameter === 37445) {
    return 'Qualcomm';
  }
  // UNMASKED_RENDERER_WEBGL
  if (parameter === 37446) {
    return 'Adreno (TM) 740';
  }
  return getParameterOrig.call(this, parameter);
};

const getParameterOrig2 = WebGL2RenderingContext.prototype.getParameter;
WebGL2RenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) {
    return 'Qualcomm';
  }
  if (parameter === 37446) {
    return 'Adreno (TM) 740';
  }
  return getParameterOrig2.call(this, parameter);
};

// 12. \uBC30\uD130\uB9AC API \uBAA8\uBC14\uC77C\uD654
if (navigator.getBattery) {
  navigator.getBattery = () => Promise.resolve({
    charging: true,
    chargingTime: 0,
    dischargingTime: Infinity,
    level: 0.85 + Math.random() * 0.1,  // 85~95% \uB79C\uB364
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// 13. Playwright \uC804\uC5ED \uBCC0\uC218 \uC81C\uAC70
delete window.__playwright__binding__;
delete window.__pwInitScripts;
`;
async function applyMobileStealth(context) {
  await context.addInitScript(MOBILE_STEALTH_SCRIPT);
}

// rank-check-shopping.ts
var ITEMS_PER_PAGE = 40;
var TITLE_MAX = 300;
var SAFE_DELAY_MS = 1500;
var HYDRATE_SCROLL_TOTAL = 18 * 550;
function microDelay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function humanScroll(page, totalDistance) {
  let scrolled = 0;
  while (scrolled < totalDistance) {
    const scrollAmount = 300 + Math.random() * 300;
    const actualScroll = Math.min(scrollAmount, totalDistance - scrolled);
    await page.evaluate((y) => window.scrollBy(0, y), actualScroll);
    scrolled += actualScroll;
    await microDelay(50 + Math.random() * 100);
    if (Math.random() < 0.03) {
      await microDelay(200 + Math.random() * 300);
    }
  }
}
async function collectVisibleSearchMidDebug(page, limit = 12) {
  return page.evaluate(({ limit: limit2 }) => {
    const cards = Array.from(
      document.querySelectorAll("li._slog_visible, section._slog_visible, div._slog_visible")
    );
    const mids = [];
    const result = [];
    const pushMid = (mid) => {
      if (!mid)
        return;
      if (!mids.includes(mid))
        mids.push(mid);
    };
    for (const card of cards) {
      const anchors = Array.from(card.querySelectorAll("a[href]"));
      const hrefs = [];
      const ids = [];
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (href)
          hrefs.push(href);
        for (const m of [
          href.match(/(?:nv_mid|nvMid)=(\d+)/),
          href.match(/\/main\/products\/(\d+)/),
          href.match(/\/products\/(\d+)/),
          href.match(/searchGate\?[^#]*nv_mid=(\d+)/)
        ]) {
          if (m)
            pushMid(m[1]);
        }
        const aria = a.getAttribute("aria-labelledby") || "";
        const m2 = aria.match(/(?:nstore_productId|view_type_guide)_(\d+)/);
        if (m2)
          pushMid(m2[1]);
      }
      for (const el of Array.from(card.querySelectorAll("[id]"))) {
        const id = el.id || "";
        if (!id)
          continue;
        const nm = id.match(/(?:nstore_productId|view_type_guide)_(\d+)/);
        if (nm)
          pushMid(nm[1]);
        if (ids.length < 4)
          ids.push(id);
      }
      if (!hrefs.length && !ids.length)
        continue;
      const titleEl = card.querySelector('strong span:last-child, [class*="title"], [class*="name"], img[alt]');
      const title = titleEl ? (titleEl.getAttribute?.("alt") || titleEl.textContent || "").trim().replace(/\s+/g, " ") : "";
      result.push({
        tag: card.tagName,
        cls: card.className || null,
        dataSlog: card.getAttribute("data-slog-content"),
        ids,
        hrefs: hrefs.slice(0, 3),
        title: title.slice(0, 140)
      });
      if (result.length >= limit2)
        break;
    }
    return { mids, cards: result };
  }, { limit });
}
async function isShoppingBlocked(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText ?? "";
    return body.includes("\uBCF4\uC548 \uD655\uC778") || body.includes("\uC790\uB3D9 \uC785\uB825 \uBC29\uC9C0") || body.includes("\uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C");
  });
}
function normalizeDetailTitle(raw) {
  return String(raw || "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}
async function extractDetailPageTitle(page) {
  try {
    const title = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
      const stripSuffix = (value) => {
        let text = clean(value);
        text = text.replace(/\s*(?:\||·|:|\-|—)\s*(?:네이버.*|Naver.*|SmartStore.*)$/i, "").trim();
        text = text.replace(/\s*\|\s*$/, "").trim();
        return text;
      };
      const seen = /* @__PURE__ */ new Set();
      const candidates = [];
      const push = (value) => {
        const text = stripSuffix(String(value || ""));
        if (!text || seen.has(text))
          return;
        seen.add(text);
        candidates.push(text);
      };
      push(document.querySelector('meta[property="og:title"]')?.getAttribute("content"));
      push(document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"));
      push(document.querySelector('meta[name="title"]')?.getAttribute("content"));
      push(document.title);
      for (const sel of ["h1", "h2", "h3", "strong"]) {
        document.querySelectorAll(sel).forEach((el) => push(el.textContent));
      }
      for (const text of candidates) {
        if (text.length >= 4) {
          return text;
        }
      }
      return null;
    });
    return title ? normalizeDetailTitle(title) : null;
  } catch {
    return null;
  }
}
var SEARCH_HOST = "search.naver.com";
async function enterNaverShoppingSearch(page, kw, log3, sleepMs) {
  log3("\uB124\uC774\uBC84 \uD1B5\uD569\uAC80\uC0C9 \uC9C4\uC785\u2026");
  try {
    await page.goto(`https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(kw)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45e3
    });
  } catch {
    log3("\uB124\uC774\uBC84 \uD1B5\uD569\uAC80\uC0C9 \uC9C4\uC785 \uC2E4\uD328");
    return false;
  }
  await page.evaluate(() => {
    window.__name = (fn) => fn;
  }).catch(() => {
  });
  await sleepMs(SAFE_DELAY_MS);
  log3("\uD1B5\uD569\uAC80\uC0C9 \uACB0\uACFC \uB300\uAE30 \uC911\u2026");
  if (!page.url().includes(SEARCH_HOST)) {
    log3("\uD1B5\uD569\uAC80\uC0C9 URL \uBBF8\uD655\uC778");
    return false;
  }
  if (await isShoppingBlocked(page)) {
    log3("\uBCF4\uC548/\uCC28\uB2E8 \uD398\uC774\uC9C0 \uAC10\uC9C0");
    return false;
  }
  return true;
}
async function findNaverShoppingRankByMid(page, keyword, targetMid, maxPages, log3, sleepMs) {
  const empty = {
    rank: null,
    reviewCount: null,
    starRating: null,
    productTitle: null,
    catalogMid: null,
    detailUrl: null
  };
  const mid = targetMid.trim();
  const kw = keyword.trim();
  if (!mid || !kw) {
    log3("\uD0A4\uC6CC\uB4DC \uB610\uB294 MID \uBE44\uC5B4 \uC788\uC74C");
    return empty;
  }
  const entered = await enterNaverShoppingSearch(page, kw, log3, sleepMs);
  if (!entered) {
    return empty;
  }
  await page.evaluate(() => {
    window.__name = (fn) => fn;
  }).catch(() => {
  });
  const out = { ...empty };
  let currentPage = 1;
  while (currentPage <= maxPages) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await humanScroll(page, HYDRATE_SCROLL_TOTAL);
    await sleepMs(150);
    const result = await page.evaluate(
      ({ targetId, pageNum, itemsPerPage, titleMax }) => {
        const clip = (s) => {
          const t = s.replace(/\s+/g, " ").trim();
          return t.length > titleMax ? t.substring(0, titleMax) : t;
        };
        const titleFromProductItem = (productItem, fromJson) => {
          if (fromJson && fromJson.trim())
            return clip(fromJson);
          const img = productItem.querySelector(
            'img[src*="shopping-phinf.pstatic.net"], img[src*="shop-phinf.pstatic.net"], img[alt]'
          );
          const alt = img?.getAttribute("alt")?.trim();
          if (alt)
            return clip(alt);
          const titleEl = productItem.querySelector(".product_title__") || productItem.querySelector('[class*="product_title__"]');
          const tx = titleEl?.textContent?.trim();
          return tx ? clip(tx) : null;
        };
        const extractFromProductItem = (productItem) => {
          let reviewCount2 = null;
          let starRating2 = null;
          const reviewElements = productItem.querySelectorAll('.product_etc__Z7jnS, [class*="product_etc__"]');
          for (const elem of reviewElements) {
            const text = elem.textContent || "";
            if (text.includes("\uB9AC\uBDF0")) {
              const reviewMatch = text.match(/리뷰\s*(\d+)|\((\d+(?:,\d+)*)\)/);
              if (reviewMatch) {
                const reviewNum = reviewMatch[1] || reviewMatch[2];
                reviewCount2 = parseInt(reviewNum.replace(/,/g, ""), 10) || null;
                break;
              }
            }
          }
          const starEl = productItem.querySelector(".product_grade__O_5f5") || productItem.querySelector('[class*="product_grade__"]');
          if (starEl) {
            const starText = starEl.textContent?.trim() || "";
            const starMatch = starText.match(/(\d+\.?\d*)/);
            if (starMatch) {
              starRating2 = parseFloat(starMatch[1]) || null;
            }
          }
          return { reviewCount: reviewCount2, starRating: starRating2 };
        };
        const anchors = document.querySelectorAll(
          "a[data-shp-contents-id][data-shp-contents-rank][data-shp-contents-dtl]"
        );
        for (let i = 0; i < anchors.length; i++) {
          const anchor = anchors[i];
          const dtl = anchor.getAttribute("data-shp-contents-dtl");
          const rankStr = anchor.getAttribute("data-shp-contents-rank");
          if (!dtl || !rankStr)
            continue;
          try {
            const normalized = dtl.replace(/&quot;/g, '"');
            const parsed = JSON.parse(normalized);
            if (!Array.isArray(parsed))
              continue;
            let chnlProdNo = null;
            let catalogNvMid = null;
            let prodNm = null;
            for (const item of parsed) {
              if (item.key === "chnl_prod_no" && item.value) {
                chnlProdNo = String(item.value);
              }
              if (item.key === "catalog_nv_mid" && item.value) {
                catalogNvMid = String(item.value);
              }
              if (item.key === "prod_nm" && item.value) {
                prodNm = String(item.value);
              }
            }
            if (chnlProdNo !== targetId && catalogNvMid !== targetId)
              continue;
            const pageRank = parseInt(rankStr, 10);
            const rank2 = (pageNum - 1) * 40 + (Number.isFinite(pageRank) ? pageRank : i + 1);
            const productItem = anchor.closest(".product_item__KQayS") || anchor.closest('[class*="product_item__"]');
            const extra = productItem ? extractFromProductItem(productItem) : { reviewCount: null, starRating: null };
            const productTitle2 = productItem ? titleFromProductItem(productItem, prodNm) : prodNm ? clip(prodNm) : null;
            const catalogMid2 = catalogNvMid || anchor.getAttribute("data-shp-contents-id") || null;
            return {
              found: true,
              rank: rank2,
              reviewCount: extra.reviewCount,
              starRating: extra.starRating,
              productTitle: productTitle2,
              catalogMid: catalogMid2,
              detailUrl: anchor.href || null
            };
          } catch {
          }
        }
        const integratedCards = Array.from(
          document.querySelectorAll("li._slog_visible, li[data-slog-content], div[data-slog-content], article[data-slog-content]")
        );
        for (let i = 0; i < integratedCards.length; i++) {
          const card2 = integratedCards[i];
          const anchor = card2.querySelector("a[href]");
          const href = anchor?.href || "";
          const ids = [
            href.match(/(?:nv_mid|nvMid)=(\d+)/)?.[1] || null,
            href.match(/\/products\/(\d+)/)?.[1] || null,
            card2.id.match(/nstore_productId_(\d+)/)?.[1] || null,
            card2.id.match(/view_type_guide_(\d+)/)?.[1] || null,
            card2.querySelector('[id^="nstore_productId_"]')?.id.match(/nstore_productId_(\d+)/)?.[1] || null,
            card2.querySelector('[id^="view_type_guide_"]')?.id.match(/view_type_guide_(\d+)/)?.[1] || null
          ].filter((v) => Boolean(v));
          if (!ids.includes(targetId))
            continue;
          const pageRank = i + 1;
          const rank2 = (pageNum - 1) * itemsPerPage + pageRank;
          const img = card2.querySelector("img[alt]");
          const alt = img?.getAttribute("alt")?.trim();
          const titleEl = card2.querySelector("strong span:last-child") || card2.querySelector('[class*="title"]') || card2.querySelector('[class*="name"]');
          const productTitle2 = alt || titleEl?.textContent?.trim() || null;
          const catalogMid2 = ids.find((id) => id !== targetId) || targetId;
          return {
            found: true,
            rank: rank2,
            reviewCount: null,
            starRating: null,
            productTitle: productTitle2 ? clip(productTitle2) : null,
            catalogMid: catalogMid2,
            detailUrl: anchor.href || null
          };
        }
        const mids = [];
        const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];
        document.querySelectorAll("a").forEach((a) => {
          const href = a.href || "";
          for (const p of patterns) {
            const hit = href.match(p);
            if (hit && !mids.includes(hit[1])) {
              mids.push(hit[1]);
              break;
            }
          }
        });
        const idx = mids.indexOf(targetId);
        if (idx === -1) {
          return {
            found: false,
            rank: null,
            reviewCount: null,
            starRating: null,
            productTitle: null,
            catalogMid: null,
            detailUrl: null
          };
        }
        const rank = (pageNum - 1) * itemsPerPage + idx + 1;
        let reviewCount = null;
        let starRating = null;
        let productTitle = null;
        const linkEl = document.querySelector(
          `a[href*="/products/${targetId}"], a[href*="products%2F${targetId}"]`
        );
        const container = linkEl?.closest(".product_item__KQayS") || linkEl?.closest('[class*="product_item__"]');
        if (container) {
          const ex = extractFromProductItem(container);
          reviewCount = ex.reviewCount;
          starRating = ex.starRating;
          productTitle = titleFromProductItem(container, null);
        }
        const card = linkEl?.closest("[data-shp-contents-id]") || container?.closest("[data-shp-contents-id]");
        const catalogMid = card?.getAttribute("data-shp-contents-id") || null;
        return { found: true, rank, reviewCount, starRating, productTitle, catalogMid, detailUrl: linkEl?.href || null };
      },
      { targetId: mid, pageNum: currentPage, itemsPerPage: ITEMS_PER_PAGE, titleMax: TITLE_MAX }
    );
    log3(`${currentPage}\uD398\uC774\uC9C0 \uC218\uC9D1: ${result.found ? "\uBC1C\uACAC" : "\uBBF8\uBC1C\uACAC"}`);
    if (!result.found && process.env.NAVERSHOPPING_DEBUG_VISIBLE_MIDS === "1") {
      const debug = await collectVisibleSearchMidDebug(page, 12).catch(() => null);
      if (debug) {
        log3(
          `[DEBUG] visible mids p${currentPage}: ${debug.mids.length ? debug.mids.join(", ") : "(none)"}`,
          "warn"
        );
        debug.cards.slice(0, 8).forEach((card, idx) => {
          log3(
            `[DEBUG] card ${idx + 1}: tag=${card.tag} ids=${card.ids.join("|") || "-"} title=${card.title || "-"}`,
            "warn"
          );
        });
      }
    }
    if (result.found && result.rank != null) {
      out.rank = result.rank;
      out.reviewCount = result.reviewCount;
      out.starRating = result.starRating;
      out.catalogMid = result.catalogMid || null;
      if (result.detailUrl) {
        try {
          await page.goto(result.detailUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45e3
          });
          await sleepMs(SAFE_DELAY_MS);
          out.productTitle = await extractDetailPageTitle(page);
          if (!out.productTitle) {
            log3("\uC0C1\uC138\uD398\uC774\uC9C0 \uC81C\uBAA9 \uCD94\uCD9C \uC2E4\uD328", "warn");
          }
        } catch {
          out.productTitle = null;
        }
      }
      break;
    }
    const nextClicked = await page.evaluate((nextPage) => {
      const selectors = [".pagination_num__B3C28", 'a[class*="pagination"]', 'a[href*="pagingIndex"]'];
      for (const sel of selectors) {
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
          if (btn.textContent?.trim() === String(nextPage)) {
            btn.click();
            return true;
          }
        }
      }
      const nextSelectors = [".pagination_next__pZuC6", 'a[class*="next"]'];
      for (const sel of nextSelectors) {
        const nextBtn = document.querySelector(sel);
        if (nextBtn && !nextBtn.classList.contains("pagination_disabled__qUdaH")) {
          nextBtn.click();
          return true;
        }
      }
      return false;
    }, currentPage + 1);
    if (!nextClicked) {
      log3(`${currentPage}\uD398\uC774\uC9C0\uAE4C\uC9C0 \uD0D0\uC0C9 \uC885\uB8CC(\uB2E4\uC74C \uD398\uC774\uC9C0 \uC5C6\uC74C)`);
      break;
    }
    await sleepMs(2e3);
    await page.evaluate(() => {
      window.__name = (fn) => fn;
    }).catch(() => {
    });
    currentPage++;
  }
  return out;
}

// unified-runner.ts
var getDriveLetter = () => {
  try {
    if (fs3.existsSync("D:\\")) {
      return "D:\\temp";
    }
  } catch (e) {
  }
  return "C:\\turafic\\temp";
};
var TEMP_DIR = getDriveLetter();
try {
  if (!fs3.existsSync(TEMP_DIR)) {
    fs3.mkdirSync(TEMP_DIR, { recursive: true });
  }
  process.env.TEMP = TEMP_DIR;
  process.env.TMP = TEMP_DIR;
  process.env.TMPDIR = TEMP_DIR;
  console.log(`[TEMP] Using: ${TEMP_DIR}`);
} catch (e) {
  console.error(`[TEMP] Failed to create temp dir: ${e.message}`);
  console.error(`[TEMP] Using system default temp dir`);
}
var envPaths = [
  path3.join(process.cwd(), ".env.local"),
  path3.join(process.cwd(), ".env"),
  path3.join(__dirname, ".env"),
  "C:\\turafic\\.env"
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded from: ${envPath}`);
    break;
  }
}
var PARALLEL_BROWSERS = Math.max(1, parseInt(process.env.PARALLEL_BROWSERS || "1", 10));
var ONCE_MODE = process.argv.includes("--once");
var BROWSER_POSITIONS = [
  { x: 0, y: 0 },
  // Worker 1: 좌상단
  { x: 480, y: 0 },
  // Worker 2: 우상단
  { x: 0, y: 540 },
  // Worker 3: 좌하단
  { x: 480, y: 540 }
  // Worker 4: 우하단
];
var BROWSER_WIDTH = 480;
var BROWSER_HEIGHT = 540;
var ENGINE = loadEngineConfig();
function normalizeComboForBlacklist(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function secondComboEntryKey(mid, combo) {
  return `${mid}${normalizeComboForBlacklist(combo)}`;
}
function storedComboFromItem(e) {
  return normalizeComboForBlacklist(e.secondCombo || e.keyword || "");
}
function readKeywordBlacklistItems(filePath) {
  try {
    if (!fs3.existsSync(filePath))
      return [];
    const raw = fs3.readFileSync(filePath, "utf-8");
    const j = JSON.parse(raw);
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}
function isSecondComboBlacklisted(runtime, mid, secondSearchPhrase) {
  if (!runtime.keywordBlacklistEnabled)
    return false;
  const key = secondComboEntryKey(mid, secondSearchPhrase);
  const items = readKeywordBlacklistItems(runtime.keywordBlacklistPath);
  return items.some((e) => secondComboEntryKey(e.mid, storedComboFromItem(e)) === key);
}
async function appendSecondComboBlacklistEntry(runtime, mid, secondSearchPhrase) {
  if (!runtime.keywordBlacklistEnabled)
    return;
  const norm = normalizeComboForBlacklist(secondSearchPhrase);
  if (!mid || !norm)
    return;
  const filePath = runtime.keywordBlacklistPath;
  const dir = path3.dirname(filePath);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const items = readKeywordBlacklistItems(filePath);
      if (items.some(
        (e) => secondComboEntryKey(e.mid, storedComboFromItem(e)) === secondComboEntryKey(mid, norm)
      )) {
        return;
      }
      const next = {
        version: 2,
        items: [
          ...items,
          { mid, secondCombo: norm, addedAt: (/* @__PURE__ */ new Date()).toISOString() }
        ]
      };
      if (!fs3.existsSync(dir)) {
        fs3.mkdirSync(dir, { recursive: true });
      }
      fs3.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
      log2(
        `[KeywordBlacklist] 2\uCC28 \uC870\uD569 \uB4F1\uB85D: mid=${mid} combo="${norm.substring(0, 48)}${norm.length > 48 ? "..." : ""}" \u2192 ${filePath}`
      );
      return;
    } catch (e) {
      await sleep2(30 + Math.floor(Math.random() * 40));
      if (attempt === 9) {
        log2(`[KeywordBlacklist] \uD30C\uC77C \uC800\uC7A5 \uC2E4\uD328: ${e?.message ?? e}`, "warn");
      }
    }
  }
}
var totalRuns = 0;
var totalSuccess = 0;
var totalCaptcha = 0;
var totalFailed = 0;
var sessionStartTime = Date.now();
var currentIP = "";
var isClaimingTask = false;
var GIT_CHECK_INTERVAL = 3 * 60 * 1e3;
var lastCommitHash = "";
function getCurrentCommitHash() {
  try {
    return (0, import_child_process2.execSync)("git rev-parse HEAD", { encoding: "utf8", timeout: 5e3 }).trim();
  } catch {
    return "";
  }
}
function checkForUpdates() {
  try {
    (0, import_child_process2.execSync)("git fetch origin main", { encoding: "utf8", timeout: 3e4 });
    const remoteHash = (0, import_child_process2.execSync)("git rev-parse origin/main", { encoding: "utf8", timeout: 5e3 }).trim();
    const localHash = getCurrentCommitHash();
    if (remoteHash && localHash && remoteHash !== localHash) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
function startGitUpdateChecker() {
  if (process.env.SKIP_GIT_UPDATE_CHECK === "1") {
    log2("Git \uC5C5\uB370\uC774\uD2B8 \uC790\uB3D9 \uD655\uC778 \uC0DD\uB7B5 (SKIP_GIT_UPDATE_CHECK=1)", "info");
    return;
  }
  lastCommitHash = getCurrentCommitHash();
  setInterval(() => {
    if (checkForUpdates()) {
      log2("Git update detected! Restarting to apply changes...", "warn");
      process.exit(0);
    }
  }, GIT_CHECK_INTERVAL);
}
function sleep2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function log2(msg, level = "info") {
  const time = (/* @__PURE__ */ new Date()).toISOString().substring(11, 19);
  const prefix = { info: "[INFO]", warn: "[WARN]", error: "[ERROR]" }[level];
  console.log(`[${time}] ${prefix} ${msg}`);
}
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
function randomKeyDelay() {
  return 30 + Math.random() * 30;
}
var cdpSessions = /* @__PURE__ */ new Map();
async function getCDPSession(page) {
  if (!cdpSessions.has(page)) {
    const client = await page.context().newCDPSession(page);
    cdpSessions.set(page, client);
  }
  return cdpSessions.get(page);
}
async function humanScroll2(page, targetY) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width < 100 || viewport.height < 100) {
    await page.evaluate((y2) => window.scrollBy(0, y2), targetY).catch(() => {
    });
    await sleep2(500);
    return;
  }
  const client = await getCDPSession(page);
  const x = Math.max(50, Math.floor(viewport.width / 2));
  const y = Math.max(50, Math.floor(viewport.height / 2));
  let scrolled = 0;
  while (scrolled < targetY) {
    const step = 100 + Math.random() * 150;
    try {
      await client.send("Input.synthesizeScrollGesture", {
        x,
        y,
        yDistance: -Math.floor(step),
        // 음수 = 아래로 스크롤
        xDistance: 0,
        speed: Math.min(1200, Math.max(600, Math.floor(randomBetween(800, 1200)))),
        // 600~1200 범위 제한
        gestureSourceType: "touch",
        repeatCount: 1,
        repeatDelayMs: 0
      });
    } catch (e) {
      await page.evaluate((s) => window.scrollBy(0, s), step).catch(() => {
      });
    }
    scrolled += step;
    await sleep2(80 + Math.random() * 60);
  }
}
var NAVER_LOGIN_URL = "https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com/";
var NAVER_ACCOUNT_PATHS = [
  path3.join(process.cwd(), "naver-account.txt"),
  path3.join(__dirname, "naver-account.txt")
];
function readNaverAccountFile() {
  let found = null;
  for (const p of NAVER_ACCOUNT_PATHS) {
    if (fs3.existsSync(p)) {
      found = p;
      break;
    }
  }
  if (!found)
    return { status: "absent" };
  const raw = fs3.readFileSync(found, "utf-8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) {
    log2("[NaverLogin] naver-account.txt: \uC544\uC774\uB514\xB7\uBE44\uBC00\uBC88\uD638 2\uC904 \uD544\uC694", "warn");
    return { status: "invalid" };
  }
  return { status: "ok", id: lines[0], pw: lines[1] };
}
async function typeNaverLoginField(page, fieldSelector, value) {
  await page.locator(fieldSelector).click({ force: true });
  await sleep2(randomBetween(200, 400));
  await page.keyboard.press("Control+a");
  await sleep2(40);
  await page.keyboard.press("Backspace");
  await sleep2(80);
  for (const char of value) {
    await page.keyboard.type(char, { delay: randomKeyDelay() });
  }
}
async function ensureNaverLoginIfConfigured(page, workerId) {
  const r = readNaverAccountFile();
  if (r.status === "absent")
    return true;
  if (r.status === "invalid")
    return false;
  const acc = r;
  const masked = acc.id.length <= 4 ? "****" : `${acc.id.slice(0, 2)}\u2026${acc.id.slice(-2)}`;
  log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 (${masked})`);
  try {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
    await sleep2(randomBetween(1e3, 1800));
    await page.locator("#id").waitFor({ state: "visible", timeout: 2e4 });
    await typeNaverLoginField(page, "#id", acc.id);
    await sleep2(randomBetween(400, 700));
    await typeNaverLoginField(page, "#pw", acc.pw);
    await sleep2(randomBetween(500, 900));
    const loginBtn = page.locator("#log\\.login").or(page.locator('button[type="submit"]')).first();
    await loginBtn.click();
    const deadline = Date.now() + 45e3;
    while (Date.now() < deadline) {
      await sleep2(500);
      if (!page.url().includes("nidlogin.login")) {
        await sleep2(randomBetween(1500, 2500));
        log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC644\uB8CC`);
        return true;
      }
    }
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uD0C0\uC784\uC544\uC6C3 (\uB85C\uADF8\uC778 \uD398\uC774\uC9C0 \uC774\uD0C8 \uC5C6\uC74C)`, "warn");
    return false;
  } catch (e) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC608\uC678: ${e.message}`, "warn");
    return false;
  }
}
async function ensureNaverLoginPrbPage(page, workerId) {
  const r = readNaverAccountFile();
  if (r.status === "absent")
    return true;
  if (r.status === "invalid")
    return false;
  const acc = r;
  const masked = acc.id.length <= 4 ? "****" : `${acc.id.slice(0, 2)}\u2026${acc.id.slice(-2)}`;
  log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 PRB (${masked})`);
  try {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
    await sleep2(randomBetween(1e3, 1800));
    await page.waitForSelector("#id", { visible: true, timeout: 2e4 });
    await page.click("#id", { clickCount: 3 });
    await page.keyboard.type(acc.id, { delay: randomKeyDelay() });
    await sleep2(randomBetween(400, 700));
    await page.waitForSelector("#pw", { visible: true, timeout: 1e4 });
    await page.click("#pw", { clickCount: 3 });
    await page.keyboard.type(acc.pw, { delay: randomKeyDelay() });
    await sleep2(randomBetween(500, 900));
    const loginClicked = await page.evaluate(() => {
      const el = document.getElementById("log.login");
      if (el) {
        el.click();
        return true;
      }
      const s = document.querySelector('button[type="submit"]');
      if (s) {
        s.click();
        return true;
      }
      return false;
    });
    if (!loginClicked) {
      log2(`[Worker ${workerId}] \uB85C\uADF8\uC778 \uBC84\uD2BC \uC5C6\uC74C(PRb)`, "warn");
      return false;
    }
    const deadline = Date.now() + 45e3;
    while (Date.now() < deadline) {
      await sleep2(500);
      if (!page.url().includes("nidlogin.login")) {
        await sleep2(randomBetween(1500, 2500));
        log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC644\uB8CC`);
        return true;
      }
    }
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uD0C0\uC784\uC544\uC6C3(PRb)`, "warn");
    return false;
  } catch (e) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC608\uC678(PRb): ${e.message}`, "warn");
    return false;
  }
}
function cleanupChromeTempFolders() {
  const tempDirs = ["D:\\temp", "D:\\tmp"];
  let totalCleaned = 0;
  for (const tempDir of tempDirs) {
    if (!fs3.existsSync(tempDir))
      continue;
    try {
      const entries = fs3.readdirSync(tempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (entry.name.startsWith("puppeteer_") || entry.name.startsWith("lighthouse") || entry.name.startsWith("chrome_") || entry.name.startsWith(".org.chromium.") || entry.name.startsWith("scoped_dir"))) {
          const folderPath = path3.join(tempDir, entry.name);
          try {
            fs3.rmSync(folderPath, { recursive: true, force: true });
            totalCleaned++;
          } catch {
          }
        }
      }
    } catch {
    }
  }
  if (totalCleaned > 0) {
    log2(`Temp \uD3F4\uB354 \uC815\uB9AC: ${totalCleaned}\uAC1C \uC0AD\uC81C`);
  }
}
function loadProfile(profileName) {
  const profilePath = path3.join(__dirname, "profiles", `${profileName}.json`);
  if (fs3.existsSync(profilePath)) {
    const content = fs3.readFileSync(profilePath, "utf-8");
    return JSON.parse(content);
  }
  return {
    name: profileName,
    prb_options: {
      headless: false,
      turnstile: true
    }
  };
}
function extractMidFromLinkUrl(linkUrl) {
  if (!linkUrl || typeof linkUrl !== "string")
    return null;
  const m = linkUrl.match(/\/products\/(\d+)/);
  return m ? m[1] : null;
}
function toCombinedKeyword(fullTitle) {
  return (fullTitle || "").replace(/\s+/g, "").trim() || "\uC0C1\uD488";
}
var SECOND_SEARCH_TAIL_WORDS = ["\uD310\uB9E4", "\uCD5C\uC800\uAC00", "\uCD5C\uC800", "\uAD6C\uB9E4", "\uBE44\uAD50", "\uD310\uB9E4\uCC98", "\uCD94\uCC9C", "\uAC00\uACA9", "\uAD6C\uB9E4\uCC98", "\uAC00\uACA9\uBE44\uAD50"];
function buildSecondSearchPhrase(firstKeyword, keywordName) {
  const part1 = (firstKeyword || "").trim() || "\uC0C1\uD488";
  const firstWords = new Set(
    part1.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  );
  const nameWords = (keywordName || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).filter((w) => !firstWords.has(w));
  const part2 = nameWords.length > 0 ? nameWords[Math.floor(Math.random() * nameWords.length)] : part1;
  const part3 = SECOND_SEARCH_TAIL_WORDS[Math.floor(Math.random() * SECOND_SEARCH_TAIL_WORDS.length)];
  const parts = [part1, part2, part3];
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }
  return parts.join(" ");
}
function pickSecondSearchPhraseAvoidingBlacklist(engine, mid, firstKeyword, keywordName, workerId) {
  if (!engine.keywordBlacklistEnabled) {
    return buildSecondSearchPhrase(firstKeyword, keywordName);
  }
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const phrase = buildSecondSearchPhrase(firstKeyword, keywordName);
    if (!isSecondComboBlacklisted(engine, mid, phrase)) {
      if (t > 0) {
        log2(
          `[Worker ${workerId}] [KeywordBlacklist] 2\uCC28 \uC870\uD569 ${t + 1}\uBC88\uC9F8 \uC2DC\uB3C4\uB85C \uCC44\uD0DD: "${phrase.substring(0, 50)}${phrase.length > 50 ? "..." : ""}"`
        );
      }
      return phrase;
    }
  }
  const fallback = buildSecondSearchPhrase(firstKeyword, keywordName);
  log2(
    `[Worker ${workerId}] [KeywordBlacklist] 2\uCC28 \uC870\uD569 \uBE14\uB799 \uC2DC\uB3C4 \uB2E4\uC218 \u2014 \uC784\uC758 \uC870\uD569 \uC0AC\uC6A9: "${fallback.substring(0, 50)}${fallback.length > 50 ? "..." : ""}"`,
    "warn"
  );
  return fallback;
}
var usedCombinedKeywordsToday = /* @__PURE__ */ new Set();
var usedShuffledPhrasesToday = /* @__PURE__ */ new Set();
var lastUsedDate = "";
function resetUsedKeywordsIfNewDay() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (lastUsedDate !== today) {
    usedCombinedKeywordsToday.clear();
    usedShuffledPhrasesToday.clear();
    lastUsedDate = today;
  }
}
function isCombinedKeywordUsedToday(combined) {
  return usedCombinedKeywordsToday.has(combined);
}
function markCombinedKeywordUsedToday(combined) {
  usedCombinedKeywordsToday.add(combined);
}
function tryClaimWorkItemFromEngineFile() {
  const filePath = ENGINE.engineTaskFilePath;
  const processingPath = `${filePath}.processing`;
  try {
    fs3.renameSync(filePath, processingPath);
  } catch {
    return null;
  }
  let raw;
  try {
    raw = fs3.readFileSync(processingPath, "utf-8");
  } catch {
    try {
      fs3.unlinkSync(processingPath);
    } catch {
    }
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    log2(`[EngineFile] JSON \uD30C\uC2F1 \uC2E4\uD328: ${processingPath}`, "warn");
    try {
      fs3.unlinkSync(processingPath);
    } catch {
    }
    return null;
  }
  const keyword = (data.keyword || "").trim();
  const linkUrl = (data.linkUrl || data.link_url || data.url || "").trim();
  const slotSequence = Math.floor(Number(data.slotSequence ?? data.slot_sequence ?? 0));
  const keywordNameRaw = (data.secondKeyword ?? data.second_keyword ?? data.keywordName ?? data.keyword_name ?? "").trim();
  if (!keyword || !linkUrl) {
    log2(`[EngineFile] keyword\xB7linkUrl \uD544\uC218 \u2014 \uCC98\uB9AC\uBCF8 \uC0AD\uC81C`, "warn");
    try {
      fs3.unlinkSync(processingPath);
    } catch {
    }
    return null;
  }
  const mid = extractMidFromLinkUrl(linkUrl);
  if (!mid) {
    log2(`[EngineFile] linkUrl\uC5D0\uC11C mid \uCD94\uCD9C \uBD88\uAC00 \u2014 ${linkUrl}`, "warn");
    try {
      fs3.unlinkSync(processingPath);
    } catch {
    }
    return null;
  }
  const keywordName = keywordNameRaw || keyword;
  const productName = keywordName;
  if (!keywordNameRaw) {
    log2(`[EngineFile] 2\uCC28 \uD0A4\uC6CC\uB4DC \uC0DD\uB7B5 \u2014 \uB9E4\uCE6D\xB72\uCC28 \uAC80\uC0C9\uC5D0 keyword \uC0AC\uC6A9`, "warn");
  }
  if (process.env.ENGINE_BLOCK_DAILY_COMBINED === "1") {
    resetUsedKeywordsIfNewDay();
    const combined = toCombinedKeyword(productName);
    if (isCombinedKeywordUsedToday(combined)) {
      log2(
        `[EngineFile] \uB2F9\uC77C \uB3D9\uC77C \uC870\uD569\uD615 \uC774\uBBF8 \uCC98\uB9AC\uB428 \u2014 \uD30C\uC77C \uBCF5\uAD6C \uD6C4 \uC2A4\uD0B5: ${combined.substring(0, 36)}...`,
        "warn"
      );
      try {
        fs3.renameSync(processingPath, filePath);
      } catch {
        try {
          fs3.unlinkSync(processingPath);
        } catch {
        }
      }
      return null;
    }
    markCombinedKeywordUsedToday(combined);
  }
  try {
    fs3.unlinkSync(processingPath);
  } catch {
  }
  const taskId = Date.now();
  log2(
    `[EngineFile] \uC791\uC5C5 \uC218\uB77D: 1\uCC28="${keyword.substring(0, 24)}..." slot_sequence=${slotSequence || 0} mid=${mid}`
  );
  const catalogMid = (data.catalogMid || "").trim() || void 0;
  return {
    taskId,
    slotSequence,
    keyword,
    productName,
    mid,
    linkUrl,
    keywordName,
    secondKeywordRaw: keywordNameRaw.length > 0 ? keywordNameRaw : void 0,
    catalogMid
  };
}
async function claimWorkItem() {
  while (isClaimingTask) {
    await sleep2(100);
  }
  isClaimingTask = true;
  try {
    return tryClaimWorkItemFromEngineFile();
  } catch (e) {
    log2(`[CLAIM ERROR] ${e.message}`, "error");
    return null;
  } finally {
    isClaimingTask = false;
  }
}
function shouldBlacklistSecondComboAfterRun(r) {
  if (r.productPageEntered)
    return false;
  return r.failReason === "NO_MID_MATCH" || r.failReason === "DETAIL_NOT_REACHED";
}
function writeEngineTaskResult(work, result) {
  const okTraffic = result.productPageEntered;
  const okRank = !!result.rankCheckOk;
  const payload = {
    ok: result.rankCheckMode ? okRank : okTraffic,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    mode: result.rankCheckMode ? "rankCheck" : "traffic",
    task: {
      taskId: work.taskId,
      keyword: work.keyword,
      linkUrl: work.linkUrl,
      slotSequence: work.slotSequence,
      keywordName: work.keywordName ?? null,
      productName: work.productName,
      mid: work.mid
    },
    secondSearchPhraseUsed: result.secondSearchPhraseUsed ?? null,
    productPageEntered: result.productPageEntered,
    captchaDetected: result.captchaDetected,
    captchaSolved: result.captchaSolved,
    midMatched: result.midMatched,
    failReason: result.failReason ?? null,
    error: result.error ?? null,
    rankCheckMode: !!result.rankCheckMode,
    rankCheckOk: !!result.rankCheckOk,
    shoppingRank: result.shoppingRank ?? null,
    reviewCount: result.reviewCount ?? null,
    starRating: result.starRating ?? null,
    extractedProductTitle: result.extractedProductTitle ?? null,
    catalogMid: result.catalogMid ?? null
  };
  try {
    fs3.writeFileSync(ENGINE.engineResultFilePath, JSON.stringify(payload, null, 2), "utf-8");
    log2(`[EngineFile] \uACB0\uACFC \uC800\uC7A5: ${ENGINE.engineResultFilePath} ok=${payload.ok}`);
  } catch (e) {
    log2(`[EngineFile] \uACB0\uACFC \uD30C\uC77C \uAE30\uB85D \uC2E4\uD328: ${e.message}`, "warn");
  }
}
async function runShoppingRankCheck(page, work, workerId, engine) {
  const result = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false,
    rankCheckMode: true,
    rankCheckOk: false,
    shoppingRank: null
  };
  try {
    const kw = work.keyword.trim();
    const mid = work.mid;
    const maxPages = 15;
    log2(`[Worker ${workerId}] D\uBAA8\uB4DC \uC21C\uC704\uCCB4\uD06C: "${kw.substring(0, 40)}..." mid=${mid} (\uCD5C\uB300 ${maxPages}\uD398\uC774\uC9C0)`);
    const detail = await findNaverShoppingRankByMid(
      page,
      kw,
      mid,
      maxPages,
      (m) => log2(`[Worker ${workerId}] ${m}`),
      sleep2
    );
    if (detail.rank != null && detail.rank > 0) {
      result.shoppingRank = detail.rank;
      result.reviewCount = detail.reviewCount;
      result.starRating = detail.starRating;
      result.extractedProductTitle = detail.productTitle?.trim() || null;
      result.catalogMid = detail.catalogMid || null;
      result.rankCheckOk = true;
      result.midMatched = true;
      log2(
        `[Worker ${workerId}] \uC21C\uC704: ${detail.rank}\uC704` + (detail.reviewCount != null ? ` | \uB9AC\uBDF0 ${detail.reviewCount}` : "") + (detail.starRating != null ? ` | \uBCC4 ${detail.starRating}` : "") + (result.extractedProductTitle ? ` | \uC81C\uBAA9 "${result.extractedProductTitle.substring(0, 36)}${result.extractedProductTitle.length > 36 ? "\u2026" : ""}"` : "")
      );
    } else {
      result.failReason = "NO_MID_MATCH";
      result.error = "\uC21C\uC704\uAD8C_\uBBF8\uBC1C\uACAC";
      log2(`[Worker ${workerId}] \uC21C\uC704\uAD8C \uB0B4 MID \uC5C6\uC74C`, "warn");
    }
  } catch (e) {
    result.error = e?.message || "Unknown";
    result.failReason = "TIMEOUT";
    log2(`[Worker ${workerId}] \uC21C\uC704\uCCB4\uD06C \uC608\uC678: ${result.error}`, "warn");
  }
  return result;
}
function generateAckey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 8; i++)
    r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}
function pickQueryWords(keyword, productName) {
  const tails = ["\uCD94\uCC9C", "\uD560\uC778", "\uD6C4\uAE30", "\uC778\uAE30", "\uBCA0\uC2A4\uD2B8", "\uAD6C\uB9E4", "\uC1FC\uD551", "\uD2B9\uAC00", "\uC138\uC77C", "\uAC00\uC131\uBE44", "\uCD5C\uC800\uAC00", "\uC815\uD488"];
  const allText = `${keyword} ${productName}`.replace(/[\[\](){}]/g, " ").replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, " ");
  const pool = [...new Set(allText.split(/\s+/).filter((w) => w.length >= 2))];
  for (let j = pool.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pool[j], pool[k]] = [pool[k], pool[j]];
  }
  const selected = [];
  for (const w of pool) {
    if (selected.length >= 3)
      break;
    selected.push(w);
  }
  while (selected.length < 3) {
    const avail = tails.filter((t) => !selected.includes(t));
    if (!avail.length)
      break;
    selected.push(avail[Math.floor(Math.random() * avail.length)]);
  }
  return selected.slice(0, 3).join(" ");
}
function buildAckeySearchUrl(query) {
  const p = new URLSearchParams({
    sm: "mtp_sug.top",
    where: "m",
    query,
    ackey: generateAckey(),
    acq: query,
    acr: String(Math.floor(Math.random() * 9) + 1),
    qdt: "0"
  });
  return `https://m.search.naver.com/search.naver?${p.toString()}`;
}
function buildIntegratedSearchUrl(query) {
  const p = new URLSearchParams({
    where: "m",
    query
  });
  return `https://m.search.naver.com/search.naver?${p.toString()}`;
}
async function runPatchrightEngine(page, mid, productName, keyword, workerId, engine, keywordName, secondKeywordRaw, catalogMid) {
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log2(`[Worker ${workerId}] ${msg}`));
  const result = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };
  const flow = engine.searchFlowVersion;
  const flowLabel = flow === "A" ? "A \uD1B5\uD5691+2\uCC28" : flow === "B" ? "B \uD1B5\uD569\uBA54\uC778" : flow === "C" ? "C \uD1B5\uD5692\uCC28" : flow === "E" ? "E ackey\uC704\uC7A5URL" : flow === "F" ? "F \uD1B5\uD569\uC0C1\uD488\uBA85" : flow;
  try {
    const firstKeyword = (keyword || "").trim() || "\uC0C1\uD488";
    log2(`[Worker ${workerId}] \uAC80\uC0C9 \uC2DC\uC791 (\uC791\uC5C5 \uBAA8\uB4DC: ${flowLabel})`);
    if (flow === "E") {
      const query = pickQueryWords(firstKeyword, productName);
      const searchUrl = buildAckeySearchUrl(query);
      log2(`[Worker ${workerId}] E\uBAA8\uB4DC ackey URL: query="${query}"`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 6e4 });
      await sleep2(engine.delay("afterFirstSearchLoad"));
      result.secondSearchPhraseUsed = query;
    } else if (flow === "C") {
      const onlySecond = (secondKeywordRaw || "").trim();
      if (!onlySecond) {
        log2(`[Worker ${workerId}] C\uBAA8\uB4DC\uB294 2\uCC28 \uD0A4\uC6CC\uB4DC \uD544\uC218 \u2014 \uC791\uC5C5 \uC2A4\uD0B5`, "warn");
        result.failReason = "INVALID_TASK";
        result.error = "C\uBAA8\uB4DC_2\uCC28\uD0A4\uC6CC\uB4DC\uC5C6\uC74C";
        return result;
      }
      log2(`[Worker ${workerId}] C\uBAA8\uB4DC \uD1B5\uD569\uAC80\uC0C9 (2\uCC28 \uD0A4\uC6CC\uB4DC): ${onlySecond.substring(0, 48)}${onlySecond.length > 48 ? "..." : ""}`);
      await page.goto(buildIntegratedSearchUrl(onlySecond), { waitUntil: "domcontentloaded", timeout: 6e4 });
      await sleep2(engine.delay("afterFirstSearchLoad"));
      result.secondSearchPhraseUsed = onlySecond;
    } else if (flow === "F") {
      const query = (productName || firstKeyword || "").trim() || pickQueryWords(firstKeyword, productName);
      log2(`[Worker ${workerId}] F\uBAA8\uB4DC \uC0C1\uD488\uBA85 \uC804\uCCB4 \uD1B5\uD569\uAC80\uC0C9: "${query}"`);
      await page.goto(buildIntegratedSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 6e4 });
      await sleep2(engine.delay("afterFirstSearchLoad"));
      result.secondSearchPhraseUsed = query;
    } else {
      const firstQuery = firstKeyword;
      log2(`[Worker ${workerId}] 1\uCC28 \uD1B5\uD569\uAC80\uC0C9: ${firstQuery}`);
      await page.goto(buildIntegratedSearchUrl(firstQuery), { waitUntil: "domcontentloaded", timeout: 6e4 });
      await sleep2(engine.delay("afterFirstSearchLoad"));
      if (flow === "A") {
        let secondSearchKeyword;
        if (catalogMid && productName && productName.length > 10) {
          secondSearchKeyword = productName;
          log2(`[Worker ${workerId}] A\uBAA8\uB4DC 2\uCC28 \uD1B5\uD569\uAC80\uC0C9 (\uD480\uB124\uC784): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
        } else {
          const nameForSecond = (keywordName || productName || "").trim() || firstKeyword;
          secondSearchKeyword = pickSecondSearchPhraseAvoidingBlacklist(
            engine,
            mid,
            firstKeyword,
            nameForSecond,
            workerId
          );
          log2(`[Worker ${workerId}] A\uBAA8\uB4DC 2\uCC28 \uD1B5\uD569\uAC80\uC0C9 (3\uB2E8\uC870\uD569): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
        }
        result.secondSearchPhraseUsed = secondSearchKeyword;
        await page.goto(buildIntegratedSearchUrl(secondSearchKeyword), { waitUntil: "domcontentloaded", timeout: 6e4 });
        await sleep2(engine.delay("afterSecondSearchLoad"));
      } else {
        log2(`[Worker ${workerId}] B\uBAA8\uB4DC \u2014 1\uCC28 \uD1B5\uD569\uAC80\uC0C9 \uACB0\uACFC\uC5D0\uC11C \uC0C1\uD488 \uD0D0\uC0C9`);
      }
    }
    const isBlocked = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      return bodyText.includes("\uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC") || bodyText.includes("\uC790\uB3D9\uD654\uB41C \uC811\uADFC") || bodyText.includes("\uC811\uADFC\uC774 \uC81C\uD55C") || bodyText.includes("\uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC") || bodyText.includes("\uBE44\uC815\uC0C1\uC801\uC778 \uC694\uCCAD") || bodyText.includes("\uC774\uC6A9\uC774 \uC81C\uD55C");
    }).catch(() => false);
    if (isBlocked) {
      log2(`[Worker ${workerId}] IP \uCC28\uB2E8 \uAC10\uC9C0!`, "warn");
      result.failReason = "IP_BLOCKED";
      result.error = "Blocked";
      return result;
    }
    const searchCaptcha = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      return bodyText.includes("\uBCF4\uC548 \uD655\uC778") || bodyText.includes("\uC790\uB3D9\uC785\uB825\uBC29\uC9C0");
    }).catch(() => false);
    if (searchCaptcha) {
      log2(`[Worker ${workerId}] \uAC80\uC0C9 CAPTCHA \uAC10\uC9C0 - \uD574\uACB0 \uC2DC\uB3C4...`);
      result.captchaDetected = true;
      const solved = await captchaSolver.solve(page);
      if (solved) {
        log2(`[Worker ${workerId}] \uAC80\uC0C9 CAPTCHA \uD574\uACB0 \uC131\uACF5!`);
        result.captchaSolved = true;
        result.captchaDetected = false;
      } else {
        log2(`[Worker ${workerId}] \uAC80\uC0C9 CAPTCHA \uD574\uACB0 \uC2E4\uD328`, "warn");
        result.failReason = "CAPTCHA_UNSOLVED";
        return result;
      }
    }
    const MAX_SCROLL = engine.maxScrollAttempts;
    let linkClicked = false;
    for (let i = 0; i < MAX_SCROLL && !linkClicked; i++) {
      log2(`[Worker ${workerId}] \uC0C1\uD488 \uB9C1\uD06C \uD0D0\uC0C9 ${i + 1}/${MAX_SCROLL}`);
      const searchMid = catalogMid || mid;
      const link = (
        // 1. 쇼핑/통합 카드 공통: 제품 식별자 기반
        (catalogMid ? await page.$(`a[data-shp-contents-id="${catalogMid}"]`).catch(() => null) : null) || await page.$(`a[aria-labelledby="nstore_productId_${searchMid}"]`).catch(() => null) || await page.$(`a[href*="smartstore.naver.com/main/products/${searchMid}"]`).catch(() => null) || await page.$(`a[href*="m.smartstore.naver.com/main/products/${searchMid}"]`).catch(() => null) || await page.$(`a[href*="/products/${searchMid}"]`).catch(() => null) || // 2. 가격비교 / 브릿지 링크
        await page.$(`a[href*="nv_mid=${searchMid}"]`).catch(() => null) || await page.$(`a[href*="searchGate?nv_mid=${searchMid}"]`).catch(() => null) || // 3. ID 속성 매칭 (카드 컨테이너)
        await page.$(`[id="nstore_productId_${mid}"]`).catch(() => null) || (catalogMid ? await page.$(`a[href*="/products/${mid}"]`).catch(() => null) : null)
      );
      if (link) {
        const isVisible = await link.isVisible().catch(() => false);
        if (isVisible) {
          log2(`[Worker ${workerId}] MID(${mid}) \uB9C1\uD06C \uBC1C\uACAC \u2192 \uD074\uB9AD`);
          await link.evaluate((el) => el.removeAttribute("target"));
          await link.click();
          await page.waitForLoadState("domcontentloaded", { timeout: 3e4 }).catch(() => {
          });
          await sleep2(engine.delay("afterProductClick"));
          const currentPageUrl = page.url();
          log2(`[Worker ${workerId}] \uD398\uC774\uC9C0: ${currentPageUrl.substring(0, 80)}...`);
          linkClicked = true;
          result.midMatched = true;
          const dwellTime = engine.delay("stayOnProduct");
          log2(`[Worker ${workerId}] \uCCB4\uB958 ${(dwellTime / 1e3).toFixed(1)}\uCD08...`);
          await sleep2(dwellTime);
          if (currentPageUrl.includes("smartstore.naver.com") || currentPageUrl.includes("brand.naver.com")) {
            result.productPageEntered = true;
          } else {
            result.failReason = "DETAIL_NOT_REACHED";
            result.error = "StoreDetailUrlMismatch";
          }
          break;
        }
      }
      if (!linkClicked && process.env.NAVERSHOPPING_DEBUG_VISIBLE_MIDS === "1") {
        const debug = await collectVisibleSearchMidDebug(page, 8).catch(() => null);
        if (debug) {
          log2(
            `[DEBUG] visible mids attempt ${i + 1}/${MAX_SCROLL}: ${debug.mids.length ? debug.mids.join(", ") : "(none)"}`,
            "warn"
          );
          debug.cards.slice(0, 6).forEach((card, idx) => {
            log2(
              `[DEBUG] card ${idx + 1}: tag=${card.tag} ids=${card.ids.join("|") || "-"} title=${card.title || "-"}`,
              "warn"
            );
          });
        }
      }
      await humanScroll2(page, engine.explorationScrollPixels);
      await sleep2(engine.delay("explorationBetweenScrolls"));
    }
    if (!linkClicked) {
      log2(`[Worker ${workerId}] \uC0C1\uD488\uC774 \uC874\uC7AC\uD558\uC9C0 \uC54A\uC74C \u2014 MID(${mid}) \uAC80\uC0C9\uACB0\uACFC\uC5D0 \uBBF8\uB178\uCD9C (${MAX_SCROLL}\uD68C \uC2A4\uD06C\uB864)`, "warn");
      result.error = "\uC0C1\uD488\uC774 \uC874\uC7AC\uD558\uC9C0 \uC54A\uC74C";
      result.failReason = "PRODUCT_NOT_FOUND";
      result.midMatched = false;
      return result;
    }
    return result;
  } catch (e) {
    if (e.message?.includes("Timeout") || e.message?.includes("timeout") || e.name === "TimeoutError") {
      result.error = "Timeout";
      result.failReason = "TIMEOUT";
    } else {
      result.error = e.message || "Unknown";
    }
    return result;
  }
}
function getPrbRankUserDataDir(workerId) {
  const dir = path3.join(os.tmpdir(), `prb-rank-worker-${workerId}`);
  fs3.mkdirSync(dir, { recursive: true });
  return dir;
}
async function clearBrowserContextCookiesAndCache(context, workerId) {
  try {
    await context.clearCookies();
  } catch {
  }
  for (const p of context.pages()) {
    try {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Network.clearBrowserCache");
      await cdp.send("Network.clearBrowserCookies");
    } catch {
    }
  }
  log2(`[Worker ${workerId}] \uCFE0\uD0A4\xB7HTTP \uCE90\uC2DC \uCD08\uAE30\uD654 \uC644\uB8CC`);
}
async function runIndependentWorker(workerId, profile, onceMode = false) {
  log2(`[Worker ${workerId}] \uC2DC\uC791${onceMode ? " (1\uAC74 \uCC98\uB9AC \uD6C4 \uC885\uB8CC)" : ""}`);
  while (true) {
    let browser = null;
    let context = null;
    let rankPrbBrowser = null;
    try {
      const work = await claimWorkItem();
      if (!work) {
        if (onceMode) {
          log2(`[Worker ${workerId}] \uC791\uC5C5 \uC5C6\uC74C - \uC885\uB8CC`);
          process.exit(0);
        }
        await sleep2(ENGINE.emptyQueueWaitMs);
        continue;
      }
      const productShort = work.productName.substring(0, 30);
      log2(`[Worker ${workerId}] \uC791\uC5C5: ${productShort}... (mid=${work.mid}) [IP: ${currentIP}]`);
      const isRankD = ENGINE.searchFlowVersion === "D";
      if (!isRankD && ENGINE.airplaneBeforeTask) {
        await toggleAdbMobileDataOffOn(`Worker ${workerId} \uC791\uC5C5 \uC804`, ENGINE.airplaneCycles);
      }
      const winW = isRankD ? 1280 : BROWSER_WIDTH;
      const winH = isRankD ? 880 : BROWSER_HEIGHT;
      const pos = BROWSER_POSITIONS[(workerId - 1) % BROWSER_POSITIONS.length];
      const isMobileTask = isRankD ? false : resolveMobileForTask(ENGINE);
      const ua = pickUserAgent(ENGINE, isMobileTask);
      const proxy = pickProxyConfig(ENGINE);
      if (ENGINE.logEngineEvents) {
        log2(
          `[Engine] Worker ${workerId} mode=${isRankD ? "rankCheck(start.bat\xB7puppeteer-real-browser)" : isMobileTask ? "mobile" : "desktop"} proxy=${proxy ? proxy.server : "none"}`
        );
      }
      let page;
      if (isRankD && process.env.HEADLESS === "1") {
        const browserLaunchOptions = {
          headless: true,
          args: [
            `--window-position=${pos.x},${pos.y}`,
            `--window-size=${winW},${winH}`
          ]
        };
        const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || process.env.BROWSER_CHANNEL;
        if (browserChannel) {
          browserLaunchOptions.channel = browserChannel;
        }
        browser = await import_patchright.chromium.launch(browserLaunchOptions);
        const ctxOpts = buildBrowserContextOptions(false, ua);
        context = await browser.newContext({
          ...ctxOpts,
          ...proxy ? { proxy } : {}
        });
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        page.setDefaultTimeout(6e4);
        page.setDefaultNavigationTimeout(6e4);
      } else if (isRankD) {
        const userDataDir = getPrbRankUserDataDir(workerId);
        if (ENGINE.logEngineEvents) {
          log2(`[Engine] Worker ${workerId} \uC21C\uC704 PRB \uD504\uB85C\uD544: ${userDataDir}`);
        }
        const connectOpts = {
          headless: process.env.HEADLESS === "1",
          turnstile: true,
          fingerprint: true,
          disableXvfb: process.env.HEADLESS === "1",
          customConfig: { userDataDir }
        };
        const conn = await (0, import_puppeteer_real_browser.connect)(connectOpts);
        rankPrbBrowser = conn.browser;
        page = conn.page;
        await page.setViewport?.({ width: 1920, height: 1080 });
        await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => {
        });
        try {
          const tabPages = await rankPrbBrowser.pages();
          for (const p of tabPages) {
            if (p !== page && p.url() === "about:blank")
              await p.close().catch(() => {
              });
          }
        } catch {
        }
        page.setDefaultTimeout?.(6e4);
        page.setDefaultNavigationTimeout?.(6e4);
        browser = null;
        context = null;
      } else {
        const browserLaunchOptions = {
          headless: process.env.HEADLESS === "1",
          args: [
            `--window-position=${pos.x},${pos.y}`,
            `--window-size=${winW},${winH}`
          ]
        };
        const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || process.env.BROWSER_CHANNEL;
        if (browserChannel) {
          browserLaunchOptions.channel = browserChannel;
        }
        browser = await import_patchright.chromium.launch(browserLaunchOptions);
        const ctxOpts = buildBrowserContextOptions(isMobileTask, ua);
        context = await browser.newContext({
          ...ctxOpts,
          ...proxy ? { proxy } : {}
        });
        if (isMobileTask) {
          await applyMobileStealth(context);
        }
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        page.setDefaultTimeout(6e4);
        page.setDefaultNavigationTimeout(6e4);
      }
      if (!isRankD) {
        await sleep2(ENGINE.delay("browserLaunch"));
      }
      if (!isRankD && ENGINE.proxyEnabled) {
        await sleep2(ENGINE.delay("proxySetup"));
      }
      totalRuns++;
      const loginOk = !ENGINE.naverLoginEnabled ? true : isRankD && process.env.NAVER_LOGIN_ON_RANK !== "1" ? true : isRankD ? await ensureNaverLoginPrbPage(page, workerId) : await ensureNaverLoginIfConfigured(page, workerId);
      if (!loginOk) {
        totalFailed++;
        writeEngineTaskResult(work, {
          productPageEntered: false,
          captchaDetected: false,
          captchaSolved: false,
          midMatched: false,
          failReason: "LOGIN_FAILED",
          error: "login failed"
        });
        const failMsg = `[\uC2E4\uD328] Worker${workerId} | slot_sequence=${work.slotSequence} | \uC0AC\uC720=\uB85C\uADF8\uC778\uC2E4\uD328 | ${productShort}...`;
        log2(failMsg, "warn");
        console.log(failMsg);
        await sleep2(ENGINE.delay("taskGapRest"));
        if (onceMode)
          process.exit(1);
        continue;
      }
      const engineResult = isRankD ? await runShoppingRankCheck(page, work, workerId, ENGINE) : await runPatchrightEngine(
        page,
        work.mid,
        work.productName,
        work.keyword,
        workerId,
        ENGINE,
        work.keywordName,
        work.secondKeywordRaw,
        work.catalogMid
      );
      if (isRankD) {
        if (engineResult.rankCheckOk) {
          totalSuccess++;
          writeEngineTaskResult(work, engineResult);
          const successMsg = `[\uC131\uACF5\xB7\uC21C\uC704] Worker${workerId} | ${engineResult.shoppingRank}\uC704 | slot_sequence=${work.slotSequence} | ${productShort}...`;
          log2(successMsg);
          console.log(successMsg);
        } else {
          totalFailed++;
          const failReason = engineResult.failReason === "NO_MID_MATCH" ? "\uC21C\uC704\uBBF8\uBC1C\uACAC" : engineResult.failReason === "TIMEOUT" ? "\uD0C0\uC784\uC544\uC6C3" : engineResult.error || "Unknown";
          writeEngineTaskResult(work, engineResult);
          const failMsg = `[\uC2E4\uD328\xB7\uC21C\uC704] Worker${workerId} | slot_sequence=${work.slotSequence} | \uC0AC\uC720=${failReason} | ${productShort}...`;
          log2(failMsg, "warn");
          console.log(failMsg);
        }
      } else if (engineResult.productPageEntered) {
        totalSuccess++;
        writeEngineTaskResult(work, engineResult);
        const successMsg = `[\uC131\uACF5] Worker${workerId} | slot_sequence=${work.slotSequence} | ${productShort}...${engineResult.captchaSolved ? " (CAPTCHA\uD574\uACB0)" : ""}`;
        log2(successMsg);
        console.log(successMsg);
        if (engineResult.captchaSolved) {
          log2(`[Worker ${workerId}] SUCCESS(CAPTCHA\uD574\uACB0) | ${productShort}...`);
        } else {
          log2(`[Worker ${workerId}] SUCCESS | ${productShort}...`);
        }
      } else {
        totalFailed++;
        const failReason = engineResult.failReason === "CAPTCHA_UNSOLVED" ? "CAPTCHA" : engineResult.failReason === "IP_BLOCKED" ? "IP\uCC28\uB2E8" : engineResult.failReason === "NO_MID_MATCH" ? "MID\uC5C6\uC74C" : engineResult.failReason === "DETAIL_NOT_REACHED" ? "\uC0C1\uC138\uBBF8\uC9C4\uC785" : engineResult.failReason === "TIMEOUT" ? "\uD0C0\uC784\uC544\uC6C3" : engineResult.failReason === "INVALID_TASK" ? "\uC791\uC5C5\uC124\uC815\uC624\uB958" : engineResult.error || "Unknown";
        writeEngineTaskResult(work, engineResult);
        const failMsg = `[\uC2E4\uD328] Worker${workerId} | slot_sequence=${work.slotSequence} | \uC0AC\uC720=${failReason} | ${productShort}...`;
        log2(failMsg, "warn");
        console.log(failMsg);
        if (engineResult.failReason === "CAPTCHA_UNSOLVED") {
          totalCaptcha++;
          log2(`[Worker ${workerId}] FAIL(CAPTCHA) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === "IP_BLOCKED") {
          log2(`[Worker ${workerId}] FAIL(IP\uCC28\uB2E8) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === "NO_MID_MATCH") {
          log2(`[Worker ${workerId}] FAIL(MID\uC5C6\uC74C) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === "DETAIL_NOT_REACHED") {
          log2(`[Worker ${workerId}] FAIL(\uC0C1\uC138\uBBF8\uC9C4\uC785) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === "TIMEOUT") {
          log2(`[Worker ${workerId}] FAIL(\uD0C0\uC784\uC544\uC6C3) | ${productShort}...`, "warn");
        } else if (engineResult.failReason === "INVALID_TASK") {
          log2(`[Worker ${workerId}] FAIL(\uC791\uC5C5\uC124\uC815) | ${productShort}...`, "warn");
        } else {
          log2(`[Worker ${workerId}] FAIL(${engineResult.error || "Unknown"}) | ${productShort}...`, "warn");
        }
        if (ENGINE.searchFlowVersion === "A" && shouldBlacklistSecondComboAfterRun(engineResult)) {
          await appendSecondComboBlacklistEntry(
            ENGINE,
            work.mid,
            engineResult.secondSearchPhraseUsed || ""
          );
        }
      }
      await sleep2(ENGINE.delay("taskGapRest"));
      if (onceMode) {
        log2(`[Worker ${workerId}] 1\uAC74 \uCC98\uB9AC \uC644\uB8CC - \uC885\uB8CC`);
        process.exit(0);
      }
    } catch (e) {
      log2(`[Worker ${workerId}] ERROR: ${e.message}`, "error");
      if (onceMode)
        process.exit(1);
      await sleep2(5e3);
    } finally {
      if (rankPrbBrowser) {
        await sleep2(randomBetween(100, 500));
        await rankPrbBrowser.close().catch(() => {
        });
      } else {
        if (context) {
          await clearBrowserContextCookiesAndCache(context, workerId);
        }
        if (browser) {
          await sleep2(randomBetween(100, 500));
          await browser.close().catch(() => {
          });
        }
      }
    }
    if (totalRuns % 10 === 0 && workerId === 1) {
      cleanupChromeTempFolders();
    }
  }
}
function printStats() {
  const elapsed = (Date.now() - sessionStartTime) / 1e3 / 60;
  const successRate = totalRuns > 0 ? (totalSuccess / totalRuns * 100).toFixed(1) : "0";
  const captchaRate = totalRuns > 0 ? (totalCaptcha / totalRuns * 100).toFixed(1) : "0";
  console.log(`
${"=".repeat(60)}`);
  console.log(`  \uD1B5\uACC4 (${elapsed.toFixed(1)}\uBD84 \uACBD\uACFC)`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  \uCD1D \uC2E4\uD589: ${totalRuns}\uD68C`);
  console.log(`  \uC131\uACF5: ${totalSuccess} (${successRate}%) | CAPTCHA: ${totalCaptcha} (${captchaRate}%)`);
  console.log(`  \uC2E4\uD328: ${totalFailed} | \uD604\uC7AC IP: ${currentIP}`);
  console.log(`  \uC18D\uB3C4: ${elapsed > 0 ? (totalRuns / elapsed).toFixed(1) : "0"}\uD68C/\uBD84`);
  console.log(`${"=".repeat(60)}
`);
}
async function main() {
  let gitCommit = "unknown";
  try {
    gitCommit = (0, import_child_process2.execSync)("git rev-parse --short HEAD", {
      encoding: "utf-8",
      stdio: "pipe"
    }).trim();
  } catch (e) {
  }
  const onceMode = process.argv.includes("--once");
  const workerCount = onceMode ? 1 : PARALLEL_BROWSERS;
  const adbBeforeTaskEnabled = ENGINE.airplaneBeforeTask && ENGINE.searchFlowVersion !== "D";
  const adbLabel = adbBeforeTaskEnabled ? `\uC791\uC5C5\uC804ADB=ON(${ENGINE.airplaneCycles}\uD68C)` : ENGINE.searchFlowVersion === "D" ? "\uC791\uC5C5\uC804ADB=OFF(D\uBAA8\uB4DC\xB7start.bat \uB3D9\uC77C)" : "\uC791\uC5C5\uC804ADB=OFF";
  console.log(`
${"=".repeat(60)}`);
  console.log(`  Unified Runner (Patchright + \uC5D4\uC9C4 \uD30C\uC77C)`);
  console.log(`  Script: unified-runner.ts | Commit: ${gitCommit}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  \uB3D9\uC2DC \uC6CC\uCEE4: ${workerCount}\uAC1C${onceMode ? " (--once 1\uAC74 \uD6C4 \uC885\uB8CC)" : ""}`);
  if (workerCount > 1) {
    console.log(`  [\uC8FC\uC758] \uC791\uC5C5 JSON 1\uAC1C \uD050 \u2014 PARALLEL_BROWSERS=1 \uAD8C\uC7A5`);
  }
  console.log(
    `  \uC785\uCD9C\uB825: \uC791\uC5C5=${ENGINE.engineTaskFilePath} | \uACB0\uACFC=${ENGINE.engineResultFilePath} | workMode=${ENGINE.workMode} | \uAC80\uC0C9\uBAA8\uB4DC=${ENGINE.searchFlowVersion} | proxy=${ENGINE.proxyEnabled} | ${adbLabel}`
  );
  console.log(`${"=".repeat(60)}`);
  if (adbBeforeTaskEnabled) {
    log2(`\uC2DC\uC791 \uC804 \uB370\uC774\uD130 \uD1A0\uAE00 \uC0DD\uB7B5 \u2014 \uC791\uC5C5 1\uAC74\uB2F9 ${ENGINE.airplaneCycles}\uD68C OFF\u2192ON \uC2E4\uD589`);
  } else if (ENGINE.searchFlowVersion === "D") {
    log2("D\uBAA8\uB4DC: \uC791\uC5C5 \uC804 ADB \uB370\uC774\uD130 \uD1A0\uAE00 \uBE44\uD65C\uC131\uD654 (start.bat \uB3D9\uC77C)");
  } else {
    log2("\uC791\uC5C5 \uC804 ADB \uB370\uC774\uD130 \uD1A0\uAE00 \uBE44\uD65C\uC131\uD654");
  }
  startGitUpdateChecker();
  log2(`Git update checker started (interval: ${GIT_CHECK_INTERVAL / 1e3}s)`);
  const profile = loadProfile("pc_v7");
  log2(`[Profile] ${profile.name}`);
  try {
    currentIP = await getCurrentIP();
    log2(`\uD604\uC7AC IP: ${currentIP}`);
  } catch (e) {
    log2(`IP \uD655\uC778 \uC2E4\uD328: ${e.message}`, "error");
    currentIP = "unknown";
  }
  setInterval(printStats, 6e4);
  const numWorkers = onceMode ? 1 : PARALLEL_BROWSERS;
  log2(`
${numWorkers}\uAC1C \uC6CC\uCEE4 \uC2DC\uC791...`);
  for (let i = 1; i <= numWorkers; i++) {
    runIndependentWorker(i, profile, onceMode).catch((e) => {
      log2(`[Worker ${i}] \uCE58\uBA85\uC801 \uC5D0\uB7EC: ${e.message}`, "error");
      if (onceMode)
        process.exit(1);
    });
    if (i < numWorkers) {
      await sleep2(ENGINE.workerStartDelayMs);
    }
  }
  if (onceMode) {
    log2(`[--once] \uC6CC\uCEE4 \uB300\uAE30 \uC911...`);
    await new Promise(() => {
    });
  }
  log2(`\uBAA8\uB4E0 \uC6CC\uCEE4 \uC2DC\uC791 \uC644\uB8CC - \uB3C5\uB9BD \uC2E4\uD589 \uC911...
`);
  while (true) {
    await sleep2(6e4);
  }
}
process.on("SIGINT", () => {
  console.log("\n\n[STOP] \uC885\uB8CC \uC694\uCCAD\uB428");
  printStats();
  process.exit(0);
});
process.on("uncaughtException", (error) => {
  const msg = error.message || "";
  if ((msg.includes("EPERM") || msg.includes("ENOENT")) && (msg.includes("temp") || msg.includes("lighthouse") || msg.includes("puppeteer"))) {
    return;
  }
  console.error(`
[FATAL] Uncaught Exception: ${error.message}`);
  console.error(error.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error(`
[FATAL] Unhandled Rejection: ${reason?.message || reason}`);
});
main().catch((error) => {
  console.error(`[FATAL] Main error: ${error.message}`);
  process.exit(1);
});
