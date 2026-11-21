# Bluesky Follow Assistant

Chrome Manifest V3 extension that collects visible Bluesky profile cards and can follow up to five eligible accounts per button-initiated run.

## Use

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Reload** for this extension (or remove the old unpacked copy and load the updated repository folder).
4. Refresh the Bluesky page containing the profile list.
5. Open the extension popup.
6. Click **Collect visible accounts** to display the visible profiles.
7. Click **Start automatic follow (up to 5)** to follow eligible profiles in the current page DOM.

The popup does not open profile tabs and has no manual per-profile follow controls. A green dot means the page changed to a recognized Following/Unfollow state. Amber means Bluesky displayed a pending follow request. Red means the extension could not confirm the action. Gray means no follow was confirmed for that account.

## Limits and behavior

- At most five follow clicks per run.
- Only visible profile cards with an enabled Follow control are eligible.
- Existing follows and pending requests are skipped.
- If a click cannot be confirmed within ten seconds, the run stops.
- The action starts only when the user presses the automatic-follow button.
- Scroll the Bluesky list to load more accounts, then collect or run again.
- The extension does not bypass challenges or platform controls.

## Privacy and permissions

Collected account details are stored in `chrome.storage.local` on this browser. The extension requests `storage` and `tabs` permissions and access to `https://bsky.app/*`. It does not request Bluesky credentials or send the collected list to a server.
