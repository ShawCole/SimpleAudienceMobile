# Selenium Network Sniffer

Headed automation that logs every Fetch/XHR call while iterating through Audience Lab filters. The runner wraps Chrome via Selenium, injects the same browser sniffer we already use manually, and saves the resulting traces in the `docs/provider-traces/` format.

## Prerequisites

- Chrome (latest stable).
- Matching `chromedriver` (installed automatically through the `chromedriver` npm dependency).
- `AUDLAB_EMAIL` / `AUDLAB_PASSWORD` environment variables (or run with `--manual-login` to log in yourself).

Install dependencies:

```bash
cd sniffer/selenium
npm install
```

## Usage

```bash
# Capture Seniority filter inside Business tab
npm run capture -- --section business --filter business.seniority

# Capture every filter defined in config (skips virtualized lists)
npm run capture -- --all

# Fall back to manual login (the script waits for you to authenticate)
npm run capture -- --manual-login --section business --filter business.seniority
```

Options:

| Flag | Description |
| --- | --- |
| `--section <name>` | High-level section (`business`, `financial`, etc.). |
| `--filter <buttonKey>` | Specific button key from `automation/src/catalog/button-roster.json`. |
| `--all` | Iterate over all entries defined in `src/config/filters.ts`. |
| `--manual-login` | Skip automated credential entry. |
| `--output <dir>` | Where to write trace files (defaults to `docs/provider-traces`). |

Each capture writes a `YYYY-MM-DDTHH-mm-ss-<buttonKey>.json` file compatible with `npm run build:map --workspace automation`.

> **Selectors:** The DOM moves regularly. Update `src/config/selectors.ts` and each filter runner in `src/config/filters.ts` if the UI changes or if you need to support more filters.
