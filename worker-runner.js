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
    var fs6 = require("fs");
    var path5 = require("path");
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
            if (fs6.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path5.resolve(process.cwd(), ".env.vault");
      }
      if (fs6.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path5.join(os2.homedir(), envPath.slice(1)) : envPath;
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
      const dotenvPath = path5.resolve(process.cwd(), ".env");
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
      for (const path6 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs6.readFileSync(path6, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${path6} ${e.message}`);
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
            const relative = path5.relative(process.cwd(), filePath);
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
var path4 = __toESM(require("path"));
var fs5 = __toESM(require("fs"));
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
  return new Promise((resolve3) => setTimeout(resolve3, ms));
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
var DEFAULT_DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
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
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  viewport: { width: 520, height: 860 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
  extraHTTPHeaders: {
    "sec-ch-ua": '"Chromium";v="137", "Google Chrome";v="137", "Not-A.Brand";v="99"',
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
  if (v === "B" || v === "C" || v === "D" || v === "E" || v === "F" || v === "G")
    return v;
  return "G";
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
function buildEngineRuntime(file) {
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
function loadEngineConfig() {
  return buildEngineRuntime(readConfigJson());
}
function resolveMobileForTask(runtime) {
  if (runtime.searchFlowVersion === "E" || runtime.searchFlowVersion === "G")
    return true;
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
    viewport: { width: 520, height: 860 },
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
  screenshotToBase64(data) {
    if (typeof data === "string") {
      const commaIdx = data.indexOf(",");
      return commaIdx >= 0 && data.substring(0, commaIdx).includes("base64") ? data.substring(commaIdx + 1) : data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("base64");
    }
    if (data instanceof Uint8Array) {
      return Buffer.from(data).toString("base64");
    }
    throw new Error(`Screenshot result is not base64-compatible: ${Object.prototype.toString.call(data)}`);
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
          const screenshot2 = await imageElement.screenshot();
          const base64 = this.screenshotToBase64(screenshot2);
          this.log(`\uC774\uBBF8\uC9C0 \uCEA1\uCC98 \uC131\uACF5: ${selector} (${base64.length} bytes base64)`);
          return base64;
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
          const screenshot2 = await area.screenshot();
          const base64 = this.screenshotToBase64(screenshot2);
          this.log(`\uC601\uC5ED \uCEA1\uCC98 \uC131\uACF5: ${selector} (${base64.length} bytes base64)`);
          return base64;
        } catch {
          continue;
        }
      }
    }
    this.log("\uC804\uCCB4 \uD398\uC774\uC9C0 \uCEA1\uCC98");
    const screenshot = await page.screenshot();
    return this.screenshotToBase64(screenshot);
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
    return new Promise((resolve3) => setTimeout(resolve3, ms));
  }
};

// shared/mobile-stealth.ts
var MOBILE_STEALTH_SCRIPT = `
// ============================================================
// \uBAA8\uBC14\uC77C \uC2A4\uD154\uC2A4 \uC2A4\uD06C\uB9BD\uD2B8 - navigator \uBC0F API \uC624\uBC84\uB77C\uC774\uB4DC
// Chrome 137 / Android 14 / SM-S911B (Galaxy S23)
// ============================================================

// 1. navigator.userAgentData \uC624\uBC84\uB77C\uC774\uB4DC (Client Hints API)
Object.defineProperty(navigator, 'userAgentData', {
  get: () => ({
    brands: [
      { brand: 'Chromium', version: '137' },
      { brand: 'Google Chrome', version: '137' },
      { brand: 'Not-A.Brand', version: '99' }
    ],
    mobile: true,
    platform: 'Android',
    getHighEntropyValues: async (hints) => ({
      brands: [
        { brand: 'Chromium', version: '137' },
        { brand: 'Google Chrome', version: '137' },
        { brand: 'Not-A.Brand', version: '99' }
      ],
      mobile: true,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: 'arm',
      bitness: '64',
      model: 'SM-S911B',
      uaFullVersion: '137.0.0.0',
      fullVersionList: [
        { brand: 'Chromium', version: '137.0.0.0' },
        { brand: 'Google Chrome', version: '137.0.0.0' },
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
async function collectVisibleSearchMidDebug(_page, _limit = 12) {
  return { mids: [], cards: [] };
}
var ITEMS_PER_PAGE = 40;
var TITLE_MAX = 300;
var SAFE_DELAY_MS = 1500;
var HYDRATE_SCROLL_TOTAL = 18 * 550;
var PAGE_EVALUATE_NAME_POLYFILL = "window.__name = window.__name || ((fn) => fn);";
function microDelay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function isMobileBrowserPage(page) {
  return page.evaluate(() => {
    const ua = navigator.userAgent || "";
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
    const width = Math.min(
      window.innerWidth || Number.MAX_SAFE_INTEGER,
      document.documentElement?.clientWidth || Number.MAX_SAFE_INTEGER,
      screen.width || Number.MAX_SAFE_INTEGER
    );
    return uaMobile || navigator.maxTouchPoints > 0 && width <= 768;
  }).catch(() => false);
}
async function ensureEvaluateNamePolyfill(page) {
  await page.evaluate(PAGE_EVALUATE_NAME_POLYFILL).catch(() => {
  });
}
async function humanType(page, text) {
  for (const char of text) {
    await page.keyboard.type(char);
    await microDelay(50 + Math.random() * 100);
    if (Math.random() < 0.05) {
      await microDelay(200 + Math.random() * 300);
    }
  }
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
var SHOPPING_HOST = "search.shopping.naver.com";
async function tripleClickSearchInput(page, log3) {
  try {
    if (typeof page.locator === "function") {
      const raw = page.locator('input[name="query"]');
      if (raw && typeof raw.first === "function") {
        const searchInput = raw.first();
        await searchInput.waitFor({ state: "visible", timeout: 15e3 });
        await searchInput.click({ clickCount: 3 });
        return true;
      }
    }
    if (typeof page.waitForSelector === "function") {
      const el = await page.waitForSelector('input[name="query"]', { visible: true, timeout: 15e3 });
      if (!el) {
        log3("\uAC80\uC0C9 \uC785\uB825\uCC3D \uC5C6\uC74C", "warn");
        return false;
      }
      await el.click({ clickCount: 3 });
      return true;
    }
  } catch {
    log3("\uAC80\uC0C9 \uC785\uB825\uCC3D \uC5C6\uC74C", "warn");
    return false;
  }
  log3("\uAC80\uC0C9 \uC785\uB825\uCC3D API \uBBF8\uC9C0\uC6D0", "warn");
  return false;
}
async function isShoppingBlocked(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText ?? "";
    return body.includes("\uBCF4\uC548 \uD655\uC778") || body.includes("\uC790\uB3D9 \uC785\uB825 \uBC29\uC9C0") || body.includes("\uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C");
  });
}
function normalizeDetailTitle(raw) {
  return String(raw || "").replace(/\s+/g, " ").replace(/ /g, " ").trim();
}
async function extractDetailPageTitle(page) {
  try {
    const title = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").replace(/ /g, " ").trim();
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
      const bodyText = clean(document.body?.innerText || "");
      const isErrorPage = /에러페이지|시스템오류|현재 서비스 접속이 불가합니다|Too Many Requests|접속이 불가합니다/i.test(
        `${document.title} ${bodyText}`
      );
      push(document.querySelector('meta[property="og:title"]')?.getAttribute("content"));
      push(document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"));
      push(document.querySelector('meta[name="title"]')?.getAttribute("content"));
      for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
        const raw = script.textContent?.trim();
        if (!raw)
          continue;
        try {
          const parsed = JSON.parse(raw);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            if (!item || typeof item !== "object")
              continue;
            const anyItem = item;
            push(anyItem.name);
            push(anyItem.headline);
            push(anyItem.title);
          }
        } catch {
        }
      }
      push(document.title);
      for (const sel of ["h1", "h2", "h3", "strong", "[itemprop='name']"]) {
        document.querySelectorAll(sel).forEach((el) => push(el.textContent));
      }
      if (isErrorPage)
        return null;
      for (const text of candidates) {
        if (text.length >= 4)
          return text;
      }
      return null;
    });
    return title ? normalizeDetailTitle(title) : null;
  } catch {
    return null;
  }
}
async function enterShoppingTab(page, kw, _shoppingSearchPhrase, log3, sleepMs, solveCaptcha) {
  log3("\uB124\uC774\uBC84 \uBA54\uC778 \uC9C4\uC785\u2026");
  try {
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded", timeout: 45e3 });
  } catch {
    log3("\uB124\uC774\uBC84 \uBA54\uC778 \uC9C4\uC785 \uC2E4\uD328", "warn");
    return false;
  }
  await sleepMs(SAFE_DELAY_MS);
  await ensureEvaluateNamePolyfill(page);
  const inputOk = await tripleClickSearchInput(page, log3);
  if (!inputOk)
    return false;
  log3(`\uB124\uC774\uBC84 \uAC80\uC0C9\uC5B4 \uC785\uB825: ${kw}`);
  await humanType(page, kw);
  await page.keyboard.press("Enter");
  log3("\uAC80\uC0C9 \uACB0\uACFC \uB300\uAE30 \uC911\u2026");
  if (typeof page.waitForNavigation === "function") {
    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15e3 });
    } catch {
    }
  } else {
    try {
      await page.waitForLoadState?.("domcontentloaded", { timeout: 15e3 });
    } catch {
    }
  }
  await sleepMs(1e3);
  await ensureEvaluateNamePolyfill(page);
  log3("\uC1FC\uD551\uD0ED\uC73C\uB85C \uC774\uB3D9");
  let clicked = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    clicked = await page.evaluate(() => {
      const link = document.querySelector('a[href*="search.shopping.naver.com"]');
      if (link) {
        link.removeAttribute("target");
        link.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (clicked)
      break;
    log3(`\uC1FC\uD551\uD0ED \uB300\uAE30 \uC911\u2026 (${attempt}/5)`);
    await sleepMs(2e3);
  }
  if (!clicked) {
    log3("\uC1FC\uD551\uD0ED \uB9C1\uD06C \uC5C6\uC74C", "warn");
    return false;
  }
  await sleepMs(SAFE_DELAY_MS + 800);
  await ensureEvaluateNamePolyfill(page);
  if (!page.url().includes(SHOPPING_HOST)) {
    log3(`\uC1FC\uD551\uD0ED URL \uBBF8\uD655\uC778: ${page.url().substring(0, 100)}`, "warn");
    return false;
  }
  log3(`\uC1FC\uD551\uD0ED \uC9C4\uC785 \uC644\uB8CC: ${page.url().substring(0, 100)}`);
  if (await isShoppingBlocked(page)) {
    log3("\uBCF4\uC548/\uCC28\uB2E8 \uD398\uC774\uC9C0 \uAC10\uC9C0", "warn");
    if (solveCaptcha) {
      const solved = await solveCaptcha(page).catch(() => false);
      if (!solved || await isShoppingBlocked(page)) {
        log3("CAPTCHA \uD574\uACB0 \uC2E4\uD328 \uB610\uB294 \uCC28\uB2E8 \uC0C1\uD0DC \uC720\uC9C0", "warn");
        return false;
      }
    } else {
      return false;
    }
  }
  try {
    await page.waitForSelector("[data-shp-contents-id]", { timeout: 15e3 });
  } catch {
  }
  await sleepMs(500);
  return true;
}
async function findRankOnCurrentPage(page, targetMid, pageNum) {
  return page.evaluate(
    ({ targetId, pageNum: pageNum2, itemsPerPage, titleMax }) => {
      const clip = (s) => {
        const t = s.replace(/\s+/g, " ").trim();
        return t.length > titleMax ? t.substring(0, titleMax) : t;
      };
      const extractFromProductItem = (productItem) => {
        let reviewCount = null;
        let starRating = null;
        const reviewElements = productItem.querySelectorAll('.product_etc__Z7jnS, [class*="product_etc__"]');
        for (const elem of reviewElements) {
          const text = elem.textContent || "";
          if (text.includes("\uB9AC\uBDF0")) {
            const reviewMatch = text.match(/리뷰\s*(\d+)|\((\d+(?:,\d+)*)\)/);
            if (reviewMatch) {
              const reviewNum = reviewMatch[1] || reviewMatch[2];
              reviewCount = parseInt(reviewNum.replace(/,/g, ""), 10) || null;
              break;
            }
          }
        }
        const starEl = productItem.querySelector(".product_grade__O_5f5") || productItem.querySelector('[class*="product_grade__"]');
        if (starEl) {
          const starText = starEl.textContent?.trim() || "";
          const starMatch = starText.match(/(\d+\.?\d*)/);
          if (starMatch)
            starRating = parseFloat(starMatch[1]) || null;
        }
        return { reviewCount, starRating };
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
        const titleEl = productItem.querySelector('[class*="product_title__"]') || productItem.querySelector('[class*="product_name__"]');
        const tx = titleEl?.textContent?.trim();
        return tx ? clip(tx) : null;
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
            if (item.key === "chnl_prod_no" && item.value)
              chnlProdNo = String(item.value);
            if (item.key === "catalog_nv_mid" && item.value)
              catalogNvMid = String(item.value);
            if (item.key === "prod_nm" && item.value)
              prodNm = String(item.value);
          }
          if (chnlProdNo !== targetId && catalogNvMid !== targetId)
            continue;
          const pageRank = parseInt(rankStr, 10);
          const rank = (pageNum2 - 1) * itemsPerPage + (Number.isFinite(pageRank) ? pageRank : i + 1);
          const productItem = anchor.closest(".product_item__KQayS") || anchor.closest('[class*="product_item__"]');
          const extra = productItem ? extractFromProductItem(productItem) : { reviewCount: null, starRating: null };
          const productTitle = productItem ? titleFromProductItem(productItem, prodNm) : prodNm ? clip(prodNm) : null;
          const catalogMid = catalogNvMid || anchor.getAttribute("data-shp-contents-id") || null;
          return {
            found: true,
            rank,
            reviewCount: extra.reviewCount,
            starRating: extra.starRating,
            productTitle,
            catalogMid,
            detailUrl: anchor.href || null,
            anchorIndex: i
          };
        } catch {
        }
      }
      return { found: false, rank: null, reviewCount: null, starRating: null, productTitle: null, catalogMid: null, detailUrl: null, anchorIndex: null };
    },
    { targetId: targetMid, pageNum, itemsPerPage: ITEMS_PER_PAGE, titleMax: TITLE_MAX }
  );
}
async function waitForDetailAfterCardClick(page) {
  const waits = [];
  if (typeof page.waitForLoadState === "function") {
    waits.push(page.waitForLoadState("domcontentloaded", { timeout: 3e4 }).catch(() => null));
  }
  if (typeof page.waitForNavigation === "function") {
    waits.push(page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 3e4 }).catch(() => null));
  }
  if (waits.length > 0) {
    await Promise.race([...waits, microDelay(3e4)]);
  } else {
    await microDelay(SAFE_DELAY_MS);
  }
}
async function clickShoppingResultCardByIndex(page, anchorIndex, log3) {
  if (anchorIndex == null || anchorIndex < 0)
    return false;
  const selector = "a[data-shp-contents-id][data-shp-contents-rank][data-shp-contents-dtl]";
  const handles = await page.$$(selector).catch(() => []);
  const anchor = handles[anchorIndex];
  if (!anchor)
    return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const failures = [];
    try {
      if (typeof anchor.scrollIntoViewIfNeeded === "function") {
        await anchor.scrollIntoViewIfNeeded().catch(() => {
        });
      }
      await anchor.evaluate((el) => {
        const card = el.closest(".product_item__KQayS") || el.closest('[class*="product_item__"]') || el;
        card.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        el.removeAttribute("target");
      });
      await microDelay(250 + Math.random() * 250);
      const box = await anchor.boundingBox().catch(() => null);
      let clickedBy = "";
      if (box && box.width > 0 && box.height > 0) {
        const clickX = box.x + box.width / 2 + (Math.random() - 0.5) * Math.min(16, box.width / 2);
        const clickY = box.y + box.height / 2 + (Math.random() - 0.5) * Math.min(10, box.height / 2);
        const useTouch = await isMobileBrowserPage(page);
        if (useTouch && page.touchscreen?.tap) {
          try {
            await page.touchscreen.tap(clickX, clickY);
            clickedBy = "touchscreen.tap";
          } catch (e) {
            failures.push(`touchscreen.tap=${e?.message || e}`);
          }
        }
        if (!clickedBy && page.mouse?.click) {
          try {
            await page.mouse.move(clickX, clickY).catch(() => {
            });
            await microDelay(70 + Math.random() * 120);
            await page.mouse.click(clickX, clickY, { delay: 35 + Math.random() * 50 });
            clickedBy = "mouse.click";
          } catch (e) {
            failures.push(`mouse.click=${e?.message || e}`);
          }
        }
      } else {
        failures.push("boundingBox=missing");
      }
      if (!clickedBy) {
        try {
          await anchor.click();
          clickedBy = "element.click";
        } catch (e) {
          failures.push(`element.click=${e?.message || e}`);
        }
      }
      if (!clickedBy) {
        try {
          const domClicked = await anchor.evaluate((el) => {
            el.removeAttribute("target");
            el.click();
            return true;
          });
          if (domClicked)
            clickedBy = "dom.click";
        } catch (e) {
          failures.push(`dom.click=${e?.message || e}`);
        }
      }
      if (clickedBy) {
        log3(`\uC0C1\uC138\uD398\uC774\uC9C0 \uCE74\uB4DC \uD074\uB9AD \uC131\uACF5 (${clickedBy}, attempt ${attempt})`);
        await waitForDetailAfterCardClick(page);
        return true;
      }
    } catch (e) {
      failures.push(`prepare=${e?.message || e}`);
    }
    log3(`\uC0C1\uC138\uD398\uC774\uC9C0 \uCE74\uB4DC \uD074\uB9AD \uC2E4\uD328(attempt ${attempt}): ${failures.join(" | ") || "unknown"}`, "warn");
    await microDelay(400);
  }
  return false;
}
async function goToNextPage(page, targetPage) {
  const paginationSelector = 'a.pagination_btn_page__utqBz, a[class*="pagination_btn"]';
  try {
    await page.waitForSelector(paginationSelector, { timeout: 1e4 });
  } catch {
    return false;
  }
  const buttonExists = await page.evaluate((nextPage) => {
    const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === String(nextPage))
        return true;
    }
    return false;
  }, targetPage);
  if (!buttonExists)
    return false;
  let apiResponsePromise = null;
  if (typeof page.waitForResponse === "function") {
    apiResponsePromise = page.waitForResponse(
      (response) => {
        const url = response.url();
        return url.includes("/api/search/all") && url.includes(`pagingIndex=${targetPage}`);
      },
      { timeout: 3e4 }
    ).catch(() => null);
  }
  try {
    const clicked = await page.evaluate((nextPage) => {
      const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === String(nextPage)) {
          btn.click();
          return true;
        }
      }
      return false;
    }, targetPage);
    if (!clicked)
      return false;
  } catch {
    return false;
  }
  if (apiResponsePromise)
    await apiResponsePromise;
  await microDelay(1500);
  await ensureEvaluateNamePolyfill(page);
  return true;
}
async function findNaverShoppingRankByMid(page, keyword, targetMid, maxPages, log3, sleepMs, solveCaptcha, shoppingSearchPhrase) {
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
  const entered = await enterShoppingTab(page, kw, shoppingSearchPhrase || kw, log3, sleepMs, solveCaptcha);
  if (!entered)
    return empty;
  const out = { ...empty };
  for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
    if (currentPage > 1) {
      await sleepMs(1e3 + Math.random() * 1e3);
      const moved = await goToNextPage(page, currentPage);
      if (!moved) {
        log3(`${currentPage - 1}\uD398\uC774\uC9C0\uAE4C\uC9C0 \uD0D0\uC0C9 \uC885\uB8CC(\uB2E4\uC74C \uD398\uC774\uC9C0 \uC5C6\uC74C)`);
        break;
      }
      if (await isShoppingBlocked(page)) {
        log3("\uBCF4\uC548/\uCC28\uB2E8 \uD398\uC774\uC9C0 \uAC10\uC9C0");
        break;
      }
    }
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
      await humanScroll(page, HYDRATE_SCROLL_TOTAL);
      await sleepMs(150);
    } catch (e) {
      if (e?.message?.includes("Target closed") || e?.message?.includes("Protocol error") || e?.message?.includes("Session closed")) {
        log3(`\uD398\uC774\uC9C0 \uC5F0\uACB0 \uB04A\uAE40: ${e.message}`, "warn");
        break;
      }
      throw e;
    }
    let result;
    try {
      result = await findRankOnCurrentPage(page, mid, currentPage);
    } catch (e) {
      if (e?.message?.includes("Target closed") || e?.message?.includes("Protocol error") || e?.message?.includes("Session closed")) {
        log3(`\uD398\uC774\uC9C0 \uC5F0\uACB0 \uB04A\uAE40: ${e.message}`, "warn");
        break;
      }
      throw e;
    }
    log3(`${currentPage}\uD398\uC774\uC9C0 \uC218\uC9D1: ${result.found ? `\uBC1C\uACAC (${result.rank}\uC704)` : "\uBBF8\uBC1C\uACAC"}`);
    if (result.found && result.rank != null) {
      out.rank = result.rank;
      out.reviewCount = result.reviewCount;
      out.starRating = result.starRating;
      out.productTitle = result.productTitle || null;
      out.catalogMid = result.catalogMid || null;
      if (result.anchorIndex != null) {
        try {
          const clicked = await clickShoppingResultCardByIndex(page, result.anchorIndex, log3);
          if (!clicked) {
            log3("\uC0C1\uC138\uD398\uC774\uC9C0 \uCE74\uB4DC \uD074\uB9AD \uC2E4\uD328", "warn");
            break;
          }
          await sleepMs(SAFE_DELAY_MS);
          const detailTitle = await extractDetailPageTitle(page);
          if (detailTitle) {
            out.productTitle = detailTitle;
          } else if (!out.productTitle) {
            log3("\uC0C1\uC138\uD398\uC774\uC9C0 \uC81C\uBAA9 \uCD94\uCD9C \uC2E4\uD328", "warn");
          }
        } catch {
          if (!out.productTitle)
            log3("\uC0C1\uC138\uD398\uC774\uC9C0 \uC9C4\uC785 \uC2E4\uD328", "warn");
        }
      }
      break;
    }
    if (currentPage < maxPages)
      await sleepMs(SAFE_DELAY_MS);
  }
  return out;
}

// flows/flow-d-rank-check.ts
async function runRankCheckFlow(input, deps) {
  const { page, work, workerId } = input;
  const { log: log3, sleep: sleep3 } = deps;
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
    log3(`[Worker ${workerId}] D\uBAA8\uB4DC \uC21C\uC704\uCCB4\uD06C: "${kw.substring(0, 40)}..." mid=${mid} (\uCD5C\uB300 ${maxPages}\uD398\uC774\uC9C0)`);
    const rankCaptchaSolver = new ReceiptCaptchaSolverPRB((msg) => log3(`[Worker ${workerId}] ${msg}`));
    const detail = await findNaverShoppingRankByMid(
      page,
      kw,
      mid,
      maxPages,
      (m) => log3(`[Worker ${workerId}] ${m}`),
      sleep3,
      (p) => rankCaptchaSolver.solve(p),
      work.productName || kw
    );
    if (detail.rank != null && detail.rank > 0) {
      result.shoppingRank = detail.rank;
      result.reviewCount = detail.reviewCount;
      result.starRating = detail.starRating;
      result.extractedProductTitle = detail.productTitle?.trim() || null;
      result.catalogMid = detail.catalogMid || null;
      result.rankCheckOk = true;
      result.midMatched = true;
      log3(
        `[Worker ${workerId}] \uC21C\uC704: ${detail.rank}\uC704` + (detail.reviewCount != null ? ` | \uB9AC\uBDF0 ${detail.reviewCount}` : "") + (detail.starRating != null ? ` | \uBCC4 ${detail.starRating}` : "") + (result.extractedProductTitle ? ` | \uC81C\uBAA9 "${result.extractedProductTitle.substring(0, 36)}${result.extractedProductTitle.length > 36 ? "\u2026" : ""}"` : "")
      );
    } else {
      result.failReason = "NO_MID_MATCH";
      result.error = "\uC21C\uC704\uAD8C_\uBBF8\uBC1C\uACAC";
      log3(`[Worker ${workerId}] \uC21C\uC704\uAD8C \uB0B4 MID \uC5C6\uC74C`, "warn");
    }
  } catch (e) {
    result.error = e?.message || "Unknown";
    result.failReason = "TIMEOUT";
    log3(`[Worker ${workerId}] \uC21C\uC704\uCCB4\uD06C \uC608\uC678: ${result.error}`, "warn");
  }
  return result;
}

// flows/traffic-keywords.ts
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
function tokenizeKeywordWords(text) {
  return (text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}
function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function buildGIntegratedFiveWordQuery(mainKeyword, secondaryText) {
  const mainWords = tokenizeKeywordWords(mainKeyword);
  const mainPick = mainWords.length > 0 ? mainWords[Math.floor(Math.random() * mainWords.length)] : "\uC0C1\uD488";
  let pool = [...new Set(tokenizeKeywordWords(secondaryText))].filter((w) => w !== mainPick);
  if (pool.length === 0) {
    pool = [...new Set(tokenizeKeywordWords(secondaryText))];
  }
  if (pool.length === 0) {
    pool = [mainPick];
  }
  const shuffled = [...pool];
  shuffleArrayInPlace(shuffled);
  const four = [];
  for (let i = 0; i < 4; i++) {
    four.push(shuffled[i % shuffled.length]);
  }
  return [mainPick, ...four].join(" ");
}
function pickGSecondSearchPhraseAvoidingBlacklist(engine, mid, firstKeyword, keywordName, workerId, deps) {
  if (!engine.keywordBlacklistEnabled) {
    return buildGIntegratedFiveWordQuery(firstKeyword, keywordName);
  }
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const phrase = buildGIntegratedFiveWordQuery(firstKeyword, keywordName);
    if (!deps.isSecondComboBlacklisted(engine, mid, phrase)) {
      if (t > 0) {
        deps.log(
          `[Worker ${workerId}] [KeywordBlacklist] G 2\uCC28 5\uB2E8\uC5B4 ${t + 1}\uBC88\uC9F8 \uC2DC\uB3C4\uB85C \uCC44\uD0DD: "${phrase.substring(0, 50)}${phrase.length > 50 ? "..." : ""}"`
        );
      }
      return phrase;
    }
  }
  const fallback = buildGIntegratedFiveWordQuery(firstKeyword, keywordName);
  deps.log(
    `[Worker ${workerId}] [KeywordBlacklist] G 2\uCC28 \uC81C\uC678 \uBAA9\uB85D\uACFC \uCDA9\uB3CC \uB2E4\uC218 \u2014 \uC784\uC758 5\uB2E8\uC5B4 \uC0AC\uC6A9: "${fallback.substring(0, 50)}${fallback.length > 50 ? "..." : ""}"`,
    "warn"
  );
  return fallback;
}
function pickSecondSearchPhraseAvoidingBlacklist(engine, mid, firstKeyword, keywordName, workerId, deps) {
  if (!engine.keywordBlacklistEnabled) {
    return buildSecondSearchPhrase(firstKeyword, keywordName);
  }
  const maxTries = 200;
  for (let t = 0; t < maxTries; t++) {
    const phrase = buildSecondSearchPhrase(firstKeyword, keywordName);
    if (!deps.isSecondComboBlacklisted(engine, mid, phrase)) {
      if (t > 0) {
        deps.log(
          `[Worker ${workerId}] [KeywordBlacklist] 2\uCC28 \uC870\uD569 ${t + 1}\uBC88\uC9F8 \uC2DC\uB3C4\uB85C \uCC44\uD0DD: "${phrase.substring(0, 50)}${phrase.length > 50 ? "..." : ""}"`
        );
      }
      return phrase;
    }
  }
  const fallback = buildSecondSearchPhrase(firstKeyword, keywordName);
  deps.log(
    `[Worker ${workerId}] [KeywordBlacklist] 2\uCC28 \uC870\uD569 \uBE14\uB799 \uC2DC\uB3C4 \uB2E4\uC218 \u2014 \uC784\uC758 \uC870\uD569 \uC0AC\uC6A9: "${fallback.substring(0, 50)}${fallback.length > 50 ? "..." : ""}"`,
    "warn"
  );
  return fallback;
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
function buildAckeySearchUrl(query, acq = query, acr = 1) {
  const p = new URLSearchParams({
    sm: "mtp_sug.top",
    where: "m",
    query,
    ackey: generateAckey(),
    acq,
    acr: String(Math.max(1, Math.floor(acr))),
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

// flows/flow-a-traffic.ts
async function runTrafficFlowA(input, deps, flowLabel) {
  const { page, mid, productName, keyword, workerId, engine, keywordName, catalogMid } = input;
  const firstKeyword = (keyword || "").trim() || "\uC0C1\uD488";
  deps.log(`[Worker ${workerId}] 1\uCC28 \uD1B5\uD569\uAC80\uC0C9: ${firstKeyword}`);
  await page.goto(buildIntegratedSearchUrl(firstKeyword), { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  let secondSearchKeyword;
  if (catalogMid && productName && productName.length > 10) {
    secondSearchKeyword = productName;
    deps.log(`[Worker ${workerId}] A\uBAA8\uB4DC 2\uCC28 \uD1B5\uD569\uAC80\uC0C9 (\uD480\uB124\uC784): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
  } else {
    const nameForSecond = (keywordName || productName || "").trim() || firstKeyword;
    secondSearchKeyword = pickSecondSearchPhraseAvoidingBlacklist(
      engine,
      mid,
      firstKeyword,
      nameForSecond,
      workerId,
      deps
    );
    deps.log(`[Worker ${workerId}] A\uBAA8\uB4DC 2\uCC28 \uD1B5\uD569\uAC80\uC0C9 (3\uB2E8\uC870\uD569): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`);
  }
  await page.goto(buildIntegratedSearchUrl(secondSearchKeyword), { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("afterSecondSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: secondSearchKeyword };
}

// flows/flow-b-traffic.ts
async function runTrafficFlowB(input, deps, flowLabel) {
  const { page, keyword, workerId, engine } = input;
  const firstKeyword = (keyword || "").trim() || "\uC0C1\uD488";
  deps.log(`[Worker ${workerId}] 1\uCC28 \uD1B5\uD569\uAC80\uC0C9: ${firstKeyword}`);
  await page.goto(buildIntegratedSearchUrl(firstKeyword), { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  deps.log(`[Worker ${workerId}] B\uBAA8\uB4DC \u2014 1\uCC28 \uD1B5\uD569\uAC80\uC0C9 \uACB0\uACFC\uC5D0\uC11C \uC0C1\uD488 \uD0D0\uC0C9`);
  return { ok: true, flowLabel };
}

// flows/flow-c-traffic.ts
async function runTrafficFlowC(input, deps, flowLabel) {
  const { page, workerId, engine, secondKeywordRaw } = input;
  const onlySecond = (secondKeywordRaw || "").trim();
  if (!onlySecond) {
    deps.log(`[Worker ${workerId}] C\uBAA8\uB4DC\uB294 2\uCC28 \uD0A4\uC6CC\uB4DC \uD544\uC218 \u2014 \uC791\uC5C5 \uC2A4\uD0B5`, "warn");
    return {
      ok: false,
      flowLabel,
      failReason: "INVALID_TASK",
      error: "C\uBAA8\uB4DC_2\uCC28\uD0A4\uC6CC\uB4DC\uC5C6\uC74C"
    };
  }
  deps.log(`[Worker ${workerId}] C\uBAA8\uB4DC \uD1B5\uD569\uAC80\uC0C9 (2\uCC28 \uD0A4\uC6CC\uB4DC): ${onlySecond.substring(0, 48)}${onlySecond.length > 48 ? "..." : ""}`);
  await page.goto(buildIntegratedSearchUrl(onlySecond), { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: onlySecond };
}

// flows/flow-e-traffic.ts
function buildAutocompleteInput(keyword, productName) {
  const source = (keyword || productName || "\uC0C1\uD488").replace(/\s+/g, " ").trim();
  const words = source.split(" ").filter(Boolean);
  if (source.length <= 18 && words.length <= 3)
    return source;
  const picked = words.slice(0, Math.min(3, words.length)).join(" ");
  return picked || source.substring(0, 18);
}
async function runTrafficFlowE(input, deps, flowLabel) {
  const { page, productName, keyword, workerId, engine } = input;
  const query = (productName || keyword || "").trim() || "\uC0C1\uD488";
  const acq = buildAutocompleteInput(keyword, query);
  deps.log(
    `[Worker ${workerId}] E\uBAA8\uB4DC \uC6D0\uBCF8 \uC790\uB3D9\uC644\uC131 \uD750\uB984: input="${acq.substring(0, 40)}${acq.length > 40 ? "..." : ""}" query="${query.substring(0, 40)}${query.length > 40 ? "..." : ""}"`
  );
  await page.goto("https://m.naver.com", { waitUntil: "load", timeout: 3e4 });
  await deps.sleep(Math.max(2e3, engine.delay("portalAfterOpen")));
  const searchBtn = await page.$("#MM_SEARCH_FAKE");
  if (searchBtn) {
    await searchBtn.click();
  } else {
    deps.log(`[Worker ${workerId}] E\uBAA8\uB4DC \uAC80\uC0C9\uCC3D \uD65C\uC131\uD654 \uBC84\uD2BC \uBBF8\uBC1C\uACAC(#MM_SEARCH_FAKE)`, "warn");
  }
  await deps.sleep(Math.max(1e3, engine.delay("searchFakeClickGap")));
  const inputEl = await page.$("#query");
  if (!inputEl) {
    return {
      ok: false,
      flowLabel,
      failReason: "PAGE_NOT_LOADED",
      error: "E\uBAA8\uB4DC_\uAC80\uC0C9\uC785\uB825\uCC3D\uC5C6\uC74C"
    };
  }
  await inputEl.click();
  for (const char of acq) {
    await page.keyboard.type(char, { delay: Math.max(80, engine.delay("firstKeywordTypingDelay")) });
    await deps.sleep(50);
  }
  await deps.sleep(2e3);
  await page.waitForSelector("li.u_atcp_l", { timeout: 4e3 }).catch(() => null);
  const items = await page.$$("li.u_atcp_l");
  deps.log(`[Worker ${workerId}] E\uBAA8\uB4DC \uC790\uB3D9\uC644\uC131 \uD56D\uBAA9: ${items.length}\uAC1C`);
  if (items.length <= 0) {
    const fallbackUrl = buildAckeySearchUrl(query, acq, 1);
    deps.log(
      `[Worker ${workerId}] E\uBAA8\uB4DC \uC790\uB3D9\uC644\uC131 \uC5C6\uC74C \u2192 turafic_update Case B ackey URL \uAC80\uC0C9 \uC9C4\uC785`,
      "warn"
    );
    await page.goto(fallbackUrl, { waitUntil: "load", timeout: 6e4 });
    await deps.sleep(Math.max(3e3, engine.delay("afterFirstSearchLoad")));
    return { ok: true, flowLabel, secondSearchPhraseUsed: query };
  }
  await items[0].click();
  await deps.sleep(Math.max(3e3, engine.delay("afterFirstSearchLoad")));
  return { ok: true, flowLabel, secondSearchPhraseUsed: query };
}

// flows/flow-f-traffic.ts
async function runTrafficFlowF(input, deps, flowLabel) {
  const { page, productName, keyword, workerId, engine } = input;
  const firstKeyword = (keyword || "").trim() || "\uC0C1\uD488";
  const query = (productName || firstKeyword || "").trim() || pickQueryWords(firstKeyword, productName);
  deps.log(`[Worker ${workerId}] F\uBAA8\uB4DC \uC0C1\uD488\uBA85 \uC804\uCCB4 \uD1B5\uD569\uAC80\uC0C9: "${query}"`);
  await page.goto(buildIntegratedSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: query };
}

// flows/flow-g-traffic.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var G_FORCE_FULL_SECOND_SEARCH_AFTER_MISSES = 10;
function cookieDomainIsNaver(domain) {
  const d = String(domain || "").trim().replace(/^\./, "").toLowerCase();
  if (!d)
    return false;
  return d === "naver.com" || d.endsWith(".naver.com");
}
function readStorageStateCookiesForPlaywright(filePath) {
  const text = fs3.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object")
      continue;
    const c = raw;
    const name = String(c.name || "");
    const domain = String(c.domain || "");
    const p = String(c.path || "/");
    if (!name || !domain)
      continue;
    const row = {
      name,
      value: String(c.value ?? ""),
      domain,
      path: p || "/"
    };
    const exp = c.expires;
    if (typeof exp === "number" && exp > 0) {
      row.expires = exp;
    }
    if (typeof c.httpOnly === "boolean")
      row.httpOnly = c.httpOnly;
    if (typeof c.secure === "boolean")
      row.secure = c.secure;
    const ss = c.sameSite;
    if (ss === "Strict" || ss === "Lax" || ss === "None") {
      row.sameSite = ss;
    }
    out.push(row);
  }
  return out;
}
async function stripNaverCookiesKeepOthers(context) {
  const all = await context.cookies();
  const keep = all.filter((c) => !cookieDomainIsNaver(c.domain));
  await context.clearCookies();
  if (keep.length > 0) {
    await context.addCookies(keep);
  }
}
async function verifyGFlowNaverLoggedIn(page) {
  const ctx = page.context();
  const urls = ["https://m.naver.com/", "https://www.naver.com/"];
  const names = /* @__PURE__ */ new Set();
  for (const u of urls) {
    try {
      for (const c of await ctx.cookies(u)) {
        names.add(c.name);
      }
    } catch {
    }
  }
  const hasSessionCookie = names.has("NID_SES") || names.has("NID_AUT");
  if (hasSessionCookie)
    return true;
  const domHint = await page.locator(
    'a[href*="nidlogin.logout"], a[href*="logout"], a[href*="LOGOUT"], [class*="MyView"] a[href*="my"]'
  ).first().isVisible().catch(() => false);
  return domHint;
}
async function runFlowGPortalCookieLoginSequence(page, workerId, engine, deps, storagePathAbs, flowLabel) {
  const context = page.context();
  deps.log(
    `[Worker ${workerId}] G\uBAA8\uB4DC: \uB124\uC774\uBC84 \uCFE0\uD0A4 \uCD08\uAE30\uD654 \u2192 m.naver.com \uC9C4\uC785 \u2192 \uC800\uC7A5 \uC138\uC158 \uCFE0\uD0A4 \uC8FC\uC785 \u2192 \uB85C\uADF8\uC778 \uAC80\uC99D`
  );
  await stripNaverCookiesKeepOthers(context);
  await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("portalAfterOpen"));
  let rows;
  try {
    rows = readStorageStateCookiesForPlaywright(storagePathAbs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC storage-state \uC77D\uAE30 \uC2E4\uD328: ${msg}`, "warn");
    return {
      ok: false,
      flowLabel,
      failReason: "LOGIN_FAILED",
      error: "G flow: invalid storage state file"
    };
  }
  if (rows.length === 0) {
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC storage-state\uC5D0 \uC720\uD6A8\uD55C cookies \uD56D\uBAA9\uC774 \uC5C6\uC74C`, "warn");
    return {
      ok: false,
      flowLabel,
      failReason: "LOGIN_FAILED",
      error: "G flow: empty cookies in storage state"
    };
  }
  try {
    await context.addCookies(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC addCookies \uC2E4\uD328: ${msg}`, "warn");
    return {
      ok: false,
      flowLabel,
      failReason: "LOGIN_FAILED",
      error: `G flow: addCookies failed: ${msg}`
    };
  }
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 6e4 });
  } catch {
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 6e4 });
  }
  await deps.sleep(engine.delay("browserLoad"));
  const loggedIn = await verifyGFlowNaverLoggedIn(page);
  if (!loggedIn) {
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC \uB85C\uADF8\uC778 \uAC80\uC99D \uC2E4\uD328(NID_SES/NID_AUT\xB7DOM)`, "warn");
    return {
      ok: false,
      flowLabel,
      failReason: "LOGIN_FAILED",
      error: "G flow: login verification failed after cookie inject"
    };
  }
  deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uAC80\uC99D \uC644\uB8CC \u2192 \uD1B5\uD569\uAC80\uC0C9 1\uCC28 \uC9C4\uD589`);
  return { ok: true, flowLabel };
}
async function resolveMobileIntegratedSearchInput(page) {
  const combined = "#nx_query, input#query, input[name='query'][type='search'], input[name='query'], form[role='search'] input[type='text'], .search_input input[type='text'], header input[type='text']";
  const loc = page.locator(combined).first();
  try {
    await loc.waitFor({ state: "visible", timeout: 15e3 });
    return loc;
  } catch {
    return null;
  }
}
async function integratedSearchClearAllAndSubmitNewQuery(page, engine, workerId, deps, newQuery) {
  const q = (newQuery || "").trim();
  if (!q)
    return false;
  const portalSearchInput = await resolveMobileIntegratedSearchInput(page);
  if (!portalSearchInput) {
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC \uD1B5\uD569\uAC80\uC0C9 \uC785\uB825\uCC3D \uBBF8\uBC1C\uACAC`, "warn");
    return false;
  }
  const context = page.context();
  try {
    await portalSearchInput.click({ force: true });
  } catch {
    await portalSearchInput.evaluate((el) => {
      try {
        el.scrollIntoView({ block: "center", inline: "center" });
        el.focus();
      } catch {
      }
    }).catch(() => {
    });
  }
  await deps.sleep(engine.delay("secondSearchField"));
  await page.keyboard.press("Control+a");
  await deps.sleep(40);
  await page.keyboard.press("Backspace");
  await deps.sleep(50);
  for (const origin of ["https://m.search.naver.com", "https://search.naver.com"]) {
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    } catch {
    }
  }
  try {
    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t);
    }, q);
    await page.keyboard.press("Control+v");
  } catch (e) {
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uD074\uB9BD\uBCF4\uB4DC \uBD99\uC5EC\uB123\uAE30 \uC2E4\uD328 \u2192 value \uD3F4\uBC31: ${String(e)}`, "warn");
  }
  await deps.sleep(engine.delay("afterSecondKeywordType"));
  let inBox = (await portalSearchInput.inputValue().catch(() => "")).trim();
  if (!inBox && q) {
    try {
      await portalSearchInput.click({ force: true });
    } catch {
      await portalSearchInput.evaluate((el) => {
        try {
          el.scrollIntoView({ block: "center", inline: "center" });
          el.focus();
        } catch {
        }
      }).catch(() => {
      });
    }
    await deps.sleep(80);
    await portalSearchInput.evaluate((el, value) => {
      const input = el;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, q).catch(() => {
    });
    await deps.sleep(engine.delay("afterSecondKeywordType"));
    inBox = (await portalSearchInput.inputValue().catch(() => "")).trim();
  }
  if (!inBox.trim()) {
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uAC80\uC0C9\uC5B4 \uC785\uB825 \uD6C4\uC5D0\uB3C4 \uBE44\uC5B4 \uC788\uC74C`, "warn");
    return false;
  }
  deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uAC80\uC0C9\uCC3D \uC804\uCCB4 \uC0AD\uC81C \uD6C4 \uC7AC\uC785\uB825 \u2192 Enter`);
  await page.keyboard.press("Enter");
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 45e3 });
  } catch {
  }
  return true;
}
async function runTrafficFlowG(input, deps, flowLabel) {
  const { page, mid, productName, keyword, workerId, engine, keywordName, catalogMid, secondKeywordRaw } = input;
  const gStorage = (input.naverStorageStatePathForFlowG || "").trim();
  if (gStorage && fs3.existsSync(gStorage)) {
    const abs = path3.isAbsolute(gStorage) ? gStorage : path3.join(process.cwd(), gStorage);
    const gate = await runFlowGPortalCookieLoginSequence(page, workerId, engine, deps, abs, flowLabel);
    if (!gate.ok)
      return gate;
  }
  const firstKeyword = (keyword || "").trim() || "\uC0C1\uD488";
  const secondaryText = (secondKeywordRaw || keywordName || productName || "").trim() || firstKeyword;
  const firstPhrase = buildGIntegratedFiveWordQuery(firstKeyword, secondaryText);
  deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC 1\uCC28 \uD1B5\uD569\uAC80\uC0C9(5\uB2E8\uC5B4): ${firstPhrase}`);
  await page.goto(buildIntegratedSearchUrl(firstPhrase), { waitUntil: "domcontentloaded", timeout: 6e4 });
  await deps.sleep(engine.delay("afterFirstSearchLoad"));
  const secondKeywordPool = (keywordName || productName || "").trim() || firstKeyword;
  const midMissCount = deps.countBlacklistedSecondCombosForMid(engine, mid);
  const mustUseFullSecondKeyword = midMissCount >= G_FORCE_FULL_SECOND_SEARCH_AFTER_MISSES;
  let secondSearchKeyword;
  if (mustUseFullSecondKeyword) {
    secondSearchKeyword = secondKeywordPool;
    deps.log(
      `[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uBBF8\uB178\uCD9C \uB204\uC801 ${midMissCount}\uD68C(>=${G_FORCE_FULL_SECOND_SEARCH_AFTER_MISSES}) \u2192 \uD480\uAC80\uC0C9\uC5B4 \uAC15\uC81C: ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`,
      "warn"
    );
  } else if (catalogMid && productName && productName.length > 10) {
    secondSearchKeyword = productName;
    deps.log(
      `[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uD1B5\uD569\uAC80\uC0C9 (\uD480\uB124\uC784\xB7A\uB3D9\uC77C): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`
    );
  } else {
    secondSearchKeyword = pickGSecondSearchPhraseAvoidingBlacklist(
      engine,
      mid,
      firstKeyword,
      secondKeywordPool,
      workerId,
      deps
    );
    deps.log(
      `[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uD1B5\uD569\uAC80\uC0C9(5\uB2E8\uC5B4\xB7\uAF2C\uB9AC\uC5C6\uC74C): ${secondSearchKeyword.substring(0, 50)}${secondSearchKeyword.length > 50 ? "..." : ""}`
    );
  }
  if (mustUseFullSecondKeyword && deps.isSecondComboBlacklisted(engine, mid, secondSearchKeyword)) {
    deps.log(
      `[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uD480\uAC80\uC0C9\uC5B4 \uBBF8\uB178\uCD9C \uC774\uB825 \uC874\uC7AC\uD558\uC9C0\uB9CC \uC2E4\uC2DC\uAC04 \uC7AC\uAC80\uC99D \uC9C4\uD589(mid=${mid})`,
      "warn"
    );
  }
  const typedOk = await integratedSearchClearAllAndSubmitNewQuery(
    page,
    engine,
    workerId,
    deps,
    secondSearchKeyword
  );
  if (!typedOk) {
    deps.log(`[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uAC80\uC0C9\uCC3D \uC785\uB825 \uC2E4\uD328 \u2192 URL \uC9C1\uC811 \uC774\uB3D9 \uD3F4\uBC31`, "warn");
    await page.goto(buildIntegratedSearchUrl(secondSearchKeyword), { waitUntil: "domcontentloaded", timeout: 6e4 });
  }
  await deps.sleep(engine.delay("afterSecondSearchLoad"));
  return { ok: true, flowLabel, secondSearchPhraseUsed: secondSearchKeyword };
}

// flows/traffic-search-flow.ts
function trafficFlowLabel(flow) {
  return flow === "A" ? "A \uD1B5\uD5691+2\uCC28" : flow === "B" ? "B \uD1B5\uD569\uBA54\uC778" : flow === "C" ? "C \uD1B5\uD5692\uCC28" : flow === "E" ? "E ackey\uC704\uC7A5URL" : flow === "F" ? "F \uD1B5\uD569\uC0C1\uD488\uBA85" : flow === "G" ? "G \uD1B5\uD5695\uB2E8\uC5B4+\uC81C\uC678\uD0A4\uC6CC\uB4DC" : flow;
}
async function prepareTrafficSearchFlow(input, deps) {
  const flow = input.engine.searchFlowVersion;
  const flowLabel = trafficFlowLabel(flow);
  deps.log(`[Worker ${input.workerId}] \uAC80\uC0C9 \uC2DC\uC791 (\uC791\uC5C5 \uBAA8\uB4DC: ${flowLabel})`);
  if (flow === "A")
    return runTrafficFlowA(input, deps, flowLabel);
  if (flow === "C")
    return runTrafficFlowC(input, deps, flowLabel);
  if (flow === "E")
    return runTrafficFlowE(input, deps, flowLabel);
  if (flow === "F")
    return runTrafficFlowF(input, deps, flowLabel);
  if (flow === "G")
    return runTrafficFlowG(input, deps, flowLabel);
  return runTrafficFlowB(input, deps, flowLabel);
}

// strategy-sync.ts
var fs4 = __toESM(require("fs"));
function toNonNegativeInt(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
function extractMidFromLinkUrl(linkUrl) {
  const match = String(linkUrl).match(/\/products\/(\d+)/);
  return match ? match[1] : "";
}
function normalizeRuntime(strategy) {
  const runtime = strategy.runtime || {};
  const taskSource = runtime.taskSource || {};
  return {
    ...runtime,
    taskSource: {
      taskFilePath: taskSource.taskFilePath || "engine-next-task.json",
      resultFilePath: taskSource.resultFilePath || "engine-last-result.json"
    }
  };
}
function normalizeStrategy(strategy) {
  const runtime = normalizeRuntime(strategy);
  const tasks = (strategy.tasks || []).map((task) => {
    const keyword = String(task.keyword || "").trim();
    const linkUrl = String(task.linkUrl || "").trim();
    const keywordName = String(task.keywordName || "").trim();
    return {
      checked: task.checked !== false,
      keyword,
      linkUrl,
      mid: extractMidFromLinkUrl(linkUrl),
      keywordName,
      targetCount: toNonNegativeInt(task.targetCount),
      productTitle: String(task.productTitle || "").trim(),
      currentRank: String(task.currentRank || "").trim(),
      startRank: String(task.startRank || "").trim(),
      trafficOk: toNonNegativeInt(task.trafficOk),
      trafficFail: toNonNegativeInt(task.trafficFail),
      yesterdayOk: toNonNegativeInt(task.yesterdayOk),
      yesterdayFail: toNonNegativeInt(task.yesterdayFail),
      reviewCount: String(task.reviewCount || "").trim(),
      starRating: String(task.starRating || "").trim()
    };
  });
  return {
    version: 1,
    name: String(strategy.name || "").trim(),
    description: strategy.description?.trim(),
    runtime,
    tasks
  };
}
function validateStrategy(strategy) {
  const normalized = normalizeStrategy(strategy);
  const errors = [];
  const warnings = [];
  const flow = normalized.runtime.search?.searchFlowVersion || "A";
  if (normalized.version !== 1) {
    errors.push(`Unsupported strategy version: ${String(strategy.version)}`);
  }
  if (!normalized.name) {
    errors.push("Strategy name is required.");
  }
  if (!normalized.tasks.length) {
    errors.push("At least one task is required.");
  }
  if (!isSupportedSearchFlowVersion(flow)) {
    errors.push(`Unsupported searchFlowVersion: ${String(flow)}`);
  }
  normalized.tasks.forEach((task, index) => {
    const label = `tasks[${index}]`;
    if (!task.keyword) {
      errors.push(`${label}: keyword is required.`);
    }
    if (!task.linkUrl) {
      errors.push(`${label}: linkUrl is required.`);
    }
    if (!task.mid) {
      errors.push(`${label}: linkUrl must include /products/<mid>.`);
    }
    if (flow === "C" && !task.keywordName) {
      errors.push(`${label}: flow C requires keywordName.`);
    }
    if (flow === "G" && !task.keywordName) {
      errors.push(`${label}: flow G requires keywordName (2\uCC28 \uB2E8\uC5B4 \uD480).`);
    }
    if (flow !== "D" && task.checked && task.targetCount <= 0) {
      warnings.push(`${label}: non-D flows usually need targetCount > 0 for infinite-run parity.`);
    }
  });
  if (!normalized.tasks.some((task) => task.checked)) {
    warnings.push("No tasks are checked. tasks.txt will be generated, but next-task selection will fail.");
  }
  return { errors, warnings };
}
function isSupportedSearchFlowVersion(value) {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E" || value === "F" || value === "G";
}
function loadStrategyFile(strategyPath) {
  const raw = fs4.readFileSync(strategyPath, "utf-8");
  return JSON.parse(raw);
}

// unified-runner.ts
var getDriveLetter = () => {
  try {
    if (fs5.existsSync("D:\\")) {
      return "D:\\temp";
    }
  } catch (e) {
  }
  return "C:\\turafic\\temp";
};
var TEMP_DIR = getDriveLetter();
try {
  if (!fs5.existsSync(TEMP_DIR)) {
    fs5.mkdirSync(TEMP_DIR, { recursive: true });
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
  path4.join(process.cwd(), ".env.local"),
  path4.join(process.cwd(), ".env"),
  path4.join(__dirname, ".env"),
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
var STRATEGY_ARG = (() => {
  const idx = process.argv.indexOf("--strategy");
  return idx !== -1 ? process.argv[idx + 1] : void 0;
})();
var BROWSER_POSITIONS = [
  { x: 0, y: 0 },
  // Worker 1: 좌상단
  { x: 560, y: 0 },
  // Worker 2: 우상단
  { x: 0, y: 760 },
  // Worker 3: 좌하단
  { x: 560, y: 760 }
  // Worker 4: 우하단
];
var BROWSER_WIDTH = 560;
var BROWSER_HEIGHT = 760;
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
    if (!fs5.existsSync(filePath))
      return [];
    const raw = fs5.readFileSync(filePath, "utf-8");
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
function countBlacklistedSecondCombosForMid(runtime, mid) {
  if (!runtime.keywordBlacklistEnabled)
    return 0;
  const targetMid = (mid || "").trim();
  if (!targetMid)
    return 0;
  const items = readKeywordBlacklistItems(runtime.keywordBlacklistPath);
  return items.filter((e) => (e.mid || "").trim() === targetMid).length;
}
async function appendSecondComboBlacklistEntry(runtime, mid, secondSearchPhrase) {
  if (!runtime.keywordBlacklistEnabled)
    return;
  const norm = normalizeComboForBlacklist(secondSearchPhrase);
  if (!mid || !norm)
    return;
  const filePath = runtime.keywordBlacklistPath;
  const dir = path4.dirname(filePath);
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
      if (!fs5.existsSync(dir)) {
        fs5.mkdirSync(dir, { recursive: true });
      }
      fs5.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
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
    (0, import_child_process2.execSync)("git fetch --quiet origin main", {
      encoding: "utf8",
      timeout: 3e4,
      stdio: ["ignore", "pipe", "pipe"]
    });
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
    return;
  }
  lastCommitHash = getCurrentCommitHash();
  setInterval(() => {
    if (checkForUpdates()) {
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
async function isMobileBrowserPage2(page) {
  return page.evaluate(() => {
    const ua = navigator.userAgent || "";
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
    const width = Math.min(
      window.innerWidth || Number.MAX_SAFE_INTEGER,
      document.documentElement?.clientWidth || Number.MAX_SAFE_INTEGER,
      screen.width || Number.MAX_SAFE_INTEGER
    );
    return uaMobile || navigator.maxTouchPoints > 0 && width <= 768;
  }).catch(() => false);
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
async function scrollIntegratedSearchPageDown(page, deltaY) {
  await page.evaluate((dy) => {
    const hints = ["#ct", "#content", "#main_pack", ".api_subject_bx", ".sc_new", "#wrap", "main"];
    for (const sel of hints) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement) {
        const sh = el.scrollHeight;
        const ch = el.clientHeight;
        if (sh > ch + 50) {
          const max = sh - ch;
          el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + dy));
          return true;
        }
      }
    }
    let best = null;
    let bestExcess = 0;
    for (const el of document.body.querySelectorAll("div")) {
      if (!(el instanceof HTMLElement))
        continue;
      const st = getComputedStyle(el);
      if (st.overflowY !== "scroll" && st.overflowY !== "auto")
        continue;
      const excess = el.scrollHeight - el.clientHeight;
      if (excess > bestExcess && excess > 100) {
        bestExcess = excess;
        best = el;
      }
    }
    if (best) {
      const max = best.scrollHeight - best.clientHeight;
      best.scrollTop = Math.min(max, Math.max(0, best.scrollTop + dy));
      return true;
    }
    window.scrollBy(0, dy);
    return true;
  }, deltaY).catch(() => {
  });
  await sleep2(120 + Math.floor(Math.random() * 120));
}
async function scrollSmartstoreDetailBy(page, deltaY) {
  const applied = await page.evaluate((dy) => {
    const pickScrollTarget = () => {
      const hints = ["#wrap", "main", "#content", "#__next", '[id*="layout"]', ".container"];
      for (const sel of hints) {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement) {
          const sh = el.scrollHeight;
          const ch = el.clientHeight;
          if (sh > ch + 60)
            return el;
        }
      }
      let best = null;
      let bestExcess = 0;
      const nodes = document.body.querySelectorAll("div, main, section, article");
      for (const el of nodes) {
        if (!(el instanceof HTMLElement))
          continue;
        const st = getComputedStyle(el);
        if (st.overflowY !== "scroll" && st.overflowY !== "auto")
          continue;
        const excess = el.scrollHeight - el.clientHeight;
        if (excess > bestExcess && excess > 100) {
          bestExcess = excess;
          best = el;
        }
      }
      return best || document.scrollingElement || document.documentElement;
    };
    const target = pickScrollTarget();
    const docEl = document.documentElement;
    const body = document.body;
    if (target === docEl || target === body || target === document.scrollingElement) {
      window.scrollBy(0, dy);
      return true;
    }
    if (target instanceof HTMLElement) {
      const max = target.scrollHeight - target.clientHeight;
      const next = Math.max(0, Math.min(max, target.scrollTop + dy));
      if (next !== target.scrollTop) {
        target.scrollTop = next;
        return true;
      }
    }
    window.scrollBy(0, dy);
    return true;
  }, deltaY).catch(() => false);
  if (!applied) {
    await page.evaluate((dy) => window.scrollBy(0, dy), deltaY).catch(() => {
    });
  }
  await sleep2(160 + Math.floor(Math.random() * 140));
}
async function gModeDetailPageOscillateScroll(page, engine) {
  const base = Math.min(520, Math.max(220, engine.explorationScrollPixels));
  const down1 = Math.floor(base * 0.55);
  const up = -Math.floor(base * 0.38);
  const down2 = Math.floor(base * 0.3);
  await scrollSmartstoreDetailBy(page, down1);
  await sleep2(engine.delay("explorationBetweenScrolls"));
  await scrollSmartstoreDetailBy(page, up);
  await sleep2(engine.delay("explorationBetweenScrolls"));
  await scrollSmartstoreDetailBy(page, down2);
  const vp = page.viewportSize();
  if (vp && vp.width > 80 && vp.height > 80) {
    const cx = Math.max(20, Math.floor(vp.width / 2));
    const cy = Math.max(20, Math.floor(vp.height * 0.45));
    try {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, 340);
      await sleep2(220 + Math.floor(Math.random() * 120));
      await page.mouse.wheel(0, -200);
      await sleep2(200 + Math.floor(Math.random() * 100));
      await page.mouse.wheel(0, 140);
    } catch {
    }
  }
  await sleep2(200 + Math.floor(Math.random() * 160));
}
var NAVER_LOGIN_URL = "https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com/";
var NAVER_ACCOUNT_PATHS = [
  path4.join(process.cwd(), "naver-account.txt"),
  path4.join(__dirname, "naver-account.txt")
];
function getNaverLoginStorageStatePaths(profileName) {
  return [
    path4.join(process.cwd(), "profiles", `${profileName}.storage-state.json`),
    path4.join(__dirname, "profiles", `${profileName}.storage-state.json`)
  ];
}
function resolveExistingNaverLoginStorageStatePath(profileName) {
  for (const p of getNaverLoginStorageStatePaths(profileName)) {
    if (fs5.existsSync(p))
      return p;
  }
  return null;
}
function resolveWritableNaverLoginStorageStatePath(profileName) {
  return getNaverLoginStorageStatePaths(profileName)[0];
}
function readNaverAccountFile() {
  let found = null;
  for (const p of NAVER_ACCOUNT_PATHS) {
    if (fs5.existsSync(p)) {
      found = p;
      break;
    }
  }
  if (!found)
    return { status: "absent" };
  const raw = fs5.readFileSync(found, "utf-8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
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
async function waitForNaverLoginCompletion(page, workerId, label, timeoutMs = 45e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep2(500);
    if (!page.url().includes("nidlogin.login")) {
      await sleep2(randomBetween(1500, 2500));
      log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC644\uB8CC${label ? ` (${label})` : ""}`);
      return true;
    }
  }
  log2(
    `[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uD0C0\uC784\uC544\uC6C3${label ? ` (${label})` : ""} (\uB85C\uADF8\uC778 \uD398\uC774\uC9C0 \uC774\uD0C8 \uC5C6\uC74C)`,
    "warn"
  );
  return false;
}
async function persistNaverLoginStorageState(context, profileName, workerId) {
  if (!context)
    return;
  const targetPath = resolveWritableNaverLoginStorageStatePath(profileName);
  const dir = path4.dirname(targetPath);
  try {
    if (!fs5.existsSync(dir)) {
      fs5.mkdirSync(dir, { recursive: true });
    }
    await context.storageState({ path: targetPath });
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uC138\uC158 \uC800\uC7A5 \uC644\uB8CC: ${targetPath}`);
  } catch (e) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uC138\uC158 \uC800\uC7A5 \uC2E4\uD328: ${e?.message ?? e}`, "warn");
  }
}
async function ensureNaverLoginIfConfigured(page, workerId, context, profileName, ignoreStoredSession = false) {
  const storedPath = resolveExistingNaverLoginStorageStatePath(profileName);
  if (storedPath && !ignoreStoredSession) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uC800\uC7A5 \uC138\uC158 \uC0AC\uC6A9: ${storedPath}`);
    return true;
  }
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
    const ok = await waitForNaverLoginCompletion(page, workerId, "\uC790\uB3D9");
    if (ok) {
      await persistNaverLoginStorageState(context, profileName, workerId);
    }
    return ok;
  } catch (e) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC608\uC678: ${e.message}`, "warn");
    return false;
  }
}
async function ensureNaverLoginManually(page, workerId, context, profileName) {
  try {
    await page.goto(NAVER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
    await sleep2(randomBetween(1e3, 1800));
    await page.locator("#id").waitFor({ state: "visible", timeout: 2e4 });
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uC218\uB3D9 \uB85C\uADF8\uC778 \uB300\uAE30 \uC911 - \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC9C1\uC811 \uB85C\uADF8\uC778\uD558\uC138\uC694.`);
    const ok = await waitForNaverLoginCompletion(page, workerId, "\uC218\uB3D9", 5 * 60 * 1e3);
    if (ok) {
      await persistNaverLoginStorageState(context, profileName, workerId);
    }
    return ok;
  } catch (e) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uC218\uB3D9 \uB85C\uADF8\uC778 \uC608\uC678: ${e.message}`, "warn");
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
    return await waitForNaverLoginCompletion(page, workerId, "PRb", 45e3);
  } catch (e) {
    log2(`[Worker ${workerId}] \uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uC608\uC678(PRb): ${e.message}`, "warn");
    return false;
  }
}
function cleanupChromeTempFolders() {
  const tempDirs = ["D:\\temp", "D:\\tmp"];
  let totalCleaned = 0;
  for (const tempDir of tempDirs) {
    if (!fs5.existsSync(tempDir))
      continue;
    try {
      const entries = fs5.readdirSync(tempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (entry.name.startsWith("puppeteer_") || entry.name.startsWith("lighthouse") || entry.name.startsWith("chrome_") || entry.name.startsWith(".org.chromium.") || entry.name.startsWith("scoped_dir"))) {
          const folderPath = path4.join(tempDir, entry.name);
          try {
            fs5.rmSync(folderPath, { recursive: true, force: true });
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
  const profilePath = path4.join(__dirname, "profiles", `${profileName}.json`);
  if (fs5.existsSync(profilePath)) {
    const content = fs5.readFileSync(profilePath, "utf-8");
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
function extractMidFromLinkUrl2(linkUrl) {
  if (!linkUrl || typeof linkUrl !== "string")
    return null;
  const m = linkUrl.match(/\/products\/(\d+)/);
  return m ? m[1] : null;
}
function toCombinedKeyword(fullTitle) {
  return (fullTitle || "").replace(/\s+/g, "").trim() || "\uC0C1\uD488";
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
    fs5.renameSync(filePath, processingPath);
  } catch {
    return null;
  }
  let raw;
  try {
    raw = fs5.readFileSync(processingPath, "utf-8");
  } catch {
    try {
      fs5.unlinkSync(processingPath);
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
      fs5.unlinkSync(processingPath);
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
      fs5.unlinkSync(processingPath);
    } catch {
    }
    return null;
  }
  const mid = extractMidFromLinkUrl2(linkUrl);
  if (!mid) {
    log2(`[EngineFile] linkUrl\uC5D0\uC11C mid \uCD94\uCD9C \uBD88\uAC00 \u2014 ${linkUrl}`, "warn");
    try {
      fs5.unlinkSync(processingPath);
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
        fs5.renameSync(processingPath, filePath);
      } catch {
        try {
          fs5.unlinkSync(processingPath);
        } catch {
        }
      }
      return null;
    }
    markCombinedKeywordUsedToday(combined);
  }
  try {
    fs5.unlinkSync(processingPath);
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
var strategyQueue = null;
function buildBrowserChannelCandidates() {
  const explicit = process.env.PLAYWRIGHT_BROWSER_CHANNEL || process.env.BROWSER_CHANNEL;
  if (explicit && explicit.trim())
    return [explicit.trim()];
  return ["chrome", "msedge", void 0];
}
async function launchChromiumWithChannelFallback(browserLaunchOptions) {
  let lastError;
  for (const channel of buildBrowserChannelCandidates()) {
    const options = { ...browserLaunchOptions };
    if (channel)
      options.channel = channel;
    else
      delete options.channel;
    try {
      return await import_patchright.chromium.launch(options);
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e || "");
      if (!/Executable doesn't exist|Failed to launch|channel/i.test(msg))
        throw e;
    }
  }
  throw lastError ?? new Error("chromium launch failed");
}
function reloadEngineConfigForNextClaim() {
  const previous = ENGINE;
  const next = loadEngineConfig();
  ENGINE = next;
  if (previous.searchFlowVersion !== next.searchFlowVersion || previous.workMode !== next.workMode || previous.proxyEnabled !== next.proxyEnabled || previous.engineTaskFilePath !== next.engineTaskFilePath || previous.engineResultFilePath !== next.engineResultFilePath) {
    log2(
      `[EngineConfig] \uC124\uC815 \uC7AC\uB85C\uB4DC: \uAC80\uC0C9\uBAA8\uB4DC ${previous.searchFlowVersion}\u2192${next.searchFlowVersion}, workMode ${previous.workMode}\u2192${next.workMode}, proxy ${previous.proxyEnabled}\u2192${next.proxyEnabled}`
    );
  }
}
function createStrategyQueue(strategy) {
  const tasks = strategy.tasks.filter((t) => t.checked);
  if (tasks.length === 0) {
    throw new Error("[Strategy] checked \uC791\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. tasks\uC5D0 checked:true \uD56D\uBAA9\uC744 \uCD94\uAC00\uD558\uC138\uC694.");
  }
  return { tasks, runCounts: /* @__PURE__ */ new Map(), cursor: 0, done: false };
}
function buildWorkItemFromStrategyTask(task) {
  return {
    taskId: Date.now(),
    slotSequence: 0,
    keyword: task.keyword,
    productName: task.keywordName || task.keyword,
    mid: task.mid,
    linkUrl: task.linkUrl,
    keywordName: task.keywordName || task.keyword,
    secondKeywordRaw: task.keywordName || void 0,
    catalogMid: void 0
  };
}
function claimFromStrategyQueue() {
  const q = strategyQueue;
  for (let i = 0; i < q.tasks.length; i++) {
    const idx = (q.cursor + i) % q.tasks.length;
    const task = q.tasks[idx];
    const done = q.runCounts.get(task.mid) ?? 0;
    if (task.targetCount <= 0 || done < task.targetCount) {
      const next = done + 1;
      q.runCounts.set(task.mid, next);
      if (task.targetCount > 0) {
        log2(`[Strategy] ${task.mid} \uC2E4\uD589 ${next}/${task.targetCount}`);
      }
      q.cursor = (idx + 1) % q.tasks.length;
      return buildWorkItemFromStrategyTask(task);
    }
  }
  q.done = true;
  return null;
}
async function claimWorkItem() {
  if (strategyQueue) {
    return claimFromStrategyQueue();
  }
  while (isClaimingTask) {
    await sleep2(100);
  }
  isClaimingTask = true;
  try {
    reloadEngineConfigForNextClaim();
    return tryClaimWorkItemFromEngineFile();
  } catch (e) {
    log2(`[CLAIM ERROR] ${e.message}`, "error");
    return null;
  } finally {
    isClaimingTask = false;
  }
}
async function detectNaverShoppingAccessBlocked(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const titleText = document.title || "";
    const merged = `${titleText}
${bodyText}`;
    return merged.includes("\uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC") || merged.includes("\uC790\uB3D9\uD654\uB41C \uC811\uADFC") || merged.includes("\uC811\uADFC\uC774 \uC81C\uD55C") || merged.includes("\uC811\uC18D\uC774 \uC81C\uD55C") || merged.includes("\uC1FC\uD551 \uC11C\uBE44\uC2A4 \uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C") || merged.includes("\uC774\uC6A9\uC774 \uC81C\uD55C") || merged.includes("\uBE44\uC815\uC0C1\uC801\uC778 \uC694\uCCAD") || merged.includes("\uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC");
  }).catch(() => false);
}
function shouldBlacklistSecondComboAfterRun(r) {
  if (r.productPageEntered)
    return false;
  return r.failReason === "NO_MID_MATCH" || r.failReason === "DETAIL_NOT_REACHED";
}
function shouldAppendSecondComboBlacklistAfterRun(flow, r) {
  if (flow === "G" && r.failReason === "PRODUCT_NOT_FOUND" && (r.secondSearchPhraseUsed || "").trim()) {
    return true;
  }
  return flow === "A" && shouldBlacklistSecondComboAfterRun(r);
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
    fs5.writeFileSync(ENGINE.engineResultFilePath, JSON.stringify(payload, null, 2), "utf-8");
    log2(`[EngineFile] \uACB0\uACFC \uC800\uC7A5: ${ENGINE.engineResultFilePath} ok=${payload.ok}`);
  } catch (e) {
    log2(`[EngineFile] \uACB0\uACFC \uD30C\uC77C \uAE30\uB85D \uC2E4\uD328: ${e.message}`, "warn");
  }
}
async function collectSearchDomDiagnostics(page, mid, catalogMid) {
  try {
    const diag = await page.evaluate(({ mid: mid2, catalogMid: catalogMid2 }) => {
      const bodyText = document.body?.innerText || "";
      const title = document.title || "";
      const targetId = `nstore_productId_${mid2}`;
      const targetCatalogId = catalogMid2 ? `nstore_productId_${catalogMid2}` : "";
      const count = (sel) => document.querySelectorAll(sel).length;
      const has = (sel) => !!document.querySelector(sel);
      const errorHints = ["\uBCF4\uC548 \uD655\uC778", "\uC790\uB3D9\uC785\uB825\uBC29\uC9C0", "Too Many Requests", "\uC5D0\uB7EC\uD398\uC774\uC9C0", "\uC2DC\uC2A4\uD15C\uC624\uB958", "\uC811\uC18D\uC774 \uBD88\uAC00\uD569\uB2C8\uB2E4"].filter(
        (t) => `${title} ${bodyText}`.includes(t)
      );
      const targetSelectors = [
        `#${targetId}`,
        `a[aria-labelledby="${targetId}"]`,
        `a[href*="/products/${mid2}"]`,
        `a[href*="main/products/${mid2}"]`,
        `a[href*="nv_mid=${mid2}"]`
      ];
      if (catalogMid2) {
        targetSelectors.unshift(`#nstore_productId_${catalogMid2}`);
        targetSelectors.unshift(`a[data-shp-contents-id="${catalogMid2}"]`);
      }
      return {
        url: location.href,
        readyState: document.readyState,
        title,
        slogVisibleCount: count("li._slog_visible"),
        slogContentCount: count("[data-slog-content]"),
        targetIdVisible: has(`#${targetId}`),
        targetCatalogVisible: catalogMid2 ? has(`#nstore_productId_${catalogMid2}`) : false,
        targetSelectors: targetSelectors.filter((sel) => has(sel)),
        errorHints,
        bodySnippet: bodyText.slice(0, 220).replace(/\s+/g, " ").trim()
      };
    }, { mid, catalogMid: catalogMid ?? null });
    return `[DOM] url=${diag.url} readyState=${diag.readyState} title=${JSON.stringify(diag.title)} slogVisible=${diag.slogVisibleCount} dataSlog=${diag.slogContentCount} targetId=${diag.targetIdVisible} catalogId=${diag.targetCatalogVisible} matched=${diag.targetSelectors.join(",") || "-"} errors=${diag.errorHints.join(",") || "-"} body=${JSON.stringify(diag.bodySnippet)}`;
  } catch (e) {
    return `[DOM] diagnostics unavailable: ${e?.message || String(e)}`;
  }
}
async function inspectDetailSystemError(page) {
  try {
    return await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const title = clean(document.title);
      const body = clean(document.body?.innerText || "");
      const haystack = `${title} ${body}`;
      const patterns = [
        "\uC2DC\uC2A4\uD15C\uC624\uB958",
        "\uC2DC\uC2A4\uD15C \uC624\uB958",
        "\uC5D0\uB7EC\uD398\uC774\uC9C0",
        "\uD604\uC7AC \uC11C\uBE44\uC2A4 \uC811\uC18D\uC774 \uBD88\uAC00\uD569\uB2C8\uB2E4",
        "\uC77C\uC2DC\uC801\uC778 \uC11C\uBE44\uC2A4 \uC7A5\uC560",
        "Too Many Requests",
        "\uC811\uC18D\uC774 \uBD88\uAC00\uD569\uB2C8\uB2E4"
      ];
      const reason = patterns.find((pattern) => haystack.includes(pattern)) || "";
      return {
        detected: Boolean(reason),
        reason,
        title,
        snippet: body.substring(0, 160)
      };
    });
  } catch (e) {
    return {
      detected: false,
      reason: "",
      title: "",
      snippet: `detail error inspection failed: ${e?.message || e}`
    };
  }
}
async function findTrafficMidLink(page, mid, catalogMid, expectedProductName, expectedStoreAlias, expectedKeyword) {
  const linkHandle = await page.evaluateHandle(({ mid: mid2, catalogMid: catalogMid2, expectedProductName: expectedProductName2, expectedStoreAlias: expectedStoreAlias2, expectedKeyword: expectedKeyword2 }) => {
    const mids = [catalogMid2, mid2].filter(Boolean);
    const isAdAnchor = (anchor) => {
      const inventory = anchor.getAttribute("data-shp-inventory") || anchor.closest("[data-shp-inventory]")?.getAttribute("data-shp-inventory") || "";
      return /lst\*(A|P|D)/.test(inventory);
    };
    const directProductHref = (href, targetMid) => {
      return href.includes(`/products/${targetMid}`) || href.includes(`smartstore.naver.com/main/products/${targetMid}`) || href.includes(`m.smartstore.naver.com/main/products/${targetMid}`);
    };
    const trackedSearchHref = (href, targetMid) => {
      return href.includes(targetMid) && (href.includes("/p/crd/rd") || href.includes("cr.shopping") || href.includes("cr2.shopping") || href.includes("cr3.shopping") || href.includes("/bridge/searchGate") || href.includes("searchGate"));
    };
    const normalize = (s) => String(s || "").toLowerCase().replace(/\u00a0/g, " ").replace(/[^\wㄱ-ㅎㅏ-ㅣ가-힣]+/g, " ").replace(/\s+/g, " ").trim();
    const normProduct = normalize(expectedProductName2 || "");
    const productTokens = normProduct.split(" ").filter((t) => t.length >= 2);
    const normStoreAlias = normalize(expectedStoreAlias2 || "");
    const normKeyword = normalize(expectedKeyword2 || "");
    const hasStoreAlias = (text) => {
      if (!normStoreAlias)
        return false;
      return normalize(text).includes(normStoreAlias);
    };
    const collectAnchorContextText = (anchor) => {
      const chunks = [];
      const own = (anchor.textContent || "").trim();
      if (own)
        chunks.push(own);
      const card = anchor.closest("[data-shp-contents-id]") || anchor.closest("li") || anchor.closest("article") || anchor.closest("div");
      if (card) {
        const cardText = (card.textContent || "").trim();
        if (cardText)
          chunks.push(cardText.slice(0, 700));
      }
      const aria = `${anchor.getAttribute("aria-label") || ""} ${anchor.getAttribute("title") || ""}`.trim();
      if (aria)
        chunks.push(aria);
      return chunks.join(" ");
    };
    const isTitleStoreFallbackMatch = (anchor) => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      if (!(href.includes("searchGate") || href.includes("nv_mid=")))
        return false;
      if (isAdAnchor(anchor))
        return false;
      const contextText = collectAnchorContextText(anchor);
      const normContext = normalize(contextText);
      let hit = 0;
      for (const token of productTokens) {
        if (normContext.includes(token))
          hit++;
      }
      const ratio = productTokens.length > 0 ? hit / productTokens.length : 0;
      const keywordMatched = normKeyword && normKeyword.length >= 2 ? normContext.includes(normKeyword) : false;
      if (normStoreAlias && hasStoreAlias(contextText)) {
        if (keywordMatched)
          return true;
        if (productTokens.length === 0)
          return true;
        if (productTokens.length <= 2)
          return hit >= 1;
        if (productTokens.length <= 4)
          return hit >= 2;
        return hit >= 2 && ratio >= 0.45;
      }
      if (productTokens.length >= 5) {
        return hit >= 4 && ratio >= 0.65;
      }
      if (productTokens.length >= 3) {
        return hit >= 3 && ratio >= 0.75;
      }
      return false;
    };
    const scoreAnchor = (anchor) => {
      if (isAdAnchor(anchor))
        return null;
      const href = anchor.href || anchor.getAttribute("href") || "";
      const contentId = anchor.getAttribute("data-shp-contents-id") || "";
      const labelledBy = anchor.getAttribute("aria-labelledby") || "";
      const dataset = JSON.stringify(anchor.dataset || {});
      for (const targetMid of mids) {
        if (trackedSearchHref(href, targetMid))
          return { score: 0, method: "tracked-search-gate" };
      }
      for (const targetMid of mids) {
        if (href.includes(`nv_mid=${targetMid}`))
          return { score: 1, method: "nv_mid" };
      }
      for (const targetMid of mids) {
        if (href.includes("searchGate") && href.includes(targetMid))
          return { score: 2, method: "searchGate" };
      }
      for (const targetMid of mids) {
        if (contentId === targetMid)
          return { score: 3, method: "data-shp-contents-id" };
      }
      for (const targetMid of mids) {
        if (labelledBy.includes(`nstore_productId_${targetMid}`))
          return { score: 4, method: "aria-product-id" };
      }
      for (const targetMid of mids) {
        if (dataset.includes(targetMid))
          return { score: 5, method: "data-attr-mid" };
      }
      for (const targetMid of mids) {
        if (directProductHref(href, targetMid))
          return { score: 6, method: "direct-product" };
      }
      if (isTitleStoreFallbackMatch(anchor)) {
        return { score: 7, method: "title-store-fallback" };
      }
      return null;
    };
    const anchors = Array.from(document.querySelectorAll("a"));
    const ranked = anchors.map((anchor, index) => {
      const scored = scoreAnchor(anchor);
      return scored ? { anchor, index, ...scored } : null;
    }).filter((item) => Boolean(item)).sort((a, b) => a.score - b.score || a.index - b.index);
    const clipHref = (anchor) => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      return href.substring(0, 180);
    };
    if (ranked.length > 0) {
      return { link: ranked[0].anchor, method: ranked[0].method, hrefSnippet: clipHref(ranked[0].anchor) };
    }
    for (const targetMid of mids) {
      const marker = document.getElementById(`nstore_productId_${targetMid}`);
      if (!marker)
        continue;
      let cur = marker;
      while (cur) {
        const anchor = cur.matches("a") ? cur : cur.querySelector("a");
        if (anchor instanceof HTMLAnchorElement && !isAdAnchor(anchor)) {
          return { link: anchor, method: "product-id-container", hrefSnippet: clipHref(anchor) };
        }
        cur = cur.parentElement;
      }
      let sibling = marker.previousElementSibling;
      while (sibling) {
        if (sibling instanceof HTMLAnchorElement && !isAdAnchor(sibling)) {
          return { link: sibling, method: "product-id-sibling", hrefSnippet: clipHref(sibling) };
        }
        const anchor = sibling.querySelector("a");
        if (anchor instanceof HTMLAnchorElement && !isAdAnchor(anchor)) {
          return { link: anchor, method: "product-id-sibling", hrefSnippet: clipHref(anchor) };
        }
        sibling = sibling.previousElementSibling;
      }
    }
    return { link: null, method: "", hrefSnippet: "" };
  }, {
    mid,
    catalogMid: catalogMid ?? null,
    expectedProductName: expectedProductName ?? null,
    expectedStoreAlias: expectedStoreAlias ?? null,
    expectedKeyword: expectedKeyword ?? null
  });
  const props = await linkHandle.getProperties();
  const link = props.get("link")?.asElement();
  const method = await props.get("method")?.jsonValue().catch(() => "");
  const hrefSnippet = await props.get("hrefSnippet")?.jsonValue().catch(() => "");
  await linkHandle.dispose().catch(() => {
  });
  return link ? { link, method: String(method || "unknown"), hrefSnippet: String(hrefSnippet || "") } : null;
}
function extractStoreAliasFromLinkUrl(linkUrl) {
  const raw = (linkUrl || "").trim();
  if (!raw)
    return "";
  try {
    const u = new URL(raw);
    if (!/smartstore\.naver\.com$/i.test(u.hostname))
      return "";
    const seg = (u.pathname || "/").split("/").filter(Boolean);
    if (seg.length > 0)
      return seg[0] || "";
    return "";
  } catch {
    return "";
  }
}
async function clickTrafficMidLink(page, link, workerId, method) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const failures = [];
    try {
      if (typeof link.scrollIntoViewIfNeeded === "function") {
        await link.scrollIntoViewIfNeeded().catch(() => {
        });
      }
      await link.evaluate((el) => {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        el.removeAttribute("target");
      });
      await sleep2(randomBetween(300, 600));
      const box = await link.boundingBox().catch(() => null);
      let clickedBy = "";
      if (box && box.width > 0 && box.height > 0) {
        const clickX = box.x + box.width / 2 + randomBetween(-Math.min(8, box.width / 4), Math.min(8, box.width / 4));
        const clickY = box.y + box.height / 2 + randomBetween(-Math.min(5, box.height / 4), Math.min(5, box.height / 4));
        const useTouch = await isMobileBrowserPage2(page);
        if (useTouch && page.touchscreen?.tap) {
          try {
            await page.touchscreen.tap(clickX, clickY);
            clickedBy = "touchscreen.tap";
          } catch (e) {
            failures.push(`touchscreen.tap=${e?.message || e}`);
          }
        }
        if (!clickedBy) {
          try {
            await page.mouse.move(clickX + randomBetween(-20, 20), clickY + randomBetween(-15, 15)).catch(() => {
            });
            await sleep2(randomBetween(80, 180));
            await page.mouse.click(clickX, clickY, { delay: randomBetween(35, 85) });
            clickedBy = "mouse.click";
          } catch (e) {
            failures.push(`mouse.click=${e?.message || e}`);
          }
        }
      } else {
        failures.push("boundingBox=missing");
      }
      if (!clickedBy) {
        try {
          await link.click({ timeout: 5e3 });
          clickedBy = "element.click";
        } catch (e) {
          failures.push(`element.click=${e?.message || e}`);
        }
      }
      if (!clickedBy) {
        try {
          const domClicked = await link.evaluate((el) => {
            el.removeAttribute("target");
            el.click();
            return true;
          });
          if (domClicked)
            clickedBy = "dom.click";
        } catch (e) {
          failures.push(`dom.click=${e?.message || e}`);
        }
      }
      if (clickedBy) {
        log2(`[Worker ${workerId}] MID \uB9C1\uD06C \uD074\uB9AD \uC131\uACF5 (${method}, ${clickedBy}, attempt ${attempt})`);
        return true;
      }
      log2(`[Worker ${workerId}] MID \uB9C1\uD06C \uD074\uB9AD \uC2E4\uD328 (${method}, attempt ${attempt}): ${failures.join(" | ") || "unknown"}`, "warn");
    } catch (e) {
      failures.push(`prepare=${e?.message || e}`);
      try {
        const domClicked = await link.evaluate((el) => {
          el.removeAttribute("target");
          el.click();
          return true;
        });
        if (domClicked) {
          log2(`[Worker ${workerId}] MID \uB9C1\uD06C \uD074\uB9AD \uC131\uACF5 (${method}, dom.click-after-prepare-fail, attempt ${attempt})`);
          return true;
        } else {
          failures.push("dom.click-after-prepare-fail=false");
        }
      } catch (fallbackError) {
        failures.push(`dom.click-after-prepare-fail=${fallbackError?.message || fallbackError}`);
      }
      log2(`[Worker ${workerId}] MID \uB9C1\uD06C \uD074\uB9AD \uC2E4\uD328 (${method}, attempt ${attempt}): ${failures.join(" | ")}`, "warn");
      await sleep2(500);
    }
  }
  return false;
}
var INTEGRATED_SHOP_PAGE_LIMIT = 5;
var INTEGRATED_SHOP_PAGE_SETTLE_MS = 900;
var PAGE_EVALUATE_NAME_POLYFILL2 = "window.__name = window.__name || ((fn) => fn);";
async function ensurePageEvaluateNamePolyfill(page) {
  await page.evaluate(PAGE_EVALUATE_NAME_POLYFILL2).catch(() => {
  });
}
async function clickIntegratedShoppingCarouselNext(page, maxCarouselPage = INTEGRATED_SHOP_PAGE_LIMIT) {
  await ensurePageEvaluateNamePolyfill(page);
  return page.evaluate((maxCarouselPage2) => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const readPaging = (text) => {
      const slash = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (slash) {
        return { current: Number(slash[1]), total: Number(slash[2]) };
      }
      const a11y = text.match(/현재\s*(\d+)\s*전체\s*(\d+)/);
      if (a11y) {
        return { current: Number(a11y[1]), total: Number(a11y[2]) };
      }
      return null;
    };
    const readPagingFromRoot = (root) => {
      if (!root)
        return null;
      const currentText = root.querySelector("._current, .cmm_npgs_now")?.textContent || root.querySelector("[aria-current='page']")?.textContent || "";
      const totalText = root.querySelector("._total")?.textContent || "";
      const current = Number((currentText.match(/\d+/) || [])[0]);
      const total = Number((totalText.match(/\d+/) || [])[0]);
      if (Number.isFinite(current) && Number.isFinite(total) && current > 0 && total > 0) {
        return { current, total };
      }
      return readPaging((root.textContent || "").replace(/\s+/g, " ").trim());
    };
    const shopLike = (text) => /(플러스스토어|가격비교|쇼핑|상품|스토어|상품판매)/.test(text);
    const findShopContainer = (from) => {
      let cur = from;
      for (let depth = 0; cur && depth < 16; depth++) {
        const text = cur.innerText || "";
        const hasCards = !!cur.querySelector("a.gift_link, a[data-shp-contents-id], [data-shp-contents-id], [class*='product_item'], [class*='product_title']");
        if (shopLike(text) && (readPaging(text) || hasCards))
          return cur;
        cur = cur.parentElement;
      }
      return null;
    };
    const directCandidates = Array.from(
      document.querySelectorAll(
        [
          "a.cmm_pg_next._next.on",
          "button.cmm_pg_next._next.on",
          ".pagination_wrap._page_root a.cmm_pg_next._next.on",
          ".pagination_wrap._page_root button.cmm_pg_next._next.on",
          "a._next.on",
          "button._next.on",
          "a[class*='pg_next'].on",
          "button[class*='pg_next'].on",
          "a[class*='btn_next']",
          "button[class*='btn_next']"
        ].join(",")
      )
    ).filter((el, idx, arr) => arr.indexOf(el) === idx);
    let lastPagingCurrent;
    let lastPagingTotal;
    for (const next of directCandidates) {
      if (!isVisible(next))
        continue;
      const cls = `${next.className || ""}`;
      const aria = `${next.getAttribute("aria-label") || ""} ${next.getAttribute("title") || ""} ${next.textContent || ""}`;
      if (/이전|prev|previous|left/i.test(`${aria} ${cls}`))
        continue;
      const disabled = next.getAttribute("aria-disabled") === "true" || next.hasAttribute("disabled") || /disabled|_off|inactive/i.test(cls);
      if (disabled)
        continue;
      const container = findShopContainer(next);
      const pagingRoot = next.closest(".pagination_wrap._page_root, .pagination_wrap, .cmm_pgs");
      const pageText = container?.innerText || document.body?.innerText || "";
      if (!container && !shopLike(pageText))
        continue;
      const paging = readPagingFromRoot(pagingRoot) || readPaging(pageText);
      if (paging) {
        lastPagingCurrent = paging.current;
        lastPagingTotal = paging.total;
        const pageLimit = Math.min(paging.total, maxCarouselPage2);
        if (!Number.isFinite(paging.current) || !Number.isFinite(paging.total) || paging.current >= pageLimit) {
          return {
            clicked: false,
            current: paging.current,
            total: paging.total,
            reachedEnd: true,
            reason: `pageLimitReached=${paging.current}/${paging.total}`
          };
        }
      }
      next.scrollIntoView({ block: "center", inline: "center" });
      next.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      next.click();
      return {
        clicked: true,
        current: paging?.current,
        total: paging?.total,
        label: paging ? `${paging.current + 1}/${paging.total}` : void 0
      };
    }
    const sections = Array.from(
      document.querySelectorAll(
        [
          "section._root_shp_lis",
          "section._root_shs_lis",
          "section._sp_nshop_gift",
          "section.sp_shop_gift",
          "section[class*='sp_shop']",
          "section[class*='shop_gift']",
          "section[class*='shop_product']",
          'section[class*="_root_shp"]',
          'section[class*="_root_shs"]',
          "section"
        ].join(",")
      )
    ).filter((section, idx, arr) => arr.indexOf(section) === idx);
    for (const section of sections) {
      const text = section.innerText || "";
      if (!/(플러스스토어|쇼핑|상품|스토어)/.test(text))
        continue;
      const paging = readPaging(text);
      if (!paging)
        continue;
      const { current, total } = paging;
      const pageLimit = Math.min(total, maxCarouselPage2);
      if (!Number.isFinite(current) || !Number.isFinite(total) || current >= pageLimit) {
        return {
          clicked: false,
          current,
          total,
          reachedEnd: true,
          reason: `pageLimitReached=${current}/${total}`
        };
      }
      const sectionRect = section.getBoundingClientRect();
      const directNext = section.querySelector(
        "a.cmm_pg_next._next.on, button.cmm_pg_next._next.on, a._next.on, button._next.on, a[class*='pg_next'].on, button[class*='pg_next'].on"
      );
      const buttons = [
        ...directNext ? [directNext] : [],
        ...Array.from(section.querySelectorAll("button,a,[role='button']"))
      ].filter((el) => isVisible(el)).filter((el) => {
        const aria = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.textContent || ""}`;
        const cls = `${el.className || ""}`;
        const rect = el.getBoundingClientRect();
        const disabled = el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled") || /disabled|_off|inactive/i.test(cls);
        if (disabled)
          return false;
        if (/이전|prev|previous|left/i.test(`${aria} ${cls}`))
          return false;
        if (/다음|next|right|btn_next|pg_next|cmm_pg_next|pagination_next|_next/i.test(`${aria} ${cls}`))
          return true;
        return rect.left > sectionRect.left + sectionRect.width / 2 && rect.width >= 18 && rect.width <= 90 && rect.height >= 18 && rect.height <= 90;
      }).sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
      const next = buttons[0];
      if (!next)
        continue;
      next.scrollIntoView({ block: "center", inline: "center" });
      next.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      next.click();
      return { clicked: true, current, total, label: `${current + 1}/${total}` };
    }
    return {
      clicked: false,
      current: lastPagingCurrent,
      total: lastPagingTotal,
      reason: `nextCandidates=${directCandidates.length}`
    };
  }, maxCarouselPage).catch((e) => ({ clicked: false, reason: e?.message || String(e) }));
}
async function waitForIntegratedShoppingPageSettle(page, expectedCurrent) {
  if (expectedCurrent) {
    await page.waitForFunction(
      (expected) => {
        const currentText = document.querySelector(".pagination_wrap._page_root ._current, .pagination_wrap._page_root .cmm_npgs_now")?.textContent || "";
        return Number((currentText.match(/\d+/) || [])[0]) === expected;
      },
      expectedCurrent,
      { timeout: 2500 }
    ).catch(() => {
    });
  }
  await sleep2(INTEGRATED_SHOP_PAGE_SETTLE_MS);
}
async function getIntegratedShoppingPagingState(page) {
  await ensurePageEvaluateNamePolyfill(page);
  return page.evaluate(() => {
    const root = document.querySelector(".pagination_wrap._page_root, .pagination_wrap, .cmm_pgs");
    if (!root)
      return null;
    const readNumber = (selector) => {
      const text = root.querySelector(selector)?.textContent || "";
      const n = Number((text.match(/\d+/) || [])[0]);
      return Number.isFinite(n) && n > 0 ? n : void 0;
    };
    const current = readNumber("._current, .cmm_npgs_now, [aria-current='page']");
    const total = readNumber("._total");
    return { current, total };
  }).catch(() => null);
}
async function waitForDomReady(page, timeoutMs = 3e4) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
    return true;
  } catch {
    try {
      await page.waitForFunction(
        () => document.readyState === "interactive" || document.readyState === "complete",
        { timeout: 5e3 }
      );
      return true;
    } catch {
      return false;
    }
  }
}
async function hasCaptchaChallenge(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    if (bodyText.includes("\uBCF4\uC548 \uD655\uC778") || bodyText.includes("\uC790\uB3D9\uC785\uB825\uBC29\uC9C0") || bodyText.includes("\uC790\uB3D9 \uC785\uB825 \uBC29\uC9C0") || bodyText.includes("\uBCF4\uC548\uBB38\uC790") || bodyText.includes("\uC601\uC218\uC99D") || bodyText.includes("\uAC00\uC0C1\uC73C\uB85C \uC81C\uC791") || bodyText.includes("\uBB34\uC5C7\uC785\uB2C8\uAE4C") || bodyText.includes("\uBE48 \uCE78\uC744 \uCC44\uC6CC\uC8FC\uC138\uC694") || bodyText.includes("\uBC88\uC9F8 \uC22B\uC790") || bodyText.includes("\uBC88\uC9F8 \uAE00\uC790") || bodyText.includes("CAPTCHA")) {
      return true;
    }
    return !!document.querySelector(
      [
        ".captcha_img",
        ".captcha_img_cover img",
        ".captcha_area",
        "[class*='captcha']",
        "img[src*='captcha']",
        "#captcha_image",
        "#captcha_answer"
      ].join(",")
    );
  }).catch(() => false);
}
async function waitForCaptchaChallenge(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasCaptchaChallenge(page))
      return true;
    await sleep2(500);
  }
  return await hasCaptchaChallenge(page);
}
async function solveCaptchaIfPresent(page, solver, result, workerId, scopeLabel, mid, catalogMid, waitForAppearMs = 0) {
  const detected = waitForAppearMs > 0 ? await waitForCaptchaChallenge(page, waitForAppearMs) : await hasCaptchaChallenge(page);
  if (!detected) {
    log2(`[Worker ${workerId}] ${scopeLabel} CAPTCHA \uBBF8\uAC10\uC9C0`);
    return true;
  }
  log2(`[Worker ${workerId}] ${scopeLabel} CAPTCHA \uAC10\uC9C0 - \uD574\uACB0 \uC2DC\uB3C4...`);
  result.captchaDetected = true;
  const solved = await solver.solve(page).catch(() => false);
  await waitForDomReady(page, 15e3);
  await sleep2(500);
  if (solved && !await hasCaptchaChallenge(page)) {
    log2(`[Worker ${workerId}] ${scopeLabel} CAPTCHA \uD574\uACB0 \uC131\uACF5!`);
    result.captchaSolved = true;
    result.captchaDetected = false;
    return true;
  }
  log2(`[Worker ${workerId}] ${scopeLabel} CAPTCHA \uD574\uACB0 \uC2E4\uD328`, "warn");
  log2(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
  result.failReason = "CAPTCHA_UNSOLVED";
  return false;
}
async function runPatchrightEngine(page, mid, productName, keyword, workerId, engine, keywordName, secondKeywordRaw, catalogMid, linkUrl, naverStorageStatePathForFlowG) {
  const captchaSolver = new ReceiptCaptchaSolverPRB((msg) => log2(`[Worker ${workerId}] ${msg}`));
  const result = {
    productPageEntered: false,
    captchaDetected: false,
    captchaSolved: false,
    midMatched: false
  };
  try {
    const searchSetup = await prepareTrafficSearchFlow({
      page,
      mid,
      productName,
      keyword,
      workerId,
      engine,
      keywordName,
      secondKeywordRaw,
      catalogMid,
      naverStorageStatePathForFlowG: engine.searchFlowVersion === "G" ? naverStorageStatePathForFlowG ?? null : null
    }, {
      log: log2,
      sleep: sleep2,
      isSecondComboBlacklisted,
      countBlacklistedSecondCombosForMid
    });
    if (!searchSetup.ok) {
      result.failReason = searchSetup.failReason;
      result.error = searchSetup.error;
      return result;
    }
    if (searchSetup.secondSearchPhraseUsed) {
      result.secondSearchPhraseUsed = searchSetup.secondSearchPhraseUsed;
    }
    const isBlocked = await detectNaverShoppingAccessBlocked(page);
    if (isBlocked) {
      log2(`[Worker ${workerId}] IP \uCC28\uB2E8 \uAC10\uC9C0!`, "warn");
      log2(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
      result.failReason = "IP_BLOCKED";
      result.error = "Blocked";
      return result;
    }
    if (!await solveCaptchaIfPresent(page, captchaSolver, result, workerId, "\uAC80\uC0C9", mid, catalogMid)) {
      return result;
    }
    if (engine.searchFlowVersion === "G") {
      log2(`[Worker ${workerId}] G\uBAA8\uB4DC 2\uCC28 \uAC80\uC0C9 \uC9C1\uD6C4 \uC1FC\uD551 \uC601\uC5ED\uAE4C\uC9C0 \uD398\uC774\uC9C0 \uC2A4\uD06C\uB864(\uC120\uD0D0\uC0C9)`);
      const step = Math.max(280, Math.floor(engine.explorationScrollPixels * 0.95));
      for (let s = 0; s < 4; s++) {
        await scrollIntegratedSearchPageDown(page, step);
        await sleep2(engine.delay("explorationBetweenScrolls"));
      }
      const vp0 = page.viewportSize();
      if (vp0 && vp0.width > 80) {
        try {
          await page.mouse.move(Math.floor(vp0.width / 2), Math.floor(vp0.height * 0.38));
          await page.mouse.wheel(0, 420);
          await sleep2(280);
          await page.mouse.wheel(0, 320);
        } catch {
        }
      }
      await sleep2(450);
    }
    const MAX_SCROLL = Math.max(engine.maxScrollAttempts, INTEGRATED_SHOP_PAGE_LIMIT);
    let linkClicked = false;
    const fallbackProductTitle = productName;
    for (let i = 0; i < MAX_SCROLL && !linkClicked; i++) {
      const blockedDuringPaging = await detectNaverShoppingAccessBlocked(page);
      if (blockedDuringPaging) {
        log2(`[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9/\uC1FC\uD551 \uC811\uADFC \uC81C\uD55C \uAC10\uC9C0(\uD398\uC774\uC9C0\uB124\uC774\uC158 \uC911\uB2E8)`, "warn");
        log2(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
        result.failReason = "IP_BLOCKED";
        result.error = "ShoppingAccessTemporarilyRestricted";
        return result;
      }
      const pagingState = await getIntegratedShoppingPagingState(page);
      const pagingLabel = pagingState?.current && pagingState?.total ? `\uCEF4\uD3EC\uB10C\uD2B8 ${pagingState.current}/${pagingState.total}\uD398\uC774\uC9C0` : `\uD0D0\uC0C9 ${i + 1}/${MAX_SCROLL}`;
      log2(`[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9 ${pagingLabel} MID(${catalogMid || mid}) \uD655\uC778`);
      let midLink = await findTrafficMidLink(
        page,
        mid,
        catalogMid,
        productName,
        extractStoreAliasFromLinkUrl(linkUrl),
        keyword
      );
      if (!midLink) {
        const probeSteps = engine.searchFlowVersion === "G" ? 3 : 1;
        const probeStepPx = Math.max(220, Math.floor(engine.explorationScrollPixels * (engine.searchFlowVersion === "G" ? 0.8 : 0.55)));
        log2(
          `[Worker ${workerId}] MID(${catalogMid || mid}) 1\uCC28 \uBBF8\uBC1C\uACAC \u2192 \uD398\uC774\uC9C0 \uC2A4\uD06C\uB864 \uC7AC\uD0D0\uC0C9 ${probeSteps}\uD68C`,
          "warn"
        );
        for (let probe = 0; probe < probeSteps && !midLink; probe++) {
          await scrollIntegratedSearchPageDown(page, probeStepPx);
          await sleep2(engine.delay("explorationBetweenScrolls"));
          midLink = await findTrafficMidLink(
            page,
            mid,
            catalogMid,
            productName,
            extractStoreAliasFromLinkUrl(linkUrl),
            keyword
          );
          if (midLink) {
            log2(
              `[Worker ${workerId}] MID(${catalogMid || mid}) \uC2A4\uD06C\uB864 \uC7AC\uD0D0\uC0C9 ${probe + 1}/${probeSteps}\uC5D0\uC11C \uBC1C\uACAC`,
              "warn"
            );
          }
        }
      }
      if (midLink) {
        try {
          await midLink.link.scrollIntoViewIfNeeded({ timeout: 8e3 }).catch(() => {
          });
          await midLink.link.evaluate((el) => {
            if (el instanceof HTMLElement) {
              el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
            }
          });
        } catch {
        }
        await sleep2(320 + Math.floor(Math.random() * 220));
        const isVisible = await midLink.link.isVisible().catch(() => false);
        if (!isVisible) {
          log2(
            `[Worker ${workerId}] MID \uB9C1\uD06C DOM \uC874\uC7AC\xB7\uC2A4\uD06C\uB864 \uC815\uB82C \uD6C4\uC5D0\uB3C4 \uBE44\uD45C\uC2DC \u2014 \uCD94\uAC00 \uC2A4\uD06C\uB864 \uD6C4 \uC7AC\uC2DC\uB3C4`,
            "warn"
          );
          await scrollIntegratedSearchPageDown(page, Math.floor(engine.explorationScrollPixels * 0.75));
          await sleep2(engine.delay("explorationBetweenScrolls"));
        }
        const isVisible2 = await midLink.link.isVisible().catch(() => false);
        if (isVisible2) {
          log2(`[Worker ${workerId}] MID(${mid}) \uB9C1\uD06C \uBC1C\uACAC (${midLink.method}) \u2192 \uD074\uB9AD | href=${midLink.hrefSnippet || "-"}`);
          const clicked = await clickTrafficMidLink(page, midLink.link, workerId, midLink.method);
          if (!clicked) {
            log2(`[Worker ${workerId}] MID\uB97C \uCC3E\uC558\uC9C0\uB9CC \uD074\uB9AD \uC2E4\uD328`, "warn");
            result.failReason = "NO_MID_MATCH";
            result.error = "ClickFailed";
            return result;
          }
          const detailDomReady = await waitForDomReady(page, 3e4);
          await sleep2(engine.delay("afterProductClick"));
          if (!detailDomReady) {
            log2(`[Worker ${workerId}] \uC0C1\uC138\uD398\uC774\uC9C0 DOM \uB85C\uB4DC \uD655\uC778 \uC2E4\uD328`, "warn");
            log2(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
            result.failReason = "PAGE_NOT_LOADED";
            result.error = "DetailDomNotLoaded";
            return result;
          }
          log2(`[Worker ${workerId}] \uC0C1\uC138\uD398\uC774\uC9C0 DOM \uB85C\uB4DC \uD655\uC778 \uC644\uB8CC`);
          log2(`[Worker ${workerId}] \uC0C1\uC138\uD398\uC774\uC9C0 CAPTCHA \uD45C\uC2DC \uB300\uAE30 \uC911...`);
          if (!await solveCaptchaIfPresent(page, captchaSolver, result, workerId, "\uC0C1\uC138\uD398\uC774\uC9C0", mid, catalogMid, 12e3)) {
            return result;
          }
          const currentPageUrl = page.url();
          log2(`[Worker ${workerId}] \uD398\uC774\uC9C0: ${currentPageUrl.substring(0, 80)}...`);
          linkClicked = true;
          result.midMatched = true;
          if (currentPageUrl.includes("smartstore.naver.com") || currentPageUrl.includes("brand.naver.com")) {
            let detailError = await inspectDetailSystemError(page);
            if (detailError.detected) {
              log2(
                `[Worker ${workerId}] \uC0C1\uC138\uD398\uC774\uC9C0 \uC2DC\uC2A4\uD15C \uC624\uB958 \uAC10\uC9C0(${detailError.reason}) \u2014 1\uD68C \uC0C8\uB85C\uACE0\uCE68 \uD6C4 \uC7AC\uD655\uC778`,
                "warn"
              );
              await page.reload({ waitUntil: "domcontentloaded", timeout: 3e4 }).catch((e) => {
                log2(`[Worker ${workerId}] \uC0C1\uC138\uD398\uC774\uC9C0 \uC0C8\uB85C\uACE0\uCE68 \uC2E4\uD328: ${e?.message || e}`, "warn");
              });
              await sleep2(engine.delay("afterProductClick"));
              detailError = await inspectDetailSystemError(page);
            }
            if (detailError.detected) {
              log2(
                `[Worker ${workerId}] \uC0C1\uC138\uD398\uC774\uC9C0 \uC2DC\uC2A4\uD15C \uC624\uB958 \uC720\uC9C0: title=${JSON.stringify(detailError.title)} body=${JSON.stringify(detailError.snippet)}`,
                "warn"
              );
              result.failReason = "DETAIL_NOT_REACHED";
              result.error = `DetailSystemError:${detailError.reason || "unknown"}`;
              return result;
            }
            result.productPageEntered = true;
            try {
              const pageTitle = await page.evaluate(() => {
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
                const bodyText = clean(document.body?.innerText || "");
                const isErrorPage = /에러페이지|시스템오류|현재 서비스 접속이 불가합니다|Too Many Requests|접속이 불가합니다/i.test(
                  `${document.title} ${bodyText}`
                );
                push(document.querySelector('meta[property="og:title"]')?.getAttribute("content"));
                push(document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"));
                push(document.querySelector('meta[name="title"]')?.getAttribute("content"));
                for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
                  const raw = script.textContent?.trim();
                  if (!raw)
                    continue;
                  try {
                    const parsed = JSON.parse(raw);
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    for (const item of items) {
                      if (!item || typeof item !== "object")
                        continue;
                      const anyItem = item;
                      push(anyItem.name);
                      push(anyItem.headline);
                      push(anyItem.title);
                    }
                  } catch {
                  }
                }
                push(document.title);
                for (const sel of ["h1", "h2", "h3", "strong", "[itemprop='name']"]) {
                  document.querySelectorAll(sel).forEach((el) => push(el.textContent));
                }
                if (isErrorPage)
                  return null;
                return candidates.find((t) => t.length >= 4) || null;
              });
              if (pageTitle)
                result.extractedProductTitle = pageTitle;
              if (!result.extractedProductTitle && fallbackProductTitle) {
                result.extractedProductTitle = fallbackProductTitle;
              }
            } catch {
              if (!result.extractedProductTitle && fallbackProductTitle) {
                result.extractedProductTitle = fallbackProductTitle;
              }
            }
          } else {
            log2(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
            result.failReason = "DETAIL_NOT_REACHED";
            result.error = "StoreDetailUrlMismatch";
          }
          if (result.productPageEntered && engine.searchFlowVersion === "G") {
            log2(`[Worker ${workerId}] G\uBAA8\uB4DC \uC0C1\uC138 \uC2A4\uD06C\uB864 \uC654\uB2E4\uAC14\uB2E4`);
            await gModeDetailPageOscillateScroll(page, engine);
          }
          const dwellTime = result.productPageEntered && engine.searchFlowVersion === "G" ? 4e3 : engine.delay("stayOnProduct");
          log2(`[Worker ${workerId}] \uCCB4\uB958 ${(dwellTime / 1e3).toFixed(1)}\uCD08...`);
          await sleep2(dwellTime);
          break;
        }
      }
      if (midLink && !linkClicked) {
        const stillHidden = !await midLink.link.isVisible().catch(() => false);
        if (stillHidden) {
          log2(`[Worker ${workerId}] MID \uB9C1\uD06C\uAC00 \uBDF0\uD3EC\uD2B8 \uBC16\uC73C\uB85C \uCD94\uC815 \u2014 \uD1B5\uD569\uAC80\uC0C9 \uC2A4\uD06C\uB864\uB85C \uB178\uCD9C \uC2DC\uB3C4`, "warn");
          await scrollIntegratedSearchPageDown(page, Math.floor(engine.explorationScrollPixels));
          await sleep2(engine.delay("explorationBetweenScrolls"));
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
      const carouselNext = await clickIntegratedShoppingCarouselNext(page, INTEGRATED_SHOP_PAGE_LIMIT);
      if (carouselNext.clicked) {
        log2(
          `[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9 \uC1FC\uD551 \uCE90\uB7EC\uC140 \uB2E4\uC74C \uD398\uC774\uC9C0 \uD074\uB9AD` + (carouselNext.label ? ` (${carouselNext.label})` : "")
        );
        await waitForIntegratedShoppingPageSettle(page, carouselNext.current ? carouselNext.current + 1 : void 0);
        await sleep2(engine.delay("explorationBetweenScrolls"));
        continue;
      } else if (carouselNext.reachedEnd) {
        log2(
          `[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9 \uC1FC\uD551 \uCE90\uB7EC\uC140 \uD398\uC774\uC9C0 \uD55C\uB3C4 \uB3C4\uB2EC` + (carouselNext.current && carouselNext.total ? ` (${carouselNext.current}/${carouselNext.total})` : "")
        );
        break;
      } else if (carouselNext.reason) {
        log2(`[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9 \uC1FC\uD551 \uCE90\uB7EC\uC140 \uB2E4\uC74C \uBC84\uD2BC \uBBF8\uD074\uB9AD: ${carouselNext.reason}`, "warn");
      }
      log2(`[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9 \uCEF4\uD3EC\uB10C\uD2B8 \uB2E4\uC74C \uD398\uC774\uC9C0 \uC5C6\uC74C \u2014 \uC2A4\uD06C\uB864\uB85C \uCD94\uAC00 \uB85C\uB529 \uD655\uC778`);
      if (engine.searchFlowVersion === "G") {
        await scrollIntegratedSearchPageDown(page, engine.explorationScrollPixels);
        const vp1 = page.viewportSize();
        if (vp1 && vp1.width > 80) {
          try {
            await page.mouse.move(Math.floor(vp1.width / 2), Math.floor(vp1.height * 0.42));
            await page.mouse.wheel(0, Math.floor(engine.explorationScrollPixels * 0.9));
          } catch {
          }
        }
      }
      await humanScroll2(page, Math.floor(engine.explorationScrollPixels * (engine.searchFlowVersion === "G" ? 0.45 : 1)));
      await sleep2(engine.delay("explorationBetweenScrolls"));
    }
    if (!linkClicked) {
      log2(`[Worker ${workerId}] \uD1B5\uD569\uAC80\uC0C9 \uCEF4\uD3EC\uB10C\uD2B8 \uD398\uC774\uC9C0\uB124\uC774\uC158 \uB0B4 \uC0C1\uD488 \uBBF8\uBC1C\uACAC`, "warn");
      log2(`[Worker ${workerId}] \uC1FC\uD551 \uB354\uBCF4\uAE30 \uD3F4\uBC31 \uC5C6\uC774 \uD1B5\uD569\uAC80\uC0C9 \uCEF4\uD3EC\uB10C\uD2B8 \uD0D0\uC0C9\uC5D0\uC11C \uC885\uB8CC`, "warn");
    }
    if (!linkClicked) {
      log2(`[Worker ${workerId}] \uC0C1\uD488\uC774 \uC874\uC7AC\uD558\uC9C0 \uC54A\uC74C \u2014 MID(${mid}) \uD1B5\uD569\uAC80\uC0C9 \uCEF4\uD3EC\uB10C\uD2B8 \uD398\uC774\uC9C0\uB124\uC774\uC158 \uB0B4 \uBBF8\uB178\uCD9C`, "warn");
      log2(await collectSearchDomDiagnostics(page, mid, catalogMid), "warn");
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
  const dir = path4.join(os.tmpdir(), `prb-rank-worker-${workerId}`);
  fs5.mkdirSync(dir, { recursive: true });
  return dir;
}
function removeStaleChromiumProfileLocks(userDataDir) {
  if (process.env.PRB_KEEP_PROFILE_LOCKS === "1")
    return;
  const names = ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"];
  const bases = [userDataDir, path4.join(userDataDir, "Default")];
  for (const base of bases) {
    try {
      if (!fs5.existsSync(base))
        continue;
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path4.join(base, name);
      try {
        if (fs5.existsSync(p))
          fs5.unlinkSync(p);
      } catch {
      }
    }
  }
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
        if (strategyQueue?.done) {
          log2(`[Worker ${workerId}] \uC804\uB7B5 \uC644\uB8CC - \uBAA8\uB4E0 \uC791\uC5C5 \uC2E4\uD589 \uD69F\uC218 \uB2EC\uC131`);
          printStats();
          process.exit(0);
        }
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
      const profileName = profile.name;
      const manualNaverLogin = (process.env.NAVER_LOGIN_MODE || "").toLowerCase() === "manual" || process.env.NAVER_MANUAL_LOGIN === "1";
      const storedNaverStatePath = resolveExistingNaverLoginStorageStatePath(profileName);
      const forceRefreshNaverState = process.env.NAVER_LOGIN_FORCE_REFRESH === "1";
      const loadNaverCookieStorageAtLaunch = !!storedNaverStatePath && !forceRefreshNaverState;
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
        browser = await launchChromiumWithChannelFallback(browserLaunchOptions);
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
        removeStaleChromiumProfileLocks(userDataDir);
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
        browser = await launchChromiumWithChannelFallback(browserLaunchOptions);
        const ctxOpts = buildBrowserContextOptions(isMobileTask, ua);
        context = await browser.newContext({
          ...ctxOpts,
          ...proxy ? { proxy } : {},
          ...loadNaverCookieStorageAtLaunch ? { storageState: storedNaverStatePath } : {}
        });
        if (isMobileTask) {
          await applyMobileStealth(context);
        }
        await context.addInitScript(PAGE_EVALUATE_NAME_POLYFILL2);
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        await ensurePageEvaluateNamePolyfill(page);
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
      const loginOk = !ENGINE.naverLoginEnabled ? true : isRankD && process.env.NAVER_LOGIN_ON_RANK !== "1" ? true : isRankD ? await ensureNaverLoginPrbPage(page, workerId) : loadNaverCookieStorageAtLaunch ? (log2(
        `[Worker ${workerId}] \uB124\uC774\uBC84 \uCFE0\uD0A4 \uC138\uC158 \uC0AC\uC6A9(storage-state, \uD3FC \uB85C\uADF8\uC778 \uC0DD\uB7B5): ${storedNaverStatePath}`
      ), true) : manualNaverLogin ? await ensureNaverLoginManually(page, workerId, context, profileName) : await ensureNaverLoginIfConfigured(
        page,
        workerId,
        context,
        profileName,
        forceRefreshNaverState
      );
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
      const engineResult = isRankD ? await runRankCheckFlow(
        { page, work, workerId },
        { log: log2, sleep: sleep2 }
      ) : await runPatchrightEngine(
        page,
        work.mid,
        work.productName,
        work.keyword,
        workerId,
        ENGINE,
        work.keywordName,
        work.secondKeywordRaw,
        work.catalogMid,
        work.linkUrl,
        ENGINE.searchFlowVersion === "G" ? resolveExistingNaverLoginStorageStatePath(profileName) : null
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
        const failReason = engineResult.failReason === "CAPTCHA_UNSOLVED" ? "CAPTCHA" : engineResult.failReason === "IP_BLOCKED" ? "IP\uCC28\uB2E8" : engineResult.failReason === "NO_MID_MATCH" ? "MID\uC5C6\uC74C" : engineResult.failReason === "DETAIL_NOT_REACHED" ? "\uC0C1\uC138\uBBF8\uC9C4\uC785" : engineResult.failReason === "PRODUCT_NOT_FOUND" ? "\uC0C1\uD488\uBBF8\uB178\uCD9C" : engineResult.failReason === "TIMEOUT" ? "\uD0C0\uC784\uC544\uC6C3" : engineResult.failReason === "INVALID_TASK" ? "\uC791\uC5C5\uC124\uC815\uC624\uB958" : engineResult.error || "Unknown";
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
        if (shouldAppendSecondComboBlacklistAfterRun(ENGINE.searchFlowVersion, engineResult)) {
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
        await sleep2(randomBetween(200, 500));
        await rankPrbBrowser.close().catch(() => {
        });
        await sleep2(randomBetween(800, 1500));
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
  if (STRATEGY_ARG) {
    const strategyPath = path4.isAbsolute(STRATEGY_ARG) ? STRATEGY_ARG : path4.resolve(process.cwd(), STRATEGY_ARG);
    log2(`[Strategy] \uC804\uB7B5 \uD30C\uC77C \uB85C\uB4DC: ${strategyPath}`);
    const rawStrategy = loadStrategyFile(strategyPath);
    const validation = validateStrategy(rawStrategy);
    if (validation.errors.length > 0) {
      console.error("[Strategy] \uC720\uD6A8\uC131 \uC624\uB958:\n" + validation.errors.join("\n"));
      process.exit(1);
    }
    if (validation.warnings.length > 0) {
      for (const w of validation.warnings)
        log2(`[Strategy] \uACBD\uACE0: ${w}`, "warn");
    }
    const normalized = normalizeStrategy(rawStrategy);
    ENGINE = buildEngineRuntime(normalized.runtime);
    strategyQueue = createStrategyQueue(normalized);
    const checkedTasks = normalized.tasks.filter((t) => t.checked);
    log2(`[Strategy] "${normalized.name}" | \uD50C\uB85C\uC6B0=${ENGINE.searchFlowVersion} | \uC791\uC5C5=${checkedTasks.length}\uAC1C (checked)`);
    for (const t of checkedTasks) {
      log2(`[Strategy]   \xB7 ${t.keyword} \u2192 mid=${t.mid} | \uD69F\uC218=${t.targetCount > 0 ? t.targetCount + "\uD68C" : "\uBB34\uC81C\uD55C"}`);
    }
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
