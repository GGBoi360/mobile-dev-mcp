#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as readline from "readline";

// License module
import {
  checkLicense,
  requireAdvanced,
  requireBasic,
  licenseTools,
  handleLicenseTool,
  loadConfig,
  getMaxLogLines,
  isAdvancedTool,
  LicenseTier,
  TIER_LIMITS,
  getTrialStatus,
  incrementTrialUsage,
} from "./license.js";

const execAsync = promisify(exec);

// Configuration (loaded from user config)
const userConfig = loadConfig();
const CONFIG = {
  metroPort: userConfig.metroPort || 8081,
  logBufferSize: userConfig.logBufferSize || 100,
  screenshotDir: process.env.TEMP || "/tmp",
};

// Log buffers
let metroLogBuffer: string[] = [];
let adbLogBuffer: string[] = [];
let metroProcess: ChildProcess | null = null;
let adbLogProcess: ChildProcess | null = null;

// Screenshot history for Pro users
let screenshotHistory: Array<{ timestamp: string; data: string }> = [];
const MAX_SCREENSHOT_HISTORY = 20;

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const coreTools: Tool[] = [
  // === FREE TIER TOOLS ===
  {
    name: "get_metro_logs",
    description:
      "Get recent logs from Metro bundler. Returns the last N lines of Metro output. Useful for seeing build errors, warnings, and bundle status.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of log lines to retrieve (default: 50, max: 50 for free tier)",
          default: 50,
        },
        filter: {
          type: "string",
          description: "Optional filter string to match (e.g., 'error', 'warning')",
        },
      },
    },
  },
  {
    name: "get_adb_logs",
    description:
      "Get logs from Android device/emulator via ADB logcat. Filters for React Native and JavaScript logs by default.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of log lines to retrieve (default: 50, max: 50 for free tier)",
          default: 50,
        },
        filter: {
          type: "string",
          description: "Tag filter for logcat (default: 'ReactNativeJS'). Use '*' for all logs.",
          default: "ReactNativeJS",
        },
        level: {
          type: "string",
          enum: ["V", "D", "I", "W", "E", "F"],
          description: "Minimum log level: V(erbose), D(ebug), I(nfo), W(arn), E(rror), F(atal)",
          default: "I",
        },
      },
    },
  },
  {
    name: "screenshot_emulator",
    description:
      "Capture a screenshot from the currently running Android emulator. Returns the screenshot as a base64-encoded image.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Specific device ID (from 'adb devices'). Leave empty for default device.",
        },
      },
    },
  },
  {
    name: "list_devices",
    description:
      "List all connected Android devices and emulators via ADB. Shows device IDs and status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "check_metro_status",
    description:
      "Check if Metro bundler is running and get its current status. Returns bundle status and any pending builds.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Metro port (default: 8081)",
          default: 8081,
        },
      },
    },
  },
  {
    name: "get_app_info",
    description:
      "Get information about an installed app on the Android device, including version and permissions.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: {
          type: "string",
          description: "The app package name (e.g., 'com.myapp' or 'host.exp.exponent')",
        },
      },
      required: ["packageName"],
    },
  },
  {
    name: "clear_app_data",
    description:
      "Clear app data and cache on Android device. Useful for testing fresh installs.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: {
          type: "string",
          description: "The app package name to clear data for",
        },
      },
      required: ["packageName"],
    },
  },
  {
    name: "restart_adb",
    description:
      "Restart the ADB server. Useful when ADB becomes unresponsive or devices are not detected.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_device_info",
    description:
      "Get detailed information about the connected Android device including OS version, screen size, and available memory.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Specific device ID. Leave empty for default device.",
        },
      },
    },
  },
  {
    name: "start_metro_logging",
    description:
      "Start capturing Metro bundler logs by watching a log file. Point this at your Metro output file or pipe Metro to a file.",
    inputSchema: {
      type: "object",
      properties: {
        logFile: {
          type: "string",
          description: "Path to Metro log file to watch. If not provided, will try common locations.",
        },
      },
    },
  },
  {
    name: "stop_metro_logging",
    description: "Stop the background Metro log capture.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // === PRO TIER TOOLS ===
  {
    name: "stream_adb_realtime",
    description:
      "[PRO] Start real-time ADB log streaming. Logs are continuously captured in the background.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Tag filter for logcat (default: 'ReactNativeJS')",
          default: "ReactNativeJS",
        },
      },
    },
  },
  {
    name: "stop_adb_streaming",
    description: "[PRO] Stop real-time ADB log streaming.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "screenshot_history",
    description:
      "[PRO] Get previously captured screenshots. Stores up to 20 screenshots.",
    inputSchema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of recent screenshots to retrieve (default: 5)",
          default: 5,
        },
      },
    },
  },
  {
    name: "watch_for_errors",
    description:
      "[PRO] Start watching logs for specific error patterns. Returns when an error is detected.",
    inputSchema: {
      type: "object",
      properties: {
        patterns: {
          type: "array",
          items: { type: "string" },
          description: "Error patterns to watch for (e.g., ['Error', 'Exception', 'crash'])",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 60)",
          default: 60,
        },
      },
    },
  },
  {
    name: "multi_device_logs",
    description:
      "[PRO] Get logs from multiple devices simultaneously.",
    inputSchema: {
      type: "object",
      properties: {
        devices: {
          type: "array",
          items: { type: "string" },
          description: "Array of device IDs to get logs from",
        },
        lines: {
          type: "number",
          description: "Number of log lines per device",
          default: 30,
        },
      },
    },
  },

  // === INTERACTION TOOLS (Advanced) ===
  {
    name: "tap_screen",
    description:
      "[PRO] Tap on the screen at specific coordinates. Use this to interact with UI elements.",
    inputSchema: {
      type: "object",
      properties: {
        x: {
          type: "number",
          description: "X coordinate to tap",
        },
        y: {
          type: "number",
          description: "Y coordinate to tap",
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "input_text",
    description:
      "[PRO] Type text into the currently focused input field.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to type",
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "press_button",
    description:
      "[PRO] Press a hardware button (back, home, recent apps, volume, power).",
    inputSchema: {
      type: "object",
      properties: {
        button: {
          type: "string",
          enum: ["back", "home", "recent", "volume_up", "volume_down", "power", "enter"],
          description: "Button to press",
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
      required: ["button"],
    },
  },
  {
    name: "swipe_screen",
    description:
      "[PRO] Swipe on the screen from one point to another. Use for scrolling or gestures.",
    inputSchema: {
      type: "object",
      properties: {
        startX: {
          type: "number",
          description: "Starting X coordinate",
        },
        startY: {
          type: "number",
          description: "Starting Y coordinate",
        },
        endX: {
          type: "number",
          description: "Ending X coordinate",
        },
        endY: {
          type: "number",
          description: "Ending Y coordinate",
        },
        duration: {
          type: "number",
          description: "Swipe duration in milliseconds (default: 300)",
          default: 300,
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
      required: ["startX", "startY", "endX", "endY"],
    },
  },
  {
    name: "launch_app",
    description:
      "[PRO] Launch an app by its package name.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: {
          type: "string",
          description: "Package name of the app (e.g., 'com.example.myapp')",
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
      required: ["packageName"],
    },
  },
  {
    name: "install_apk",
    description:
      "[PRO] Install an APK file to the device.",
    inputSchema: {
      type: "object",
      properties: {
        apkPath: {
          type: "string",
          description: "Path to the APK file",
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
      required: ["apkPath"],
    },
  },
];

// Combine core tools with license tools
const tools: Tool[] = [...coreTools, ...licenseTools];

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

async function getMetroLogs(lines: number = 50, filter?: string): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("get_metro_logs");
  if (!check.allowed) return check.message!;

  const license = await checkLicense();
  const tierLimits = TIER_LIMITS[license.tier];
  const maxLines = Math.min(lines, tierLimits.maxLogLines);

  let logs = metroLogBuffer.slice(-maxLines);

  if (filter) {
    logs = logs.filter((line) =>
      line.toLowerCase().includes(filter.toLowerCase())
    );
  }

  if (logs.length === 0) {
    try {
      const response = await fetchMetroStatus(CONFIG.metroPort);
      let result = `Metro is running but no logs captured yet.\nMetro status: ${response}\n\nTip: Use 'start_metro_logging' with a log file path, or pipe Metro output:\n  npx expo start 2>&1 | tee metro.log`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    } catch {
      let result = `No Metro logs available. Metro may not be running.\n\nTo capture logs:\n1. Start Metro with output to file: npx expo start 2>&1 | tee metro.log\n2. Use start_metro_logging tool with logFile parameter`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }
  }

  const header = license.valid
    ? `📋 Metro Logs (${logs.length} lines):`
    : `📋 Metro Logs (${logs.length} lines, trial mode):`;

  let result = `${header}\n${"─".repeat(50)}\n${logs.join("\n")}`;
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

async function getAdbLogs(
  lines: number = 50,
  filter: string = "ReactNativeJS",
  level: string = "I"
): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("get_adb_logs");
  if (!check.allowed) return check.message!;

  const license = await checkLicense();
  const tierLimits = TIER_LIMITS[license.tier];
  const maxLines = Math.min(lines, tierLimits.maxLogLines);

  try {
    await execAsync("adb version");

    let command: string;
    if (filter === "*") {
      command = `adb logcat -d -t ${maxLines} *:${level}`;
    } else {
      command = `adb logcat -d -t ${maxLines} ${filter}:${level} *:S`;
    }

    const { stdout, stderr } = await execAsync(command);

    if (stderr && !stdout) {
      return `ADB Error: ${stderr}`;
    }

    let result = stdout || "No logs found matching the filter.";
    if (check.message) result += `\n\n${check.message}`;

    return result;
  } catch (error: any) {
    if (error.message.includes("not recognized") || error.message.includes("not found")) {
      return "ADB is not installed or not in PATH. Please install Android SDK Platform Tools.";
    }
    if (error.message.includes("no devices")) {
      return "No Android devices/emulators connected. Start an emulator or connect a device.";
    }
    return `Error getting ADB logs: ${error.message}`;
  }
}

async function screenshotEmulator(device?: string): Promise<{
  success: boolean;
  data?: string;
  mimeType?: string;
  error?: string;
  trialMessage?: string;
}> {
  // Check license/trial status
  const check = await requireBasic("screenshot_emulator");
  if (!check.allowed) {
    return { success: false, error: check.message };
  }

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    const screenshotPath = path.join(
      CONFIG.screenshotDir,
      `screenshot_${Date.now()}.png`
    );

    // Capture screenshot
    await execAsync(`adb ${deviceFlag} exec-out screencap -p > "${screenshotPath}"`);

    // Read and convert to base64
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Data = imageBuffer.toString("base64");

    // Clean up temp file
    fs.unlinkSync(screenshotPath);

    // Save to history for Advanced users
    const license = await checkLicense();
    if (license.valid && license.tier === "advanced") {
      screenshotHistory.unshift({
        timestamp: new Date().toISOString(),
        data: base64Data,
      });
      if (screenshotHistory.length > MAX_SCREENSHOT_HISTORY) {
        screenshotHistory = screenshotHistory.slice(0, MAX_SCREENSHOT_HISTORY);
      }
    }

    return {
      success: true,
      data: base64Data,
      mimeType: "image/png",
      trialMessage: check.message,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to capture screenshot: ${error.message}`,
    };
  }
}

async function listDevices(): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("list_devices");
  if (!check.allowed) return check.message!;

  try {
    const { stdout } = await execAsync("adb devices -l");
    const lines = stdout.trim().split("\n");

    if (lines.length <= 1) {
      let result = `No devices connected.\n\nTo connect:\n- Start an Android emulator (Android Studio, Genymotion)\n- Or connect a physical device with USB debugging enabled`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    let result = stdout;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error listing devices: ${error.message}`;
  }
}

async function fetchMetroStatus(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/status`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data || "Metro is running"));
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

async function checkMetroStatus(port: number = 8081): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("check_metro_status");
  if (!check.allowed) return check.message!;

  try {
    const status = await fetchMetroStatus(port);
    let result = `✅ Metro is running on port ${port}\nStatus: ${status}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch {
    let result = `❌ Metro does not appear to be running on port ${port}.\n\nTo start Metro:\n  npx expo start\n  # or\n  npx react-native start`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }
}

async function getAppInfo(packageName: string): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("get_app_info");
  if (!check.allowed) return check.message!;

  try {
    const { stdout } = await execAsync(`adb shell dumpsys package ${packageName}`);

    const lines = stdout.split("\n");
    const relevantInfo: string[] = [];

    for (const line of lines) {
      if (
        line.includes("versionName") ||
        line.includes("versionCode") ||
        line.includes("targetSdk") ||
        line.includes("dataDir") ||
        line.includes("firstInstallTime") ||
        line.includes("lastUpdateTime")
      ) {
        relevantInfo.push(line.trim());
      }
    }

    if (relevantInfo.length === 0) {
      let result = `Package ${packageName} not found on device.`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    let result = `📱 App Info for ${packageName}:\n${relevantInfo.join("\n")}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error getting app info: ${error.message}`;
  }
}

async function clearAppData(packageName: string): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("clear_app_data");
  if (!check.allowed) return check.message!;

  try {
    await execAsync(`adb shell pm clear ${packageName}`);
    let result = `✅ Successfully cleared data for ${packageName}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error clearing app data: ${error.message}`;
  }
}

async function restartAdb(): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("restart_adb");
  if (!check.allowed) return check.message!;

  try {
    await execAsync("adb kill-server");
    await execAsync("adb start-server");
    const { stdout } = await execAsync("adb devices");
    let result = `✅ ADB server restarted successfully.\n\nConnected devices:\n${stdout}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error restarting ADB: ${error.message}`;
  }
}

async function getDeviceInfo(device?: string): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("get_device_info");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    const commands = [
      `adb ${deviceFlag} shell getprop ro.build.version.release`,
      `adb ${deviceFlag} shell getprop ro.build.version.sdk`,
      `adb ${deviceFlag} shell getprop ro.product.model`,
      `adb ${deviceFlag} shell getprop ro.product.manufacturer`,
      `adb ${deviceFlag} shell wm size`,
      `adb ${deviceFlag} shell wm density`,
    ];

    const results = await Promise.all(
      commands.map((cmd) =>
        execAsync(cmd)
          .then(({ stdout }) => stdout.trim())
          .catch(() => "N/A")
      )
    );

    let result = `📱 Device Information:
─────────────────────────────
  Android Version: ${results[0]}
  SDK Level: ${results[1]}
  Model: ${results[3]} ${results[2]}
  Screen Size: ${results[4].replace("Physical size: ", "")}
  Screen Density: ${results[5].replace("Physical density: ", "")} dpi`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error getting device info: ${error.message}`;
  }
}

// ============================================================================
// FIXED: Metro Logging Implementation
// ============================================================================

async function startMetroLogging(logFile?: string): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("start_metro_logging");
  if (!check.allowed) return check.message!;

  if (metroProcess) {
    let result = "Metro logging is already running. Use 'stop_metro_logging' first.";
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }

  metroLogBuffer = [];

  // If a log file is provided, tail it
  if (logFile) {
    if (!fs.existsSync(logFile)) {
      let result = `Log file not found: ${logFile}\n\nCreate it by running:\n  npx expo start 2>&1 | tee ${logFile}`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    // Use PowerShell's Get-Content -Wait on Windows, tail -f on Unix
    const isWindows = process.platform === "win32";

    if (isWindows) {
      metroProcess = spawn("powershell", [
        "-Command",
        `Get-Content -Path "${logFile}" -Wait -Tail 100`,
      ]);
    } else {
      metroProcess = spawn("tail", ["-f", "-n", "100", logFile]);
    }

    metroProcess.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      metroLogBuffer.push(...lines);
      if (metroLogBuffer.length > CONFIG.logBufferSize) {
        metroLogBuffer = metroLogBuffer.slice(-CONFIG.logBufferSize);
      }
    });

    metroProcess.stderr?.on("data", (data: Buffer) => {
      metroLogBuffer.push(`[STDERR] ${data.toString().trim()}`);
    });

    metroProcess.on("error", (err) => {
      metroLogBuffer.push(`[ERROR] ${err.message}`);
    });

    let result = `✅ Metro log capture started!\nWatching: ${logFile}\n\nUse 'get_metro_logs' to retrieve captured logs.`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }

  // No log file provided - give instructions
  let result = `📋 Metro Log Capture Setup
─────────────────────────────

To capture Metro logs, you have two options:

Option 1: Pipe Metro to a file (Recommended)
  npx expo start 2>&1 | tee metro.log

  Then run: start_metro_logging with logFile="metro.log"

Option 2: Check common log locations
  - Expo: .expo/logs/
  - React Native: Check Metro terminal output

Option 3: Use ADB logs instead
  For device-side JavaScript logs, use 'get_adb_logs'

─────────────────────────────
Once you have a log file, call this tool again with the logFile parameter.`;
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

async function stopMetroLogging(): Promise<string> {
  // Check license/trial status
  const check = await requireBasic("stop_metro_logging");
  if (!check.allowed) return check.message!;

  if (metroProcess) {
    metroProcess.kill();
    metroProcess = null;
  }
  const logCount = metroLogBuffer.length;
  let result = `✅ Metro logging stopped. ${logCount} log lines were captured.`;
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

// ============================================================================
// PRO FEATURE IMPLEMENTATIONS
// ============================================================================

async function streamAdbRealtime(filter: string = "ReactNativeJS"): Promise<string> {
  const check = await requireAdvanced("stream_adb_realtime");
  if (!check.allowed) return check.message!;

  if (adbLogProcess) {
    return "ADB streaming is already running. Use 'stop_adb_streaming' first.";
  }

  adbLogBuffer = [];

  adbLogProcess = spawn("adb", ["logcat", `${filter}:V`, "*:S"]);

  adbLogProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    adbLogBuffer.push(...lines);
    if (adbLogBuffer.length > 500) {
      adbLogBuffer = adbLogBuffer.slice(-500);
    }
  });

  adbLogProcess.on("error", (err) => {
    adbLogBuffer.push(`[ERROR] ${err.message}`);
  });

  return `✅ [PRO] Real-time ADB streaming started!\nFilter: ${filter}\n\nUse 'get_adb_logs' to retrieve the live buffer.`;
}

function stopAdbStreaming(): string {
  if (adbLogProcess) {
    adbLogProcess.kill();
    adbLogProcess = null;
  }
  return `✅ ADB streaming stopped. Buffer contained ${adbLogBuffer.length} lines.`;
}

async function getScreenshotHistory(count: number = 5): Promise<string> {
  const check = await requireAdvanced("screenshot_history");
  if (!check.allowed) return check.message!;

  if (screenshotHistory.length === 0) {
    return "No screenshots in history. Take screenshots using 'screenshot_emulator' first.";
  }

  const recent = screenshotHistory.slice(0, count);
  return `📸 [PRO] Screenshot History (${recent.length} of ${screenshotHistory.length}):\n\n${recent
    .map((s, i) => `${i + 1}. ${s.timestamp}`)
    .join("\n")}\n\nNote: Full image data available in tool response.`;
}

async function watchForErrors(
  patterns: string[] = ["Error", "Exception"],
  timeout: number = 60
): Promise<string> {
  const check = await requireAdvanced("watch_for_errors");
  if (!check.allowed) return check.message!;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(async () => {
      // Check ADB logs for patterns
      try {
        const { stdout } = await execAsync("adb logcat -d -t 50 *:E");
        for (const pattern of patterns) {
          if (stdout.toLowerCase().includes(pattern.toLowerCase())) {
            clearInterval(checkInterval);
            resolve(
              `🚨 [PRO] Error detected!\nPattern: "${pattern}"\n\nRelevant logs:\n${stdout}`
            );
            return;
          }
        }
      } catch {}

      // Check timeout
      if (Date.now() - startTime > timeout * 1000) {
        clearInterval(checkInterval);
        resolve(`✅ [PRO] No errors detected in ${timeout} seconds.`);
      }
    }, 2000);
  });
}

async function multiDeviceLogs(
  devices: string[],
  lines: number = 30
): Promise<string> {
  const check = await requireAdvanced("multi_device_logs");
  if (!check.allowed) return check.message!;

  if (!devices || devices.length === 0) {
    const { stdout } = await execAsync("adb devices");
    return `No devices specified. Available devices:\n${stdout}`;
  }

  const results = await Promise.all(
    devices.map(async (device) => {
      try {
        const { stdout } = await execAsync(
          `adb -s ${device} logcat -d -t ${lines} ReactNativeJS:V *:S`
        );
        return `📱 Device: ${device}\n${"─".repeat(30)}\n${stdout}`;
      } catch (error: any) {
        return `📱 Device: ${device}\n${"─".repeat(30)}\nError: ${error.message}`;
      }
    })
  );

  return `📋 [PRO] Multi-Device Logs\n${"═".repeat(50)}\n\n${results.join("\n\n")}`;
}

// ============================================================================
// INTERACTION TOOLS (Advanced)
// ============================================================================

async function tapScreen(x: number, y: number, device?: string): Promise<string> {
  const check = await requireAdvanced("tap_screen");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    await execAsync(`adb ${deviceFlag} shell input tap ${x} ${y}`);
    let result = `✅ Tapped at (${x}, ${y})`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error tapping screen: ${error.message}`;
  }
}

async function inputText(text: string, device?: string): Promise<string> {
  const check = await requireAdvanced("input_text");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    // Escape special characters for shell
    const escapedText = text.replace(/([\\'"$ `])/g, "\\$1").replace(/ /g, "%s");
    await execAsync(`adb ${deviceFlag} shell input text "${escapedText}"`);
    let result = `✅ Typed: "${text}"`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error inputting text: ${error.message}`;
  }
}

async function pressButton(button: string, device?: string): Promise<string> {
  const check = await requireAdvanced("press_button");
  if (!check.allowed) return check.message!;

  const keyMap: Record<string, number> = {
    back: 4,
    home: 3,
    recent: 187,
    volume_up: 24,
    volume_down: 25,
    power: 26,
    enter: 66,
  };

  const keyCode = keyMap[button];
  if (!keyCode) {
    return `Unknown button: ${button}. Available: ${Object.keys(keyMap).join(", ")}`;
  }

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    await execAsync(`adb ${deviceFlag} shell input keyevent ${keyCode}`);
    let result = `✅ Pressed: ${button.toUpperCase()}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error pressing button: ${error.message}`;
  }
}

async function swipeScreen(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration: number = 300,
  device?: string
): Promise<string> {
  const check = await requireAdvanced("swipe_screen");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    await execAsync(`adb ${deviceFlag} shell input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
    let result = `✅ Swiped from (${startX}, ${startY}) to (${endX}, ${endY})`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error swiping: ${error.message}`;
  }
}

async function launchApp(packageName: string, device?: string): Promise<string> {
  const check = await requireAdvanced("launch_app");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    // Get the main activity using monkey
    await execAsync(`adb ${deviceFlag} shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
    let result = `✅ Launched: ${packageName}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error launching app: ${error.message}\n\nMake sure the package name is correct.`;
  }
}

async function installApk(apkPath: string, device?: string): Promise<string> {
  const check = await requireAdvanced("install_apk");
  if (!check.allowed) return check.message!;

  if (!fs.existsSync(apkPath)) {
    return `APK file not found: ${apkPath}`;
  }

  try {
    const deviceFlag = device ? `-s ${device}` : "";
    const { stdout } = await execAsync(`adb ${deviceFlag} install -r "${apkPath}"`);
    let result = `✅ APK installed successfully!\n\n${stdout}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error installing APK: ${error.message}`;
  }
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: "claude-mobile-dev-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // License tools
    if (name === "get_license_status" || name === "set_license_key") {
      const result = await handleLicenseTool(name, args || {});
      return { content: [{ type: "text", text: result }] };
    }

    // Core tools
    switch (name) {
      case "get_metro_logs": {
        const result = await getMetroLogs(
          args?.lines as number,
          args?.filter as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "get_adb_logs": {
        const result = await getAdbLogs(
          args?.lines as number,
          args?.filter as string,
          args?.level as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "screenshot_emulator": {
        const result = await screenshotEmulator(args?.device as string);
        if (result.success && result.data) {
          const content: any[] = [
            {
              type: "image",
              data: result.data,
              mimeType: result.mimeType!,
            },
          ];
          // Add trial warning if present
          if (result.trialMessage) {
            content.push({ type: "text", text: result.trialMessage });
          }
          return { content };
        }
        return { content: [{ type: "text", text: result.error! }] };
      }

      case "list_devices": {
        const result = await listDevices();
        return { content: [{ type: "text", text: result }] };
      }

      case "check_metro_status": {
        const result = await checkMetroStatus(args?.port as number);
        return { content: [{ type: "text", text: result }] };
      }

      case "get_app_info": {
        const result = await getAppInfo(args?.packageName as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "clear_app_data": {
        const result = await clearAppData(args?.packageName as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "restart_adb": {
        const result = await restartAdb();
        return { content: [{ type: "text", text: result }] };
      }

      case "get_device_info": {
        const result = await getDeviceInfo(args?.device as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "start_metro_logging": {
        const result = await startMetroLogging(args?.logFile as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "stop_metro_logging": {
        const result = await stopMetroLogging();
        return { content: [{ type: "text", text: result }] };
      }

      // PRO FEATURES
      case "stream_adb_realtime": {
        const result = await streamAdbRealtime(args?.filter as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "stop_adb_streaming": {
        const result = stopAdbStreaming();
        return { content: [{ type: "text", text: result }] };
      }

      case "screenshot_history": {
        const result = await getScreenshotHistory(args?.count as number);
        return { content: [{ type: "text", text: result }] };
      }

      case "watch_for_errors": {
        const result = await watchForErrors(
          args?.patterns as string[],
          args?.timeout as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "multi_device_logs": {
        const result = await multiDeviceLogs(
          args?.devices as string[],
          args?.lines as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      // INTERACTION TOOLS
      case "tap_screen": {
        const result = await tapScreen(
          args?.x as number,
          args?.y as number,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "input_text": {
        const result = await inputText(
          args?.text as string,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "press_button": {
        const result = await pressButton(
          args?.button as string,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "swipe_screen": {
        const result = await swipeScreen(
          args?.startX as number,
          args?.startY as number,
          args?.endX as number,
          args?.endY as number,
          args?.duration as number,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "launch_app": {
        const result = await launchApp(
          args?.packageName as string,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "install_apk": {
        const result = await installApk(
          args?.apkPath as string,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup info to stderr (won't interfere with MCP protocol)
  const license = await checkLicense();
  console.error(`Mobile Dev MCP Server v0.1.0`);
  console.error(`License: ${license.tier.toUpperCase()}`);
  console.error(`Ready for connections...`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
