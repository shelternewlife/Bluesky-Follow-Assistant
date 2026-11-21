(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const clean = value => (value || "").replace(/\\s+/g, " ").trim();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isProfilePath = href => {
    try {
      const url = new URL(href, location.origin);
      return url.origin === location.origin && /^\\/profile\\/[^/]+\\/?$/.test(url.pathname);
    } catch { return false; }
  };

  function handleFromAnchor(anchor) {
    try {
      return decodeURIComponent(new URL(anchor.href, location.origin).pathname.split("/")[2] || "").replace(/^@/, "");
    } catch { return ""; }
  }

  function actionLabel(element) {
    return clean(
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("data-testid") ||
      element.innerText ||
      element.textContent
    ).toLowerCase().replace(/[^a-z]/g, "");
  }

  function actionState(element) {
    const label = actionLabel(element);
    if (label === "follow" || label === "followbtn") return "follow";
    if (label === "following" || label === "unfollow" || label === "followingbtn") return "followed";
    if (label === "requested" || label === "requesteds" || label === "pending") return "requested";
    return "";
  }

  function profileCard(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 12 && node?.parentElement; depth++) {
      node = node.parentElement;
      const text = clean(node.innerText);
      if (!text || text.length > 2200) continue;
      const controls = [...node.querySelectorAll('button,[role="button"]')];
      if (controls.some(control => actionState(control))) return node;
    }
    return anchor.parentElement || anchor;
  }

  function findAccount(handle) {
    const anchor = [...document.querySelectorAll('a[href*="/profile/"]')]
      .find(item => handleFromAnchor(item).toLowerCase() === handle.toLowerCase());
    if (!anchor) return null;
    const card = profileCard(anchor);
    const controls = [...card.querySelectorAll('button,[role="button"]')];
    const control = controls.find(item => actionState(item) === "follow");
    return { anchor, card, control };
  }

  function collectVisibleAccounts() {
    const found = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/profile/"]')) {
      const href = anchor.getAttribute("href");
      if (!href || !isProfilePath(href)) continue;
      const handle = handleFromAnchor(anchor);
      if (!handle) continue;
      const card = profileCard(anchor);
      const lines = (card.innerText || "").split(/\\n+/).map(clean).filter(Boolean);
      const ignored = /^(follow|following|requested|unfollow|s'abonner|abonné|abonner|suivi)$/i;
      const displayName = lines.find(line => line !== handle && !ignored.test(line) && !/^@?\\S+\\.bsky\\.social$/i.test(line)) || handle;
      if (!found.has(handle.toLowerCase())) {
        found.set(handle.toLowerCase(), {
          handle,
          displayName: displayName.slice(0, 100),
          avatar: card.querySelector("img[src]")?.src || "",
          url: "https://bsky.app/profile/" + encodeURIComponent(handle),
          status: "new"
        });
      }
    }
    return [...found.values()];
  }

  async function autoFollowFive() {
    const candidates = collectVisibleAccounts();
    const attempted = [];
    for (const account of candidates) {
      if (attempted.length >= 5) break;
      const match = findAccount(account.handle);
      if (!match?.control || match.control.disabled) continue;

      match.control.click();
      let state = "";
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await wait(400);
        const updated = findAccount(account.handle);
        const controls = updated?.card
          ? [...updated.card.querySelectorAll('button,[role="button"]')]
          : [];
        state = controls.map(actionState).find(value => value === "followed" || value === "requested") || "";
        if (state) break;
      }

      attempted.push({
        handle: account.handle,
        status: state === "followed" ? "followed" : state === "requested" ? "requested" : "unconfirmed"
      });
      if (!state) break;
      await wait(350);
    }

    return {
      ok: true,
      limit: 5,
      attempted: attempted.length,
      followed: attempted.filter(item => item.status === "followed").length,
      results: attempted
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BFA_COLLECT_VISIBLE") {
      sendResponse({ ok: true, accounts: collectVisibleAccounts(), page: location.href });
      return false;
    }
    if (message?.type === "BFA_AUTO_FOLLOW_FIVE") {
      autoFollowFive().then(sendResponse).catch(() =>
        sendResponse({ ok: false, error: "The automatic follow run failed." })
      );
      return true;
    }
    return false;
  });
})();
