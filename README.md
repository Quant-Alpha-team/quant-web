# Quant Alpha Dashboard

**Quant Alpha Dashboard** is a Next.js-based monitoring UI for the Quant Alpha
ecosystem, focused on strategy performance, account equity tracking, and
trade-log diagnostics.

> [!IMPORTANT]
> **Node.js >= 22 is required.**

## Key Features

- Timezone-consistent query boundaries across executions, equity history, and
  strategy P&L.
- Read-only integration with the backend query API using token authentication.
- Server-side API proxy through Next.js route handlers, keeping `API_TOKEN`
  out of the browser.
- Modular React UI architecture with separate sidebar filters, section
  controls, chart renderers, tables, metric cards, and status components.
- App Router structure with dynamic API route handlers for dashboard data,
  filter metadata, and backend health checks.
- Live dashboard fetch flow using `cache: "no-store"`, backend pagination, and
  configurable per-dataset row caps.
- CLI launcher (`quant-web`) with backend API preflight check before startup.
- CSV export support for strategy performance, account equity history, and raw
  trade logs.

## Project Structure

```text
quant-web/
├── app/
│   ├── api/
│   │   ├── dashboard/
│   │   │   ├── data/route.ts      # Dashboard data proxy
│   │   │   └── filters/route.ts   # Filter metadata proxy
│   │   └── health/route.ts        # Backend health proxy
│   ├── globals.css                # Global Tailwind styles and theme tokens
│   ├── layout.tsx                 # Root Next.js layout
│   └── page.tsx                   # Dashboard page entry
├── components/
│   ├── dashboard-shell.tsx        # Main client-side dashboard orchestration
│   ├── sidebar-filters.tsx        # Sidebar filter controls
│   ├── section-control.tsx        # Dashboard section switcher
│   ├── dashboard-charts.tsx       # Recharts visualizations
│   ├── data-table.tsx             # Paginated table component
│   ├── metric-card.tsx            # KPI card component
│   ├── signal-icon.tsx            # Shared icon badge component
│   └── status-message.tsx         # Loading, info, and error messages
├── lib/
│   ├── backend-api.ts             # Backend API client and pagination layer
│   ├── dashboard.ts               # Date, KPI, formatting, and chart helpers
│   ├── logger.ts                  # Server-side dashboard logger and rotation
│   └── types.ts                   # Shared TypeScript data contracts
├── bin/
│   └── quant-web.mjs              # CLI entry point (`quant-web`)
├── .env                           # Environment variable template
├── package.json                   # npm scripts and dependencies
└── tsconfig.json
```

## Quick Start

### 1. Install

```bash
npm install
npm link
```

### 2. Configure

```bash
cp .env.example .env
```

Common settings:

- `API_BASE_URL`: backend API base URL, for example `http://127.0.0.1:8000`
- `API_TOKEN`: API token used as `Authorization: Token <key>`
- `API_AUTH_DISABLED`: skip token auth for local test backends (`true`
  disables the Authorization header)
- `API_TIMEOUT_SECONDS`: backend request timeout in seconds
- `API_PAGE_SIZE`: backend list API pagination page size
- `API_MAX_EXEC_ROWS` / `API_MAX_PERF_ROWS` / `API_MAX_PNL_ROWS`: per-dataset
  fetch caps (set `0` to disable a cap)
- `API_PREFLIGHT_STRICT`: whether startup should fail when the backend API is
  unavailable (`false` by default)
- `LOG_DIR`: directory for dashboard log files (`log` by default)
- `LOG_FILE`: active dashboard log filename (`dashboard.log` by default)
- `LOG_LEVEL`: minimum log level (`DEBUG`, `INFO`, `WARNING`, or `ERROR`)
- `LOG_RETENTION_DAYS`: number of days to retain rotated `dashboard.log.YYYY-MM-DD`
  files (`7` by default)
- `TZ`: local timezone used in log timestamps and daily log filenames, for
  example `America/New_York`

### 3. Run

```bash
# default Next.js development port 3000
quant-web

# custom port
quant-web --port 3001
```

Production mode after a build:

```bash
npm run build
quant-web start --port 3000
```

### 4. Quality Checks

```bash
npm run lint
npm run build
```

## Scripts

- `npm run dev`: start the Next.js development server
- `npm run build`: create a production build
- `npm run start`: start the production server after build
- `npm run lint`: run ESLint

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.



## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

**Version**: 0.3.1
