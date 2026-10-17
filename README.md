# Quant Alpha Dashboard

Next.js dashboard for monitoring the Quant Alpha trading platform. It combines
strategy performance, account equity, broker positions, and execution records
behind a single filterable interface.

For backend setup, authentication, API, reconciliation, and deployment details,
see the [Quant Alpha Backend README](https://github.com/quant-alpha-team/quant-backend/blob/main/README.md).

> [!IMPORTANT]
> Node.js 22 or newer is required. The dashboard also needs a reachable Quant
> Alpha backend API to load trading data.

## Contents

- [What the Dashboard Provides](#what-the-dashboard-provides)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Troubleshooting](#troubleshooting)
- [Tests and Validation](#tests-and-validation)
- [Project Structure](#project-structure)
- [Deployment Checklist](#deployment-checklist)

## What the Dashboard Provides

- **Overview** — account NAV, period change, realized and unrealized P&L,
  commissions, trade counts, and open-position coverage.
- **Strategy P&L** — daily total, realized, and unrealized P&L with valuation
  status, charts, sortable tables, and CSV export.
- **Positions** — broker-reconciled holdings grouped by strategy and asset type,
  including price change, market value, day change, cost basis, expiration, and
  gain/loss.
- **Account Equity** — daily account snapshots, period change, equity history,
  charts, and CSV export.
- **Trade Logs** — paginated and sortable execution records with CSV export.
- **Diagnostics** — loaded-row counts and query context for troubleshooting.
- Strategy, broker account, date-range, and display-timezone filters.
- One-click backend reconciliation before refreshing the visible data.
- Responsive layout, collapsible navigation, and sortable position tables.

## Architecture

The browser only calls the dashboard's internal route handlers. Those handlers
query the backend with server-side credentials, so `API_TOKEN` is never sent to
the browser.

```text
Browser
  │
  ├── /api/dashboard/filters ──┐
  ├── /api/dashboard/data ─────┼── Next.js server ── Quant Alpha backend API
  ├── /api/dashboard/sync ─────┤
  └── /api/health ─────────────┘
```

Dashboard requests are uncached, paginated, and isolated by dataset. Per-dataset
row limits and bounded backend concurrency prevent unbounded fan-out. If a
backend scope fails, returns invalid rows, or reaches a limit, the UI identifies
the affected dataset as partial instead of presenting incomplete values as exact.

## Requirements

- Node.js 22+
- npm and the committed `package-lock.json`
- A reachable [Quant Alpha Backend](https://github.com/quant-alpha-team/quant-backend/blob/main/README.md)
  exposing these routes:

| Method | Backend route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health/` | Connectivity check |
| `GET` | `/api/trading/meta/filters/` | Strategies and broker accounts |
| `GET` | `/api/trading/trades/executions/` | Trade executions |
| `GET` | `/api/trading/accounts/equity-history/` | Account equity history |
| `GET` | `/api/trading/strategies/daily-pnl/` | Daily strategy P&L |
| `GET` | `/api/trading/portfolio/positions/` | Strategy positions as of a date |
| `POST` | `/api/trading/reconciliation/sync/` | Trading-data reconciliation |

Except for the health check, backend requests use
`Authorization: Token <API_TOKEN>` unless authentication is explicitly disabled.
The public backend health route is used by launcher preflight; the dashboard's
own `/api/health` readiness result also probes protected filter access, so an
invalid or expired token is reported as offline instead of healthy.

## Quick Start

### 1. Install the dependencies

```bash
npm ci
```

### 2. Configure the environment

Copy the [environment template](./.env.example):

```bash
cp .env.example .env
```

Set `API_BASE_URL` when the backend is not at `http://127.0.0.1:8000`, and
set `API_TOKEN` when backend authentication is enabled. For a trusted local
backend without authentication, set `API_AUTH_DISABLED=true` instead.

### 3. Start the development server

```bash
npm run dev
```

### 4. Verify the dashboard

Open [http://localhost:3000](http://localhost:3000).

To confirm that the dashboard can reach the backend, request
[http://localhost:3000/api/health](http://localhost:3000/api/health). A healthy
response contains `"ok": true`.

## Configuration

The application reads `.env` through Next.js. The optional `quant-web` launcher
also loads `.env.local` first and then `.env`, without overwriting variables
already present in the shell. The repository ignores `.env`. If you use
`.env.local`, keep it untracked because it can contain credentials.

### Backend connection

| Variable | Default | Description |
| --- | --- | --- |
| `API_BASE_URL` | `http://127.0.0.1:8000` | Backend origin without a trailing API path |
| `API_TOKEN` | empty | Token sent in the server-side `Authorization` header |
| `API_AUTH_DISABLED` | `false` | Disables the authorization header; use only for trusted local backends |
| `API_TIMEOUT_SECONDS` | `15` | Timeout for normal backend requests and launcher preflight |
| `API_SYNC_TIMEOUT_SECONDS` | `180` | Timeout for reconciliation requests |
| `API_PAGE_SIZE` | `500` | Rows requested per backend page; capped at `2000` |
| `DASHBOARD_API_CONCURRENCY` | `4` | Maximum concurrent backend dataset/scope requests; capped at `8` |
| `API_PREFLIGHT_STRICT` | `false` | Makes the `quant-web` launcher exit when its backend preflight fails |

### Dataset limits

Each limit defaults to `5000` source rows across the entire requested dataset,
including all selected strategy scopes. Set a value to `0` to disable that
dataset's cap. The response metadata and dashboard warning identify truncated or
otherwise incomplete data.

| Variable | Dataset |
| --- | --- |
| `API_MAX_EXEC_ROWS` | Trade executions |
| `API_MAX_PERF_ROWS` | Account equity history |
| `API_MAX_PNL_ROWS` | Daily strategy P&L |
| `API_MAX_POSITION_ROWS` | Strategy positions |

### Server and logging

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Next.js listening port |
| `HOSTNAME` | `localhost` | Host used by the `quant-web` launcher; the Docker image uses `0.0.0.0` |
| `LOG_DIR` | `logs` | Log directory, relative to the project root unless absolute |
| `LOG_FILE` | `dashboard.log` | Active log filename |
| `LOG_LEVEL` | `INFO` | Minimum level: `DEBUG`, `INFO`, `WARNING`, or `ERROR` |
| `LOG_RETENTION_DAYS` | `7` | Retention for rotated log files |
| `TZ` | system timezone | Timezone for log timestamps and daily rotation; falls back to `America/New_York` |

Logs rotate daily as `dashboard.log.YYYY-MM-DD`. If the log directory cannot be
created or written, file logging is disabled and messages continue on stdout.

## Running the Application

### npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create the standalone production build |
| `npm run start` | Start a previously built production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run dashboard, logging, and reconciliation tests |
| `npm run check` | Run lint, typecheck, and tests |

For a local production run:

```bash
npm run build
npm run start
```

### CLI launcher

The optional launcher adds `.env` loading, rotating launcher logs, and a backend
health preflight before Next.js starts.

```bash
npm link

# Development mode
quant-web
quant-web --port 3001

# Production mode; run npm run build first
quant-web start --port 3000
```

With the default `API_PREFLIGHT_STRICT=false`, an unavailable backend produces a
warning and the UI still starts. Set it to `true` when startup should fail fast.

### Docker

The multi-stage image builds a standalone Next.js server and runs it as an
unprivileged user.

```bash
docker build -t quant-web:local .
docker run --rm --env-file .env -p 3000:3000 quant-web:local
```

Inside a container, `127.0.0.1` refers to the container itself. Set
`API_BASE_URL` to a hostname or container-network address that can reach the
backend. Mount `/app/logs` to a writable host directory if logs must survive
container replacement.

Maintainers can use the Buildx helper for local or multi-architecture images:

```bash
# Local image for the detected architecture
./scripts/build.sh --local

# Local image for a selected architecture
./scripts/build.sh --local --arch amd
./scripts/build.sh --local --arch arm

# Build and push linux/amd64 and linux/arm64 images
./scripts/build.sh --remote
```

By default, remote builds push the version-tagged image to GHCR. Override
`REGISTRY_GH` when a different registry namespace is required.

## Troubleshooting

- **Missing API token** — set `API_TOKEN`, or use
  `API_AUTH_DISABLED=true` only with a trusted unauthenticated backend.
- **Dashboard starts without data** — check `API_BASE_URL`, then open
  `/api/health` and inspect `logs/dashboard.log`.
- **Refresh times out** — increase `API_SYNC_TIMEOUT_SECONDS`; reconciliation
  can take longer than normal read requests.
- **Incomplete tables** — raise the relevant `API_MAX_*_ROWS` value or set it to
  `0`, taking backend and browser memory usage into account.
- **Docker cannot reach the backend** — do not use `127.0.0.1` unless the
  backend runs in the same container; use a shared Docker network or a reachable
  host address.

For reconciliation and PnL behavior, see the
[backend reconciliation and PnL guide](https://github.com/quant-alpha-team/quant-backend/blob/main/README.md#reconciliation-and-pnl).

## Tests and Validation

Run the fast validation suite, then create a production build before submitting
changes:

```bash
npm run check
npm run build
```

Release history is maintained in [CHANGELOG.md](./CHANGELOG.md).

## Project Structure

```text
quant-web/
├── app/
│   ├── api/
│   │   ├── dashboard/
│   │   │   ├── data/route.ts       # Section-aware data proxy
│   │   │   ├── filters/route.ts    # Filter metadata proxy
│   │   │   └── sync/route.ts       # Reconciliation proxy
│   │   └── health/route.ts         # Backend health proxy
│   ├── globals.css                 # Theme and global styles
│   ├── icon.png                    # Application icon
│   ├── layout.tsx                  # Root layout
│   └── page.tsx                    # Dashboard entry page
├── bin/
│   └── quant-web.mjs               # CLI launcher and startup logging
├── components/
│   ├── dashboard-shell.tsx         # Dashboard state and section views
│   ├── dashboard-charts.tsx        # Recharts visualizations
│   ├── data-table.tsx              # Paginated, sortable data table
│   ├── metric-card.tsx             # KPI cards
│   ├── section-control.tsx         # Dashboard section navigation
│   ├── sidebar-filters.tsx         # Query filters
│   ├── signal-icon.tsx             # Shared icon treatment
│   └── status-message.tsx          # Loading and error states
├── lib/
│   ├── backend-api.ts              # Authenticated API client and pagination
│   ├── dashboard.ts                # Date, KPI, chart, and formatting helpers
│   ├── logger-core.mjs             # Shared log rotation and retention
│   ├── logger.ts                   # Next.js logger adapter
│   ├── reconciliation.ts           # Reconciliation response normalization
│   ├── trade-executions.ts         # Execution schema and field helpers
│   └── types.ts                    # Shared TypeScript contracts
├── tests/
│   ├── dashboard.test.mts          # Dashboard helper regression tests
│   ├── logger.test.mts             # Logger regression tests
│   └── reconciliation.test.mts     # Reconciliation regression tests
├── public/
│   └── QuantAlpha-logo.png         # Dashboard logo
├── scripts/
│   └── build.sh                    # Docker Buildx helper
├── .env.example                    # Configuration template
├── Dockerfile                      # Standalone production image
├── next.config.mjs                 # Next.js standalone output settings
└── package.json                    # Scripts and dependencies
```

### Key files

| Area | Reference |
| --- | --- |
| Environment configuration | [`.env.example`](./.env.example) |
| Dashboard entry page | [`app/page.tsx`](./app/page.tsx) |
| Dashboard data proxy | [`app/api/dashboard/data/route.ts`](./app/api/dashboard/data/route.ts) |
| Backend API client | [`lib/backend-api.ts`](./lib/backend-api.ts) |
| Dashboard data helpers | [`lib/dashboard.ts`](./lib/dashboard.ts) |
| Regression tests | [`tests/`](./tests/) |
| Container build | [`Dockerfile`](./Dockerfile) and [`scripts/build.sh`](./scripts/build.sh) |
| Release history | [`CHANGELOG.md`](./CHANGELOG.md) |

## Deployment Checklist

1. Run `npm run check` and `npm run build`.
2. Inject production settings at runtime. Keep backend authentication enabled,
   provide `API_TOKEN`, and keep environment files out of the image.
3. Confirm that `API_BASE_URL` is reachable from the frontend runtime,
   especially when the services use separate containers.
4. Start the production build or container and make `LOG_DIR` writable when
   file logs must be retained.
5. Verify `/api/health`, load each dashboard section, and confirm that
   reconciliation succeeds when the deployment is expected to use it.

Complete the
[backend deployment checklist](https://github.com/quant-alpha-team/quant-backend/blob/main/README.md#deployment-checklist)
before exposing the dashboard.

---

**Version**: 1.2.4
