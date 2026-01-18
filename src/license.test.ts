import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock fs module before importing license
vi.mock("fs");
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    hostname: vi.fn(() => "test-host"),
    platform: vi.fn(() => "test-platform"),
    arch: vi.fn(() => "x64"),
    cpus: vi.fn(() => [{ model: "Test CPU" }]),
    homedir: vi.fn(() => "/mock/home"),
  };
});

// Import after mocks
import {
  FREE_TOOLS,
  ADVANCED_TOOLS,
  TIER_LIMITS,
  canAccessTool,
  isFreeTool,
  isAdvancedOnlyTool,
  getMaxLogLines,
  getMaxDevices,
  MobileDevTier,
} from "./license.js";

// ============================================================================
// TOOL CLASSIFICATION TESTS
// ============================================================================

describe("Tool Classification", () => {
  describe("FREE_TOOLS constant", () => {
    it("should have 8 free tools (Android only)", () => {
      expect(FREE_TOOLS).toHaveLength(8);
    });

    it("should include Android screenshot tool", () => {
      expect(FREE_TOOLS).toContain("screenshot_emulator");
    });

    it("should include Android device listing tool", () => {
      expect(FREE_TOOLS).toContain("list_devices");
    });

    it("should include Android device info tools", () => {
      expect(FREE_TOOLS).toContain("get_device_info");
      expect(FREE_TOOLS).toContain("get_app_info");
    });

    it("should include Android log tools", () => {
      expect(FREE_TOOLS).toContain("get_adb_logs");
      expect(FREE_TOOLS).toContain("get_metro_logs");
    });

    it("should include utility tools", () => {
      expect(FREE_TOOLS).toContain("check_metro_status");
      expect(FREE_TOOLS).toContain("get_license_status");
    });

    it("should NOT include iOS tools (Advanced only)", () => {
      expect(FREE_TOOLS).not.toContain("screenshot_ios_simulator");
      expect(FREE_TOOLS).not.toContain("list_ios_simulators");
      expect(FREE_TOOLS).not.toContain("get_ios_simulator_info");
      expect(FREE_TOOLS).not.toContain("get_ios_simulator_logs");
    });

    it("should NOT include UI inspection or analysis tools", () => {
      expect(FREE_TOOLS).not.toContain("get_ui_tree");
      expect(FREE_TOOLS).not.toContain("find_element");
      expect(FREE_TOOLS).not.toContain("analyze_screen");
      expect(FREE_TOOLS).not.toContain("set_license_key");
    });
  });

  describe("ADVANCED_TOOLS constant", () => {
    it("should have 21 total tools (8 free + 13 advanced-only)", () => {
      expect(ADVANCED_TOOLS).toHaveLength(21);
    });

    it("should include all free tools", () => {
      FREE_TOOLS.forEach((tool) => {
        expect(ADVANCED_TOOLS).toContain(tool);
      });
    });

    it("should include UI inspection tools", () => {
      expect(ADVANCED_TOOLS).toContain("get_ui_tree");
      expect(ADVANCED_TOOLS).toContain("find_element");
      expect(ADVANCED_TOOLS).toContain("wait_for_element");
      expect(ADVANCED_TOOLS).toContain("get_element_property");
      expect(ADVANCED_TOOLS).toContain("assert_element");
    });

    it("should include screen analysis tools", () => {
      expect(ADVANCED_TOOLS).toContain("suggest_action");
      expect(ADVANCED_TOOLS).toContain("analyze_screen");
      expect(ADVANCED_TOOLS).toContain("get_screen_text");
    });

    it("should include set_license_key", () => {
      expect(ADVANCED_TOOLS).toContain("set_license_key");
    });

    it("should NOT include removed streaming tools", () => {
      expect(ADVANCED_TOOLS).not.toContain("start_screen_stream");
      expect(ADVANCED_TOOLS).not.toContain("stop_screen_stream");
      expect(ADVANCED_TOOLS).not.toContain("get_stream_frames");
      expect(ADVANCED_TOOLS).not.toContain("start_fast_stream");
      expect(ADVANCED_TOOLS).not.toContain("get_live_frame");
    });

    it("should NOT include removed automation tools", () => {
      expect(ADVANCED_TOOLS).not.toContain("tap_element");
      expect(ADVANCED_TOOLS).not.toContain("input_to_element");
      expect(ADVANCED_TOOLS).not.toContain("swipe_screen");
      expect(ADVANCED_TOOLS).not.toContain("scroll_to_element");
    });
  });

  describe("isFreeTool()", () => {
    it("should return true for free tools", () => {
      expect(isFreeTool("screenshot_emulator")).toBe(true);
      expect(isFreeTool("list_devices")).toBe(true);
      expect(isFreeTool("get_adb_logs")).toBe(true);
      expect(isFreeTool("get_license_status")).toBe(true);
    });

    it("should return false for advanced-only tools", () => {
      expect(isFreeTool("get_ui_tree")).toBe(false);
      expect(isFreeTool("analyze_screen")).toBe(false);
      expect(isFreeTool("set_license_key")).toBe(false);
    });

    it("should return false for unknown tools", () => {
      expect(isFreeTool("unknown_tool")).toBe(false);
      expect(isFreeTool("")).toBe(false);
    });
  });

  describe("isAdvancedOnlyTool()", () => {
    it("should return true for advanced-only tools", () => {
      expect(isAdvancedOnlyTool("get_ui_tree")).toBe(true);
      expect(isAdvancedOnlyTool("find_element")).toBe(true);
      expect(isAdvancedOnlyTool("analyze_screen")).toBe(true);
      expect(isAdvancedOnlyTool("set_license_key")).toBe(true);
    });

    it("should return false for free tools", () => {
      expect(isAdvancedOnlyTool("screenshot_emulator")).toBe(false);
      expect(isAdvancedOnlyTool("list_devices")).toBe(false);
      expect(isAdvancedOnlyTool("get_adb_logs")).toBe(false);
    });

    it("should return false for unknown tools", () => {
      expect(isAdvancedOnlyTool("unknown_tool")).toBe(false);
    });
  });

  describe("canAccessTool()", () => {
    it("should allow free tools for free tier", () => {
      expect(canAccessTool("screenshot_emulator", "free")).toBe(true);
      expect(canAccessTool("list_devices", "free")).toBe(true);
      expect(canAccessTool("get_adb_logs", "free")).toBe(true);
    });

    it("should allow free tools for advanced tier", () => {
      expect(canAccessTool("screenshot_emulator", "advanced")).toBe(true);
      expect(canAccessTool("list_devices", "advanced")).toBe(true);
      expect(canAccessTool("get_adb_logs", "advanced")).toBe(true);
    });

    it("should deny advanced-only tools for free tier", () => {
      expect(canAccessTool("get_ui_tree", "free")).toBe(false);
      expect(canAccessTool("analyze_screen", "free")).toBe(false);
      expect(canAccessTool("set_license_key", "free")).toBe(false);
    });

    it("should allow advanced-only tools for advanced tier", () => {
      expect(canAccessTool("get_ui_tree", "advanced")).toBe(true);
      expect(canAccessTool("analyze_screen", "advanced")).toBe(true);
      expect(canAccessTool("set_license_key", "advanced")).toBe(true);
    });

    it("should deny unknown tools for all tiers", () => {
      expect(canAccessTool("unknown_tool", "free")).toBe(false);
      expect(canAccessTool("unknown_tool", "advanced")).toBe(false);
    });
  });
});

// ============================================================================
// TIER LIMITS TESTS
// ============================================================================

describe("Tier Limits", () => {
  describe("TIER_LIMITS constant", () => {
    it("should have free and advanced tiers only", () => {
      expect(TIER_LIMITS).toHaveProperty("free");
      expect(TIER_LIMITS).toHaveProperty("advanced");
      expect(Object.keys(TIER_LIMITS)).toHaveLength(2);
    });

    it("should have correct free tier limits", () => {
      expect(TIER_LIMITS.free.maxLogLines).toBe(50);
      expect(TIER_LIMITS.free.maxDevices).toBe(1);
    });

    it("should have correct advanced tier limits", () => {
      expect(TIER_LIMITS.advanced.maxLogLines).toBe(200);
      expect(TIER_LIMITS.advanced.maxDevices).toBe(3);
    });

    it("advanced tier should have better limits than free", () => {
      expect(TIER_LIMITS.advanced.maxLogLines).toBeGreaterThan(
        TIER_LIMITS.free.maxLogLines
      );
      expect(TIER_LIMITS.advanced.maxDevices).toBeGreaterThan(
        TIER_LIMITS.free.maxDevices
      );
    });
  });

  describe("getMaxLogLines()", () => {
    it("should return correct limits for each tier", () => {
      expect(getMaxLogLines("free")).toBe(50);
      expect(getMaxLogLines("advanced")).toBe(200);
    });

    it("should return default 50 for unknown tier", () => {
      expect(getMaxLogLines("unknown" as MobileDevTier)).toBe(50);
    });
  });

  describe("getMaxDevices()", () => {
    it("should return correct limits for each tier", () => {
      expect(getMaxDevices("free")).toBe(1);
      expect(getMaxDevices("advanced")).toBe(3);
    });

    it("should return default 1 for unknown tier", () => {
      expect(getMaxDevices("unknown" as MobileDevTier)).toBe(1);
    });
  });
});

// ============================================================================
// TOOL COUNTS VALIDATION
// ============================================================================

describe("Tool Counts (Documentation Alignment)", () => {
  it("should have 21 total tools", () => {
    expect(ADVANCED_TOOLS).toHaveLength(21);
  });

  it("should have 8 free tools (Android only)", () => {
    expect(FREE_TOOLS).toHaveLength(8);
  });

  it("should have 13 advanced-only tools", () => {
    const advancedOnlyTools = ADVANCED_TOOLS.filter(
      (tool) => !FREE_TOOLS.includes(tool)
    );
    expect(advancedOnlyTools).toHaveLength(13);
  });

  it("free tools should be a subset of advanced tools", () => {
    const advancedSet = new Set(ADVANCED_TOOLS);
    FREE_TOOLS.forEach((tool) => {
      expect(advancedSet.has(tool)).toBe(true);
    });
  });

  it("should have no duplicate tools in free tier", () => {
    const uniqueTools = new Set(FREE_TOOLS);
    expect(uniqueTools.size).toBe(FREE_TOOLS.length);
  });

  it("should have no duplicate tools in advanced tier", () => {
    const uniqueTools = new Set(ADVANCED_TOOLS);
    expect(uniqueTools.size).toBe(ADVANCED_TOOLS.length);
  });
});

// ============================================================================
// READ-ONLY VERIFICATION
// ============================================================================

describe("Read-Only Tool Verification", () => {
  const allTools = ADVANCED_TOOLS;

  it("should NOT include any tap/click automation tools", () => {
    const tapTools = allTools.filter(
      (tool) => tool.includes("tap") || tool.includes("click")
    );
    // The only tap-related tool should NOT be present (tap_element was removed)
    expect(tapTools).toHaveLength(0);
  });

  it("should NOT include any input/type automation tools", () => {
    const inputTools = allTools.filter(
      (tool) => tool.includes("input") && !tool.includes("info")
    );
    expect(inputTools).toHaveLength(0);
  });

  it("should NOT include any swipe/scroll automation tools", () => {
    const swipeTools = allTools.filter(
      (tool) => tool.includes("swipe") || tool.includes("scroll")
    );
    expect(swipeTools).toHaveLength(0);
  });

  it("should NOT include any streaming tools", () => {
    const streamTools = allTools.filter((tool) => tool.includes("stream"));
    expect(streamTools).toHaveLength(0);
  });

  it("all tools should be read-only observation tools", () => {
    // Verify known read-only patterns
    const readOnlyPatterns = [
      "screenshot",
      "list",
      "get",
      "check",
      "find",
      "wait",
      "assert",
      "suggest",
      "analyze",
      "set_license", // This modifies local config only, not the device
    ];

    allTools.forEach((tool) => {
      const isReadOnly = readOnlyPatterns.some((pattern) =>
        tool.includes(pattern)
      );
      expect(isReadOnly).toBe(true);
    });
  });
});
