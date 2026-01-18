// Mobile Dev MCP - License Management
// Read-only debugging tool - simplified 2-tier system

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { TIER_LIMITS, FREE_TOOLS, ADVANCED_TOOLS } from "./types.js";

// Re-export for tests
export { TIER_LIMITS, FREE_TOOLS, ADVANCED_TOOLS };

// Simplified 2-tier system: free and advanced
export type MobileDevTier = "free" | "advanced";

export interface LicenseInfo {
  tier: MobileDevTier;
  valid: boolean;
  licenseKey?: string;
  expiresAt?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".mobile-dev-mcp");
const LICENSE_CACHE_FILE = path.join(CONFIG_DIR, "license.json");

// License validation API (Cloudflare Worker)
const LICENSE_API_URL = "https://mobiledev-license-api.giladworkersdev.workers.dev/validate";

// Cache TTL: 1 hour (reduced from 24 hours for faster revocation)
const CACHE_TTL_MS = 60 * 60 * 1000;

// ============================================================================
// MACHINE ID
// ============================================================================

let cachedMachineId: string | null = null;

function getMachineId(): string {
  if (cachedMachineId) return cachedMachineId;

  try {
    if (process.platform === "win32") {
      const output = execSync("wmic csproduct get uuid", { encoding: "utf-8" });
      const lines = output.trim().split("\n");
      if (lines.length > 1) {
        cachedMachineId = lines[1].trim();
        return cachedMachineId;
      }
    } else if (process.platform === "linux") {
      if (fs.existsSync("/etc/machine-id")) {
        cachedMachineId = fs.readFileSync("/etc/machine-id", "utf-8").trim();
        return cachedMachineId;
      }
    } else if (process.platform === "darwin") {
      const output = execSync("ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID", { encoding: "utf-8" });
      const match = output.match(/"([A-F0-9-]+)"/);
      if (match) {
        cachedMachineId = match[1];
        return cachedMachineId;
      }
    }
  } catch {
    // Ignore errors
  }

  cachedMachineId = os.hostname();
  return cachedMachineId;
}

// ============================================================================
// CACHE INTEGRITY (HMAC signing)
// ============================================================================

function getCacheSecret(): string {
  // Use machine ID as part of secret to prevent cache file copying between machines
  return `mobiledev-${getMachineId()}-cache-v1`;
}

function signCacheData(data: object): string {
  const payload = JSON.stringify(data);
  return crypto.createHmac("sha256", getCacheSecret()).update(payload).digest("hex");
}

function verifyCacheSignature(data: object, signature: string): boolean {
  const expected = signCacheData(data);
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expected);
  // Length check before timingSafeEqual to prevent length-based timing leaks
  // (timingSafeEqual throws if lengths differ, which is itself a timing leak)
  if (sigBuffer.length !== expBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expBuffer);
}

// ============================================================================
// LICENSE CACHE
// ============================================================================

interface CachedLicense {
  data: {
    tier: MobileDevTier;
    licenseKey: string;
    expiresAt?: string;
    lastValidated: number;
  };
  signature: string;
}

function loadCachedLicense(): CachedLicense["data"] | null {
  try {
    if (fs.existsSync(LICENSE_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LICENSE_CACHE_FILE, "utf-8"));

      // Verify signature to prevent tampering
      if (raw.data && raw.signature) {
        if (verifyCacheSignature(raw.data, raw.signature)) {
          return raw.data;
        } else {
          // Signature mismatch - delete corrupted cache
          console.error("License cache signature mismatch - clearing cache");
          fs.unlinkSync(LICENSE_CACHE_FILE);
          return null;
        }
      }

      // Legacy cache without signature - delete it
      fs.unlinkSync(LICENSE_CACHE_FILE);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function saveLicenseCache(data: CachedLicense["data"]): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }

    const signature = signCacheData(data);
    const cache: CachedLicense = { data, signature };

    // Write with restricted permissions (owner read/write only)
    fs.writeFileSync(LICENSE_CACHE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch {
    // Ignore write errors
  }
}

// ============================================================================
// LICENSE VALIDATION
// ============================================================================

export async function checkLicense(): Promise<LicenseInfo> {
  try {
    const cached = loadCachedLicense();

    if (cached && cached.licenseKey) {
      const now = Date.now();
      const lastCheck = cached.lastValidated || 0;

      // Check if cache is still valid (1 hour TTL)
      if (now - lastCheck < CACHE_TTL_MS) {
        return {
          tier: cached.tier,
          valid: true,
          licenseKey: cached.licenseKey,
          expiresAt: cached.expiresAt,
        };
      }

      // Re-validate with API
      const validated = await validateWithLemonSqueezy(cached.licenseKey);
      if (validated) {
        return validated;
      }

      // Validation failed - clear cache and fall back to free
      try {
        fs.unlinkSync(LICENSE_CACHE_FILE);
      } catch {
        // Ignore
      }
    }

    return { tier: "free", valid: true };
  } catch {
    return { tier: "free", valid: true };
  }
}

async function validateWithLemonSqueezy(licenseKey: string): Promise<LicenseInfo | null> {
  return new Promise((resolve) => {
    const machineId = getMachineId();
    const postData = JSON.stringify({
      license_key: licenseKey,
      instance_id: machineId,
    });

    const url = new URL(LICENSE_API_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": postData.length,
        },
      },
      (res) => {
        let data = "";
        const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB limit to prevent DoS
        res.on("data", (chunk) => {
          data += chunk;
          // Abort if response is too large (potential DoS)
          if (data.length > MAX_RESPONSE_SIZE) {
            req.destroy();
            resolve(null);
          }
        });
        res.on("end", () => {
          try {
            const response = JSON.parse(data);
            if (response.valid) {
              const tier = mapProductToTier(response.meta?.product_name || "");
              const info: LicenseInfo = {
                tier,
                valid: true,
                licenseKey,
                expiresAt: response.license_key?.expires_at,
              };

              saveLicenseCache({
                tier,
                licenseKey,
                expiresAt: response.license_key?.expires_at,
                lastValidated: Date.now(),
              });

              resolve(info);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
    req.write(postData);
    req.end();
  });
}

function mapProductToTier(productName: string): MobileDevTier {
  const name = productName.toLowerCase();
  // Any paid product maps to advanced tier
  if (name.includes("advanced") || name.includes("pro") || name.includes("basic")) {
    return "advanced";
  }
  return "free";
}

// ============================================================================
// TOOL ACCESS CONTROL
// ============================================================================

export function canAccessTool(toolName: string, tier: MobileDevTier): boolean {
  // Free tools are always accessible
  if (FREE_TOOLS.includes(toolName)) {
    return true;
  }

  // Advanced tools require advanced tier
  if (tier === "advanced") {
    if (ADVANCED_TOOLS.includes(toolName)) {
      return true;
    }
  }

  return false;
}

export function isFreeTool(toolName: string): boolean {
  return FREE_TOOLS.includes(toolName);
}

export function isAdvancedOnlyTool(toolName: string): boolean {
  return ADVANCED_TOOLS.includes(toolName) && !FREE_TOOLS.includes(toolName);
}

export function getMaxLogLines(tier: MobileDevTier): number {
  return TIER_LIMITS[tier]?.maxLogLines || 50;
}

export function getMaxDevices(tier: MobileDevTier): number {
  return TIER_LIMITS[tier]?.maxDevices || 1;
}

// ============================================================================
// LICENSE TOOLS (exposed via MCP)
// ============================================================================

export async function getLicenseStatus(): Promise<string> {
  const license = await checkLicense();
  const limits = TIER_LIMITS[license.tier];

  return JSON.stringify({
    tier: license.tier.toUpperCase(),
    valid: license.valid,
    expiresAt: license.expiresAt || "N/A",
    features: {
      maxLogLines: limits?.maxLogLines || 50,
      maxDevices: limits?.maxDevices || 1,
      tools: license.tier === "advanced" ? 21 : 8,
    },
    upgrade: license.tier === "free" ? {
      url: "https://codecontrol.ai/mcp",
      price: "$18/month",
      features: ["UI inspection", "Screen analysis", "Multi-device support"],
    } : null,
    attribution: {
      required: license.tier === "free",
      notice: "MIT License: Attribution required - credit GGBoi360 in README or credits",
      example: "Mobile Dev MCP by GGBoi360 (https://github.com/GGBoi360/mobile-dev-mcp)",
    },
    _powered_by: "Mobile Dev MCP by GGBoi360",
  }, null, 2);
}

export async function setLicenseKey(licenseKey: string): Promise<string> {
  if (!licenseKey || licenseKey.trim() === "") {
    return JSON.stringify({ success: false, error: "License key is required" });
  }

  // Basic format validation
  const key = licenseKey.trim();
  if (key.length < 10 || key.length > 100) {
    return JSON.stringify({ success: false, error: "Invalid license key format" });
  }

  const validated = await validateWithLemonSqueezy(key);

  if (validated) {
    return JSON.stringify({
      success: true,
      tier: validated.tier.toUpperCase(),
      expiresAt: validated.expiresAt || "N/A",
      message: `License activated! You now have ${validated.tier.toUpperCase()} tier access with all 21 tools.`,
    });
  }

  return JSON.stringify({
    success: false,
    error: "Invalid license key. Please check your key and try again.",
  });
}
