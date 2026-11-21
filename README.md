# Bluesky Follow Assistant (v3.0.0)

Chrome extension (Manifest V3) that collects accounts from a Bluesky followers or following page and can automatically follow up to 5 of them per run.

## How it works

1. Open a page like `https://bsky.app/profile/SOMEONE/followers` (or `/follows`).
2. Click the extension icon → **Collect accounts**.
3. The extension reads the actor from the URL and fetches the list from Bluesky's public API (`public.api.bsky.app`). This is reliable and does not depend on fragile CSS selectors.
4. Follow status of currently visible buttons is also read from the page (supports French and English).
5. Click **Start automatic follow (up to 5)** to click the Follow / S’abonner buttons of up to 5 accounts that are not yet followed. No new tabs are opened.

## Install

1. Open `chrome://extensions`
2. Enable Developer mode
3. **Remove any old version** of this extension
4. Load unpacked → select this folder
5. Open a Bluesky followers page and **reload the page (F5)**
6. Open the popup and click **Collect accounts**

## Limits

- Maximum 5 automatic follows per button press
- Only works on the currently open Bluesky tab
- Does not open profile pages or new tabs
- Collection uses the public API (no login required for the list)
- Auto-follow clicks the real buttons on the page (requires you to be logged in)
