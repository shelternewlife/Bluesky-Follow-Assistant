(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const clean = value => (value || "").replace(/\s+/g, " ").trim();
  const isProfilePath = url => {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.origin === location.origin && /^\/profile\/[^/]+\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const buttonLabel = button => clean(button?.innerText || button?.getAttribute("aria-label") || button?.textContent).toLowerCase();

  function findCard(anchor) {
    let node = anchor;
    for (let level = 0; level < 9 && node.parentElement; level++) {
      node = node.parentElement;
      const text = clean(node.innerText);
      const buttons = [...node.querySelectorAll("button")];
      if (buttons.length && text.length > 0 && text.length < 1800) return node;
    }
    return anchor.parentElement || anchor;
  }

  function collectVisibleAccounts() {
    const found = new Map();
    const anchors = [...document.querySelectorAll('a[href*="/profile/"]')];
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href || !isProfilePath(href)) continue;
      const url = new URL(href, location.origin);
      let handle;
      try { handle = decodeURIComponent(url.pathname.split("/")[2] || "").replace(/^@/, ""); }
      catch { continue; }
      if (!handle || handle.includes("?") || handle.includes("#")) continue;

      const card = findCard(anchor);
      const lines = (card.innerText || "").split(/\n+/).map(clean).filter(Boolean);
      const displayName = lines.find(line =>
        line !== handle &&
        !/^(@?\S+\.bsky\.social)$/i.test(line) &&
        !/^(follow|following|requested|unfollow|s'abonner|abonné|abonner|suivi)$/i.test(line)
      ) || handle;
      const avatar = card.querySelector("img[src]")?.src || "";
      const description = lines
        .filter(line => line !== displayName && line !== handle &&
          !/^(follow|following|requested|unfollow|s'abonner|abonné|abonner|suivi)$/i.test(line))
        .slice(0, 2).join(" · ");

      if (!found.has(handle.toLowerCase())) {
        found.set(handle.toLowerCase(), {
          handle,
          displayName: displayName.slice(0, 100),
          description: description.slice(0, 240),
          avatar,
          url: "https://bsky.app/profile/" + encodeURIComponent(handle)
        });
      }
    }
    return [...found.values()];
  }

  function findFollowButton(card) {
    return [...card.querySelectorAll("button")].find(button =>
      !button.disabled && buttonLabel(button) === "follow"
    ) || null;
  }

  async function autoFollowVisible() {
    const results = [];
    const seen = new Set();
    const anchors = [...document.querySelectorAll('a[href*="/profile/"]')];

    for (const anchor of anchors) {
      if (results.length >= 5) break;
      const href = anchor.getAttribute("href");
      if (!href || !isProfilePath(href)) continue;

      const url = new URL(href, location.origin);
      let handle;
      try { handle = decodeURIComponent(url.pathname.split("/")[2] || "").replace(/^@/, ""); }
      catch { continue; }
      const key = handle.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const card = findCard(anchor);
      const followButton = findFollowButton(card);
      if (!followButton) continue;

      followButton.click();
      await wait(1600);

      const updatedLabels = [...card.querySelectorAll("button")].map(buttonLabel);
      const confirmed = updatedLabels.some(label =>
        label === "following" || label === "requested" || label === "unfollow"
      );

      if (confirmed) {
        results.push({ handle, status: "followed" });
      } else {
        results.push({ handle, status: "unconfirmed" });
        break;
      }
      await wait(500);
    }

    return {
      ok: true,
      limit: 5,
      followed: results.filter(item => item.status === "followed").length,
      results,
      message: results.length
        ? "Processed up to five visible accounts."
        : "No eligible, not-yet-followed accounts with a visible Follow button were found."
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BFA_COLLECT_VISIBLE") {
      sendResponse({ ok: true, accounts: collectVisibleAccounts(), page: location.href });
      return false;
    }
    if (message?.type === "BFA_AUTO_FOLLOW_FIVE") {
      autoFollowVisible()
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "The follow run could not be completed." }));
      return true;
    }
    return false;
  });
})();
