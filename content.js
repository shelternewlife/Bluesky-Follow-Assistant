(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const clean = value => (value || "").replace(/\s+/g, " ").trim();
  const normalize = value =>
    clean(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘ʼʹ′]/g, "'")
      .replace(/[^a-z0-9'@._-]/g, "");

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Broad selectors that survive Bluesky class-hash changes
  const controlsSelector =
    'button, [role="button"], [data-testid*="follow" i], [aria-label*="follow" i], [aria-label*="abon" i], [aria-label*="suiv" i]';
  const profileLinksSelector = 'a[href*="/profile/"]';

  function handleFromHref(href) {
    if (!href) return "";
    try {
      const url = new URL(href, location.origin);
      // Accept /profile/handle or /profile/did:plc:... (optionally with trailing slash)
      const match = url.pathname.match(/^\/profile\/([^/]+)\/?$/i);
      if (!match) return "";
      let h = decodeURIComponent(match[1]).replace(/^@/, "");
      // Prefer real handles over raw DIDs when both exist for the same account
      return h;
    } catch {
      return "";
    }
  }

  function handleFromAnchor(anchor) {
    return handleFromHref(anchor.getAttribute("href") || anchor.href || "");
  }

  function actionState(element) {
    if (!element) return "";
    const raw = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("label"),
      element.innerText,
      element.textContent
    ]
      .filter(Boolean)
      .join(" ");
    const label = normalize(raw);

    // Already following / unfollow
    if (
      /following|unfollow|abonne|abonnee|suivi|suivie|neplussuivre|ne plus suivre/.test(
        label
      )
    ) {
      return "followed";
    }
    // Pending / requested
    if (
      /requested|pending|demande|enattente|en attente|awaiting/.test(label)
    ) {
      return "requested";
    }
    // Can follow
    if (
      /follow|s'abonner|sabonner|suivre|abonner|followback|follow back/.test(
        label
      )
    ) {
      return "follow";
    }
    return "";
  }

  /**
   * Walk up from a profile link to find the smallest reasonable "card"
   * that contains the link and (ideally) a follow control.
   */
  function profileCard(anchor) {
    let node = anchor;
    let best = anchor.parentElement || anchor;

    for (let depth = 0; depth < 12 && node?.parentElement; depth++) {
      node = node.parentElement;

      // Skip absurdly large containers (whole list / screen)
      const textLen = (node.innerText || "").length;
      if (textLen > 2500) continue;

      const linksInside = node.querySelectorAll(profileLinksSelector).length;
      const controls = [...node.querySelectorAll(controlsSelector)];
      const hasAction = controls.some(c => actionState(c));

      // Prefer a node that already contains a follow/unfollow control
      if (hasAction && linksInside <= 6) {
        return node;
      }

      // A typical profile row has 1–3 profile links (avatar + name + maybe handle)
      if (linksInside > 0 && linksInside <= 4) {
        best = node;
      }

      // Stop if we reached a clear list-item boundary with multiple distinct accounts
      if (linksInside > 6) break;
    }
    return best;
  }

  function accountForAnchor(anchor) {
    const handle = handleFromAnchor(anchor);
    if (!handle) return null;

    const card = profileCard(anchor);
    if (!card) return null;

    const lines = (card.innerText || "")
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);

    const ignored = /^(follow|following|requested|unfollow|s'abonner|sabonner|abonne|abonnee|suivre|suivi|suivie|demande|en attente|follow back|followback)$/i;

    // Prefer a human display name over the handle itself
    let displayName =
      lines.find(
        line =>
          line !== handle &&
          !ignored.test(normalize(line)) &&
          !/^@?\S+\.(bsky\.social|bsky\.app)$/i.test(line) &&
          !/^did:plc:/i.test(line) &&
          line.length < 80
      ) || handle;

    // Clean leading @ if present
    if (displayName.startsWith("@")) displayName = displayName.slice(1);

    const controls = [...card.querySelectorAll(controlsSelector)];
    const states = controls.map(actionState);
    const existingState = states.find(
      v => v === "followed" || v === "requested"
    );

    // Avatar: prefer real image, fall back to any img inside the card
    const avatarImg =
      card.querySelector('img[src*="avatar"], img[data-testid*="avatar" i], img[src]') ||
      null;

    return {
      handle,
      displayName: String(displayName).slice(0, 100),
      avatar: avatarImg?.src || "",
      url: "https://bsky.app/profile/" + encodeURIComponent(handle),
      status: existingState || "new"
    };
  }

  function collectVisibleAccounts() {
    const found = new Map(); // key = lowercased handle
    const links = [...document.querySelectorAll(profileLinksSelector)];

    for (const anchor of links) {
      const account = accountForAnchor(anchor);
      if (!account) continue;

      const key = account.handle.toLowerCase();

      // Prefer a non-DID handle + a nicer display name when both exist
      const previous = found.get(key);
      const isDid = key.startsWith("did:plc:");
      const prevIsDid = previous && previous.handle.toLowerCase().startsWith("did:plc:");

      if (!previous) {
        found.set(key, account);
      } else if (prevIsDid && !isDid) {
        // replace DID entry with a real handle if we later find one (rare)
        found.delete(key);
        found.set(key, account);
      } else if (
        previous.displayName === previous.handle &&
        account.displayName !== account.handle
      ) {
        found.set(key, { ...previous, ...account });
      } else if (
        account.status !== "new" &&
        previous.status === "new"
      ) {
        // Keep the more informative status
        found.set(key, { ...previous, status: account.status });
      }
    }

    // Secondary pass: also index by non-DID handles that appear as text
    // (helps when the only link is a DID but the visible text shows @handle)
    return [...found.values()];
  }

  function findAccount(handle) {
    const target = handle.toLowerCase();
    const anchors = [...document.querySelectorAll(profileLinksSelector)];
    const anchor = anchors.find(
      a => handleFromAnchor(a).toLowerCase() === target
    );
    if (!anchor) return null;

    const card = profileCard(anchor);
    const controls = [...card.querySelectorAll(controlsSelector)];
    const control = controls.find(c => actionState(c) === "follow");
    const state =
      controls.map(actionState).find(v => v === "followed" || v === "requested") ||
      "";

    return { anchor, card, control, state };
  }

  async function autoFollowFive() {
    const candidates = collectVisibleAccounts().filter(
      a => a.status === "new"
    );
    const attempted = [];

    for (const account of candidates) {
      if (attempted.length >= 5) break;

      const match = findAccount(account.handle);
      if (!match?.control || match.control.disabled) continue;

      try {
        match.control.click();
      } catch {
        attempted.push({
          handle: account.handle,
          status: "unconfirmed"
        });
        break;
      }

      let state = "";
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await wait(350);
        state = findAccount(account.handle)?.state || "";
        if (state) break;
      }

      attempted.push({
        handle: account.handle,
        status:
          state === "followed"
            ? "followed"
            : state === "requested"
              ? "requested"
              : "unconfirmed"
      });

      // Stop the whole run if we cannot confirm the result
      if (!state) break;

      await wait(400);
    }

    return {
      ok: true,
      limit: 5,
      attempted: attempted.length,
      followed: attempted.filter(i => i.status === "followed").length,
      results: attempted
    };
  }

  function buildDiagnostics(accounts) {
    const allLinks = [...document.querySelectorAll(profileLinksSelector)];
    const hrefSamples = allLinks
      .map(a => a.getAttribute("href") || "")
      .filter(h => /profile/i.test(h))
      .slice(0, 10);

    const buttonSamples = [...document.querySelectorAll(controlsSelector)]
      .map(b => {
        const t = clean(
          b.getAttribute("aria-label") ||
            b.getAttribute("title") ||
            b.innerText ||
            ""
        );
        return t.slice(0, 60);
      })
      .filter(Boolean)
      .slice(0, 8);

    return {
      profileLinksFound: allLinks.length,
      accountsExtracted: accounts.length,
      profileHrefSamples: hrefSamples,
      buttonLabelSamples: buttonSamples,
      followerScreen: Boolean(
        document.querySelector(
          '[data-testid*="profileFollowersScreen"], [data-testid*="profileFollowsScreen"]'
        )
      ),
      followingScreen: Boolean(
        document.querySelector('[data-testid*="profileFollowsScreen"]')
      ),
      pageTitle: document.title || "",
      url: location.href
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BFA_COLLECT_VISIBLE") {
      try {
        const accounts = collectVisibleAccounts();
        sendResponse({
          ok: true,
          accounts,
          page: location.href,
          diagnostics: buildDiagnostics(accounts)
        });
      } catch (err) {
        sendResponse({
          ok: false,
          error: String(err?.message || err),
          page: location.href
        });
      }
      return false;
    }

    if (message?.type === "BFA_AUTO_FOLLOW_FIVE") {
      autoFollowFive()
        .then(sendResponse)
        .catch(err =>
          sendResponse({
            ok: false,
            error: String(err?.message || err) || "The automatic follow run failed."
          })
        );
      return true; // keep channel open for async
    }

    return false;
  });
})();
