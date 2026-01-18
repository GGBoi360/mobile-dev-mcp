#!/usr/bin/env node

/**
 * Mobile Dev MCP - Read-Only Debugging Tools for Mobile Development
 *
 * A read-only MCP server for observing and debugging mobile apps:
 * - Taking screenshots
 * - Viewing device information
 * - Reading logs
 * - Inspecting UI hierarchy
 * - Analyzing screen content
 *
 * License: Dual (MIT + Elastic License 2.0)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  ADB,
  XCRUN,
  execAsync,
  sleep,
  parseUiTree,
  findElementInTree,
  captureAndroidScreenshot,
  captureIosScreenshot,
  listConnectedDevices,
  loadConfig,
  validateDeviceId,
  validatePackageName,
  validateUdid,
  validateLogFilter,
  validateLogLevel,
} from "./utils.js";

import {
  checkLicense,
  canAccessTool,
  getMaxLogLines,
  getMaxDevices,
  getLicenseStatus,
  setLicenseKey,
  MobileDevTier,
} from "./license.js";

// ============================================================================
// CONFIG
// ============================================================================

const userConfig = loadConfig();
const CONFIG = {
  metroPort: userConfig.metroPort || 8081,
  screenshotDir: process.env.TEMP || "/tmp",
};

// ============================================================================
// TOOL DEFINITIONS (21 tools)
// ============================================================================

const tools: Tool[] = [
  // === FREE TIER - Screenshots (2 tools) ===
  {
    name: "screenshot_emulator",
    description: "Capture a screenshot from the currently running Android emulator. Returns base64-encoded PNG image.",
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
    name: "screenshot_ios_simulator",
    description: "Capture a screenshot from an iOS Simulator. Returns base64-encoded PNG image.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for booted simulator.",
        },
      },
    },
  },

  // === FREE TIER - Device Info (5 tools) ===
  {
    name: "list_devices",
    description: "List all connected Android devices and emulators via ADB.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_ios_simulators",
    description: "List all available iOS Simulators with state and iOS version.",
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
    name: "get_device_info",
    description: "Get detailed information about connected Android device (OS version, screen size, memory).",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Specific device ID. Leave empty for default.",
        },
      },
    },
  },
  {
    name: "get_ios_simulator_info",
    description: "Get detailed information about an iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for booted simulator.",
        },
      },
    },
  },
  {
    name: "get_app_info",
    description: "Get information about an installed app on Android device.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: {
          type: "string",
          description: "The app package name (e.g., 'com.myapp')",
        },
      },
      required: ["packageName"],
    },
  },

  // === FREE TIER - Logs (4 tools) ===
  {
    name: "get_metro_logs",
    description: "Get recent logs from Metro bundler. Useful for build errors and warnings.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of lines (default: 50, limit varies by tier)",
          default: 50,
        },
        filter: {
          type: "string",
          description: "Optional filter string (e.g., 'error', 'warning')",
        },
      },
    },
  },
  {
    name: "get_adb_logs",
    description: "Get logs from Android device via ADB logcat. Filters for React Native by default.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of lines (default: 50, limit varies by tier)",
          default: 50,
        },
        filter: {
          type: "string",
          description: "Tag filter (default: 'ReactNativeJS'). Use '*' for all.",
          default: "ReactNativeJS",
        },
        level: {
          type: "string",
          enum: ["V", "D", "I", "W", "E", "F"],
          description: "Minimum log level",
          default: "I",
        },
      },
    },
  },
  {
    name: "get_ios_simulator_logs",
    description: "Get recent logs from iOS Simulator.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of lines (default: 50)",
          default: 50,
        },
        filter: {
          type: "string",
          description: "Filter logs by subsystem or content",
        },
        udid: {
          type: "string",
          description: "Simulator UDID. Leave empty for booted simulator.",
        },
      },
    },
  },
  {
    name: "check_metro_status",
    description: "Check if Metro bundler is running and get its status.",
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

  // === FREE TIER - License (1 tool) ===
  {
    name: "get_license_status",
    description: "Get your current license tier and available features.",
    inputSchema: { type: "object", properties: {} },
  },

  // === ADVANCED TIER - UI Inspection (5 tools) ===
  {
    name: "get_ui_tree",
    description: "[ADVANCED] Get the current UI hierarchy from Android device. Returns all visible elements with text, bounds, and properties.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Specific device ID (optional)",
        },
        compressed: {
          type: "boolean",
          description: "Return only interactive elements (default: true)",
          default: true,
        },
      },
    },
  },
  {
    name: "find_element",
    description: "[ADVANCED] Find a UI element by text, resource ID, or content description.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Element text to find" },
        resourceId: { type: "string", description: "Resource ID to find" },
        contentDescription: { type: "string", description: "Accessibility label" },
        device: { type: "string", description: "Specific device ID (optional)" },
      },
    },
  },
  {
    name: "wait_for_element",
    description: "[ADVANCED] Wait for a UI element to appear on screen.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Element text to wait for" },
        resourceId: { type: "string", description: "Resource ID to wait for" },
        contentDescription: { type: "string", description: "Accessibility label" },
        timeout: {
          type: "number",
          description: "Maximum wait time in ms (default: 5000)",
          default: 5000,
        },
        device: { type: "string", description: "Specific device ID (optional)" },
      },
    },
  },
  {
    name: "get_element_property",
    description: "[ADVANCED] Get a specific property of a UI element.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Element text to find" },
        resourceId: { type: "string", description: "Resource ID to find" },
        property: {
          type: "string",
          enum: ["text", "enabled", "checked", "selected", "focused", "clickable", "scrollable"],
          description: "Property to retrieve",
        },
        device: { type: "string", description: "Specific device ID (optional)" },
      },
      required: ["property"],
    },
  },
  {
    name: "assert_element",
    description: "[ADVANCED] Verify a UI element exists or has expected state.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Element text to verify" },
        resourceId: { type: "string", description: "Resource ID to verify" },
        shouldExist: {
          type: "boolean",
          description: "Whether element should exist (default: true)",
          default: true,
        },
        isEnabled: { type: "boolean", description: "Expected enabled state" },
        isChecked: { type: "boolean", description: "Expected checked state" },
        device: { type: "string", description: "Specific device ID (optional)" },
      },
    },
  },

  // === ADVANCED TIER - Screen Analysis (3 tools) ===
  {
    name: "suggest_action",
    description: "[ADVANCED] Analyze the screen and suggest what action to take based on the current UI state. Returns suggestions without executing.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "What you're trying to accomplish (e.g., 'login', 'send message', 'navigate to settings')",
        },
        device: { type: "string", description: "Specific device ID" },
      },
      required: ["goal"],
    },
  },
  {
    name: "analyze_screen",
    description: "[ADVANCED] Get a detailed analysis of what's currently on the screen.",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string", description: "Specific device ID" },
      },
    },
  },
  {
    name: "get_screen_text",
    description: "[ADVANCED] Extract all visible text from the current screen.",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string", description: "Specific device ID" },
      },
    },
  },

  // === ADVANCED TIER - License (1 tool) ===
  {
    name: "set_license_key",
    description: "Activate a license key to unlock premium features.",
    inputSchema: {
      type: "object",
      properties: {
        licenseKey: {
          type: "string",
          description: "Your license key from codecontrol.ai/mcp",
        },
      },
      required: ["licenseKey"],
    },
  },
];

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

async function handleTool(
  name: string,
  args: Record<string, unknown>,
  tier: MobileDevTier
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {

  // Check tool access
  if (!canAccessTool(name, tier)) {
    return {
      content: [{
        type: "text",
        text: `This tool requires ADVANCED tier ($18/mo). Your tier: ${tier.toUpperCase()}. Upgrade at https://codecontrol.ai/mcp`,
      }],
    };
  }

  const device = args.device as string | undefined;

  // Validate device ID if provided (security: prevent shell injection)
  if (device && !validateDeviceId(device)) {
    return {
      content: [{ type: "text", text: "Invalid device ID format. Device IDs should be alphanumeric with dashes, colons, or periods." }],
    };
  }

  const deviceArg = device ? `-s ${device}` : "";

  switch (name) {
    // === SCREENSHOTS ===
    case "screenshot_emulator": {
      try {
        const base64 = await captureAndroidScreenshot(device);
        return {
          content: [
            { type: "text", text: "Screenshot captured successfully" },
            { type: "image", data: base64, mimeType: "image/png" },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to capture screenshot: ${error.message}` }] };
      }
    }

    case "screenshot_ios_simulator": {
      // Validate UDID if provided (defense in depth - also validated in captureIosScreenshot)
      const iosUdid = args.udid as string | undefined;
      if (iosUdid && !validateUdid(iosUdid)) {
        return {
          content: [{ type: "text", text: "Invalid iOS Simulator UDID format. Must be UUID format or 'booted'." }],
        };
      }

      try {
        const base64 = await captureIosScreenshot(iosUdid);
        return {
          content: [
            { type: "text", text: "iOS screenshot captured successfully" },
            { type: "image", data: base64, mimeType: "image/png" },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to capture iOS screenshot: ${error.message}` }] };
      }
    }

    // === DEVICE INFO ===
    case "list_devices": {
      try {
        const devices = await listConnectedDevices();
        const maxDevices = getMaxDevices(tier);

        if (devices.length === 0) {
          return { content: [{ type: "text", text: "No devices connected. Start an emulator or connect a device." }] };
        }

        const limited = devices.slice(0, maxDevices);
        let result = `Connected devices (showing ${limited.length}/${devices.length}):\n`;
        result += limited.map((d) => `  ${d.id} - ${d.status}`).join("\n");

        if (devices.length > maxDevices) {
          result += `\n\n[Upgrade to ADVANCED to see all ${devices.length} devices]`;
        }

        return { content: [{ type: "text", text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to list devices: ${error.message}` }] };
      }
    }

    case "list_ios_simulators": {
      if (process.platform !== "darwin") {
        return { content: [{ type: "text", text: "iOS Simulators are only available on macOS" }] };
      }

      try {
        const { stdout } = await execAsync(`${XCRUN} simctl list devices --json`);
        const data = JSON.parse(stdout);
        const onlyBooted = args.onlyBooted as boolean;

        let result = "iOS Simulators:\n";
        for (const [runtime, devices] of Object.entries(data.devices as Record<string, any[]>)) {
          const filteredDevices = onlyBooted
            ? devices.filter((d) => d.state === "Booted")
            : devices;

          if (filteredDevices.length > 0) {
            result += `\n${runtime}:\n`;
            for (const device of filteredDevices) {
              result += `  ${device.name} (${device.udid}) - ${device.state}\n`;
            }
          }
        }

        return { content: [{ type: "text", text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to list simulators: ${error.message}` }] };
      }
    }

    case "get_device_info": {
      try {
        const props = [
          "ro.product.model",
          "ro.build.version.release",
          "ro.build.version.sdk",
          "ro.product.manufacturer",
        ];

        let result = "Device Information:\n";
        for (const prop of props) {
          const { stdout } = await execAsync(`${ADB} ${deviceArg} shell getprop ${prop}`);
          result += `  ${prop}: ${stdout.trim()}\n`;
        }

        // Screen size
        const { stdout: screenSize } = await execAsync(`${ADB} ${deviceArg} shell wm size`);
        result += `  Screen: ${screenSize.trim()}\n`;

        // Memory (avoid shell piping - process in Node.js)
        const { stdout: memInfo } = await execAsync(`${ADB} ${deviceArg} shell cat /proc/meminfo`);
        const memLines = memInfo.split("\n").slice(0, 3);  // Limit to first 3 lines in Node.js
        result += `  Memory:\n${memLines.map((l) => `    ${l}`).join("\n")}`;

        return { content: [{ type: "text", text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get device info: ${error.message}` }] };
      }
    }

    case "get_ios_simulator_info": {
      if (process.platform !== "darwin") {
        return { content: [{ type: "text", text: "iOS Simulators only available on macOS" }] };
      }

      // Validate UDID if provided
      const simUdid = args.udid as string || "booted";
      if (simUdid !== "booted" && !validateUdid(simUdid)) {
        return {
          content: [{ type: "text", text: "Invalid iOS Simulator UDID format. Must be UUID format or 'booted'." }],
        };
      }

      try {
        const udid = simUdid;
        const { stdout } = await execAsync(`${XCRUN} simctl list devices --json`);
        const data = JSON.parse(stdout);

        for (const devices of Object.values(data.devices as Record<string, any[]>)) {
          for (const device of devices) {
            if (device.udid === udid || (udid === "booted" && device.state === "Booted")) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify(device, null, 2),
                }],
              };
            }
          }
        }

        return { content: [{ type: "text", text: "Simulator not found" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get simulator info: ${error.message}` }] };
      }
    }

    case "get_app_info": {
      const packageName = args.packageName as string;

      // Validate package name (security: prevent shell injection)
      if (!validatePackageName(packageName)) {
        return {
          content: [{ type: "text", text: "Invalid package name format. Package names should be like 'com.example.app'." }],
        };
      }

      try {
        // Quote package name and avoid shell piping - process in Node.js
        const { stdout } = await execAsync(`${ADB} ${deviceArg} shell dumpsys package "${packageName}"`);
        const outputLines = stdout.split("\n").slice(0, 50).join("\n");  // Limit to 50 lines in Node.js
        return { content: [{ type: "text", text: outputLines }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get app info: ${error.message}` }] };
      }
    }

    // === LOGS ===
    case "get_metro_logs": {
      const requestedLines = (args.lines as number) || 50;
      const maxLines = getMaxLogLines(tier);
      // Ensure lines is a positive integer
      const lines = Math.max(1, Math.min(Math.floor(requestedLines), maxLines));

      try {
        const port = CONFIG.metroPort;
        const { stdout } = await execAsync(`curl -s http://localhost:${port}/status`, { timeout: 2000 });

        let result = `Metro Status (port ${port}): ${stdout}\n`;
        result += `\n[Metro logs require 'start_metro_logging' to capture output]`;

        if (lines < requestedLines) {
          result += `\n[Showing ${lines} lines, upgrade to ADVANCED for more]`;
        }

        result += `\n\n// Mobile Dev MCP by GGBoi360 - MIT License (attribution required)`;

        return { content: [{ type: "text", text: result }] };
      } catch {
        return {
          content: [{
            type: "text",
            text: `Metro not responding on port ${CONFIG.metroPort}. Is it running?`,
          }],
        };
      }
    }

    case "get_adb_logs": {
      const requestedLines = (args.lines as number) || 50;
      const maxLines = getMaxLogLines(tier);
      // Ensure lines is a positive integer (security: prevent injection via negative/float values)
      const lines = Math.max(1, Math.min(Math.floor(requestedLines), maxLines));
      const filter = (args.filter as string) || "ReactNativeJS";
      const level = (args.level as string) || "I";

      // Validate filter (security: prevent shell injection)
      if (!validateLogFilter(filter)) {
        return {
          content: [{ type: "text", text: "Invalid log filter format. Filters should be alphanumeric with underscores (e.g., 'ReactNativeJS', '*')." }],
        };
      }

      // Validate level
      if (!validateLogLevel(level)) {
        return {
          content: [{ type: "text", text: "Invalid log level. Use one of: V, D, I, W, E, F." }],
        };
      }

      try {
        const filterArg = filter === "*" ? "" : `-s ${filter}:${level}`;
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} logcat -d ${filterArg} -t ${lines}`,
          { timeout: 5000 }
        );

        let result = stdout || "No logs found";

        if (lines < requestedLines) {
          result += `\n\n[Showing ${lines} lines, upgrade to ADVANCED for more]`;
        }

        result += `\n\n// Mobile Dev MCP by GGBoi360 - MIT License (attribution required)`;

        return { content: [{ type: "text", text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get logs: ${error.message}` }] };
      }
    }

    case "get_ios_simulator_logs": {
      if (process.platform !== "darwin") {
        return { content: [{ type: "text", text: "iOS Simulator logs only available on macOS" }] };
      }

      const requestedLines = (args.lines as number) || 50;
      const maxLines = getMaxLogLines(tier);
      // Ensure lines is a safe positive integer (security: prevent tail injection)
      const lines = Math.max(1, Math.min(Math.floor(requestedLines), maxLines));

      try {
        // Avoid shell piping - process in Node.js
        const { stdout } = await execAsync(
          `log show --predicate 'subsystem CONTAINS "com.apple.CoreSimulator"' --last 5m --style compact`,
          { timeout: 10000 }
        );

        // Limit output lines in Node.js instead of shell tail
        const outputLines = stdout.split("\n").slice(-lines).join("\n");
        return { content: [{ type: "text", text: outputLines || "No recent logs found" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get iOS logs: ${error.message}` }] };
      }
    }

    case "check_metro_status": {
      const port = (args.port as number) || CONFIG.metroPort;

      // Validate port (security: prevent injection via port number)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return {
          content: [{ type: "text", text: "Invalid port number. Port must be between 1 and 65535." }],
        };
      }

      try {
        const { stdout } = await execAsync(`curl -s http://localhost:${port}/status`, { timeout: 2000 });
        return {
          content: [{
            type: "text",
            text: `Metro bundler is running on port ${port}\nStatus: ${stdout}`,
          }],
        };
      } catch {
        return {
          content: [{
            type: "text",
            text: `Metro bundler is NOT running on port ${port}`,
          }],
        };
      }
    }

    // === UI TREE (ADVANCED) ===
    case "get_ui_tree": {
      try {
        const compressed = args.compressed !== false;
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
          { timeout: 10000 }
        );

        const elements = parseUiTree(stdout);
        const filtered = compressed
          ? elements.filter((el) => el.clickable || el.text || el.contentDescription)
          : elements;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              elementCount: filtered.length,
              elements: filtered.map((el) => ({
                text: el.text,
                resourceId: el.resourceId,
                className: el.className.split(".").pop(),
                contentDescription: el.contentDescription,
                bounds: el.bounds,
                clickable: el.clickable,
                center: el.centerX && el.centerY ? { x: el.centerX, y: el.centerY } : undefined,
              })),
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get UI tree: ${error.message}` }] };
      }
    }

    case "find_element": {
      // Validate search parameters have reasonable length (prevent DoS)
      const MAX_SEARCH_LEN = 500;
      const searchText = args.text as string | undefined;
      const searchResourceId = args.resourceId as string | undefined;
      const searchContentDesc = args.contentDescription as string | undefined;

      if ((searchText && searchText.length > MAX_SEARCH_LEN) ||
          (searchResourceId && searchResourceId.length > MAX_SEARCH_LEN) ||
          (searchContentDesc && searchContentDesc.length > MAX_SEARCH_LEN)) {
        return { content: [{ type: "text", text: "Search parameters too long (max 500 chars)" }] };
      }

      try {
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
          { timeout: 10000 }
        );

        const elements = parseUiTree(stdout);
        const found = findElementInTree(elements, {
          text: searchText,
          resourceId: searchResourceId,
          contentDescription: searchContentDesc,
        });

        if (found) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                found: true,
                element: {
                  text: found.text,
                  resourceId: found.resourceId,
                  className: found.className,
                  contentDescription: found.contentDescription,
                  bounds: found.bounds,
                  center: { x: found.centerX, y: found.centerY },
                  clickable: found.clickable,
                  enabled: found.enabled,
                },
              }, null, 2),
            }],
          };
        }

        return { content: [{ type: "text", text: JSON.stringify({ found: false }) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to find element: ${error.message}` }] };
      }
    }

    case "wait_for_element": {
      // Cap timeout at 60 seconds to prevent indefinite blocking
      const MAX_TIMEOUT = 60000;
      const requestedTimeout = (args.timeout as number) || 5000;
      const timeout = Math.max(1000, Math.min(requestedTimeout, MAX_TIMEOUT));
      const pollInterval = 500;
      const startTime = Date.now();

      // Validate search parameters have reasonable length (prevent DoS)
      const MAX_SEARCH_LEN = 500;
      const searchText = args.text as string | undefined;
      const searchResourceId = args.resourceId as string | undefined;
      const searchContentDesc = args.contentDescription as string | undefined;

      if ((searchText && searchText.length > MAX_SEARCH_LEN) ||
          (searchResourceId && searchResourceId.length > MAX_SEARCH_LEN) ||
          (searchContentDesc && searchContentDesc.length > MAX_SEARCH_LEN)) {
        return { content: [{ type: "text", text: "Search parameters too long (max 500 chars)" }] };
      }

      while (Date.now() - startTime < timeout) {
        try {
          const { stdout } = await execAsync(
            `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
            { timeout: 5000 }
          );

          const elements = parseUiTree(stdout);
          const found = findElementInTree(elements, {
            text: searchText,
            resourceId: searchResourceId,
            contentDescription: searchContentDesc,
          });

          if (found) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  found: true,
                  waitTime: Date.now() - startTime,
                  element: {
                    text: found.text,
                    center: { x: found.centerX, y: found.centerY },
                  },
                }, null, 2),
              }],
            };
          }
        } catch {
          // Ignore errors during polling
        }

        await sleep(pollInterval);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ found: false, timeout: true, waitTime: timeout }),
        }],
      };
    }

    case "get_element_property":
    case "assert_element": {
      try {
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
          { timeout: 10000 }
        );

        const elements = parseUiTree(stdout);
        const found = findElementInTree(elements, {
          text: args.text as string | undefined,
          resourceId: args.resourceId as string | undefined,
          contentDescription: args.contentDescription as string | undefined,
        });

        if (name === "get_element_property") {
          const property = args.property as string;
          if (found) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ [property]: (found as any)[property] }),
              }],
            };
          }
          return { content: [{ type: "text", text: JSON.stringify({ error: "Element not found" }) }] };
        }

        // assert_element
        const shouldExist = args.shouldExist !== false;
        const exists = !!found;
        const passed = shouldExist === exists;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              passed,
              exists,
              shouldExist,
              element: found ? { text: found.text, enabled: found.enabled } : null,
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }] };
      }
    }

    // === SCREEN ANALYSIS (ADVANCED) ===
    case "suggest_action": {
      const goal = args.goal as string;

      // Type guard and validation
      if (!goal || typeof goal !== "string") {
        return { content: [{ type: "text", text: "Goal parameter is required and must be a string" }] };
      }

      // Validate goal has reasonable length (prevent DoS via long strings)
      const MAX_GOAL_LEN = 1000;
      if (goal.length > MAX_GOAL_LEN) {
        return { content: [{ type: "text", text: `Goal too long (max ${MAX_GOAL_LEN} chars)` }] };
      }

      try {
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
          { timeout: 10000 }
        );

        const elements = parseUiTree(stdout);
        const clickableElements = elements.filter((el) => el.clickable && (el.text || el.contentDescription));

        const suggestions: Array<{ action: string; target: string; reasoning: string }> = [];
        const goalLower = goal.toLowerCase();

        for (const el of clickableElements) {
          const text = (el.text || el.contentDescription || "").toLowerCase();

          if (goalLower.includes("login") && (text.includes("login") || text.includes("sign in"))) {
            suggestions.push({
              action: "tap",
              target: el.text || el.contentDescription,
              reasoning: "This button appears to initiate login",
            });
          }

          if (goalLower.includes("search") && (text.includes("search") || el.className.includes("EditText"))) {
            suggestions.push({
              action: el.className.includes("EditText") ? "input" : "tap",
              target: el.text || el.contentDescription || "search field",
              reasoning: "This appears to be a search input",
            });
          }

          if (goalLower.includes("settings") && text.includes("setting")) {
            suggestions.push({
              action: "tap",
              target: el.text || el.contentDescription,
              reasoning: "This navigates to settings",
            });
          }

          if (goalLower.includes("back") && text.includes("back")) {
            suggestions.push({
              action: "tap",
              target: el.text || el.contentDescription,
              reasoning: "This goes back",
            });
          }
        }

        if (suggestions.length === 0 && clickableElements.length > 0) {
          suggestions.push({
            action: "analyze",
            target: "screen",
            reasoning: `No direct match for "${goal}". ${clickableElements.length} clickable elements found. Use analyze_screen for details.`,
          });
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              goal,
              suggestions,
              clickableElementCount: clickableElements.length,
              note: "These are SUGGESTIONS only. MobileDevMCP is read-only and does not perform actions.",
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to analyze screen: ${error.message}` }] };
      }
    }

    case "analyze_screen": {
      try {
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
          { timeout: 10000 }
        );

        const elements = parseUiTree(stdout);

        const analysis = {
          totalElements: elements.length,
          clickableElements: elements.filter((el) => el.clickable).length,
          textElements: elements.filter((el) => el.text).length,
          inputFields: elements.filter((el) => el.className.includes("EditText")).length,
          buttons: elements.filter((el) => el.className.includes("Button")).length,
          visibleText: elements
            .filter((el) => el.text)
            .map((el) => el.text)
            .slice(0, 20),
          interactiveElements: elements
            .filter((el) => el.clickable && (el.text || el.contentDescription))
            .map((el) => ({
              text: el.text || el.contentDescription,
              type: el.className.split(".").pop(),
              bounds: el.bounds,
            }))
            .slice(0, 15),
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to analyze screen: ${error.message}` }] };
      }
    }

    case "get_screen_text": {
      try {
        const { stdout } = await execAsync(
          `${ADB} ${deviceArg} exec-out uiautomator dump /dev/tty`,
          { timeout: 10000 }
        );

        const elements = parseUiTree(stdout);
        const allText = elements
          .filter((el) => el.text || el.contentDescription)
          .map((el) => el.text || el.contentDescription)
          .filter((text, index, arr) => arr.indexOf(text) === index);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              textCount: allText.length,
              text: allText,
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get screen text: ${error.message}` }] };
      }
    }

    // === LICENSE ===
    case "get_license_status": {
      try {
        const status = await getLicenseStatus();
        return { content: [{ type: "text", text: status }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get license status: ${error.message}` }] };
      }
    }

    case "set_license_key": {
      try {
        const result = await setLicenseKey(args.licenseKey as string);
        return { content: [{ type: "text", text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to set license key: ${error.message}` }] };
      }
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: "mobile-dev-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const license = await checkLicense();

  // Filter tools based on tier
  const availableTools = tools.filter((tool) => canAccessTool(tool.name, license.tier));

  return { tools: availableTools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const license = await checkLicense();
    const result = await handleTool(name, args || {}, license.tier);
    return result;
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const license = await checkLicense();
  console.error(`Mobile Dev MCP v1.0.0 - Read-Only Debugging`);
  console.error(`License: ${license.tier.toUpperCase()} (${license.tier === "free" ? 8 : 21} tools)`);
  console.error(`Ready for connections...`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
