# Mobile Dev MCP - Architecture & Monetization

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User discovers tool (GitHub, Twitter, etc.)                 │
│                    ↓                                             │
│  2. Installs free version via Claude Code                       │
│                    ↓                                             │
│  3. Uses free features, gets hooked                             │
│                    ↓                                             │
│  4. Hits limitation ("Pro feature - upgrade at...")             │
│                    ↓                                             │
│  5. Goes to mobile-dev-mcp.com                                  │
│                    ↓                                             │
│  6. Pays via LemonSqueezy/Gumroad                               │
│                    ↓                                             │
│  7. Gets license key via email                                  │
│                    ↓                                             │
│  8. Adds key to config: ~/.mobiledev-mcp/config.json            │
│                    ↓                                             │
│  9. Pro features unlocked!                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## License Validation Flow

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  MCP Server  │────▶│  Validation API │────▶│  License Store   │
│  (Local)     │◀────│  (Serverless)   │◀────│  (KV/Database)   │
└──────────────┘     └─────────────────┘     └──────────────────┘
       │
       │ Caches result locally
       ▼
┌──────────────┐
│ ~/.mobiledev │
│ /license.json│
└──────────────┘
```

### Validation Logic:
1. On startup, check for cached license
2. If cache is fresh (<24h), use cached result
3. If cache is stale, validate against API
4. If API is down, use cached result (grace period)
5. If no cache and API down, run in free mode

## Payment Platform Comparison

| Platform      | Fee        | Pros                          | Cons                    |
|---------------|------------|-------------------------------|-------------------------|
| LemonSqueezy  | 5% + fees  | Dev-friendly, tax handling    | Smaller ecosystem       |
| Gumroad       | 10%        | Super easy, well-known        | Higher fee              |
| Stripe        | 2.9% + 30¢ | Full control, lowest fees     | More setup required     |
| Paddle        | 5% + fees  | Tax compliance, SaaS-focused  | More enterprise-y       |

### Recommendation: **LemonSqueezy**
- Built for developers selling software
- Handles VAT/tax automatically (important for international)
- License key generation built-in
- Good API for validation
- Reasonable fees (5% + payment processing)

## Pricing Strategy

### Tier Structure:
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  TRIAL (50 requests)  │  BASIC ($6/mo)          │  ADVANCED ($8/wk, $12/mo, $99/yr) │
├───────────────────────┼─────────────────────────┼───────────────────────────────────┤
│  ✓ All 46 tools       │  ✓ 17 core tools        │  ✓ All 46 tools                   │
│  ✓ 50 log lines       │  ✓ 50 log lines         │  ✓ Unlimited log lines            │
│  ✓ 1 device           │  ✓ 1 device             │  ✓ 3 devices                      │
│  ✗ 50 requests limit  │  ✓ Unlimited requests   │  ✓ Unlimited requests             │
│                       │  ✗ No streaming         │  ✓ Real-time log streaming        │
│                       │  ✗ No history           │  ✓ Screenshot history (20)        │
│                       │  ✗ No interaction tools │  ✓ Multi-device logs              │
│                       │  ✗ No iOS advanced      │  ✓ Error pattern watching         │
│                       │  ✗ No React DevTools    │  ✓ Device interaction (Android)   │
│                       │  ✗ No network inspect   │  ✓ iOS Simulator control          │
│                       │                         │  ✓ React DevTools integration     │
│                       │                         │  ✓ Network request inspection     │
└───────────────────────┴─────────────────────────┴───────────────────────────────────┘
```

### Core Tools (17 - All Tiers):

**Android (11):**
get_metro_logs, get_adb_logs, screenshot_emulator, list_devices, check_metro_status,
get_app_info, clear_app_data, restart_adb, get_device_info, start_metro_logging, stop_metro_logging

**iOS Simulator (4):**
list_ios_simulators, screenshot_ios_simulator, get_ios_simulator_logs, get_ios_simulator_info

**License (2):**
get_license_status, set_license_key

### Advanced Tools (29 - Advanced Tier Only):

**Android Streaming & Monitoring (5):**
stream_adb_realtime, stop_adb_streaming, screenshot_history, watch_for_errors, multi_device_logs

**Android Interaction (6):**
tap_screen, input_text, press_button, swipe_screen, launch_app, install_apk

**iOS Simulator Advanced (8):**
boot_ios_simulator, shutdown_ios_simulator, install_ios_app, launch_ios_app,
terminate_ios_app, ios_open_url, ios_push_notification, ios_set_location

**React DevTools (5):**
setup_react_devtools, check_devtools_connection, get_react_component_tree,
inspect_react_component, search_react_components

**Network Inspection (5):**
get_network_requests, start_network_monitoring, stop_network_monitoring,
get_network_stats, analyze_request

### Why This Pricing:
- **Basic $6/mo**: Low entry point for hobbyists, increased limits
- **Advanced $12/mo**: Full features for professional mobile devs
- **$8/week option**: For short-term projects or trying before committing
- **$99/year**: ~30% discount, incentivizes annual commitment
- Comparable to other dev tools (Raycast Pro: $8/mo, etc.)

### Future: Team Tier ($49/month)
- 5 seats included
- Centralized license management
- Team configuration sync
- Usage analytics

## Technical Implementation

### Config File Location:
```
~/.mobiledev-mcp/
├── config.json      # User preferences
├── license.json     # License cache
├── trial.json       # Trial usage tracking
└── logs/            # Debug logs (optional)
```

### config.json:
```json
{
  "licenseKey": "MDM_XXXX-XXXX-XXXX-XXXX",
  "metroPort": 8081,
  "logBufferSize": 100,
  "defaultDevice": null,
  "theme": "auto"
}
```

### license.json (cached):
```json
{
  "key": "MDM_XXXX-XXXX-XXXX-XXXX",
  "valid": true,
  "tier": "advanced",
  "email": "user@example.com",
  "validatedAt": "2026-01-14T12:00:00Z",
  "expiresAt": "2027-01-14T12:00:00Z"
}
```

Note: `tier` can be `"trial"`, `"basic"`, or `"advanced"`.

## Validation API (Serverless)

### Endpoint: POST /validate
```json
// Request
{
  "license_key": "lk_XXXX-XXXX-XXXX-XXXX",
  "instance_id": "hash-of-machine-info"
}

// Response (success)
{
  "valid": true,
  "tier": "basic",  // or "advanced"
  "license_key": {
    "status": "active",
    "activation_limit": 3,
    "activation_usage": 1,
    "expires_at": "2027-01-14T12:00:00Z"
  },
  "meta": {
    "customer_email": "user@example.com",
    "product_name": "Mobile Dev MCP",
    "variant_name": "Advanced Monthly"
  }
}

// Response (invalid)
{
  "valid": false,
  "error": "License expired or invalid"
}
```

Note: Tier is determined by checking `variant_name` for "basic" or "advanced" keywords.

### Hosting Options:
1. **Cloudflare Workers** (Recommended)
   - Free tier: 100k requests/day
   - KV storage for licenses
   - Global edge = fast validation

2. **Vercel Edge Functions**
   - Free tier available
   - Easy deployment

3. **Supabase Edge Functions**
   - If you want PostgreSQL for licenses

## Revenue Projections

### Conservative (First 6 months):
- 500 trial users
- 15 Basic users ($6/mo) + 10 Advanced users ($12/mo)
- $210/month = $2,520/year

### Moderate (Year 1):
- 2,000 trial users
- 100 Basic users ($6/mo) + 50 Advanced users ($12/mo)
- $1,200/month = $14,400/year

### Optimistic (Year 2+):
- 10,000 trial users
- 300 Basic users + 200 Advanced users + 20 team licenses ($49/mo)
- $5,180/month = $62,160/year

## Launch Checklist

### Phase 1: MVP Launch ✅
- [x] Fix Metro logging bug
- [x] Complete screenshot function
- [x] Implement all 17 core tools
- [x] Push to GitHub
- [ ] Create demo GIF
- [ ] Tweet at @anthropic, @boris_cherny
- [ ] Post in React Native communities

### Phase 2: Add Licensing ✅
- [x] Set up LemonSqueezy account
- [x] Create products (Basic $6/mo, Advanced $8/wk/$12/mo/$99/yr)
- [x] Build validation API (Cloudflare Workers)
- [x] Add license module to MCP server
- [x] Gate 29 advanced features
- [x] Create landing page (mobile-dev-mcp.com)

### Phase 3: Pro Features ✅
- [x] Real-time log streaming (stream_adb_realtime)
- [x] Screenshot history (screenshot_history)
- [x] Multi-device logs (multi_device_logs)
- [x] Error pattern watching (watch_for_errors)
- [x] Device interaction tools (tap_screen, input_text, press_button, swipe_screen, launch_app, install_apk)
- [x] iOS Simulator support (12 tools: screenshots, logs, boot/shutdown, app management, push notifications, location)
- [x] React DevTools integration (5 tools: setup, connection check, component tree, inspect, search)
- [x] Network request inspection (5 tools: get requests, monitoring, stats, analyze)

### Phase 4: Scale (Upcoming)
- [ ] Team tier ($49/mo)
- [ ] Usage analytics
- [ ] Referral program
- [ ] Enterprise outreach
- [ ] Performance metrics
