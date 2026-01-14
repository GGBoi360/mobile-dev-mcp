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
  BASIC_TOOLS,
  ADVANCED_TOOLS,
  TIER_LIMITS,
  isAdvancedTool,
  isBasicTool,
  getTierLimits,
  LicenseTier,
} from "./license.js";

// ============================================================================
// TOOL CLASSIFICATION TESTS
// ============================================================================

describe("Tool Classification", () => {
  describe("BASIC_TOOLS constant", () => {
    it("should have 13 basic tools", () => {
      expect(BASIC_TOOLS).toHaveLength(13);
    });

    it("should include core logging tools", () => {
      expect(BASIC_TOOLS).toContain("get_metro_logs");
      expect(BASIC_TOOLS).toContain("get_adb_logs");
    });

    it("should include device management tools", () => {
      expect(BASIC_TOOLS).toContain("list_devices");
      expect(BASIC_TOOLS).toContain("get_device_info");
      expect(BASIC_TOOLS).toContain("restart_adb");
    });

    it("should include license tools", () => {
      expect(BASIC_TOOLS).toContain("get_license_status");
      expect(BASIC_TOOLS).toContain("set_license_key");
    });
  });

  describe("ADVANCED_TOOLS constant", () => {
    it("should have 11 advanced tools", () => {
      expect(ADVANCED_TOOLS).toHaveLength(11);
    });

    it("should include streaming tools", () => {
      expect(ADVANCED_TOOLS).toContain("stream_adb_realtime");
      expect(ADVANCED_TOOLS).toContain("stop_adb_streaming");
    });

    it("should include monitoring tools", () => {
      expect(ADVANCED_TOOLS).toContain("screenshot_history");
      expect(ADVANCED_TOOLS).toContain("watch_for_errors");
      expect(ADVANCED_TOOLS).toContain("multi_device_logs");
    });

    it("should include interaction tools", () => {
      expect(ADVANCED_TOOLS).toContain("tap_screen");
      expect(ADVANCED_TOOLS).toContain("input_text");
      expect(ADVANCED_TOOLS).toContain("press_button");
      expect(ADVANCED_TOOLS).toContain("swipe_screen");
      expect(ADVANCED_TOOLS).toContain("launch_app");
      expect(ADVANCED_TOOLS).toContain("install_apk");
    });
  });

  describe("isAdvancedTool()", () => {
    it("should return true for advanced tools", () => {
      expect(isAdvancedTool("stream_adb_realtime")).toBe(true);
      expect(isAdvancedTool("tap_screen")).toBe(true);
      expect(isAdvancedTool("swipe_screen")).toBe(true);
      expect(isAdvancedTool("multi_device_logs")).toBe(true);
    });

    it("should return false for basic tools", () => {
      expect(isAdvancedTool("get_metro_logs")).toBe(false);
      expect(isAdvancedTool("screenshot_emulator")).toBe(false);
      expect(isAdvancedTool("list_devices")).toBe(false);
    });

    it("should return false for unknown tools", () => {
      expect(isAdvancedTool("unknown_tool")).toBe(false);
      expect(isAdvancedTool("")).toBe(false);
    });
  });

  describe("isBasicTool()", () => {
    it("should return true for basic tools", () => {
      expect(isBasicTool("get_metro_logs")).toBe(true);
      expect(isBasicTool("screenshot_emulator")).toBe(true);
      expect(isBasicTool("list_devices")).toBe(true);
      expect(isBasicTool("get_license_status")).toBe(true);
    });

    it("should return false for advanced tools", () => {
      expect(isBasicTool("stream_adb_realtime")).toBe(false);
      expect(isBasicTool("tap_screen")).toBe(false);
      expect(isBasicTool("multi_device_logs")).toBe(false);
    });

    it("should return false for unknown tools", () => {
      expect(isBasicTool("unknown_tool")).toBe(false);
      expect(isBasicTool("")).toBe(false);
    });
  });
});

// ============================================================================
// TIER LIMITS TESTS
// ============================================================================

describe("Tier Limits", () => {
  describe("TIER_LIMITS constant", () => {
    it("should have trial, basic, and advanced tiers", () => {
      expect(TIER_LIMITS).toHaveProperty("trial");
      expect(TIER_LIMITS).toHaveProperty("basic");
      expect(TIER_LIMITS).toHaveProperty("advanced");
    });

    it("should have correct trial limits", () => {
      expect(TIER_LIMITS.trial.maxLogLines).toBe(50);
      expect(TIER_LIMITS.trial.maxDevices).toBe(1);
      expect(TIER_LIMITS.trial.screenshotHistory).toBe(0);
    });

    it("should have correct basic limits", () => {
      expect(TIER_LIMITS.basic.maxLogLines).toBe(50);
      expect(TIER_LIMITS.basic.maxDevices).toBe(1);
      expect(TIER_LIMITS.basic.screenshotHistory).toBe(0);
    });

    it("should have correct advanced limits", () => {
      expect(TIER_LIMITS.advanced.maxLogLines).toBe(Infinity);
      expect(TIER_LIMITS.advanced.maxDevices).toBe(3);
      expect(TIER_LIMITS.advanced.screenshotHistory).toBe(20);
    });
  });

  describe("getTierLimits()", () => {
    it("should return correct limits for each tier", () => {
      expect(getTierLimits("trial")).toEqual(TIER_LIMITS.trial);
      expect(getTierLimits("basic")).toEqual(TIER_LIMITS.basic);
      expect(getTierLimits("advanced")).toEqual(TIER_LIMITS.advanced);
    });
  });
});

// ============================================================================
// TOOL COUNTS VALIDATION
// ============================================================================

describe("Tool Counts (Documentation Alignment)", () => {
  it("should have 24 total tools (13 basic + 11 advanced)", () => {
    const totalTools = BASIC_TOOLS.length + ADVANCED_TOOLS.length;
    expect(totalTools).toBe(24);
  });

  it("should not have overlapping tools between basic and advanced", () => {
    const basicSet = new Set<string>(BASIC_TOOLS);
    const advancedSet = new Set<string>(ADVANCED_TOOLS);

    ADVANCED_TOOLS.forEach((tool) => {
      expect(basicSet.has(tool)).toBe(false);
    });

    BASIC_TOOLS.forEach((tool) => {
      expect(advancedSet.has(tool)).toBe(false);
    });
  });
});

// ============================================================================
// TIER HIERARCHY TESTS
// ============================================================================

describe("Tier Hierarchy", () => {
  const tiers: LicenseTier[] = ["trial", "basic", "advanced"];

  it("should have trial with most restrictions", () => {
    // Trial and Basic have same log limits
    expect(TIER_LIMITS.trial.maxLogLines).toBe(TIER_LIMITS.basic.maxLogLines);
    expect(TIER_LIMITS.trial.maxDevices).toBe(1);
  });

  it("should have advanced with least restrictions", () => {
    expect(TIER_LIMITS.advanced.maxLogLines).toBe(Infinity);
    expect(TIER_LIMITS.advanced.maxDevices).toBeGreaterThan(
      TIER_LIMITS.basic.maxDevices
    );
    expect(TIER_LIMITS.advanced.screenshotHistory).toBeGreaterThan(0);
  });

  it("advanced should have better or equal limits than basic", () => {
    expect(TIER_LIMITS.advanced.maxLogLines).toBeGreaterThanOrEqual(
      TIER_LIMITS.basic.maxLogLines
    );
    expect(TIER_LIMITS.advanced.maxDevices).toBeGreaterThanOrEqual(
      TIER_LIMITS.basic.maxDevices
    );
    expect(TIER_LIMITS.advanced.screenshotHistory).toBeGreaterThanOrEqual(
      TIER_LIMITS.basic.screenshotHistory
    );
  });
});

// ============================================================================
// INTERACTION TOOLS TESTS
// ============================================================================

describe("Interaction Tools (New Features)", () => {
  const interactionTools = [
    "tap_screen",
    "input_text",
    "press_button",
    "swipe_screen",
    "launch_app",
    "install_apk",
  ];

  it("should have all 6 interaction tools", () => {
    expect(interactionTools.length).toBe(6);
  });

  it("all interaction tools should be Advanced tier", () => {
    interactionTools.forEach((tool) => {
      expect(isAdvancedTool(tool)).toBe(true);
      expect(ADVANCED_TOOLS).toContain(tool);
    });
  });

  it("interaction tools should not be in basic tier", () => {
    interactionTools.forEach((tool) => {
      expect(isBasicTool(tool)).toBe(false);
      expect(BASIC_TOOLS).not.toContain(tool);
    });
  });
});
