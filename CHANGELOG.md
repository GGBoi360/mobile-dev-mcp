# Changelog

All notable changes to Mobile Dev MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-01-16

### Added
- **Expo DevTools Integration** (5 tools)
  - `check_expo_status` - Check Expo dev server status
  - `get_expo_config` - Get Expo project configuration
  - `expo_dev_menu` - Open the Expo developer menu
  - `expo_reload` - Trigger app reload
  - `get_eas_builds` - Get EAS build status

- **Performance Metrics** (5 tools)
  - `get_cpu_usage` - Monitor CPU usage
  - `get_memory_usage` - Track memory consumption
  - `get_fps_stats` - Analyze frame rendering
  - `get_battery_stats` - Check battery consumption
  - `get_performance_snapshot` - Get all metrics at once

- **Dual License Model**
  - MIT License for 17 Basic tools (true open source)
  - Elastic License 2.0 for 39 Advanced tools

### Changed
- Total tools increased from 46 to 56
- Advanced tools increased from 29 to 39
- Updated documentation with new tool counts

## [0.1.0] - 2026-01-15

### Added
- **Initial Release** with 46 tools

- **Basic Tier** (17 tools - MIT Licensed)
  - Android: get_metro_logs, get_adb_logs, screenshot_emulator, list_devices, check_metro_status, get_app_info, clear_app_data, restart_adb, get_device_info, start_metro_logging, stop_metro_logging
  - iOS: list_ios_simulators, screenshot_ios_simulator, get_ios_simulator_logs, get_ios_simulator_info
  - License: get_license_status, set_license_key

- **Advanced Tier** (29 tools - Elastic License 2.0)
  - Streaming: stream_adb_realtime, stop_adb_streaming, screenshot_history, watch_for_errors, multi_device_logs
  - Interaction: tap_screen, input_text, press_button, swipe_screen, launch_app, install_apk
  - iOS Advanced: boot_ios_simulator, shutdown_ios_simulator, install_ios_app, launch_ios_app, terminate_ios_app, ios_open_url, ios_push_notification, ios_set_location
  - React DevTools: setup_react_devtools, check_devtools_connection, get_react_component_tree, inspect_react_component, search_react_components
  - Network: get_network_requests, start_network_monitoring, stop_network_monitoring, get_network_stats, analyze_request

- **Trial System**
  - 50 free tool requests
  - Access to all tools during trial
  - Usage tracking per machine

- **License Validation**
  - Cloudflare Worker API for validation
  - LemonSqueezy integration for payments
  - 24-hour cache with 7-day grace period

### Infrastructure
- Published to npm as `@ggboi360/mobile-dev-mcp`
- Landing page at https://ggboi360.github.io/mobile-dev-mcp
- GitHub repository: https://github.com/GGBoi360/mobile-dev-mcp
