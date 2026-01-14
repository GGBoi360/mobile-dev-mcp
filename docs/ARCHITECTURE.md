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
┌─────────────────────────────────────────────────────────────────┐
│  FREE                          │  PRO ($12/mo or $99/yr)        │
├────────────────────────────────┼────────────────────────────────┤
│  ✓ ADB logs (50 lines)         │  ✓ Everything in Free          │
│  ✓ Metro status check          │  ✓ Unlimited log lines         │
│  ✓ Manual screenshots          │  ✓ Real-time log streaming     │
│  ✓ List devices                │  ✓ Auto-screenshot on error    │
│  ✓ Device info                 │  ✓ Screenshot history (20)     │
│  ✓ Basic app info              │  ✓ Multi-device support        │
│  ✓ Clear app data              │  ✓ iOS Simulator support       │
│  ✓ Restart ADB                 │  ✓ React DevTools integration  │
│                                │  ✓ Custom error alerts         │
│                                │  ✓ Priority support            │
└────────────────────────────────┴────────────────────────────────┘
```

### Why $12/month:
- Low enough for individuals to justify
- $99/year gives ~30% discount (incentivizes annual)
- Comparable to other dev tools (Raycast Pro: $8/mo, etc.)
- Can always adjust based on demand

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
  "tier": "pro",
  "email": "user@example.com",
  "validatedAt": "2026-01-14T12:00:00Z",
  "expiresAt": "2027-01-14T12:00:00Z"
}
```

## Validation API (Serverless)

### Endpoint: POST /api/validate
```json
// Request
{
  "licenseKey": "MDM_XXXX-XXXX-XXXX-XXXX",
  "machineId": "hash-of-machine-info"
}

// Response (success)
{
  "valid": true,
  "tier": "pro",
  "email": "user@example.com",
  "expiresAt": "2027-01-14T12:00:00Z"
}

// Response (invalid)
{
  "valid": false,
  "error": "License expired or invalid"
}
```

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
- 500 free users
- 25 pro users (5% conversion)
- $300/month = $3,600/year

### Moderate (Year 1):
- 2,000 free users
- 150 pro users (7.5% conversion)
- $1,800/month = $21,600/year

### Optimistic (Year 2+):
- 10,000 free users
- 500 pro users (5% conversion)
- 20 team licenses
- $7,000/month = $84,000/year

## Launch Checklist

### Phase 1: MVP Launch (Free)
- [ ] Fix Metro logging bug
- [ ] Complete screenshot function
- [ ] Test all 11 tools
- [ ] Push to GitHub
- [ ] Create demo GIF
- [ ] Tweet at @anthropic, @boris_cherny
- [ ] Post in React Native communities

### Phase 2: Add Licensing (Week 2-3)
- [ ] Set up LemonSqueezy account
- [ ] Create product ($12/mo, $99/yr)
- [ ] Build validation API (Cloudflare Workers)
- [ ] Add license module to MCP server
- [ ] Gate 3-4 pro features
- [ ] Create landing page

### Phase 3: Pro Features (Week 4-6)
- [ ] Real-time log streaming
- [ ] Screenshot on error
- [ ] iOS Simulator support
- [ ] React DevTools integration

### Phase 4: Scale (Month 2+)
- [ ] Team tier
- [ ] Usage analytics
- [ ] Referral program
- [ ] Enterprise outreach
