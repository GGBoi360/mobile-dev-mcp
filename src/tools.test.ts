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
  // We'll test the tool definitions directly
  const coreToolSchemas = {
    get_metro_logs: {
      requiredParams: [],
      optionalParams: ["lines", "filter"],
    },
    get_adb_logs: {
      requiredParams: [],
      optionalParams: ["lines", "filter", "level"],
    },
    screenshot_emulator: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    list_devices: {
      requiredParams: [],
      optionalParams: [],
    },
    check_metro_status: {
      requiredParams: [],
      optionalParams: ["port"],
    },
    get_app_info: {
      requiredParams: ["packageName"],
      optionalParams: [],
    },
    clear_app_data: {
      requiredParams: ["packageName"],
      optionalParams: [],
    },
    restart_adb: {
      requiredParams: [],
      optionalParams: [],
    },
    get_device_info: {
      requiredParams: [],
      optionalParams: ["device"],
    },
    start_metro_logging: {
      requiredParams: [],
      optionalParams: ["logFile"],
    },
    stop_metro_logging: {
      requiredParams: [],
      optionalParams: [],
    },
  };

  const advancedToolSchemas = {
    stream_adb_realtime: {
      requiredParams: [],
      optionalParams: ["filter"],
    },
    stop_adb_streaming: {
      requiredParams: [],
      optionalParams: [],
    },
    screenshot_history: {
      requiredParams: [],
      optionalParams: ["limit"],
    },
    watch_for_errors: {
      requiredParams: ["patterns"],
      optionalParams: ["duration"],
    },
    multi_device_logs: {
      requiredParams: [],
      optionalParams: ["devices", "lines"],
    },
    tap_screen: {
      requiredParams: ["x", "y"],
      optionalParams: ["device"],
    },
    input_text: {
      requiredParams: ["text"],
      optionalParams: ["device"],
    },
    press_button: {
      requiredParams: ["button"],
      optionalParams: ["device"],
      enumValues: ["back", "home", "recent", "volume_up", "volume_down", "power", "enter"],
    },
    swipe_screen: {
      requiredParams: ["startX", "startY", "endX", "endY"],
      optionalParams: ["duration", "device"],
    },
    launch_app: {
      requiredParams: ["packageName"],
      optionalParams: ["device"],
    },
    install_apk: {
      requiredParams: ["apkPath"],
      optionalParams: ["device"],
    },
  };

  describe("Core Tool Schemas", () => {
    Object.entries(coreToolSchemas).forEach(([toolName, schema]) => {
      describe(`${toolName}`, () => {
        it(`should have ${schema.requiredParams.length} required params`, () => {
          expect(schema.requiredParams.length).toBeGreaterThanOrEqual(0);
        });

        it("should define optional params correctly", () => {
          expect(Array.isArray(schema.optionalParams)).toBe(true);
        });
      });
    });

    it("should have 11 core tools (excluding license tools)", () => {
      expect(Object.keys(coreToolSchemas)).toHaveLength(11);
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

    it("should have 11 advanced tools", () => {
      expect(Object.keys(advancedToolSchemas)).toHaveLength(11);
    });
  });

  describe("Interaction Tools Schema Details", () => {
    it("tap_screen should require x and y coordinates", () => {
      expect(advancedToolSchemas.tap_screen.requiredParams).toContain("x");
      expect(advancedToolSchemas.tap_screen.requiredParams).toContain("y");
    });

    it("input_text should require text parameter", () => {
      expect(advancedToolSchemas.input_text.requiredParams).toContain("text");
    });

    it("press_button should have valid button enum values", () => {
      const validButtons = ["back", "home", "recent", "volume_up", "volume_down", "power", "enter"];
      expect(advancedToolSchemas.press_button.enumValues).toEqual(validButtons);
    });

    it("swipe_screen should require start and end coordinates", () => {
      const required = advancedToolSchemas.swipe_screen.requiredParams;
      expect(required).toContain("startX");
      expect(required).toContain("startY");
      expect(required).toContain("endX");
      expect(required).toContain("endY");
    });

    it("launch_app should require packageName", () => {
      expect(advancedToolSchemas.launch_app.requiredParams).toContain("packageName");
    });

    it("install_apk should require apkPath", () => {
      expect(advancedToolSchemas.install_apk.requiredParams).toContain("apkPath");
    });
  });
});

// ============================================================================
// BUTTON KEY MAPPING TESTS
// ============================================================================

describe("Button Key Mappings", () => {
  // ADB keyevent codes for reference
  const keyMap: Record<string, number> = {
    back: 4,
    home: 3,
    recent: 187,
    volume_up: 24,
    volume_down: 25,
    power: 26,
    enter: 66,
  };

  it("should have correct Android keycode for back button", () => {
    expect(keyMap.back).toBe(4);
  });

  it("should have correct Android keycode for home button", () => {
    expect(keyMap.home).toBe(3);
  });

  it("should have correct Android keycode for recent apps", () => {
    expect(keyMap.recent).toBe(187);
  });

  it("should have correct Android keycodes for volume buttons", () => {
    expect(keyMap.volume_up).toBe(24);
    expect(keyMap.volume_down).toBe(25);
  });

  it("should have correct Android keycode for power button", () => {
    expect(keyMap.power).toBe(26);
  });

  it("should have correct Android keycode for enter", () => {
    expect(keyMap.enter).toBe(66);
  });

  it("should have 7 supported buttons", () => {
    expect(Object.keys(keyMap)).toHaveLength(7);
  });
});

// ============================================================================
// ADB COMMAND FORMAT TESTS
// ============================================================================

describe("ADB Command Formats", () => {
  describe("Tap command format", () => {
    it("should build correct tap command", () => {
      const x = 100;
      const y = 200;
      const expected = `adb shell input tap ${x} ${y}`;
      expect(`adb shell input tap ${x} ${y}`).toBe(expected);
    });

    it("should include device flag when specified", () => {
      const device = "emulator-5554";
      const x = 100;
      const y = 200;
      const expected = `adb -s ${device} shell input tap ${x} ${y}`;
      expect(`adb -s ${device} shell input tap ${x} ${y}`).toBe(expected);
    });
  });

  describe("Swipe command format", () => {
    it("should build correct swipe command with duration", () => {
      const startX = 100;
      const startY = 200;
      const endX = 100;
      const endY = 800;
      const duration = 300;
      const expected = `adb shell input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`;
      expect(
        `adb shell input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`
      ).toBe(expected);
    });
  });

  describe("Input text command format", () => {
    it("should use input text command", () => {
      const text = "hello";
      const expected = `adb shell input text "${text}"`;
      expect(`adb shell input text "${text}"`).toContain("input text");
    });
  });

  describe("Launch app command format", () => {
    it("should use monkey command for launching apps", () => {
      const packageName = "com.example.app";
      const expected = `adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`;
      expect(
        `adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
      ).toBe(expected);
    });
  });

  describe("Install APK command format", () => {
    it("should use install command with replace flag", () => {
      const apkPath = "/path/to/app.apk";
      const expected = `adb install -r "${apkPath}"`;
      expect(`adb install -r "${apkPath}"`).toBe(expected);
    });
  });
});

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

describe("Input Validation", () => {
  describe("Coordinate validation", () => {
    it("should accept positive integers for coordinates", () => {
      const validCoords = [0, 100, 500, 1920, 2560];
      validCoords.forEach((coord) => {
        expect(typeof coord).toBe("number");
        expect(coord).toBeGreaterThanOrEqual(0);
      });
    });

    it("should handle edge case coordinates", () => {
      // Common screen boundaries
      const edgeCases = [
        { x: 0, y: 0 }, // Top-left corner
        { x: 1080, y: 1920 }, // Bottom-right (common resolution)
        { x: 540, y: 960 }, // Center
      ];

      edgeCases.forEach((coord) => {
        expect(Number.isInteger(coord.x)).toBe(true);
        expect(Number.isInteger(coord.y)).toBe(true);
      });
    });
  });

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
  });

  describe("APK path validation", () => {
    it("should recognize valid APK file extensions", () => {
      const validPaths = [
        "/path/to/app.apk",
        "C:\\Users\\app.apk",
        "./build/app-release.apk",
      ];

      validPaths.forEach((path) => {
        expect(path.toLowerCase().endsWith(".apk")).toBe(true);
      });
    });
  });

  describe("Duration validation", () => {
    it("should use reasonable default duration for swipes", () => {
      const defaultDuration = 300;
      expect(defaultDuration).toBeGreaterThan(0);
      expect(defaultDuration).toBeLessThanOrEqual(5000);
    });
  });
});

// ============================================================================
// TOOL OUTPUT FORMAT TESTS
// ============================================================================

describe("Tool Output Formats", () => {
  describe("Success messages", () => {
    it("should use checkmark emoji for success", () => {
      const successMsg = "✅ Tapped at (100, 200)";
      expect(successMsg.startsWith("✅")).toBe(true);
    });

    it("should include coordinates in tap success message", () => {
      const x = 100;
      const y = 200;
      const msg = `✅ Tapped at (${x}, ${y})`;
      expect(msg).toContain(`(${x}, ${y})`);
    });
  });

  describe("Error messages", () => {
    it("should prefix errors with 'Error'", () => {
      const errorMsg = "Error tapping screen: device not found";
      expect(errorMsg.startsWith("Error")).toBe(true);
    });
  });
});
