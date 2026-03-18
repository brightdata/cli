<p align="center">
  <img src="https://raw.githubusercontent.com/brightdata/cli/main/assets/banner.gif" alt="Bright Data CLI" width="800" />
</p>

<h1 align="center">Bright Data CLI</h1>

<p align="center">
  Scrape, search, and extract structured web data — directly from your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/%40brightdata%2Fcli"><img src="https://img.shields.io/npm/v/%40brightdata%2Fcli?color=black&label=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-black" alt="node requirement" />
  <img src="https://img.shields.io/badge/license-ISC-black" alt="license" />
</p>

---

## Overview

`@brightdata/cli` is the official npm package for the [Bright Data](https://brightdata.com) CLI. It installs the `brightdata` command (with `bdata` as a shorthand alias) for access to the full Bright Data API surface:

| Command | What it does |
|---|---|
| `brightdata scrape` | Scrape any URL — bypasses CAPTCHAs, JS rendering, anti-bot protections |
| `brightdata search` | Google / Bing / Yandex search with structured JSON output |
| `brightdata pipelines` | Extract structured data from 40+ platforms (Amazon, LinkedIn, TikTok…) |
| `brightdata zones` | List and inspect your Bright Data proxy zones |
| `brightdata budget` | View account balance and per-zone cost & bandwidth |
| `brightdata skill` | Install Bright Data AI agent skills into your coding agent |
| `brightdata config` | Manage CLI configuration |
| `brightdata init` | Interactive setup wizard |

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Commands](#commands)
  - [init](#init)
  - [scrape](#scrape)
  - [search](#search)
  - [pipelines](#pipelines)
  - [status](#status)
  - [zones](#zones)
  - [budget](#budget)
  - [skill](#skill)
  - [config](#config)
  - [login / logout](#login--logout)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Output Modes](#output-modes)
- [Pipe-Friendly Usage](#pipe-friendly-usage)
- [Dataset Types Reference](#dataset-types-reference)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install -g @brightdata/cli
```

Or run without installing:

```bash
npx --yes --package @brightdata/cli brightdata <command>
```

> **Requires Node.js ≥ 20.0.0**

---

## Quick Start

```bash
# 1. Run the interactive setup wizard
brightdata init

# 2. Scrape a page as markdown
brightdata scrape https://example.com

# 3. Search Google
brightdata search "web scraping best practices"

# 4. Extract a LinkedIn profile
brightdata pipelines linkedin_person_profile "https://linkedin.com/in/username"

# 5. Check your account balance
brightdata budget
```

---

## Authentication

Get your API key from [brightdata.com/cp/setting/users](https://brightdata.com/cp/setting/users).

```bash
# Interactive — opens browser, saves key automatically
brightdata login

# Non-interactive — pass key directly
brightdata login --api-key <your-api-key>

# Environment variable — no login required
export BRIGHTDATA_API_KEY=your-api-key
```

On first login the CLI checks for required zones (`cli_unlocker`, `cli_browser`) and creates them automatically if missing.

```bash
# Clear saved credentials
brightdata logout
```

---

## Commands

### `init`

Interactive setup wizard. The recommended way to get started.

```bash
brightdata init
```

Walks through: API key detection → zone selection → default output format → quick-start examples.

| Flag | Description |
|---|---|
| `--skip-auth` | Skip the authentication step |
| `-k, --api-key <key>` | Provide API key directly |

---

### `scrape`

Scrape any URL using Bright Data's Web Unlocker. Handles CAPTCHAs, JavaScript rendering, and anti-bot protections automatically.

```bash
brightdata scrape <url> [options]
```

| Flag | Description |
|---|---|
| `-f, --format <fmt>` | `markdown` · `html` · `screenshot` · `json` (default: `markdown`) |
| `--country <code>` | Geo-target by ISO country code (e.g. `us`, `de`, `jp`) |
| `--zone <name>` | Web Unlocker zone name |
| `--mobile` | Use a mobile user agent |
| `--async` | Submit async job, return a snapshot ID |
| `-o, --output <path>` | Write output to file |
| `--json` / `--pretty` | JSON output (raw / indented) |
| `-k, --api-key <key>` | Override API key |

**Examples**

```bash
# Scrape as markdown (default)
brightdata scrape https://news.ycombinator.com

# Scrape as raw HTML
brightdata scrape https://example.com -f html

# US geo-targeting, save to file
brightdata scrape https://amazon.com -f json --country us -o product.json

# Pipe to a markdown viewer
brightdata scrape https://docs.github.com | glow -

# Async — returns a snapshot ID you can poll with `status`
brightdata scrape https://example.com --async
```

---

### `search`

Search Google, Bing, or Yandex via Bright Data's SERP API. Google results include structured data (organic results, ads, people-also-ask, related searches).

```bash
brightdata search <query> [options]
```

| Flag | Description |
|---|---|
| `--engine <name>` | `google` · `bing` · `yandex` (default: `google`) |
| `--country <code>` | Localized results (e.g. `us`, `de`) |
| `--language <code>` | Language code (e.g. `en`, `fr`) |
| `--page <n>` | Page number, 0-indexed (default: `0`) |
| `--type <type>` | `web` · `news` · `images` · `shopping` (default: `web`) |
| `--device <type>` | `desktop` · `mobile` |
| `--zone <name>` | SERP zone name |
| `-o, --output <path>` | Write output to file |
| `--json` / `--pretty` | JSON output (raw / indented) |
| `-k, --api-key <key>` | Override API key |

**Examples**

```bash
# Formatted table output (default)
brightdata search "typescript best practices"

# German localized results
brightdata search "restaurants berlin" --country de --language de

# News search
brightdata search "AI regulation" --type news

# Page 2 of results
brightdata search "web scraping" --page 1

# Extract just the URLs
brightdata search "open source scraping" --json | jq -r '.organic[].link'

# Search Bing
brightdata search "bright data pricing" --engine bing
```

---

### `pipelines`

Extract structured data from 40+ platforms using Bright Data's Web Scraper API. Triggers an async collection job, polls until ready, and returns results.

```bash
brightdata pipelines <type> [params...] [options]
```

| Flag | Description |
|---|---|
| `--format <fmt>` | `json` · `csv` · `ndjson` · `jsonl` (default: `json`) |
| `--timeout <seconds>` | Polling timeout (default: `600`) |
| `-o, --output <path>` | Write output to file |
| `--json` / `--pretty` | JSON output (raw / indented) |
| `-k, --api-key <key>` | Override API key |

```bash
# List all available dataset types
brightdata pipelines list
```

**Examples**

```bash
# LinkedIn profile
brightdata pipelines linkedin_person_profile "https://linkedin.com/in/username"

# Amazon product → CSV
brightdata pipelines amazon_product "https://amazon.com/dp/B09V3KXJPB" \
  --format csv -o product.csv

# Instagram profile
brightdata pipelines instagram_profiles "https://instagram.com/username"

# Amazon search by keyword
brightdata pipelines amazon_product_search "laptop" "https://amazon.com"

# Google Maps reviews
brightdata pipelines google_maps_reviews "https://maps.google.com/..." 7

# YouTube comments (top 50)
brightdata pipelines youtube_comments "https://youtube.com/watch?v=..." 50
```

See [Dataset Types Reference](#dataset-types-reference) for the full list.

---

### `status`

Check the status of an async snapshot job (returned by `--async` or `pipelines`).

```bash
brightdata status <job-id> [options]
```

| Flag | Description |
|---|---|
| `--wait` | Poll until the job completes |
| `--timeout <seconds>` | Polling timeout (default: `600`) |
| `-o, --output <path>` | Write output to file |
| `--json` / `--pretty` | JSON output (raw / indented) |
| `-k, --api-key <key>` | Override API key |

```bash
# Check current status
brightdata status s_abc123xyz

# Block until complete
brightdata status s_abc123xyz --wait --pretty

# Custom timeout (5 minutes)
brightdata status s_abc123xyz --wait --timeout 300
```

---

### `zones`

List and inspect your Bright Data proxy zones.

```bash
brightdata zones               # List all active zones
brightdata zones info <name>   # Show full details for a zone
```

```bash
# Export all zones as JSON
brightdata zones --json -o zones.json

# Inspect a specific zone
brightdata zones info my_unlocker_zone --pretty
```

---

### `budget`

View your account balance and per-zone cost and bandwidth usage. Read-only — no writes to the API.

```bash
brightdata budget                     # Show account balance (quick view)
brightdata budget balance             # Account balance + pending charges
brightdata budget zones               # Cost & bandwidth table for all zones
brightdata budget zone <name>         # Detailed cost & bandwidth for one zone
```

| Flag | Description |
|---|---|
| `--from <datetime>` | Start of date range (e.g. `2024-01-01T00:00:00`) |
| `--to <datetime>` | End of date range |
| `--json` / `--pretty` | JSON output (raw / indented) |
| `-k, --api-key <key>` | Override API key |

```bash
# Current account balance
brightdata budget

# Zone costs for January 2024
brightdata budget zones --from 2024-01-01T00:00:00 --to 2024-02-01T00:00:00

# Detailed view of a specific zone
brightdata budget zone my_unlocker_zone
```

---

### `skill`

Install Bright Data AI agent skills into your coding agent (Claude Code, Cursor, Copilot, etc.). Skills provide your agent with context and instructions for using Bright Data APIs effectively.

```bash
brightdata skill add              # Interactive picker — choose skill + agent
brightdata skill add <name>       # Install a specific skill directly
brightdata skill list             # List all available Bright Data skills
```

**Available skills**

| Skill | Description |
|---|---|
| `search` | Search Google and get structured JSON results |
| `scrape` | Scrape any webpage as clean markdown with bot bypass |
| `data-feeds` | Extract structured data from 40+ websites |
| `bright-data-mcp` | Orchestrate 60+ Bright Data MCP tools |
| `bright-data-best-practices` | Reference knowledge base for writing Bright Data code |

```bash
# Interactive — select skills and choose which agents to install to
brightdata skill add

# Install the scrape skill directly
brightdata skill add scrape

# See what's available
brightdata skill list
```

---

### `config`

View and manage CLI configuration.

```bash
brightdata config                              # Show all config
brightdata config get <key>                    # Get a single value
brightdata config set <key> <value>            # Set a value
```

| Key | Description |
|---|---|
| `default_zone_unlocker` | Default zone for `scrape` and `search` |
| `default_zone_serp` | Default zone for `search` (overrides unlocker zone) |
| `default_format` | Default output format: `markdown` or `json` |
| `api_url` | Override the Bright Data API base URL |

```bash
brightdata config set default_zone_unlocker my_zone
brightdata config set default_format json
```

---

### `login` / `logout`

```bash
brightdata login                      # Interactive login
brightdata login --api-key <key>      # Non-interactive
brightdata logout                     # Clear saved credentials
```

---

## Configuration

Config is stored in an OS-appropriate location:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/brightdata-cli/` |
| Linux | `~/.config/brightdata-cli/` |
| Windows | `%APPDATA%\brightdata-cli\` |

Two files are stored:
- `credentials.json` — API key
- `config.json` — zones, output format, preferences

**Priority order** (highest → lowest):

```
CLI flags  →  Environment variables  →  config.json  →  Defaults
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `BRIGHTDATA_API_KEY` | API key (overrides stored credentials) |
| `BRIGHTDATA_UNLOCKER_ZONE` | Default Web Unlocker zone |
| `BRIGHTDATA_SERP_ZONE` | Default SERP zone |
| `BRIGHTDATA_POLLING_TIMEOUT` | Default polling timeout in seconds |

```bash
BRIGHTDATA_API_KEY=xxx BRIGHTDATA_UNLOCKER_ZONE=my_zone \
  brightdata scrape https://example.com
```

---

## Output Modes

Every command supports:

| Mode | Flag | Behavior |
|---|---|---|
| Human-readable | *(default)* | Formatted table or markdown, with colors |
| JSON | `--json` | Compact JSON to stdout |
| Pretty JSON | `--pretty` | Indented JSON to stdout |
| File | `-o <path>` | Write to file; format inferred from extension |

**Auto-detected file formats:**

| Extension | Format |
|---|---|
| `.json` | JSON |
| `.md` | Markdown |
| `.html` | HTML |
| `.csv` | CSV |

---

## Pipe-Friendly Usage

When stdout is not a TTY, colors and spinners are automatically disabled. Errors go to `stderr`, data to `stdout`.

```bash
# Extract URLs from search results
brightdata search "nodejs tutorials" --json | jq -r '.organic[].link'

# Scrape and view with a markdown reader
brightdata scrape https://docs.github.com | glow -

# Save scraped content to a file
brightdata scrape https://example.com -f markdown > page.md

# Amazon product data as CSV
brightdata pipelines amazon_product "https://amazon.com/dp/xxx" --format csv > product.csv

# Chain search → scrape
brightdata search "top open source projects" --json \
  | jq -r '.organic[0].link' \
  | xargs brightdata scrape
```

---

## Dataset Types Reference

```bash
brightdata pipelines list   # See all types in your terminal
```

### E-Commerce

| Type | Platform |
|---|---|
| `amazon_product` | Amazon product page |
| `amazon_product_reviews` | Amazon reviews |
| `amazon_product_search` | Amazon search results |
| `walmart_product` | Walmart product page |
| `walmart_seller` | Walmart seller profile |
| `ebay_product` | eBay listing |
| `bestbuy_products` | Best Buy |
| `etsy_products` | Etsy |
| `homedepot_products` | Home Depot |
| `zara_products` | Zara |
| `google_shopping` | Google Shopping |

### Professional Networks

| Type | Platform |
|---|---|
| `linkedin_person_profile` | LinkedIn person |
| `linkedin_company_profile` | LinkedIn company |
| `linkedin_job_listings` | LinkedIn jobs |
| `linkedin_posts` | LinkedIn posts |
| `linkedin_people_search` | LinkedIn people search |
| `crunchbase_company` | Crunchbase |
| `zoominfo_company_profile` | ZoomInfo |

### Social Media

| Type | Platform |
|---|---|
| `instagram_profiles` | Instagram profiles |
| `instagram_posts` | Instagram posts |
| `instagram_reels` | Instagram reels |
| `instagram_comments` | Instagram comments |
| `facebook_posts` | Facebook posts |
| `facebook_marketplace_listings` | Facebook Marketplace |
| `facebook_company_reviews` | Facebook reviews |
| `facebook_events` | Facebook events |
| `tiktok_profiles` | TikTok profiles |
| `tiktok_posts` | TikTok posts |
| `tiktok_shop` | TikTok shop |
| `tiktok_comments` | TikTok comments |
| `x_posts` | X (Twitter) posts |
| `youtube_profiles` | YouTube channels |
| `youtube_videos` | YouTube videos |
| `youtube_comments` | YouTube comments |
| `reddit_posts` | Reddit posts |

### Other

| Type | Platform |
|---|---|
| `google_maps_reviews` | Google Maps reviews |
| `google_play_store` | Google Play |
| `apple_app_store` | Apple App Store |
| `reuter_news` | Reuters news |
| `github_repository_file` | GitHub repository files |
| `yahoo_finance_business` | Yahoo Finance |
| `zillow_properties_listing` | Zillow |
| `booking_hotel_listings` | Booking.com |

---

## Troubleshooting

**`Error: No Web Unlocker zone specified`**
```bash
brightdata config set default_zone_unlocker <your-zone-name>
# or
export BRIGHTDATA_UNLOCKER_ZONE=<your-zone-name>
```

**`Error: Invalid or expired API key`**
```bash
brightdata login
```

**`Error: Access denied`**

Check zone permissions in the [Bright Data control panel](https://brightdata.com/cp).

**`Error: Rate limit exceeded`**

Wait a moment and retry. Use `--async` for large jobs to avoid timeouts.

**Async job is too slow**
```bash
brightdata pipelines amazon_product <url> --timeout 1200
# or
export BRIGHTDATA_POLLING_TIMEOUT=1200
```

**Garbled output in non-interactive terminal**

Colors and spinners are disabled automatically when not in a TTY. If you still see ANSI codes, add `| cat` at the end of your command.

---

## Links

- [Bright Data Website](https://brightdata.com)
- [Control Panel](https://brightdata.com/cp)
- [API Key Settings](https://brightdata.com/cp/setting/users)
- [API Reference](https://docs.brightdata.com/api-reference)
- [Report an Issue](https://github.com/brightdata/cli/issues)

---

<p align="center">
  <sub>© Bright Data · ISC License</sub>
</p>
