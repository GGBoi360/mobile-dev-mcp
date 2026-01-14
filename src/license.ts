/**
 * License validation module for Mobile Dev MCP
 *
 * Tiers:
 * - TRIAL: No license, 50 tool requests then blocked
 * - BASIC ($6/mo): 17 core tools (Android + iOS basics), 50 line limits, 1 device
 * - ADVANCED ($8/wk, $12/mo, $99/yr): All 46 tools, unlimited, multi-device
 *
 * Handles:
 * - License key validation against API
 * - Local caching of license status
 * - Trial usage tracking
 * - Graceful degradation when offline
 * - Feature gating based on tier
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

export type LicenseTier = "trial" | "basic" | "advanced";

export interface LicenseInfo {
  key: string;
  valid: boolean;
  tier: LicenseTier;
  email?: string;
  validatedAt: string;
  expiresAt?: string;
  seats?: number; // For future team tier
}

export interface Config {
  licenseKey?: string;
  metroPort: number;
  logBufferSize: number;
  defaultDevice?: string;
  apiEndpoint: string;
}

export interface TrialInfo {
  usageCount: number;
  firstUsedAt: string;
  lastUsedAt: string;
  machineId: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".mobiledev-mcp");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LICENSE_CACHE_FILE = path.join(CONFIG_DIR, "license.json");
const TRIAL_FILE = path.join(CONFIG_DIR, "trial.json");

// How long to trust cached license without revalidation
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Grace period if API is down but we have a cached valid license
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Default API endpoint - UPDATE THIS after deploying your Cloudflare Worker!
const DEFAULT_API_ENDPOINT = "https://mobiledev-license-api.giladworkersdev.workers.dev";

// Trial settings
const TRIAL_LIMIT = 50; // Number of tool requests allowed in trial

// ============================================================================
// FEATURE TIERS
// ============================================================================

// BASIC TIER ($6/mo) - Core tools, available to all paid users
export const BASIC_TOOLS = [
  // Android tools
  "get_metro_logs",
  "get_adb_logs",
  "screenshot_emulator",
  "list_devices",
  "check_metro_status",
  "get_app_info",
  "clear_app_data",
  "restart_adb",
  "get_device_info",
  "start_metro_logging",
  "stop_metro_logging",
  // iOS Simulator tools
  "list_ios_simulators",
  "screenshot_ios_simulator",
  "get_ios_simulator_logs",
  "get_ios_simulator_info",
  // License tools
  "get_license_status",
  "set_license_key",
] as const;

// ADVANCED TIER ($8/wk, $12/mo, $99/yr) - Pro tools, only for Advanced subscribers
export const ADVANCED_TOOLS = [
  // Android streaming & monitoring
  "stream_adb_realtime",
  "stop_adb_streaming",
  "screenshot_history",
  "watch_for_errors",
  "multi_device_logs",
  // Android interaction tools
  "tap_screen",
  "input_text",
  "press_button",
  "swipe_screen",
  "launch_app",
  "install_apk",
  // iOS Simulator advanced tools
  "boot_ios_simulator",
  "shutdown_ios_simulator",
  "install_ios_app",
  "launch_ios_app",
  "terminate_ios_app",
  "ios_open_url",
  "ios_push_notification",
  "ios_set_location",
  // React DevTools integration
  "setup_react_devtools",
  "check_devtools_connection",
  "get_react_component_tree",
  "inspect_react_component",
  "search_react_components",
  // Network inspection
  "get_network_requests",
  "start_network_monitoring",
  "stop_network_monitoring",
  "get_network_stats",
  "analyze_request",
] as const;

export type BasicTool = (typeof BASIC_TOOLS)[number];
export type AdvancedTool = (typeof ADVANCED_TOOLS)[number];

// Limits for each tier
export const TIER_LIMITS = {
  trial: {
    maxLogLines: 50, // Same as Basic during trial
    maxDevices: 1,
    screenshotHistory: 0,
  },
  basic: {
    maxLogLines: 50,
    maxDevices: 1,
    screenshotHistory: 0,
  },
  advanced: {
    maxLogLines: Infinity,
    maxDevices: 3,
    screenshotHistory: 20,
  },
} as const;

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  const defaultConfig: Config = {
    metroPort: 8081,
    logBufferSize: 100,
    apiEndpoint: DEFAULT_API_ENDPOINT,
  };

  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const loaded = JSON.parse(raw);
    return { ...defaultConfig, ...loaded };
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function setLicenseKey(key: string): void {
  const config = loadConfig();
  config.licenseKey = key;
  saveConfig(config);
  // Clear cached license to force revalidation
  clearLicenseCache();
}

// ============================================================================
// MACHINE ID (for license binding)
// ============================================================================

function getMachineId(): string {
  const info = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || "unknown",
  ].join("|");

  return crypto.createHash("sha256").update(info).digest("hex").substring(0, 32);
}

// ============================================================================
// LICENSE CACHE
// ============================================================================

function loadLicenseCache(): LicenseInfo | null {
  if (!fs.existsSync(LICENSE_CACHE_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(LICENSE_CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLicenseCache(license: LicenseInfo): void {
  ensureConfigDir();
  fs.writeFileSync(LICENSE_CACHE_FILE, JSON.stringify(license, null, 2));
}

function clearLicenseCache(): void {
  if (fs.existsSync(LICENSE_CACHE_FILE)) {
    fs.unlinkSync(LICENSE_CACHE_FILE);
  }
}

function isCacheFresh(license: LicenseInfo): boolean {
  const validatedAt = new Date(license.validatedAt).getTime();
  const now = Date.now();
  return now - validatedAt < CACHE_TTL_MS;
}

function isWithinGracePeriod(license: LicenseInfo): boolean {
  const validatedAt = new Date(license.validatedAt).getTime();
  const now = Date.now();
  return now - validatedAt < GRACE_PERIOD_MS;
}

// ============================================================================
// TRIAL TRACKING
// ============================================================================

function loadTrialInfo(): TrialInfo | null {
  if (!fs.existsSync(TRIAL_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(TRIAL_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTrialInfo(trial: TrialInfo): void {
  ensureConfigDir();
  fs.writeFileSync(TRIAL_FILE, JSON.stringify(trial, null, 2));
}

function getMachineIdForTrial(): string {
  const info = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || "unknown",
  ].join("|");

  return crypto.createHash("sha256").update(info).digest("hex").substring(0, 32);
}

export function getTrialStatus(): { remaining: number; used: number; expired: boolean } {
  const trial = loadTrialInfo();
  if (!trial) {
    return { remaining: TRIAL_LIMIT, used: 0, expired: false };
  }

  // Verify machine ID matches (prevent copying trial.json to new machines)
  const currentMachineId = getMachineIdForTrial();
  if (trial.machineId !== currentMachineId) {
    return { remaining: TRIAL_LIMIT, used: 0, expired: false };
  }

  const remaining = Math.max(0, TRIAL_LIMIT - trial.usageCount);
  return {
    remaining,
    used: trial.usageCount,
    expired: remaining === 0,
  };
}

export function incrementTrialUsage(): { allowed: boolean; remaining: number; message?: string } {
  const machineId = getMachineIdForTrial();
  let trial = loadTrialInfo();

  // Initialize trial if needed
  if (!trial || trial.machineId !== machineId) {
    trial = {
      usageCount: 0,
      firstUsedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      machineId,
    };
  }

  // Check if trial expired
  if (trial.usageCount >= TRIAL_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      message: `🔒 Trial expired! You've used all ${TRIAL_LIMIT} trial requests.

To continue using Mobile Dev MCP, purchase a license:

┌─────────────────────────────────────────┐
│  Basic Solo    $6/month                 │
│  → 17 core tools, 50 log lines          │
├─────────────────────────────────────────┤
│  Advanced Solo $12/month (or $99/year)  │
│  → All 46 tools, unlimited logs         │
│  → Real-time streaming, multi-device    │
└─────────────────────────────────────────┘

Purchase at: https://mobile-dev-mcp.com
Then use 'set_license_key' to activate.`,
    };
  }

  // Increment usage
  trial.usageCount++;
  trial.lastUsedAt = new Date().toISOString();
  saveTrialInfo(trial);

  const remaining = TRIAL_LIMIT - trial.usageCount;
  return {
    allowed: true,
    remaining,
  };
}

// ============================================================================
// API VALIDATION
// ============================================================================

async function validateWithApi(
  licenseKey: string,
  apiEndpoint: string
): Promise<LicenseInfo | null> {
  try {
    const response = await fetch(`${apiEndpoint}/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_id: getMachineId(),
      }),
    });

    if (!response.ok) {
      console.error("License API returned status:", response.status);
      return null;
    }

    const data = (await response.json()) as {
      valid: boolean;
      tier?: LicenseTier;
      error?: string;
      license_key?: {
        status: string;
        activation_limit: number;
        activation_usage: number;
        expires_at: string | null;
      };
      meta?: {
        customer_email?: string;
        product_name?: string;
        variant_name?: string;
      };
    };

    if (data.valid) {
      // Determine tier from product/variant name
      let tier: LicenseTier = data.tier || "basic";

      // Check variant name for tier hints
      const variantName = data.meta?.variant_name?.toLowerCase() || "";
      const productName = data.meta?.product_name?.toLowerCase() || "";

      if (
        variantName.includes("advanced") ||
        productName.includes("advanced")
      ) {
        tier = "advanced";
      } else if (
        variantName.includes("basic") ||
        productName.includes("basic")
      ) {
        tier = "basic";
      }

      return {
        key: licenseKey,
        valid: true,
        tier,
        email: data.meta?.customer_email,
        validatedAt: new Date().toISOString(),
        expiresAt: data.license_key?.expires_at || undefined,
      };
    }

    return {
      key: licenseKey,
      valid: false,
      tier: "trial",
      validatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("License validation API error:", error);
    return null;
  }
}

// ============================================================================
// MAIN LICENSE CHECK
// ============================================================================

let cachedLicenseResult: LicenseInfo | null = null;

export async function checkLicense(): Promise<LicenseInfo> {
  // Return cached result if we've already checked this session
  if (cachedLicenseResult) {
    return cachedLicenseResult;
  }

  const config = loadConfig();

  // No license key configured - trial mode
  if (!config.licenseKey) {
    cachedLicenseResult = {
      key: "",
      valid: false,
      tier: "trial",
      validatedAt: new Date().toISOString(),
    };
    return cachedLicenseResult;
  }

  // Check local cache first
  const cached = loadLicenseCache();

  if (cached && cached.key === config.licenseKey) {
    if (cached.valid && isCacheFresh(cached)) {
      cachedLicenseResult = cached;
      return cached;
    }
  }

  // Try to validate with API
  const apiResult = await validateWithApi(config.licenseKey, config.apiEndpoint);

  if (apiResult) {
    saveLicenseCache(apiResult);
    cachedLicenseResult = apiResult;
    return apiResult;
  }

  // API is down - check if we have a valid cached license within grace period
  if (cached && cached.valid && isWithinGracePeriod(cached)) {
    console.error(
      "License API unreachable, using cached license (grace period)"
    );
    cachedLicenseResult = cached;
    return cached;
  }

  // No valid cache, API down - fall back to trial
  cachedLicenseResult = {
    key: config.licenseKey,
    valid: false,
    tier: "trial",
    validatedAt: new Date().toISOString(),
  };
  return cachedLicenseResult;
}

// ============================================================================
// FEATURE GATING
// ============================================================================

export function isAdvancedTool(toolName: string): boolean {
  return ADVANCED_TOOLS.includes(toolName as AdvancedTool);
}

export function isBasicTool(toolName: string): boolean {
  return BASIC_TOOLS.includes(toolName as BasicTool);
}

export async function canUseTool(toolName: string): Promise<boolean> {
  const license = await checkLicense();

  // Advanced tools require Advanced tier
  if (isAdvancedTool(toolName)) {
    return license.valid && license.tier === "advanced";
  }

  // Basic tools require Basic or Advanced tier
  if (isBasicTool(toolName)) {
    return license.valid && (license.tier === "basic" || license.tier === "advanced");
  }

  // Unknown tool - allow (might be a new tool)
  return true;
}

export async function requireAdvanced(toolName: string): Promise<{
  allowed: boolean;
  message?: string;
}> {
  const license = await checkLicense();

  // Advanced license holders always allowed
  if (license.valid && license.tier === "advanced") {
    return { allowed: true };
  }

  // Trial users can try Advanced tools (uses trial quota)
  if (!license.valid || license.tier === "trial") {
    const trialResult = incrementTrialUsage();
    if (!trialResult.allowed) {
      return {
        allowed: false,
        message: trialResult.message,
      };
    }

    // Trial still has requests - allow with reminder
    if (trialResult.remaining <= 10) {
      return {
        allowed: true,
        message: `⚠️ Trial: ${trialResult.remaining} requests remaining. This is an Advanced feature - upgrade to keep using it!`,
      };
    }

    return { allowed: true };
  }

  // Basic tier users cannot use Advanced tools
  return {
    allowed: false,
    message: `🔒 "${toolName}" requires Advanced tier.

Your current tier: BASIC

Upgrade to Advanced for:
- Real-time log streaming
- Screenshot history
- Multi-device support (3 devices)
- Error watching
- Unlimited log lines
- Device interaction (tap, type, swipe)

Pricing: $8/week, $12/month, or $99/year

Upgrade at: https://mobile-dev-mcp.com`,
  };
}

export async function requireBasic(toolName: string): Promise<{
  allowed: boolean;
  message?: string;
}> {
  const license = await checkLicense();

  // Licensed users can always use basic tools
  if (license.valid) {
    return { allowed: true };
  }

  // Trial users - check trial status
  const trialResult = incrementTrialUsage();
  if (!trialResult.allowed) {
    return {
      allowed: false,
      message: trialResult.message,
    };
  }

  // Trial still has requests - allow with reminder
  if (trialResult.remaining <= 10) {
    return {
      allowed: true,
      message: `⚠️ Trial: ${trialResult.remaining} requests remaining. Purchase a license to continue uninterrupted.`,
    };
  }

  return { allowed: true };
}

export function getTierLimits(tier: LicenseTier) {
  return TIER_LIMITS[tier];
}

export async function getMaxLogLines(): Promise<number> {
  const license = await checkLicense();
  return TIER_LIMITS[license.tier].maxLogLines;
}

// ============================================================================
// LICENSE INFO TOOL
// ============================================================================

export async function getLicenseStatus(): Promise<string> {
  const license = await checkLicense();
  const config = loadConfig();

  if (!config.licenseKey) {
    const trialStatus = getTrialStatus();

    if (trialStatus.expired) {
      return `📋 License Status: TRIAL EXPIRED

You've used all ${TRIAL_LIMIT} trial requests.

┌─────────────────────────────────────────┐
│  Basic Solo    $6/mo      → Core tools  │
│  Advanced Solo $12/mo     → All features│
│                $8/wk or $99/yr          │
└─────────────────────────────────────────┘

Purchase at: https://mobile-dev-mcp.com
Then use 'set_license_key' to activate.`;
    }

    return `📋 License Status: TRIAL

Trial requests remaining: ${trialStatus.remaining}/${TRIAL_LIMIT}
Trial requests used: ${trialStatus.used}

┌─────────────────────────────────────────┐
│  Basic Solo    $6/mo      → Core tools  │
│  Advanced Solo $12/mo     → All features│
│                $8/wk or $99/yr          │
└─────────────────────────────────────────┘

Purchase at: https://mobile-dev-mcp.com
Then use 'set_license_key' to activate.`;
  }

  if (!license.valid) {
    return `📋 License Status: INVALID

License key: ${maskLicenseKey(config.licenseKey)}
Status: Invalid or expired

Please check your license key or purchase a new one.
https://mobile-dev-mcp.com`;
  }

  const tierEmoji = license.tier === "advanced" ? "⭐" : "✓";
  const limits = TIER_LIMITS[license.tier];

  return `📋 License Status: ${license.tier.toUpperCase()} ${tierEmoji}

License key: ${maskLicenseKey(license.key)}
Email: ${license.email || "N/A"}
Valid until: ${license.expiresAt || "Active subscription"}
Last validated: ${license.validatedAt}

Your limits:
- Max log lines: ${limits.maxLogLines === Infinity ? "Unlimited" : limits.maxLogLines}
- Max devices: ${limits.maxDevices}
- Screenshot history: ${limits.screenshotHistory || "Not available"}

${license.tier === "basic" ? "\n💡 Upgrade to Advanced for real-time streaming & multi-device support!" : "All features unlocked! 🎉"}`;
}

function maskLicenseKey(key: string): string {
  if (key.length < 8) return "****";
  return key.substring(0, 4) + "****" + key.substring(key.length - 4);
}

// ============================================================================
// EXPORTS FOR MCP SERVER
// ============================================================================

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const licenseTools: Tool[] = [
  {
    name: "get_license_status",
    description:
      "Check your current license status and tier (free/basic/advanced)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "set_license_key",
    description: "Set or update your license key to unlock paid features",
    inputSchema: {
      type: "object",
      properties: {
        licenseKey: {
          type: "string",
          description: "Your license key from mobile-dev-mcp.com",
        },
      },
      required: ["licenseKey"],
    },
  },
];

export async function handleLicenseTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_license_status":
      return getLicenseStatus();

    case "set_license_key":
      const key = args.licenseKey as string;
      if (!key || key.length < 10) {
        return "Invalid license key format. Keys should look like: lk_XXXXX...";
      }
      setLicenseKey(key);
      // Force revalidation
      cachedLicenseResult = null;
      const status = await checkLicense();
      if (status.valid) {
        return `✅ License activated successfully!

Tier: ${status.tier.toUpperCase()}
${status.tier === "advanced" ? "All features unlocked!" : "Basic features unlocked!"}

Use 'get_license_status' to see your limits.`;
      } else {
        return `❌ License key is invalid or expired.

Please check your key or contact support.
https://mobile-dev-mcp.com`;
      }

    default:
      return `Unknown license tool: ${name}`;
  }
}
