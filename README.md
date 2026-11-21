# Bluesky Follow Assistant

A lightweight Chrome extension for collecting **currently visible** profile cards from a Bluesky followers page, saving them locally, reviewing them, and opening selected profiles for manual decisions.

## Features

- Collect profile links visible in the current Bluesky page section.
- Scroll the followers page and collect again to build a larger list.
- Deduplicate accounts by handle.
- Search, select, open, and remove saved accounts.
- Store data only in `chrome.storage.local` in this browser.
- No Bluesky password, app password, API token, remote server, or external database.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the folder containing `manifest.json`.
5. Open a Bluesky followers page and refresh it.
6. Open the extension, click **Collect visible accounts**, scroll the page, and repeat.

## Important behavior

The extension only collects profile cards that are present in the page DOM at the moment you click the button. Bluesky loads long lists dynamically, so scroll down in sections and collect each section. The extension does not automatically follow, like, message, or otherwise interact with accounts. It opens selected profile pages in background tabs so you can review each one and decide manually.

## Privacy

Collected account handles, display names, descriptions, and avatar URLs are saved in Chrome local extension storage. They are not sent to a server. Removing the extension or clearing its local storage may remove this data.

## Permissions

- `storage`: save the review list locally.
- Host access to `https://bsky.app/*`: read visible profile cards on Bluesky pages.

## Development

Manifest V3. No build step or external dependencies are required.