---
description: How to reliably navigate to the Audience Filters page via Direct Injection
---

To navigate to the audience filters page (READY state), follow these reliable steps:

1. **Extraction**: Extract dynamic context from the dashboard:
    - **Account ID**: From `__NEXT_DATA__` or local storage.
    - **CSRF Token**: From meta tags or cookies.
    - **Deployment ID**: From the HTML source (regex: `dpl_[a-zA-Z0-9]+`).

2. **Injection**: Execute a direct POST request to `https://build.audiencelab.io/home/bizypro` using:
    - `Next-Action`: `7f1b35a65f18ae14fda8ce71ff232cbccaba10029c` (Create Audience Action).
    - `Accept`: `text/x-component`.
    - `Next-Router-State-Tree`: URL-encoded dashboard state.
    - `x-csrf-token` and `x-deployment-id`: Values captured in step 1.

3. **Capture ID**: Parse the text response for a UUID pattern to find the newly created Audience ID.

4. **Navigate**: Perform a direct `page.goto()` to the target audience URL:
    - `https://build.audiencelab.io/home/bizypro/audience/[NEW_ID]`.

5. **Self-Healing**: Wait for 2 seconds for server-side sync. If an "Ouch!" page is detected, perform a single `page.reload()` to recover the session.
