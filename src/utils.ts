// Mobile Dev MCP - Shared Utilities

import { exec, ChildProcess } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

export const execAsync = promisify(exec);

// ============================================================================
// INPUT VALIDATION (Security)
// ============================================================================

/**
 * Validate Android device ID format
 * Allows: emulator-5554, device serials like RF8M12345XY, IP:port like 192.168.1.1:5555
 */
export function validateDeviceId(deviceId: string): boolean {
  if (!deviceId || deviceId.length > 64) return false;
  // Allow alphanumeric, dashes, colons, periods (for IP addresses)
  return /^[a-zA-Z0-9\-.:]+$/.test(deviceId);
}

/**
 * Validate Android package name format
 * Must be like: com.example.app, org.company.myapp
 */
export function validatePackageName(packageName: string): boolean {
  if (!packageName || packageName.length < 3 || packageName.length > 255) return false;
  // Android package name: lowercase letters, numbers, underscores, dots
  // Must contain at least one dot, cannot start/end with dot
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName);
}

/**
 * Validate iOS Simulator UDID format
 * Must be UUID format or "booted" keyword
 */
export function validateUdid(udid: string): boolean {
  if (!udid) return false;
  if (udid === "booted") return true;
  // UUID format: 8-4-4-4-12 hex characters
  return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(udid);
}

/**
 * Validate log filter/tag name
 * Allows alphanumeric, underscores, and asterisk for wildcard
 */
export function validateLogFilter(filter: string): boolean {
  if (!filter || filter.length > 128) return false;
  return /^[a-zA-Z0-9_*]+$/.test(filter);
}

/**
 * Validate log level
 * Must be one of: V, D, I, W, E, F
 */
export function validateLogLevel(level: string): boolean {
  return ["V", "D", "I", "W", "E", "F"].includes(level);
}

/**
 * Validate port number
 */
export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Generate a secure random filename for temporary files
 */
export function generateSecureTempFilename(extension: string): string {
  const randomPart = crypto.randomBytes(16).toString("hex");
  return path.join(os.tmpdir(), `mobiledev_${randomPart}.${extension}`);
}

// Sleep utility
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// ADB PATH RESOLUTION
// ============================================================================

export function getAdbCommand(): string {
  const isWindows = process.platform === "win32";
  const homedir = os.homedir();

  if (isWindows) {
    const windowsPaths = [
      `${process.env.LOCALAPPDATA || `${homedir}\\AppData\\Local`}\\Android\\Sdk\\platform-tools\\adb.exe`,
      process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}\\platform-tools\\adb.exe`,
      `C:\\Android\\Sdk\\platform-tools\\adb.exe`,
      `${homedir}\\Android\\Sdk\\platform-tools\\adb.exe`,
    ].filter(Boolean) as string[];

    for (const adbPath of windowsPaths) {
      if (fs.existsSync(adbPath)) {
        return `"${adbPath}"`;
      }
    }
  } else {
    const unixPaths = [
      process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}/platform-tools/adb`,
      `${homedir}/Library/Android/sdk/platform-tools/adb`,
      `${homedir}/Android/Sdk/platform-tools/adb`,
      "/opt/homebrew/bin/adb",
      "/usr/local/bin/adb",
    ].filter(Boolean) as string[];

    for (const adbPath of unixPaths) {
      if (fs.existsSync(adbPath)) {
        return `"${adbPath}"`;
      }
    }
  }

  return "adb";
}

export const ADB = getAdbCommand();

// ============================================================================
// iOS SIMULATOR UTILITIES
// ============================================================================

export function getXcrunCommand(): string {
  if (process.platform !== "darwin") {
    return "xcrun";
  }

  const xcrunPaths = [
    "/usr/bin/xcrun",
    "/Applications/Xcode.app/Contents/Developer/usr/bin/xcrun",
  ];

  for (const p of xcrunPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return "xcrun";
}

export const XCRUN = getXcrunCommand();

// ============================================================================
// DEVICE UTILITIES
// ============================================================================

export async function getDefaultDevice(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${ADB} devices`);
    const lines = stdout.trim().split("\n").slice(1);
    const devices = lines
      .filter((line) => line.includes("device") && !line.includes("offline"))
      .map((line) => line.split("\t")[0]);

    return devices[0] || null;
  } catch {
    return null;
  }
}

export async function listConnectedDevices(): Promise<Array<{ id: string; status: string }>> {
  try {
    const { stdout } = await execAsync(`${ADB} devices`);
    const lines = stdout.trim().split("\n").slice(1);
    return lines
      .filter((line) => line.trim())
      .map((line) => {
        const [id, status] = line.split("\t");
        return { id: id.trim(), status: status?.trim() || "unknown" };
      });
  } catch {
    return [];
  }
}

// ============================================================================
// UI TREE PARSING
// ============================================================================

export interface UiElement {
  text: string;
  resourceId: string;
  className: string;
  contentDescription: string;
  bounds: string;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  selected: boolean;
  checked: boolean;
  scrollable: boolean;
  centerX?: number;
  centerY?: number;
}

// Size limits to prevent DoS attacks
const MAX_XML_SIZE = 10 * 1024 * 1024;  // 10MB max
const MAX_ELEMENTS = 50000;  // Reasonable limit for UI tree

export function parseUiTree(xmlDump: string): UiElement[] {
  // Security: Prevent DoS from oversized XML dumps
  if (xmlDump.length > MAX_XML_SIZE) {
    throw new Error(`XML dump exceeds maximum size (${MAX_XML_SIZE} bytes)`);
  }

  const elements: UiElement[] = [];
  const nodeRegex = /<node[^>]+>/g;
  let match;

  // Precompiled regex patterns for better performance and security
  const attrRegexes: Record<string, RegExp> = {
    "text": /text="([^"]*)"/,
    "resource-id": /resource-id="([^"]*)"/,
    "class": /class="([^"]*)"/,
    "content-desc": /content-desc="([^"]*)"/,
    "bounds": /bounds="([^"]*)"/,
    "clickable": /clickable="([^"]*)"/,
    "enabled": /enabled="([^"]*)"/,
    "focused": /focused="([^"]*)"/,
    "selected": /selected="([^"]*)"/,
    "checked": /checked="([^"]*)"/,
    "scrollable": /scrollable="([^"]*)"/,
  };

  while ((match = nodeRegex.exec(xmlDump)) !== null) {
    // Security: Limit element count to prevent memory exhaustion
    if (elements.length >= MAX_ELEMENTS) {
      break;
    }

    const node = match[0];

    const getText = (attr: string): string => {
      const regex = attrRegexes[attr];
      if (!regex) return "";
      const attrMatch = node.match(regex);
      return attrMatch ? attrMatch[1] : "";
    };

    const getBool = (attr: string): boolean => getText(attr) === "true";

    const element: UiElement = {
      text: getText("text"),
      resourceId: getText("resource-id"),
      className: getText("class"),
      contentDescription: getText("content-desc"),
      bounds: getText("bounds"),
      clickable: getBool("clickable"),
      enabled: getBool("enabled"),
      focused: getBool("focused"),
      selected: getBool("selected"),
      checked: getBool("checked"),
      scrollable: getBool("scrollable"),
    };

    // Parse bounds to get center coordinates
    const boundsMatch = element.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (boundsMatch) {
      const [, x1, y1, x2, y2] = boundsMatch.map(Number);
      element.centerX = Math.floor((x1 + x2) / 2);
      element.centerY = Math.floor((y1 + y2) / 2);
    }

    elements.push(element);
  }

  return elements;
}

export function findElementInTree(
  elements: UiElement[],
  criteria: { text?: string; resourceId?: string; contentDescription?: string; className?: string }
): UiElement | null {
  for (const el of elements) {
    if (criteria.text && el.text.toLowerCase().includes(criteria.text.toLowerCase())) {
      return el;
    }
    if (criteria.resourceId && el.resourceId.includes(criteria.resourceId)) {
      return el;
    }
    if (criteria.contentDescription && el.contentDescription.toLowerCase().includes(criteria.contentDescription.toLowerCase())) {
      return el;
    }
    if (criteria.className && el.className.includes(criteria.className)) {
      return el;
    }
  }
  return null;
}

// ============================================================================
// SCREENSHOT UTILITIES
// ============================================================================

export async function captureAndroidScreenshot(device?: string): Promise<string> {
  // Validate device ID if provided
  if (device && !validateDeviceId(device)) {
    throw new Error("Invalid device ID format");
  }

  const deviceArg = device ? `-s ${device}` : "";
  const { stdout } = await execAsync(
    `${ADB} ${deviceArg} exec-out screencap -p | base64`,
    { maxBuffer: 50 * 1024 * 1024, encoding: "buffer" }
  );
  return stdout.toString("base64");
}

export async function captureIosScreenshot(udid?: string): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("iOS screenshots only available on macOS");
  }

  // Validate UDID if provided
  if (udid && !validateUdid(udid)) {
    throw new Error("Invalid iOS Simulator UDID format");
  }

  // Use secure random filename
  const tmpFile = generateSecureTempFilename("png");
  const udidArg = udid ? udid : "booted";

  try {
    await execAsync(`${XCRUN} simctl io ${udidArg} screenshot "${tmpFile}"`);
    const data = fs.readFileSync(tmpFile);
    return data.toString("base64");
  } finally {
    // Always clean up temp file
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// CONFIG UTILITIES
// ============================================================================

export function loadConfig(): Record<string, any> {
  const configPath = path.join(os.homedir(), ".mobile-dev-mcp", "config.json");

  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    // Ignore config errors
  }

  return {};
}

export function saveConfig(config: Record<string, any>): void {
  const configDir = path.join(os.homedir(), ".mobile-dev-mcp");
  const configPath = path.join(configDir, "config.json");

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
