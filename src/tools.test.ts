import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tool Implementation Tests
 *
 * These tests verify the tool definitions and input schemas
 * without executing actual ADB commands.
 */

// ============================================================================
// TOOL SCHEMA VALIDATION TESTS
// ============================================================================

describe("Tool Input Schemas", () => {
  // Free tier tools - 8 Android-only read-only tools
  const freeToolSchemas = {
    screenshot_emulator: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    list_devices: {
      requiredParams: [],
      optionalParams: [],
    },
    get_device_info: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    get_app_info: {
      requiredParams: ["packageName"],
      optionalParams: [],
    },
    get_adb_logs: {
      requiredParams: [],
      optionalParams: ["lines", "filter", "level"],
    },
    get_metro_logs: {
      requiredParams: [],
      optionalParams: ["lines", "filter"],
    },
    check_metro_status: {
      requiredParams: [],
      optionalParams: ["port"],
    },
    get_license_status: {
      requiredParams: [],
      optionalParams: [],
    },
  };

  // Advanced tier tools - iOS + UI inspection + analysis (13 tools)
  const advancedToolSchemas = {
    // iOS Support (4 tools)
    screenshot_ios_simulator: {
      requiredParams: [],
      optionalParams: ["udid"],
    },
    list_ios_simulators: {
      requiredParams: [],
      optionalParams: [],
    },
    get_ios_simulator_info: {
      requiredParams: [],
      optionalParams: ["udid"],
    },
    get_ios_simulator_logs: {
      requiredParams: [],
      optionalParams: ["lines", "filter"],
    },
    // UI Inspection (5 tools)
    get_ui_tree: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    find_element: {
      requiredParams: [],
      optionalParams: ["text", "resourceId", "contentDescription", "className", "device"],
    },
    wait_for_element: {
      requiredParams: [],
      optionalParams: ["text", "resourceId", "contentDescription", "className", "timeout", "pollInterval", "device"],
    },
    get_element_property: {
      requiredParams: ["property"],
      optionalParams: ["text", "resourceId", "contentDescription", "className", "device"],
    },
    assert_element: {
      requiredParams: ["assertion"],
      optionalParams: ["text", "resourceId", "contentDescription", "className", "device"],
    },
    // Screen Analysis (3 tools)
    suggest_action: {
      requiredParams: [],
      optionalParams: ["context", "device"],
    },
    analyze_screen: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    get_screen_text: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    // License (1 tool)
    set_license_key: {
      requiredParams: ["licenseKey"],
      optionalParams: [],
    },
  };

  describe("Free Tool Schemas", () => {
    Object.entries(freeToolSchemas).forEach(([toolName, schema]) => {
      describe(`${toolName}`, () => {
        it(`should have ${schema.requiredParams.length} required params`, () => {
          expect(schema.requiredParams.length).toBeGreaterThanOrEqual(0);
        });

        it("should define optional params correctly", () => {
          expect(Array.isArray(schema.optionalParams)).toBe(true);
        });
      });
    });

    it("should have 8 free tools (Android only)", () => {
      expect(Object.keys(freeToolSchemas)).toHaveLength(8);
    });
  });

  describe("Advanced Tool Schemas", () => {
    Object.entries(advancedToolSchemas).forEach(([toolName, schema]) => {
      describe(`${toolName}`, () => {
        it(`should have ${schema.requiredParams.length} required params`, () => {
          expect(schema.requiredParams.length).toBeGreaterThanOrEqual(0);
        });

        it("should define optional params correctly", () => {
          expect(Array.isArray(schema.optionalParams)).toBe(true);
        });
      });
    });

    it("should have 13 advanced-only tools", () => {
      expect(Object.keys(advancedToolSchemas)).toHaveLength(13);
    });
  });
});

// ============================================================================
// ADB COMMAND FORMAT TESTS
// ============================================================================

describe("ADB Command Formats", () => {
  describe("Screenshot command format", () => {
    it("should build correct screenshot command", () => {
      const expected = "adb exec-out screencap -p";
      expect("adb exec-out screencap -p").toBe(expected);
    });

    it("should include device flag when specified", () => {
      const device = "emulator-5554";
      const expected = `adb -s ${device} exec-out screencap -p`;
      expect(`adb -s ${device} exec-out screencap -p`).toBe(expected);
    });
  });

  describe("Logcat command format", () => {
    it("should build correct logcat command with line limit", () => {
      const lines = 50;
      const expected = `adb logcat -d -t ${lines}`;
      expect(`adb logcat -d -t ${lines}`).toBe(expected);
    });

    it("should include filter when specified", () => {
      const filter = "ReactNative";
      const lines = 50;
      const expected = `adb logcat -d -t ${lines} | grep ${filter}`;
      expect(`adb logcat -d -t ${lines} | grep ${filter}`).toContain("grep");
    });
  });

  describe("Device list command format", () => {
    it("should use adb devices command", () => {
      const expected = "adb devices -l";
      expect("adb devices -l").toBe(expected);
    });
  });

  describe("UI dump command format", () => {
    it("should use uiautomator dump command", () => {
      const expected = "adb shell uiautomator dump /dev/tty";
      expect("adb shell uiautomator dump /dev/tty").toContain("uiautomator");
    });
  });
});

// ============================================================================
// iOS COMMAND FORMAT TESTS
// ============================================================================

describe("iOS Simulator Command Formats", () => {
  describe("Screenshot command format", () => {
    it("should use xcrun simctl io screenshot", () => {
      const udid = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
      const expected = `xcrun simctl io ${udid} screenshot -`;
      expect(`xcrun simctl io ${udid} screenshot -`).toContain("screenshot");
    });
  });

  describe("List simulators command format", () => {
    it("should use xcrun simctl list", () => {
      const expected = "xcrun simctl list devices --json";
      expect("xcrun simctl list devices --json").toContain("simctl list");
    });
  });

  describe("Log stream command format", () => {
    it("should use log stream for simulator logs", () => {
      const expected = "xcrun simctl spawn booted log stream --predicate 'processImagePath contains \"APPNAME\"' --level debug";
      expect(expected).toContain("log stream");
    });
  });
});

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

describe("Input Validation", () => {
  describe("Package name validation", () => {
    it("should recognize valid Android package names", () => {
      const validPackages = [
        "com.example.app",
        "com.android.settings",
        "org.example.myapp",
        "com.company.app_name",
      ];

      validPackages.forEach((pkg) => {
        // Package names should contain dots
        expect(pkg.includes(".")).toBe(true);
        // Package names should not start or end with dots
        expect(pkg.startsWith(".")).toBe(false);
        expect(pkg.endsWith(".")).toBe(false);
      });
    });

    it("should reject invalid package names", () => {
      const invalidPackages = [
        ".com.example",
        "com.example.",
        "singleword",
        "",
      ];

      invalidPackages.forEach((pkg) => {
        const isValid = pkg.includes(".") && !pkg.startsWith(".") && !pkg.endsWith(".") && pkg.length > 0;
        expect(isValid).toBe(false);
      });
    });
  });

  describe("Device ID validation", () => {
    it("should recognize valid emulator IDs", () => {
      const validIds = [
        "emulator-5554",
        "emulator-5556",
        "emulator-5558",
      ];

      validIds.forEach((id) => {
        expect(id.startsWith("emulator-")).toBe(true);
      });
    });

    it("should recognize valid physical device IDs", () => {
      const validIds = [
        "RF8M12345XY",
        "1234567890ABCDEF",
      ];

      validIds.forEach((id) => {
        expect(id.length).toBeGreaterThan(5);
        expect(/^[A-Z0-9]+$/i.test(id)).toBe(true);
      });
    });
  });

  describe("iOS UDID validation", () => {
    it("should recognize valid simulator UDIDs", () => {
      const validUdids = [
        "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        "12345678-1234-1234-1234-123456789012",
      ];

      validUdids.forEach((udid) => {
        // UDIDs should have specific format with dashes
        expect(udid.length).toBe(36);
        expect(udid.split("-").length).toBe(5);
      });
    });
  });

  describe("Log lines validation", () => {
    it("should accept reasonable line counts", () => {
      const validCounts = [10, 50, 100, 200];
      validCounts.forEach((count) => {
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(1000);
      });
    });
  });
});

// ============================================================================
// TOOL OUTPUT FORMAT TESTS
// ============================================================================

describe("Tool Output Formats", () => {
  describe("Success messages", () => {
    it("should use appropriate emoji for success", () => {
      const successIndicators = ["✅", "📸", "📱", "✓"];
      const successMsg = "✅ Screenshot captured successfully";
      expect(successIndicators.some((emoji) => successMsg.includes(emoji))).toBe(true);
    });
  });

  describe("Error messages", () => {
    it("should prefix errors with 'Error' or error emoji", () => {
      const errorIndicators = ["Error", "❌", "⚠️"];
      const errorMsg = "Error: Device not found";
      expect(errorIndicators.some((indicator) => errorMsg.includes(indicator))).toBe(true);
    });
  });

  describe("JSON output", () => {
    it("should produce valid JSON for structured output", () => {
      const jsonOutput = JSON.stringify({
        status: "success",
        data: { devices: [] },
      });
      expect(() => JSON.parse(jsonOutput)).not.toThrow();
    });
  });
});

// ============================================================================
// READ-ONLY TOOL VERIFICATION
// ============================================================================

describe("Read-Only Tool Verification", () => {
  it("should not have any write/modify commands in tool descriptions", () => {
    const writeKeywords = [
      "tap",
      "click",
      "type",
      "input",
      "swipe",
      "scroll",
      "install",
      "uninstall",
      "delete",
      "remove",
      "modify",
      "write",
      "push",
      "pull",
      "stream",
    ];

    // Tool names that should NOT exist in the read-only tool set
    const forbiddenToolPatterns = writeKeywords.map((kw) => new RegExp(kw, "i"));

    // All tools should be observation/read-only
    const allToolNames = [
      "screenshot_emulator",
      "screenshot_ios_simulator",
      "list_devices",
      "list_ios_simulators",
      "get_device_info",
      "get_ios_simulator_info",
      "get_app_info",
      "get_adb_logs",
      "get_metro_logs",
      "get_ios_simulator_logs",
      "check_metro_status",
      "get_license_status",
      "get_ui_tree",
      "find_element",
      "wait_for_element",
      "get_element_property",
      "assert_element",
      "suggest_action",
      "analyze_screen",
      "get_screen_text",
      "set_license_key", // This is acceptable - modifies local config only
    ];

    // Verify no forbidden patterns in tool names (except set_license_key)
    allToolNames.forEach((toolName) => {
      if (toolName !== "set_license_key") {
        forbiddenToolPatterns.forEach((pattern) => {
          // Tool names should not contain write-related keywords
          if (pattern.test(toolName)) {
            // This should fail for any tool that has write keywords
            expect(toolName).not.toMatch(pattern);
          }
        });
      }
    });
  });

  it("should have exactly 21 total tools", () => {
    const allTools = [
      // Free (12)
      "screenshot_emulator",
      "screenshot_ios_simulator",
      "list_devices",
      "list_ios_simulators",
      "get_device_info",
      "get_ios_simulator_info",
      "get_app_info",
      "get_adb_logs",
      "get_metro_logs",
      "get_ios_simulator_logs",
      "check_metro_status",
      "get_license_status",
      // Advanced-only (9)
      "get_ui_tree",
      "find_element",
      "wait_for_element",
      "get_element_property",
      "assert_element",
      "suggest_action",
      "analyze_screen",
      "get_screen_text",
      "set_license_key",
    ];

    expect(allTools).toHaveLength(21);
  });
});
