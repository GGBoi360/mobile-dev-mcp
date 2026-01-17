# Mobile Dev MCP - Architecture

## Overview

Mobile Dev MCP is a **read-only** MCP server for debugging mobile apps. It provides observation and analysis tools without modifying device state.

```
┌─────────────────────────────────────────────────────────────────┐
│                    MOBILE DEV MCP                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  VIEW      │ Screenshots (Android emulator, iOS Simulator)     │
│  READ      │ UI tree, logs, device info, app info              │
│  ANALYZE   │ Screen analysis, element finding, suggestions     │
│  (no write)│ Safe for any environment                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
          ┌───────────────────────────────────┐
          │   Your Mobile Device/Emulator     │
          │   (Android ADB / iOS Simulator)   │
          └───────────────────────────────────┘
```

**Need automation?** For screen streaming, tapping, typing, and workflow orchestration, see [CodeControl](https://codecontrol.dev).

## Tier System

### Simple 2-Tier Model

| Tier | Price | Tools | Description |
|------|-------|-------|-------------|
| **Free** | $0 | 12 | Basic debugging - screenshots, logs, device info |
| **Advanced** | $18/mo | 21 | Full read-only - adds UI inspection + analysis |

### Free Tier (12 tools)

| Category | Tools |
|----------|-------|
| Screenshots | `screenshot_emulator`, `screenshot_ios_simulator` |
| Device Listing | `list_devices`, `list_ios_simulators` |
| Device Info | `get_device_info`, `get_ios_simulator_info`, `get_app_info` |
| Logs | `get_adb_logs`, `get_metro_logs`, `get_ios_simulator_logs`, `check_metro_status` |
| License | `get_license_status` |

### Advanced Tier (21 tools = 12 free + 9 advanced)

All Free tools plus:

| Category | Tools |
|----------|-------|
| UI Inspection | `get_ui_tree`, `find_element`, `wait_for_element`, `get_element_property`, `assert_element` |
| Screen Analysis | `suggest_action`, `analyze_screen`, `get_screen_text` |
| License | `set_license_key` |

### Tier Limits

| Feature | Free | Advanced |
|---------|------|----------|
| Tools | 12 | 21 |
| Log lines | 50 | 200 |
| Devices | 1 | 3 |

## License Validation

### Flow

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  MCP Server  │────▶│  Cloudflare     │────▶│  LemonSqueezy    │
│  (Local)     │◀────│  Worker API     │◀────│  License Store   │
└──────────────┘     └─────────────────┘     └──────────────────┘
       │
       │ HMAC-signed cache (1 hour TTL)
       ▼
┌──────────────────┐
│ ~/.mobile-dev-mcp│
│ /license.json    │
└──────────────────┘
```

### Validation Logic

1. Check for valid HMAC-signed cache
2. If cache fresh (<1 hour), use cached result
3. If cache stale, re-validate with API
4. If validation fails, clear cache and fall back to free
5. If no license key, run in free mode

### Cache Security

- Cache is HMAC-signed with machine-specific secret
- Prevents copying cache files between machines
- 1-hour TTL for fast revocation

## Technical Details

### Config File Location

```
~/.mobile-dev-mcp/
├── config.json      # User preferences (metroPort, etc.)
└── license.json     # HMAC-signed license cache
```

### license.json Format

```json
{
  "data": {
    "tier": "advanced",
    "licenseKey": "lk_XXXX...",
    "expiresAt": "2027-01-14T12:00:00Z",
    "lastValidated": 1736850000000
  },
  "signature": "hmac-sha256-signature..."
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MOBILEDEV_DEV_MODE=true` | Bypass license checks (development only) |

## Platform Support

### Android

- Uses ADB (Android Debug Bridge)
- Auto-detects SDK path on Windows, macOS, Linux
- Supports emulators and physical devices

### iOS (macOS only)

- Uses `xcrun simctl`
- Requires Xcode with Simulator
- Supports booted simulators

## API Endpoints

### License Validation

**POST** `https://mobiledev-license-api.giladworkersdev.workers.dev/validate`

```json
// Request
{
  "license_key": "lk_XXXX...",
  "instance_id": "machine-uuid"
}

// Response (success)
{
  "valid": true,
  "meta": { "product_name": "Advanced Monthly" },
  "license_key": { "expires_at": "2027-01-14T12:00:00Z" }
}

// Response (invalid)
{
  "valid": false,
  "error": "Invalid license key"
}
```

## File Structure

```
src/
├── index.ts      # MCP server, tool definitions, handlers
├── license.ts    # License validation, tier gating, HMAC
├── types.ts      # Type definitions, tool arrays, tier limits
├── utils.ts      # ADB/xcrun utilities, screenshot capture
├── *.test.ts     # Vitest test files
```

## Read-Only Design

Mobile Dev MCP is intentionally read-only:

- **No device state changes** - Cannot tap, type, install apps
- **No streaming** - Single screenshots only (streaming is CodeControl exclusive)
- **No automation** - Observation and analysis only
- **Safe for production** - Cannot accidentally modify app data

This design makes it safe to use in any environment while providing powerful debugging capabilities.

## Links

- **Website**: https://mobiledevmcp.dev
- **Pricing**: https://mobiledevmcp.dev/pricing
- **Full Automation**: https://codecontrol.dev
