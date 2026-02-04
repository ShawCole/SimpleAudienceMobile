# Provider Trace Capture Workflow

This folder stores raw network traces captured from the Audience Lab builder. Each JSON file corresponds to **one sniffing session** that focuses on a single top-level button (e.g., `Business`, `Housing`, `Intent`).

## Capture Steps

1. Log into the provider portal in Chrome.
2. Open DevTools → Console and paste the API sniffer script from the project brief.
3. Before clicking anything, pick a section from the [button roster](../../automation/src/catalog/button-roster.json) and note every button you expect to cover.
4. Click one button at a time inside that section. For each click the console will emit a JSON payload containing the request and response.
5. Copy every emitted JSON object and wrap it in the trace structure shown below.
6. Save the trace as `YYYY-MM-DD-<section>.json` inside this folder.

## Trace File Schema

```json
{
  "meta": {
    "sessionId": "2025-12-09-business",
    "section": "business",
    "capturedAt": "2025-12-09T21:14:05.000Z",
    "operator": "shaw",
    "environment": "prod",
    "topLevelButton": "top.business"
  },
  "events": [
    {
      "buttonKey": "business.industries",
      "buttonLabel": "Industries",
      "selectorHint": "//button[text()='Industries']",
      "notes": "Selected Insurance + Healthcare",
      "network": {
        "type": "FETCH",
        "url": "https://provider.example.com/api/industries",
        "method": "POST",
        "headers": { "content-type": "application/json" },
        "payload": { "query": "insurance" },
        "response": { "options": ["Insurance", "Healthcare"] },
        "status": 200,
        "timestamp": "2025-12-09T21:14:06.102Z"
      }
    }
  ]
}
```

- `buttonKey` **must** match an entry in `button-roster.json`.
- Include every network emission for the button, even if it does not hit the final API (e.g., autocomplete lookups).
- When no network call fires, still log the button with an empty `network` payload so we can flag it later.

## From Trace to Catalog

1. Add/commit the raw trace file.
2. Run `npm install` at the repo root if you have not already.
3. Build the catalog by running `npm run build:map --workspace automation`.
4. The script will parse every JSON file here and regenerate `automation/src/catalog/button-map.json`.
5. Commit both the new trace and the updated catalog.

## Tips

- Keep captures focused: one top-level popup per file keeps diff noise low.
- If the portal UI changes the DOM labels, update the roster entry and add notes before capturing.
- Use the `buttonKey` naming convention everywhere so remote control logs remain consistent.

