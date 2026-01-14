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
import WebSocket from "ws";

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

  // === iOS SIMULATOR TOOLS ===
  {
    name: "list_ios_simulators",
    description:
      "List all available iOS Simulators. Shows device name, UDID, state (Booted/Shutdown), and iOS version.",
    inputSchema: {
      type: "object",
      properties: {
        onlyBooted: {
          type: "boolean",
          description: "Only show booted simulators (default: false)",
          default: false,
        },
      },
    },
  },
  {
    name: "screenshot_ios_simulator",
    description:
      "Capture a screenshot from an iOS Simulator. Returns the screenshot as a base64-encoded image.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
    },
  },
  {
    name: "get_ios_simulator_logs",
    description:
      "Get recent logs from an iOS Simulator. Useful for debugging React Native iOS apps.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
        filter: {
          type: "string",
          description: "Filter logs by subsystem or message content",
        },
        lines: {
          type: "number",
          description: "Number of recent log lines (default: 50)",
          default: 50,
        },
      },
    },
  },
  {
    name: "get_ios_simulator_info",
    description:
      "Get detailed information about an iOS Simulator including device type, iOS version, and state.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
    },
  },
  {
    name: "boot_ios_simulator",
    description:
      "[PRO] Boot an iOS Simulator by UDID or device name.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID or device name (e.g., 'iPhone 15 Pro')",
        },
      },
      required: ["udid"],
    },
  },
  {
    name: "shutdown_ios_simulator",
    description:
      "[PRO] Shutdown an iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID. Use 'all' to shutdown all simulators.",
        },
      },
      required: ["udid"],
    },
  },
  {
    name: "install_ios_app",
    description:
      "[PRO] Install an app (.app bundle) on an iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        appPath: {
          type: "string",
          description: "Path to the .app bundle",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
      required: ["appPath"],
    },
  },
  {
    name: "launch_ios_app",
    description:
      "[PRO] Launch an app on an iOS Simulator by bundle identifier.",
    inputSchema: {
      type: "object",
      properties: {
        bundleId: {
          type: "string",
          description: "App bundle identifier (e.g., 'com.example.myapp')",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
      required: ["bundleId"],
    },
  },
  {
    name: "terminate_ios_app",
    description:
      "[PRO] Terminate (force quit) an app on an iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        bundleId: {
          type: "string",
          description: "App bundle identifier to terminate",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
      required: ["bundleId"],
    },
  },
  {
    name: "ios_open_url",
    description:
      "[PRO] Open a URL in the iOS Simulator (deep links, universal links).",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to open (e.g., 'myapp://screen' or 'https://example.com')",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "ios_push_notification",
    description:
      "[PRO] Send a push notification to an iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        bundleId: {
          type: "string",
          description: "App bundle identifier",
        },
        payload: {
          type: "object",
          description: "Push notification payload (APS format)",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
      required: ["bundleId", "payload"],
    },
  },
  {
    name: "ios_set_location",
    description:
      "[PRO] Set the simulated GPS location on an iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
          description: "Latitude coordinate",
        },
        longitude: {
          type: "number",
          description: "Longitude coordinate",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for the booted simulator.",
        },
      },
      required: ["latitude", "longitude"],
    },
  },

  // === REACT DEVTOOLS TOOLS ===
  {
    name: "setup_react_devtools",
    description:
      "[PRO] Set up React DevTools connection for debugging. Configures port forwarding and checks connectivity.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "DevTools port (default: 8097)",
          default: 8097,
        },
        device: {
          type: "string",
          description: "Specific Android device ID (optional)",
        },
      },
    },
  },
  {
    name: "check_devtools_connection",
    description:
      "[PRO] Check if React DevTools is connected and get connection status.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "DevTools port (default: 8097)",
          default: 8097,
        },
      },
    },
  },
  {
    name: "get_react_component_tree",
    description:
      "[PRO] Get the React component hierarchy from connected DevTools. Shows component names and structure.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "DevTools port (default: 8097)",
          default: 8097,
        },
        depth: {
          type: "number",
          description: "Maximum depth to traverse (default: 5)",
          default: 5,
        },
      },
    },
  },
  {
    name: "inspect_react_component",
    description:
      "[PRO] Inspect a specific React component by ID. Returns props, state, and hooks.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: {
          type: "number",
          description: "Component ID from the component tree",
        },
        port: {
          type: "number",
          description: "DevTools port (default: 8097)",
          default: 8097,
        },
      },
      required: ["componentId"],
    },
  },
  {
    name: "search_react_components",
    description:
      "[PRO] Search for React components by name or pattern.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Component name or pattern to search for",
        },
        port: {
          type: "number",
          description: "DevTools port (default: 8097)",
          default: 8097,
        },
      },
      required: ["query"],
    },
  },

  // === NETWORK INSPECTION TOOLS ===
  {
    name: "get_network_requests",
    description:
      "[PRO] Get recent network requests from app logs. Parses fetch/XHR requests from React Native logs.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of log lines to search through (default: 200)",
          default: 200,
        },
        filter: {
          type: "string",
          description: "Filter by URL pattern or method (e.g., 'api', 'POST')",
        },
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
    },
  },
  {
    name: "start_network_monitoring",
    description:
      "[PRO] Start real-time network request monitoring. Captures all HTTP/HTTPS traffic in background.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
    },
  },
  {
    name: "stop_network_monitoring",
    description:
      "[PRO] Stop network monitoring and get summary of captured requests.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_network_stats",
    description:
      "[PRO] Get device network statistics including data usage, active connections, and WiFi info.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
      },
    },
  },
  {
    name: "analyze_request",
    description:
      "[PRO] Analyze a specific network request by index from captured requests. Shows headers, body, timing.",
    inputSchema: {
      type: "object",
      properties: {
        index: {
          type: "number",
          description: "Request index from get_network_requests or monitoring",
        },
      },
      required: ["index"],
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
// iOS SIMULATOR TOOLS
// ============================================================================

interface SimulatorDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  deviceTypeIdentifier?: string;
}

interface SimulatorRuntime {
  runtimeName: string;
  identifier: string;
  version: string;
  devices: SimulatorDevice[];
}

async function checkXcodeInstalled(): Promise<boolean> {
  try {
    await execAsync("xcrun simctl help");
    return true;
  } catch {
    return false;
  }
}

async function listIosSimulators(onlyBooted: boolean = false): Promise<string> {
  const check = await requireBasic("list_ios_simulators");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    if (!(await checkXcodeInstalled())) {
      return "Xcode Command Line Tools not installed. Run: xcode-select --install";
    }

    const { stdout } = await execAsync("xcrun simctl list devices -j");
    const data = JSON.parse(stdout);

    const results: string[] = [];
    results.push("📱 iOS Simulators\n" + "═".repeat(50));

    for (const [runtime, devices] of Object.entries(data.devices)) {
      const deviceList = devices as SimulatorDevice[];
      const filteredDevices = onlyBooted
        ? deviceList.filter((d) => d.state === "Booted")
        : deviceList.filter((d) => d.isAvailable);

      if (filteredDevices.length > 0) {
        // Extract iOS version from runtime identifier
        const runtimeName = runtime.split(".").pop()?.replace(/-/g, " ") || runtime;
        results.push(`\n${runtimeName}:`);

        for (const device of filteredDevices) {
          const status = device.state === "Booted" ? "🟢 Booted" : "⚪ Shutdown";
          results.push(`  ${status} ${device.name}`);
          results.push(`      UDID: ${device.udid}`);
        }
      }
    }

    if (results.length === 1) {
      let result = onlyBooted
        ? "No booted simulators found. Boot one with 'boot_ios_simulator'."
        : "No iOS Simulators available. Open Xcode to download simulator runtimes.";
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    let result = results.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error listing iOS Simulators: ${error.message}`;
  }
}

async function screenshotIosSimulator(udid?: string): Promise<{
  success: boolean;
  data?: string;
  mimeType?: string;
  error?: string;
  trialMessage?: string;
}> {
  const check = await requireBasic("screenshot_ios_simulator");
  if (!check.allowed) {
    return { success: false, error: check.message };
  }

  if (process.platform !== "darwin") {
    return { success: false, error: "iOS Simulators are only available on macOS." };
  }

  try {
    const target = udid || "booted";
    const screenshotPath = path.join(
      CONFIG.screenshotDir,
      `ios_screenshot_${Date.now()}.png`
    );

    await execAsync(`xcrun simctl io ${target} screenshot "${screenshotPath}"`);

    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Data = imageBuffer.toString("base64");
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
    if (error.message.includes("No devices are booted")) {
      return { success: false, error: "No iOS Simulator is booted. Boot one first with 'boot_ios_simulator'." };
    }
    return { success: false, error: `Failed to capture iOS screenshot: ${error.message}` };
  }
}

async function getIosSimulatorLogs(
  udid?: string,
  filter?: string,
  lines: number = 50
): Promise<string> {
  const check = await requireBasic("get_ios_simulator_logs");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  const license = await checkLicense();
  const tierLimits = TIER_LIMITS[license.tier];
  const maxLines = Math.min(lines, tierLimits.maxLogLines);

  try {
    const target = udid || "booted";

    // Use predicate filter if provided
    let command = `xcrun simctl spawn ${target} log show --last 5m --style compact`;
    if (filter) {
      command += ` --predicate 'eventMessage CONTAINS "${filter}" OR subsystem CONTAINS "${filter}"'`;
    }

    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

    if (stderr && !stdout) {
      return `Error: ${stderr}`;
    }

    const logLines = stdout.split("\n").slice(-maxLines);
    let result = `📋 iOS Simulator Logs (${logLines.length} lines):\n${"─".repeat(50)}\n${logLines.join("\n")}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    if (error.message.includes("No devices are booted")) {
      return "No iOS Simulator is booted. Boot one first with 'boot_ios_simulator'.";
    }
    return `Error getting iOS logs: ${error.message}`;
  }
}

async function getIosSimulatorInfo(udid?: string): Promise<string> {
  const check = await requireBasic("get_ios_simulator_info");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    const { stdout } = await execAsync("xcrun simctl list devices -j");
    const data = JSON.parse(stdout);

    // Find the target device
    let targetDevice: SimulatorDevice | null = null;
    let targetRuntime = "";

    for (const [runtime, devices] of Object.entries(data.devices)) {
      const deviceList = devices as SimulatorDevice[];
      const found = deviceList.find((d) =>
        udid ? d.udid === udid : d.state === "Booted"
      );
      if (found) {
        targetDevice = found;
        targetRuntime = runtime;
        break;
      }
    }

    if (!targetDevice) {
      return udid
        ? `Simulator with UDID ${udid} not found.`
        : "No booted simulator found. Boot one first or specify a UDID.";
    }

    const runtimeName = targetRuntime.split(".").pop()?.replace(/-/g, " ") || targetRuntime;

    let result = `📱 iOS Simulator Info
${"─".repeat(40)}
  Name: ${targetDevice.name}
  UDID: ${targetDevice.udid}
  State: ${targetDevice.state === "Booted" ? "🟢 Booted" : "⚪ Shutdown"}
  Runtime: ${runtimeName}
  Available: ${targetDevice.isAvailable ? "Yes" : "No"}`;

    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error getting simulator info: ${error.message}`;
  }
}

async function bootIosSimulator(udid: string): Promise<string> {
  const check = await requireAdvanced("boot_ios_simulator");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    await execAsync(`xcrun simctl boot "${udid}"`);
    let result = `✅ iOS Simulator booted: ${udid}\n\nOpening Simulator app...`;

    // Open Simulator app to show the booted device
    try {
      await execAsync("open -a Simulator");
    } catch {}

    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    if (error.message.includes("Unable to boot device in current state: Booted")) {
      return "Simulator is already booted.";
    }
    return `Error booting simulator: ${error.message}`;
  }
}

async function shutdownIosSimulator(udid: string): Promise<string> {
  const check = await requireAdvanced("shutdown_ios_simulator");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    if (udid.toLowerCase() === "all") {
      await execAsync("xcrun simctl shutdown all");
      let result = "✅ All iOS Simulators have been shut down.";
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    await execAsync(`xcrun simctl shutdown "${udid}"`);
    let result = `✅ iOS Simulator shut down: ${udid}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    if (error.message.includes("Unable to shutdown device in current state: Shutdown")) {
      return "Simulator is already shut down.";
    }
    return `Error shutting down simulator: ${error.message}`;
  }
}

async function installIosApp(appPath: string, udid?: string): Promise<string> {
  const check = await requireAdvanced("install_ios_app");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  if (!fs.existsSync(appPath)) {
    return `App not found: ${appPath}`;
  }

  try {
    const target = udid || "booted";
    await execAsync(`xcrun simctl install ${target} "${appPath}"`);
    let result = `✅ App installed successfully on iOS Simulator!`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error installing app: ${error.message}`;
  }
}

async function launchIosApp(bundleId: string, udid?: string): Promise<string> {
  const check = await requireAdvanced("launch_ios_app");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    const target = udid || "booted";
    await execAsync(`xcrun simctl launch ${target} "${bundleId}"`);
    let result = `✅ Launched: ${bundleId}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error launching app: ${error.message}\n\nMake sure the bundle ID is correct and the app is installed.`;
  }
}

async function terminateIosApp(bundleId: string, udid?: string): Promise<string> {
  const check = await requireAdvanced("terminate_ios_app");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    const target = udid || "booted";
    await execAsync(`xcrun simctl terminate ${target} "${bundleId}"`);
    let result = `✅ Terminated: ${bundleId}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error terminating app: ${error.message}`;
  }
}

async function iosOpenUrl(url: string, udid?: string): Promise<string> {
  const check = await requireAdvanced("ios_open_url");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    const target = udid || "booted";
    await execAsync(`xcrun simctl openurl ${target} "${url}"`);
    let result = `✅ Opened URL: ${url}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error opening URL: ${error.message}`;
  }
}

async function iosPushNotification(
  bundleId: string,
  payload: object,
  udid?: string
): Promise<string> {
  const check = await requireAdvanced("ios_push_notification");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    const target = udid || "booted";
    const payloadPath = path.join(CONFIG.screenshotDir, `push_${Date.now()}.json`);

    // Write payload to temp file
    fs.writeFileSync(payloadPath, JSON.stringify(payload));

    await execAsync(`xcrun simctl push ${target} "${bundleId}" "${payloadPath}"`);

    // Clean up
    fs.unlinkSync(payloadPath);

    let result = `✅ Push notification sent to ${bundleId}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error sending push notification: ${error.message}`;
  }
}

async function iosSetLocation(
  latitude: number,
  longitude: number,
  udid?: string
): Promise<string> {
  const check = await requireAdvanced("ios_set_location");
  if (!check.allowed) return check.message!;

  if (process.platform !== "darwin") {
    return "iOS Simulators are only available on macOS.";
  }

  try {
    const target = udid || "booted";
    await execAsync(`xcrun simctl location ${target} set ${latitude},${longitude}`);
    let result = `✅ Location set to: ${latitude}, ${longitude}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error setting location: ${error.message}`;
  }
}

// ============================================================================
// REACT DEVTOOLS INTEGRATION
// ============================================================================

// Store for DevTools WebSocket connection
let devToolsWs: WebSocket | null = null;
let devToolsConnected = false;
let componentTree: Map<number, any> = new Map();
let pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
let requestId = 0;

interface DevToolsMessage {
  event: string;
  payload?: any;
}

async function setupReactDevTools(port: number = 8097, device?: string): Promise<string> {
  const check = await requireAdvanced("setup_react_devtools");
  if (!check.allowed) return check.message!;

  const results: string[] = [];
  results.push("🔧 React DevTools Setup\n" + "═".repeat(50));

  // Step 1: Set up ADB port forwarding (for Android)
  try {
    const deviceFlag = device ? `-s ${device}` : "";
    await execAsync(`adb ${deviceFlag} reverse tcp:${port} tcp:${port}`);
    results.push(`\n✅ ADB port forwarding configured: tcp:${port} -> tcp:${port}`);
  } catch (error: any) {
    results.push(`\n⚠️ ADB port forwarding failed: ${error.message}`);
    results.push("   (This is OK if using iOS Simulator or DevTools is on same machine)");
  }

  // Step 2: Check if DevTools server is available
  try {
    const isRunning = await checkDevToolsServer(port);
    if (isRunning) {
      results.push(`✅ React DevTools server detected on port ${port}`);
    } else {
      results.push(`⚠️ React DevTools server not detected on port ${port}`);
      results.push("\nTo start React DevTools:");
      results.push("  npx react-devtools");
      results.push("  # or install globally:");
      results.push("  npm install -g react-devtools && react-devtools");
    }
  } catch (error: any) {
    results.push(`⚠️ Could not check DevTools server: ${error.message}`);
  }

  // Step 3: Connection instructions
  results.push("\n📋 Next Steps:");
  results.push("1. Make sure React DevTools standalone is running (npx react-devtools)");
  results.push("2. Your React Native app should connect automatically in dev mode");
  results.push("3. Use 'check_devtools_connection' to verify the connection");
  results.push("4. Use 'get_react_component_tree' to inspect components");

  let result = results.join("\n");
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

async function checkDevToolsServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 3000);

    ws.on("open", () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function checkDevToolsConnection(port: number = 8097): Promise<string> {
  const check = await requireAdvanced("check_devtools_connection");
  if (!check.allowed) return check.message!;

  const results: string[] = [];
  results.push("🔍 React DevTools Connection Status\n" + "═".repeat(50));

  // Check if server is running
  const serverRunning = await checkDevToolsServer(port);

  if (!serverRunning) {
    results.push(`\n❌ DevTools server not found on port ${port}`);
    results.push("\nTo start React DevTools:");
    results.push("  npx react-devtools");
    let result = results.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }

  results.push(`\n✅ DevTools server running on port ${port}`);

  // Try to connect and get basic info
  try {
    const connection = await connectToDevTools(port);
    if (connection.connected) {
      results.push("✅ Successfully connected to DevTools");
      if (connection.rendererCount > 0) {
        results.push(`✅ ${connection.rendererCount} React renderer(s) connected`);
        results.push("\n📱 App is connected and ready for inspection!");
        results.push("   Use 'get_react_component_tree' to view components");
      } else {
        results.push("⚠️ No React renderers connected");
        results.push("\nMake sure your React Native app is running in development mode.");
      }
    } else {
      results.push("⚠️ Connected to server but no app detected");
    }
  } catch (error: any) {
    results.push(`⚠️ Connection test failed: ${error.message}`);
  }

  let result = results.join("\n");
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

interface DevToolsConnection {
  connected: boolean;
  rendererCount: number;
  ws?: WebSocket;
}

async function connectToDevTools(port: number): Promise<DevToolsConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    let rendererCount = 0;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve({ connected: true, rendererCount: 0 });
      }
    }, 5000);

    ws.on("open", () => {
      // DevTools protocol: request operations
      // The standalone DevTools uses a different protocol than we might expect
      // For now, we'll just confirm connection
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.event === "operations" || message.event === "roots") {
          rendererCount++;
        }
      } catch {}
    });

    ws.on("close", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ connected: true, rendererCount });
      }
    });

    ws.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    // Give it time to receive messages
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        resolve({ connected: true, rendererCount });
      }
    }, 2000);
  });
}

async function getReactComponentTree(port: number = 8097, depth: number = 5): Promise<string> {
  const check = await requireAdvanced("get_react_component_tree");
  if (!check.allowed) return check.message!;

  try {
    const tree = await fetchComponentTree(port, depth);

    if (!tree || tree.length === 0) {
      let result = `📊 React Component Tree\n${"═".repeat(50)}\n\nNo components found.\n\nMake sure:\n1. React DevTools standalone is running (npx react-devtools)\n2. Your React Native app is running in development mode\n3. The app is connected to DevTools`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    const lines: string[] = [];
    lines.push("📊 React Component Tree");
    lines.push("═".repeat(50));
    lines.push("");

    for (const node of tree) {
      const indent = "  ".repeat(node.depth);
      const typeIcon = node.type === "function" ? "ƒ" : node.type === "class" ? "◆" : "○";
      lines.push(`${indent}${typeIcon} ${node.name} [id:${node.id}]`);
      if (node.key) {
        lines.push(`${indent}  key: "${node.key}"`);
      }
    }

    lines.push("");
    lines.push(`Total: ${tree.length} components (depth: ${depth})`);
    lines.push("\nUse 'inspect_react_component' with an [id] to see props/state");

    let result = lines.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    let result = `Error fetching component tree: ${error.message}\n\nMake sure React DevTools is running: npx react-devtools`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }
}

interface ComponentNode {
  id: number;
  name: string;
  type: string;
  depth: number;
  key?: string;
}

async function fetchComponentTree(port: number, maxDepth: number): Promise<ComponentNode[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const components: ComponentNode[] = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(components);
      }
    }, 10000);

    ws.on("open", () => {
      // Send a request to get the tree
      // The DevTools protocol varies, so we listen for operations
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle different message types from React DevTools
        if (message.event === "operations") {
          // Parse operations to build component tree
          const ops = message.payload;
          if (Array.isArray(ops)) {
            // Operations array contains component tree data
            parseOperations(ops, components, maxDepth);
          }
        } else if (message.event === "roots") {
          // Root components
          if (Array.isArray(message.payload)) {
            for (const root of message.payload) {
              components.push({
                id: root.id || components.length,
                name: root.displayName || root.name || "Root",
                type: root.type || "root",
                depth: 0,
              });
            }
          }
        }
      } catch {}
    });

    ws.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Return empty array on error, not reject
        resolve(components);
      }
    });

    ws.on("close", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(components);
      }
    });

    // Give time to receive data
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        resolve(components);
      }
    }, 3000);
  });
}

function parseOperations(ops: any[], components: ComponentNode[], maxDepth: number): void {
  // React DevTools operations format varies by version
  // This is a simplified parser
  let depth = 0;

  for (let i = 0; i < ops.length && components.length < 100; i++) {
    const op = ops[i];
    if (typeof op === "object" && op.id !== undefined) {
      if (depth <= maxDepth) {
        components.push({
          id: op.id,
          name: op.displayName || op.name || `Component_${op.id}`,
          type: op.type === 1 ? "function" : op.type === 2 ? "class" : "other",
          depth: Math.min(op.depth || depth, maxDepth),
          key: op.key,
        });
      }
    }
  }
}

async function inspectReactComponent(componentId: number, port: number = 8097): Promise<string> {
  const check = await requireAdvanced("inspect_react_component");
  if (!check.allowed) return check.message!;

  try {
    const inspection = await fetchComponentDetails(componentId, port);

    if (!inspection) {
      let result = `Component with ID ${componentId} not found.\n\nUse 'get_react_component_tree' to get valid component IDs.`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    const lines: string[] = [];
    lines.push(`🔍 Component Inspection: ${inspection.name}`);
    lines.push("═".repeat(50));
    lines.push(`ID: ${componentId}`);
    lines.push(`Type: ${inspection.type}`);

    if (inspection.props && Object.keys(inspection.props).length > 0) {
      lines.push("\n📦 Props:");
      for (const [key, value] of Object.entries(inspection.props)) {
        const displayValue = formatValue(value);
        lines.push(`  ${key}: ${displayValue}`);
      }
    } else {
      lines.push("\n📦 Props: (none)");
    }

    if (inspection.state && Object.keys(inspection.state).length > 0) {
      lines.push("\n💾 State:");
      for (const [key, value] of Object.entries(inspection.state)) {
        const displayValue = formatValue(value);
        lines.push(`  ${key}: ${displayValue}`);
      }
    }

    if (inspection.hooks && inspection.hooks.length > 0) {
      lines.push("\n🪝 Hooks:");
      for (const hook of inspection.hooks) {
        lines.push(`  ${hook.name}: ${formatValue(hook.value)}`);
      }
    }

    let result = lines.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    let result = `Error inspecting component: ${error.message}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }
}

function formatValue(value: any): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value.substring(0, 100)}${value.length > 100 ? "..." : ""}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", ..." : ""}}`;
  }
  if (typeof value === "function") return "ƒ()";
  return String(value).substring(0, 50);
}

interface ComponentDetails {
  name: string;
  type: string;
  props: Record<string, any>;
  state?: Record<string, any>;
  hooks?: Array<{ name: string; value: any }>;
}

async function fetchComponentDetails(componentId: number, port: number): Promise<ComponentDetails | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    let resolved = false;
    let details: ComponentDetails | null = null;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(details);
      }
    }, 5000);

    ws.on("open", () => {
      // Request inspection of specific element
      const request = {
        event: "inspectElement",
        payload: {
          id: componentId,
          rendererID: 1,
          requestID: Date.now(),
        },
      };
      ws.send(JSON.stringify(request));
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.event === "inspectedElement" && message.payload) {
          const p = message.payload;
          details = {
            name: p.displayName || p.name || `Component_${componentId}`,
            type: p.type || "unknown",
            props: p.props || {},
            state: p.state,
            hooks: p.hooks,
          };
        }
      } catch {}
    });

    ws.on("error", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    });

    ws.on("close", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(details);
      }
    });

    // Give time to receive response
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        resolve(details);
      }
    }, 3000);
  });
}

async function searchReactComponents(query: string, port: number = 8097): Promise<string> {
  const check = await requireAdvanced("search_react_components");
  if (!check.allowed) return check.message!;

  try {
    const tree = await fetchComponentTree(port, 10);
    const queryLower = query.toLowerCase();

    const matches = tree.filter((component) =>
      component.name.toLowerCase().includes(queryLower)
    );

    if (matches.length === 0) {
      let result = `🔍 Search Results for "${query}"\n${"═".repeat(50)}\n\nNo components found matching "${query}".\n\nTip: Try a partial name or check if the app is connected to DevTools.`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    const lines: string[] = [];
    lines.push(`🔍 Search Results for "${query}"`);
    lines.push("═".repeat(50));
    lines.push(`\nFound ${matches.length} matching component(s):\n`);

    for (const match of matches.slice(0, 20)) {
      const typeIcon = match.type === "function" ? "ƒ" : match.type === "class" ? "◆" : "○";
      lines.push(`${typeIcon} ${match.name} [id:${match.id}]`);
    }

    if (matches.length > 20) {
      lines.push(`\n... and ${matches.length - 20} more matches`);
    }

    lines.push("\nUse 'inspect_react_component' with an [id] to see props/state");

    let result = lines.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    let result = `Error searching components: ${error.message}`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }
}

// ============================================================================
// NETWORK INSPECTION
// ============================================================================

// Network monitoring state
let networkMonitorProcess: ChildProcess | null = null;
let networkRequestBuffer: NetworkRequest[] = [];
const MAX_NETWORK_REQUESTS = 100;

interface NetworkRequest {
  index: number;
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  size?: string;
  headers?: Record<string, string>;
  body?: string;
  response?: string;
}

async function getNetworkRequests(
  lines: number = 200,
  filter?: string,
  device?: string
): Promise<string> {
  const check = await requireAdvanced("get_network_requests");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";

    // Get logs and filter for network-related entries
    // React Native logs network requests with various patterns
    const { stdout } = await execAsync(
      `adb ${deviceFlag} logcat -d -t ${lines} *:V`,
      { maxBuffer: 5 * 1024 * 1024 }
    );

    const requests: NetworkRequest[] = [];
    const logLines = stdout.split("\n");

    // Patterns to match network requests
    const patterns = [
      // OkHttp pattern
      /OkHttp.*?(GET|POST|PUT|DELETE|PATCH)\s+(.+)/i,
      // React Native fetch pattern
      /\[fetch\].*?(GET|POST|PUT|DELETE|PATCH)\s+(.+)/i,
      // Generic HTTP pattern
      /HTTP.*?(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/\S+)/i,
      // XMLHttpRequest pattern
      /XMLHttpRequest.*?(GET|POST|PUT|DELETE|PATCH)\s+(.+)/i,
      // Network response pattern
      /(\d{3})\s+(https?:\/\/\S+).*?(\d+ms|\d+\.\d+s)/i,
    ];

    let index = 0;
    for (const line of logLines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const method = match[1]?.toUpperCase() || "GET";
          const url = match[2] || "";

          // Apply filter if provided
          if (filter) {
            const filterLower = filter.toLowerCase();
            if (!method.toLowerCase().includes(filterLower) &&
                !url.toLowerCase().includes(filterLower)) {
              continue;
            }
          }

          requests.push({
            index: index++,
            timestamp: new Date().toISOString(),
            method,
            url: url.substring(0, 200),
            status: match[1]?.match(/^\d{3}$/) ? parseInt(match[1]) : undefined,
          });
          break;
        }
      }
    }

    if (requests.length === 0) {
      let result = `📡 Network Requests\n${"═".repeat(50)}\n\nNo network requests found in recent logs.\n\nTips:\n- Make sure your app is making network requests\n- React Native logs network activity in development mode\n- Try increasing the lines parameter`;
      if (check.message) result += `\n\n${check.message}`;
      return result;
    }

    const resultLines: string[] = [];
    resultLines.push("📡 Network Requests");
    resultLines.push("═".repeat(50));
    resultLines.push(`\nFound ${requests.length} request(s):\n`);

    for (const req of requests.slice(0, 30)) {
      const statusIcon = req.status
        ? (req.status >= 200 && req.status < 300 ? "✅" : "❌")
        : "⏳";
      resultLines.push(`[${req.index}] ${statusIcon} ${req.method} ${req.url.substring(0, 60)}${req.url.length > 60 ? "..." : ""}`);
      if (req.status) {
        resultLines.push(`    Status: ${req.status}`);
      }
    }

    if (requests.length > 30) {
      resultLines.push(`\n... and ${requests.length - 30} more requests`);
    }

    resultLines.push("\nUse 'start_network_monitoring' for real-time capture");

    let result = resultLines.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error getting network requests: ${error.message}`;
  }
}

async function startNetworkMonitoring(device?: string): Promise<string> {
  const check = await requireAdvanced("start_network_monitoring");
  if (!check.allowed) return check.message!;

  if (networkMonitorProcess) {
    return "Network monitoring is already running. Use 'stop_network_monitoring' first.";
  }

  networkRequestBuffer = [];

  const deviceFlag = device ? `-s ${device}` : "";

  // Start logcat with network-related filters
  networkMonitorProcess = spawn("adb", [
    ...deviceFlag.split(" ").filter(s => s),
    "logcat",
    "-v", "time",
    "OkHttp:V",
    "Retrofit:V",
    "ReactNativeJS:V",
    "*:S"
  ]);

  let requestIndex = 0;

  networkMonitorProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      // Parse network request patterns
      const httpMatch = line.match(/(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/\S+)/i);
      if (httpMatch) {
        networkRequestBuffer.push({
          index: requestIndex++,
          timestamp: new Date().toISOString(),
          method: httpMatch[1].toUpperCase(),
          url: httpMatch[2],
        });

        if (networkRequestBuffer.length > MAX_NETWORK_REQUESTS) {
          networkRequestBuffer = networkRequestBuffer.slice(-MAX_NETWORK_REQUESTS);
        }
      }

      // Parse response status
      const statusMatch = line.match(/<--\s*(\d{3})\s+(https?:\/\/\S+)/i);
      if (statusMatch) {
        const url = statusMatch[2];
        const req = networkRequestBuffer.find(r => r.url === url && !r.status);
        if (req) {
          req.status = parseInt(statusMatch[1]);
        }
      }
    }
  });

  networkMonitorProcess.on("error", (err) => {
    console.error("Network monitor error:", err);
  });

  let result = `📡 Network Monitoring Started\n${"═".repeat(50)}\n\nCapturing HTTP/HTTPS requests in background.\n\nUse 'stop_network_monitoring' to stop and see captured requests.\nUse 'get_network_requests' to see current buffer.`;
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

async function stopNetworkMonitoring(): Promise<string> {
  const check = await requireAdvanced("stop_network_monitoring");
  if (!check.allowed) return check.message!;

  if (networkMonitorProcess) {
    networkMonitorProcess.kill();
    networkMonitorProcess = null;
  }

  const requests = networkRequestBuffer;
  const summary = {
    total: requests.length,
    successful: requests.filter(r => r.status && r.status >= 200 && r.status < 300).length,
    failed: requests.filter(r => r.status && (r.status < 200 || r.status >= 300)).length,
    pending: requests.filter(r => !r.status).length,
  };

  const resultLines: string[] = [];
  resultLines.push("📡 Network Monitoring Stopped");
  resultLines.push("═".repeat(50));
  resultLines.push(`\nSummary:`);
  resultLines.push(`  Total requests: ${summary.total}`);
  resultLines.push(`  Successful (2xx): ${summary.successful}`);
  resultLines.push(`  Failed: ${summary.failed}`);
  resultLines.push(`  Pending: ${summary.pending}`);

  if (requests.length > 0) {
    resultLines.push(`\nRecent requests:`);
    for (const req of requests.slice(-10)) {
      const statusIcon = req.status
        ? (req.status >= 200 && req.status < 300 ? "✅" : "❌")
        : "⏳";
      resultLines.push(`[${req.index}] ${statusIcon} ${req.method} ${req.url.substring(0, 50)}...`);
    }
  }

  let result = resultLines.join("\n");
  if (check.message) result += `\n\n${check.message}`;
  return result;
}

async function getNetworkStats(device?: string): Promise<string> {
  const check = await requireAdvanced("get_network_stats");
  if (!check.allowed) return check.message!;

  try {
    const deviceFlag = device ? `-s ${device}` : "";

    // Get various network stats
    const [wifiInfo, netStats, activeConns] = await Promise.all([
      execAsync(`adb ${deviceFlag} shell dumpsys wifi | head -50`)
        .then(r => r.stdout)
        .catch(() => "N/A"),
      execAsync(`adb ${deviceFlag} shell cat /proc/net/dev`)
        .then(r => r.stdout)
        .catch(() => "N/A"),
      execAsync(`adb ${deviceFlag} shell netstat -an | head -30`)
        .then(r => r.stdout)
        .catch(() => "N/A"),
    ]);

    const resultLines: string[] = [];
    resultLines.push("📊 Network Statistics");
    resultLines.push("═".repeat(50));

    // Parse WiFi info
    const ssidMatch = wifiInfo.match(/mWifiInfo.*?SSID:\s*([^,]+)/);
    const rssiMatch = wifiInfo.match(/RSSI:\s*(-?\d+)/);
    const linkSpeedMatch = wifiInfo.match(/Link speed:\s*(\d+)/);

    resultLines.push("\n📶 WiFi Info:");
    if (ssidMatch) resultLines.push(`  SSID: ${ssidMatch[1].trim()}`);
    if (rssiMatch) resultLines.push(`  Signal: ${rssiMatch[1]} dBm`);
    if (linkSpeedMatch) resultLines.push(`  Speed: ${linkSpeedMatch[1]} Mbps`);

    // Parse network interface stats
    resultLines.push("\n📈 Interface Stats:");
    const devLines = netStats.split("\n").filter(l => l.includes("wlan") || l.includes("rmnet"));
    for (const line of devLines.slice(0, 5)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 10) {
        const iface = parts[0].replace(":", "");
        const rxBytes = parseInt(parts[1]) || 0;
        const txBytes = parseInt(parts[9]) || 0;
        resultLines.push(`  ${iface}: RX ${formatBytes(rxBytes)}, TX ${formatBytes(txBytes)}`);
      }
    }

    // Parse active connections
    resultLines.push("\n🔗 Active Connections:");
    const connLines = activeConns.split("\n")
      .filter(l => l.includes("ESTABLISHED") || l.includes("TIME_WAIT"))
      .slice(0, 8);

    if (connLines.length > 0) {
      for (const line of connLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          resultLines.push(`  ${parts[3]} -> ${parts[4]} (${parts[5] || ""})`);
        }
      }
    } else {
      resultLines.push("  No active connections found");
    }

    let result = resultLines.join("\n");
    if (check.message) result += `\n\n${check.message}`;
    return result;
  } catch (error: any) {
    return `Error getting network stats: ${error.message}`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function analyzeRequest(index: number): Promise<string> {
  const check = await requireAdvanced("analyze_request");
  if (!check.allowed) return check.message!;

  const request = networkRequestBuffer.find(r => r.index === index);

  if (!request) {
    let result = `Request #${index} not found.\n\nUse 'get_network_requests' or 'start_network_monitoring' to capture requests first.`;
    if (check.message) result += `\n\n${check.message}`;
    return result;
  }

  const resultLines: string[] = [];
  resultLines.push(`🔍 Request Analysis #${index}`);
  resultLines.push("═".repeat(50));
  resultLines.push(`\nMethod: ${request.method}`);
  resultLines.push(`URL: ${request.url}`);
  resultLines.push(`Timestamp: ${request.timestamp}`);

  if (request.status) {
    const statusText = request.status >= 200 && request.status < 300 ? "Success" : "Failed";
    resultLines.push(`Status: ${request.status} (${statusText})`);
  } else {
    resultLines.push("Status: Pending/Unknown");
  }

  if (request.duration) {
    resultLines.push(`Duration: ${request.duration}ms`);
  }

  if (request.size) {
    resultLines.push(`Size: ${request.size}`);
  }

  if (request.headers && Object.keys(request.headers).length > 0) {
    resultLines.push("\n📋 Headers:");
    for (const [key, value] of Object.entries(request.headers)) {
      resultLines.push(`  ${key}: ${value}`);
    }
  }

  if (request.body) {
    resultLines.push("\n📤 Request Body:");
    resultLines.push(`  ${request.body.substring(0, 500)}${request.body.length > 500 ? "..." : ""}`);
  }

  if (request.response) {
    resultLines.push("\n📥 Response:");
    resultLines.push(`  ${request.response.substring(0, 500)}${request.response.length > 500 ? "..." : ""}`);
  }

  let result = resultLines.join("\n");
  if (check.message) result += `\n\n${check.message}`;
  return result;
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

      // iOS SIMULATOR TOOLS
      case "list_ios_simulators": {
        const result = await listIosSimulators(args?.onlyBooted as boolean);
        return { content: [{ type: "text", text: result }] };
      }

      case "screenshot_ios_simulator": {
        const result = await screenshotIosSimulator(args?.udid as string);
        if (result.success && result.data) {
          const content: any[] = [
            {
              type: "image",
              data: result.data,
              mimeType: result.mimeType!,
            },
          ];
          if (result.trialMessage) {
            content.push({ type: "text", text: result.trialMessage });
          }
          return { content };
        }
        return { content: [{ type: "text", text: result.error! }] };
      }

      case "get_ios_simulator_logs": {
        const result = await getIosSimulatorLogs(
          args?.udid as string,
          args?.filter as string,
          args?.lines as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "get_ios_simulator_info": {
        const result = await getIosSimulatorInfo(args?.udid as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "boot_ios_simulator": {
        const result = await bootIosSimulator(args?.udid as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "shutdown_ios_simulator": {
        const result = await shutdownIosSimulator(args?.udid as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "install_ios_app": {
        const result = await installIosApp(
          args?.appPath as string,
          args?.udid as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "launch_ios_app": {
        const result = await launchIosApp(
          args?.bundleId as string,
          args?.udid as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "terminate_ios_app": {
        const result = await terminateIosApp(
          args?.bundleId as string,
          args?.udid as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "ios_open_url": {
        const result = await iosOpenUrl(
          args?.url as string,
          args?.udid as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "ios_push_notification": {
        const result = await iosPushNotification(
          args?.bundleId as string,
          args?.payload as object,
          args?.udid as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "ios_set_location": {
        const result = await iosSetLocation(
          args?.latitude as number,
          args?.longitude as number,
          args?.udid as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      // REACT DEVTOOLS TOOLS
      case "setup_react_devtools": {
        const result = await setupReactDevTools(
          args?.port as number,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "check_devtools_connection": {
        const result = await checkDevToolsConnection(args?.port as number);
        return { content: [{ type: "text", text: result }] };
      }

      case "get_react_component_tree": {
        const result = await getReactComponentTree(
          args?.port as number,
          args?.depth as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "inspect_react_component": {
        const result = await inspectReactComponent(
          args?.componentId as number,
          args?.port as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "search_react_components": {
        const result = await searchReactComponents(
          args?.query as string,
          args?.port as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      // NETWORK INSPECTION TOOLS
      case "get_network_requests": {
        const result = await getNetworkRequests(
          args?.lines as number,
          args?.filter as string,
          args?.device as string
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "start_network_monitoring": {
        const result = await startNetworkMonitoring(args?.device as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "stop_network_monitoring": {
        const result = await stopNetworkMonitoring();
        return { content: [{ type: "text", text: result }] };
      }

      case "get_network_stats": {
        const result = await getNetworkStats(args?.device as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "analyze_request": {
        const result = await analyzeRequest(args?.index as number);
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
