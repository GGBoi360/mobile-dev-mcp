/**
 * License validation module for Mobile Dev MCP
 *
 * Tiers:
 * - FREE: No license (unusable demo)
 * - BASIC ($6/mo): Core 9 tools, 50 line limits, 1 device
 * - ADVANCED ($8/wk, $12/mo, $99/yr): All 17 tools, unlimited, multi-device
 *
 * Handles:
 * - License key validation against API
 * - Local caching of license status
 * - Graceful degradation when offline
 * - Feature gating based on tier
 * - Developer mode for testing
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ============================================================================
// DEVELOPER MODE
// ============================================================================

// Set DEVELOPER_MODE=true to bypass all license checks (for your own testing)
const DEVELOPER_MODE = process.env.DEVELOPER_MODE === "true";

if (DEVELOPER_MODE) {
  console.error("⚠️  DEVELOPER MODE ENABLED - All features unlocked");
}

// ============================================================================
// TYPES
// ============================================================================

export type LicenseTier = "free" | "basic" | "advanced";

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

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".mobiledev-mcp");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LICENSE_CACHE_FILE = path.join(CONFIG_DIR, "license.json");

// How long to trust cached license without revalidation
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Grace period if API is down but we have a cached valid license
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Default API endpoint - UPDATE THIS after deploying your Cloudflare Worker!
const DEFAULT_API_ENDPOINT = "https://mobiledev-license-api.giladworkersdev.workers.dev";

// ============================================================================
// FEATURE TIERS
// ============================================================================

// BASIC TIER ($6/mo) - Core tools, available to all paid users
export const BASIC_TOOLS = [
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
  "get_license_status",
  "set_license_key",
] as const;

// ADVANCED TIER ($8/wk, $12/mo, $99/yr) - Pro tools, only for Advanced subscribers
export const ADVANCED_TOOLS = [
  "stream_adb_realtime",
  "stop_adb_streaming",
  "screenshot_history",
  "watch_for_errors",
  "multi_device_logs",
] as const;

export type BasicTool = (typeof BASIC_TOOLS)[number];
export type AdvancedTool = (typeof ADVANCED_TOOLS)[number];

// Limits for each tier
export const TIER_LIMITS = {
  free: {
    maxLogLines: 20,
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
      tier: "free",
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
  // Developer mode - return advanced tier
  if (DEVELOPER_MODE) {
    return {
      key: "DEVELOPER_MODE",
      valid: true,
      tier: "advanced",
      validatedAt: new Date().toISOString(),
    };
  }

  // Return cached result if we've already checked this session
  if (cachedLicenseResult) {
    return cachedLicenseResult;
  }

  const config = loadConfig();

  // No license key configured - free tier
  if (!config.licenseKey) {
    cachedLicenseResult = {
      key: "",
      valid: false,
      tier: "free",
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

  // No valid cache, API down - fall back to free
  cachedLicenseResult = {
    key: config.licenseKey,
    valid: false,
    tier: "free",
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
  // Developer mode - all tools available
  if (DEVELOPER_MODE) {
    return true;
  }

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
  if (DEVELOPER_MODE) {
    return { allowed: true };
  }

  const license = await checkLicense();

  if (license.valid && license.tier === "advanced") {
    return { allowed: true };
  }

  const currentTier = license.valid ? license.tier : "free";

  return {
    allowed: false,
    message: `🔒 "${toolName}" requires Advanced tier.

Your current tier: ${currentTier.toUpperCase()}

Upgrade to Advanced for:
- Real-time log streaming
- Screenshot history
- Multi-device support (3 devices)
- Error watching
- Unlimited log lines

Pricing: $8/week, $12/month, or $99/year

Upgrade at: https://mobile-dev-mcp.com

Or use 'set_license_key' if you already have a key.`,
  };
}

export async function requireBasic(toolName: string): Promise<{
  allowed: boolean;
  message?: string;
}> {
  if (DEVELOPER_MODE) {
    return { allowed: true };
  }

  const license = await checkLicense();

  if (license.valid) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: `🔒 "${toolName}" requires a license.

You're on the FREE tier.

Get Basic ($6/month) for:
- All core debugging tools
- 50 log lines per request
- Metro + ADB integration
- Screenshots

Or Advanced ($8/wk, $12/mo, $99/yr) for everything.

Purchase at: https://mobile-dev-mcp.com`,
  };
}

export function getTierLimits(tier: LicenseTier) {
  return TIER_LIMITS[tier];
}

export async function getMaxLogLines(): Promise<number> {
  if (DEVELOPER_MODE) {
    return Infinity;
  }

  const license = await checkLicense();
  return TIER_LIMITS[license.tier].maxLogLines;
}

// ============================================================================
// LICENSE INFO TOOL
// ============================================================================

export async function getLicenseStatus(): Promise<string> {
  if (DEVELOPER_MODE) {
    return `📋 License Status: DEVELOPER MODE

⚠️  All features unlocked for testing.

To disable: unset DEVELOPER_MODE environment variable.`;
  }

  const license = await checkLicense();
  const config = loadConfig();

  if (!config.licenseKey) {
    return `📋 License Status: FREE TIER

No license key configured.

┌─────────────────────────────────────────┐
│  BETA OFFER: First 200 users!           │
│  Basic tier FREE for first 3 months     │
├─────────────────────────────────────────┤
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
