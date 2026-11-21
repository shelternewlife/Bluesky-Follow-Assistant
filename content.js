(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const isProfilePath = (url) => {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.origin === location.origin && /^\/profile\/[^/]+\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  };

  function collectVisibleAccounts() {
    const found = new Map();
    const anchors = [...document.querySelectorAll('a[href*="/profile/"]')];

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href || !isProfilePath(href)) continue;

      const url = new URL(href, location.origin);
      const handle = decodeURIComponent(url.pathname.split("/")[2] || "").replace(/^@/, "");
      if (!handle || handle.includes("?") || handle.includes("#")) continue;

      let card = anchor;
      for (let level = 0; level < 7 && card.parentElement; level++) {
        const parent = card.parentElement;
        const text = clean(parent.innerText);
        card = parent;
        if (text.length > 0 && text.length < 1800 && /(follow|s'abonner|abonner|following|suivi)/i.test(text)) break;
      }

      const lines = (card.innerText || "").split(/\n+/).map(clean).filter(Boolean);
      const displayName = lines.find(line =>
        line !== handle &&
        !/^(@?\S+\.bsky\.social)$/i.test(line) &&
        !/^(follow|s'abonner|abonner|following|suivi)$/i.test(line)
      ) || handle;
      const avatar = card.querySelector('img[src]')?.src || anchor.querySelector('img[src]')?.src || "";
      const description = lines
        .filter(line => line !== displayName && line !== handle && !/^(follow|s'abonner|abonner|following|suivi)$/i.test(line))
        .slice(0, 2)
        .join(" · ");

      if (!found.has(handle)) {
        found.set(handle, {
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BFA_COLLECT_VISIBLE") {
      sendResponse({
        ok: true,
        accounts: collectVisibleAccounts(),
        page: location.href
      });
    }
    return true;
  });
})();