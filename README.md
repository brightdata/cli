# Bright Data CLI

> Scrape, search, and extract structured data from the web — directly from your terminal.

`brightdata-cli` is the official command-line interface for [Bright Data](https://brightdata.com). It gives you direct access to Bright Data's full API surface: the Web Unlocker, SERP API, Web Scraper (data feeds), and zone management — all from a single `brightdata` command.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Commands](#commands)
  - [init](#init--interactive-setup-wizard)
  - [scrape](#scrape--web-unlocker)
  - [search](#search--serp-api)
  - [pipelines](#pipelines--web-scraper-api)
  - [status](#status--check-async-jobs)
  - [zones](#zones--zone-management)
  - [config](#config--configuration)
  - [login / logout](#login--logout)
  - [version](#version)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Output Modes](#output-modes)
- [Pipe-Friendly Usage](#pipe-friendly-usage)
- [Dataset Types Reference](#dataset-types-reference)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install -g brightdata-cli
```

Or run without installing:

```bash
npx brightdata-cli <command>
```

**Requirements:** Node.js ≥ 18.0.0

---

## Quick Start

```bash
# Run the interactive setup wizard
brightdata init

# Scrape a page as markdown
brightdata scrape https://example.com

# Search Google
brightdata search "web scraping best practices"

# Extract a LinkedIn profile
brightdata pipelines linkedin_person_profile "https://linkedin.com/in/username"

# Get Amazon product data as CSV
brightdata pipelines amazon_product "https://amazon.com/dp/B09V3KXJPB" -o product.csv
```

---

## Authentication

You need a [Bright Data API key](https://brightdata.com/cp/setting/users) to use this CLI.

**Interactive login:**
```bash
brightdata login
```

**Pass key directly:**
```bash
brightdata login --api-key <your-api-key>
```

**Via environment variable (no login required):**
```bash
export BRIGHTDATA_API_KEY=your-api-key
brightdata scrape https://example.com
```

On login, the CLI automatically checks for the required `cli_unlocker` and `cli_browser` zones and creates them if they don't exist, then saves the unlocker zone as your default.

To clear saved credentials:
```bash
brightdata logout
```

---

## Commands

### `init` — Interactive Setup Wizard

The recommended way to get started. Walks you through authentication, zone selection, and default format configuration.

```bash
brightdata init
```

**Options:**

| Flag | Description |
|---|---|
| `--skip-auth` | Skip the authentication step |
| `-k, --api-key <key>` | Provide API key directly |

The wizard:
1. Displays an ASCII art banner
2. Detects or prompts for your API key
3. Validates and saves the key
4. Loads your active zones
5. Lets you pick default zones for scraping and SERP
6. Sets your preferred output format
7. Shows quick-start examples

---

### `scrape` — Web Unlocker

Scrape any URL using Bright Data's Web Unlocker API, which handles CAPTCHAs, JavaScript rendering, and anti-bot protections automatically.

```bash
brightdata scrape <url> [options]
```

**Options:**

| Flag | Description |
|---|---|
| `-f, --format <format>` | Output format: `markdown`, `html`, `screenshot`, `json` (default: `markdown`) |
| `--country <code>` | ISO country code for geo-targeting (e.g. `us`, `de`, `jp`) |
| `--zone <name>` | Web Unlocker zone name |
| `--mobile` | Use a mobile user agent |
| `--async` | Submit asynchronously and return a job ID |
| `-o, --output <path>` | Write output to file |
| `--json` | Force JSON output |
| `--pretty` | Pretty-print JSON output |
| `--timing` | Show request timing |
| `-k, --api-key <key>` | Override API key for this request |

**Examples:**

```bash
# Scrape as markdown (default)
brightdata scrape https://news.ycombinator.com

# Scrape as raw HTML
brightdata scrape https://example.com -f html

# Scrape with US geo-targeting, save to file
brightdata scrape https://amazon.com -f json --country us -o product.json

# Scrape and pipe to a markdown viewer
brightdata scrape https://docs.github.com/en | glow -

# Submit async job (returns a snapshot ID)
brightdata scrape https://example.com --async
```

---

### `search` — SERP API

Search the web through Bright Data's SERP API. Google results include structured data (organic, people-also-ask, related searches). Bing and Yandex return raw content.

```bash
brightdata search <query> [options]
```

**Options:**

| Flag | Description |
|---|---|
| `--engine <name>` | Search engine: `google`, `bing`, `yandex` (default: `google`) |
| `--country <code>` | Country code for localized results (e.g. `us`, `de`) |
| `--language <code>` | Language code (e.g. `en`, `fr`) |
| `--page <n>` | Results page number, 0-indexed (default: `0`) |
| `--type <type>` | Search type: `web`, `news`, `images`, `shopping` (default: `web`) |
| `--zone <name>` | SERP zone name |
| `--device <type>` | Device type: `desktop`, `mobile` |
| `-o, --output <path>` | Write output to file |
| `--json` | Force JSON output |
| `--pretty` | Pretty-print JSON output |
| `--timing` | Show request timing |
| `-k, --api-key <key>` | Override API key for this request |

**Examples:**

```bash
# Search Google (default — displays a formatted table)
brightdata search "typescript best practices"

# Search in German, localized to Germany
brightdata search "restaurants berlin" --country de --language de

# Get structured JSON (organic results, ads, related searches, etc.)
brightdata search "nodejs" --pretty

# Search news results
brightdata search "AI regulation" --type news

# Paginate results (page 2)
brightdata search "web scraping" --page 1

# Pipe result URLs to a script
brightdata search "open source scraping" --json | jq -r '.organic[].link'

# Search Bing instead
brightdata search "bright data pricing" --engine bing
```

Default output for Google shows a formatted table with rank, title, URL, and snippet. Use `--json` or `--pretty` to get the full structured response.

---

### `pipelines` — Web Scraper API

Extract structured data from 40+ platforms using Bright Data's Web Scraper API (data feeds). Supports e-commerce, social media, professional networks, and more.

```bash
brightdata pipelines <type> [params...] [options]
```

**Options:**

| Flag | Description |
|---|---|
| `--format <fmt>` | Result format: `json`, `csv`, `ndjson`, `jsonl` (default: `json`) |
| `--timeout <seconds>` | Polling timeout in seconds (default: `600`) |
| `-o, --output <path>` | Write output to file |
| `--json` | Force JSON output |
| `--pretty` | Pretty-print JSON output |
| `--timing` | Show request timing |
| `-k, --api-key <key>` | Override API key for this request |

**List all available dataset types:**

```bash
brightdata pipelines list
```

**Examples:**

```bash
# LinkedIn person profile
brightdata pipelines linkedin_person_profile "https://linkedin.com/in/username"

# Amazon product data
brightdata pipelines amazon_product "https://amazon.com/dp/B09V3KXJPB"

# Amazon product → CSV file
brightdata pipelines amazon_product "https://amazon.com/dp/B09V3KXJPB" \
  --format csv -o product.csv

# Instagram profile
brightdata pipelines instagram_profiles "https://instagram.com/username"

# Amazon search by keyword + domain
brightdata pipelines amazon_product_search "laptop" "https://amazon.com"

# LinkedIn people search
brightdata pipelines linkedin_people_search \
  "https://linkedin.com/search/results/people" John Doe

# Facebook reviews (with count)
brightdata pipelines facebook_company_reviews "https://facebook.com/page" 25

# Google Maps reviews (last 7 days)
brightdata pipelines google_maps_reviews "https://maps.google.com/..." 7

# YouTube comments (top 50)
brightdata pipelines youtube_comments "https://youtube.com/watch?v=..." 50

# Pretty-print results
brightdata pipelines reddit_posts "https://reddit.com/r/programming" --pretty
```

The command triggers an async data collection job, polls until results are ready, and prints them when complete.

**Special input formats:**

| Dataset type | Arguments |
|---|---|
| Most types | `<url>` |
| `amazon_product_search` | `<keyword> <domain_url>` |
| `linkedin_people_search` | `<search_url> <first_name> <last_name>` |
| `facebook_company_reviews` | `<url> [num_reviews]` |
| `google_maps_reviews` | `<url> [days_limit]` |
| `youtube_comments` | `<url> [num_comments]` |

---

### `status` — Check Async Jobs

Check the status of an asynchronous Web Scraper snapshot job.

```bash
brightdata status <job-id> [options]
```

**Options:**

| Flag | Description |
|---|---|
| `--wait` | Poll until the job is complete |
| `--timeout <seconds>` | Polling timeout in seconds (default: `600`) |
| `-o, --output <path>` | Write output to file |
| `--json` | Force JSON output |
| `--pretty` | Pretty-print JSON output |
| `--timing` | Show request timing |
| `-k, --api-key <key>` | Override API key for this request |

**Examples:**

```bash
# Check current status
brightdata status s_abc123xyz

# Wait until complete, then print results
brightdata status s_abc123xyz --wait

# Wait with a custom timeout (5 minutes)
brightdata status s_abc123xyz --wait --timeout 300 --pretty
```

---

### `zones` — Zone Management

List and inspect your Bright Data zones.

```bash
# List all active zones
brightdata zones

# Show details for a specific zone
brightdata zones info <name>
```

**Examples:**

```bash
# List zones as a table
brightdata zones

# Get zone info as JSON
brightdata zones info my_unlocker_zone --pretty

# Export all zones to JSON file
brightdata zones --json -o zones.json
```

---

### `config` — Configuration

View and manage CLI configuration settings.

```bash
# Show all config
brightdata config

# Get a specific value
brightdata config get default_zone_unlocker

# Set a value
brightdata config set default_zone_unlocker my_zone
brightdata config set default_zone_serp my_serp_zone
brightdata config set default_format json
brightdata config set api_url https://api.brightdata.com
```

**Configurable keys:**

| Key | Description |
|---|---|
| `default_zone_unlocker` | Default zone for `scrape` and `search` commands |
| `default_zone_serp` | Default zone for `search` command (overrides unlocker zone) |
| `default_format` | Default output format: `markdown` or `json` |
| `api_url` | Override the Bright Data API base URL |

---

### `login` / `logout`

```bash
# Interactive login
brightdata login

# Login with key directly
brightdata login --api-key <your-key>

# Clear saved credentials
brightdata logout
```

---

### `version`

```bash
brightdata version
# or
brightdata -v
```

---

## Configuration

Config files are stored in an OS-appropriate location:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/brightdata-cli/` |
| Windows | `~/AppData/Roaming/brightdata-cli/` |
| Linux | `~/.config/brightdata-cli/` |

Two files are stored:
- **`credentials.json`** — your API key
- **`config.json`** — zones, output format, preferences

**Priority cascade** (highest to lowest):

```
CLI flags  →  Environment variables  →  Stored config  →  Defaults
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `BRIGHTDATA_API_KEY` | API key (overrides stored credentials) |
| `BRIGHTDATA_UNLOCKER_ZONE` | Default Web Unlocker zone |
| `BRIGHTDATA_SERP_ZONE` | Default SERP zone |
| `BRIGHTDATA_POLLING_TIMEOUT` | Default polling timeout in seconds |

**Example:**

```bash
BRIGHTDATA_API_KEY=xxx BRIGHTDATA_UNLOCKER_ZONE=my_zone \
  brightdata scrape https://example.com
```

---

## Output Modes

Every command supports multiple output modes:

| Mode | Flag | Description |
|---|---|---|
| Human-readable | (default) | Formatted table or markdown, with colors |
| JSON | `--json` | Raw JSON output |
| Pretty JSON | `--pretty` | Indented, human-readable JSON |
| File | `-o <path>` | Write output to a file |

File format is auto-detected from the extension:

| Extension | Format |
|---|---|
| `.json` | JSON |
| `.md` | Markdown |
| `.html` | HTML |
| `.csv` | CSV |

---

## Pipe-Friendly Usage

When stdout is not a TTY (i.e. when piping or redirecting), the CLI automatically disables colors, spinners, and interactive prompts. Errors are sent to `stderr`, data to `stdout`.

```bash
# Extract links from Google search
brightdata search "nodejs tutorials" --json | jq -r '.organic[].link'

# Scrape a page and view with a markdown reader
brightdata scrape https://docs.github.com | glow -

# Save scraped content to a file
brightdata scrape https://example.com -f markdown > page.md

# Get Amazon product data as CSV
brightdata pipelines amazon_product "https://amazon.com/dp/xxx" --format csv > product.csv

# Chain commands
brightdata search "top companies" --json \
  | jq -r '.organic[0].link' \
  | xargs brightdata scrape
```

---

## Dataset Types Reference

Use `brightdata pipelines list` to see all supported types, or reference the table below:

### E-Commerce

| Type | Platform |
|---|---|
| `amazon_product` | Amazon product page |
| `amazon_product_reviews` | Amazon product reviews |
| `amazon_product_search` | Amazon search results |
| `walmart_product` | Walmart product page |
| `walmart_seller` | Walmart seller profile |
| `ebay_product` | eBay product listing |
| `bestbuy_products` | Best Buy products |
| `etsy_products` | Etsy products |
| `homedepot_products` | Home Depot products |
| `zara_products` | Zara products |
| `google_shopping` | Google Shopping results |

### Professional Networks

| Type | Platform |
|---|---|
| `linkedin_person_profile` | LinkedIn person profile |
| `linkedin_company_profile` | LinkedIn company page |
| `linkedin_job_listings` | LinkedIn job postings |
| `linkedin_posts` | LinkedIn posts |
| `linkedin_people_search` | LinkedIn people search |
| `crunchbase_company` | Crunchbase company profile |
| `zoominfo_company_profile` | ZoomInfo company profile |

### Social Media

| Type | Platform |
|---|---|
| `instagram_profiles` | Instagram user profiles |
| `instagram_posts` | Instagram posts |
| `instagram_reels` | Instagram reels |
| `instagram_comments` | Instagram comments |
| `facebook_posts` | Facebook posts |
| `facebook_marketplace_listings` | Facebook Marketplace |
| `facebook_company_reviews` | Facebook page reviews |
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
| `google_play_store` | Google Play app data |
| `apple_app_store` | Apple App Store data |
| `reuter_news` | Reuters news articles |
| `github_repository_file` | GitHub repository files |
| `yahoo_finance_business` | Yahoo Finance business data |
| `zillow_properties_listing` | Zillow property listings |
| `booking_hotel_listings` | Booking.com hotel listings |

---

## Troubleshooting

**`Error: No Web Unlocker zone specified`**

Run `brightdata init` or set a default zone:
```bash
brightdata config set default_zone_unlocker <your-zone-name>
# or
export BRIGHTDATA_UNLOCKER_ZONE=<your-zone-name>
```

**`Error: Invalid or expired API key`**

Re-authenticate:
```bash
brightdata login
```

**`Error: Access denied`**

Check your zone permissions in the [Bright Data control panel](https://brightdata.com/cp).

**`Error: Rate limit exceeded`**

Wait a moment and retry. Consider using `--async` for large scraping jobs.

**Async job is taking too long**

Increase the polling timeout:
```bash
brightdata pipelines amazon_product <url> --timeout 1200
# or
export BRIGHTDATA_POLLING_TIMEOUT=1200
```

**Output looks garbled in a non-interactive terminal**

Colors and spinners are automatically disabled when not in a TTY. If you still see ANSI codes, pipe through `cat` or redirect output.

---

## License

ISC — © Bright Data

---

## Links

- [Bright Data Website](https://brightdata.com)
- [Control Panel](https://brightdata.com/cp)
- [API Key Settings](https://brightdata.com/cp/setting/users)
- [GitHub Issues](https://github.com/brightdata/brightdata-cli/issues)
