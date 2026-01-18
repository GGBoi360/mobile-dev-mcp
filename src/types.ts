// Mobile Dev MCP - Type Definitions
// Read-only debugging tool for mobile development

export interface DeviceInfo {
  id: string;
  status: string;
  type: "emulator" | "device";
}

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
  // Computed properties
  centerX?: number;
  centerY?: number;
}

export interface ScreenAnalysis {
  elements: UiElement[];
  textContent: string[];
  suggestedActions: SuggestedAction[];
  screenDescription: string;
}

export interface SuggestedAction {
  action: "tap" | "swipe" | "input" | "scroll" | "back" | "home";
  description: string;
  target?: {
    text?: string;
    resourceId?: string;
    contentDescription?: string;
    bounds?: string;
  };
  reasoning: string;
}

export interface LicenseTier {
  tier: "free" | "advanced";
  valid: boolean;
  expiresAt?: string;
  features: string[];
}

export interface TierLimits {
  maxLogLines: number;
  maxDevices: number;
}

// Simplified 2-tier system: Free and Advanced
export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    maxLogLines: 50,
    maxDevices: 1,
  },
  advanced: {
    maxLogLines: 200,
    maxDevices: 3,
  },
};

// Tool categories for mobile-dev-mcp (21 tools total)

// Free Tier - 8 Android-only read-only tools
export const FREE_TOOLS = [
  "screenshot_emulator",
  "list_devices",
  "get_device_info",
  "get_app_info",
  "get_adb_logs",
  "get_metro_logs",
  "check_metro_status",
  "get_license_status",
];

// Advanced Tier ($18/mo) - Free + 13 additional tools (21 total)
// Includes: iOS support, UI inspection, screen analysis
export const ADVANCED_TOOLS = [
  ...FREE_TOOLS,
  // iOS Support (4 tools) - Advanced only
  "screenshot_ios_simulator",
  "list_ios_simulators",
  "get_ios_simulator_info",
  "get_ios_simulator_logs",
  // UI Inspection (5 tools) - Android
  "get_ui_tree",
  "find_element",
  "wait_for_element",
  "get_element_property",
  "assert_element",
  // Screen Analysis (3 tools) - Android
  "suggest_action",
  "analyze_screen",
  "get_screen_text",
  // License (1 tool)
  "set_license_key",
];

// All tools combined (same as Advanced since we only have 2 tiers)
export const ALL_TOOLS = ADVANCED_TOOLS;
