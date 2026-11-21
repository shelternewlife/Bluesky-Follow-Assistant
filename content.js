(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const clean = value => (value || "").replace(/\s+/g, " ").trim();
  const normalize = value => clean(value).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'").replace(/[^a-z']/g, "");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const controlsSelector = 'button,[role="button"],[data-testid*="follow" i]';
  const profileLinksSelector = 'a[href*="/profile/"]';

  function handleFromAnchor(anchor) {
    try {
      const url = new URL(anchor.getAttribute("href") || anchor.href, location.origin);
      const match = url.pathname.match(/^\/profile\/([^/]+)(?:\/)?$/i);
      return match ? decodeURIComponent(match[1]).replace(/^@/, "") : "";
    } catch { return ""; }
  }

  function actionState(element) {
    const label = normalize([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.innerText,
      element.textContent
    ].filter(Boolean).join(" "));
    if (/following|unfollow|abonne|abonne[e]?|suivi|suivie/.test(label)) return "followed";
    if (/requested|pending|demande|enattente/.test(label)) return "requested";
    if (/follow|s'abonner|sabonner|suivre|abonner/.test(label)) return "follow";
    return "";
  }

  function profileCard(anchor) {
    let node = anchor;
    let best = anchor.parentElement || anchor;
    for (let depth = 0; depth < 10 && node?.parentElement; depth++) {
      node = node.parentElement;
      const text = clean(node.innerText);
      if (!text || text.length > 1800) continue;
      best = node;
      const controls = [...node.querySelectorAll(controlsSelector)];
      if (controls.some(control => actionState(control))) return node;
      // A profile row normally contains its profile link and one compact action control.
      if (node.querySelectorAll(profileLinksSelector).length > 1) break;
    }
    return best;
  }

  function accountForAnchor(anchor) {
    const handle = handleFromAnchor(anchor);
    if (!handle) return null;
    const card = profileCard(anchor);
    const lines = (card.innerText || "").split(/\n+/).map(clean).filter(Boolean);
    const ignored = /^(follow|following|requested|unfollow|s'abonner|sabonner|abonne[e]?|suivre|suivi[e]?|demande)$/i;
    const displayName = lines.find(line =>
      line !== handle && !ignored.test(normalize(line)) &&
      !/^@?\S+\.bsky\.social$/i.test(line)
    ) || handle;
    const controls = [...card.querySelectorAll(controlsSelector)];
    const states = controls.map(actionState);
    const existingState = states.find(value =>
      value === "followed" || value === "requested"
    );
    return {
      handle,
      displayName: displayName.slice(0, 100),
      avatar: card.querySelector("img[src]")?.src || "",
      url: "https://bsky.app/profile/" + encodeURIComponent(handle),
      status: existingState || "new"
    };
  }

  function collectVisibleAccounts() {
    const found = new Map();
    const links = [...document.querySelectorAll(profileLinksSelector)];
    for (const anchor of links) {
      const account = accountForAnchor(anchor);
      if (!account) continue;
      const key = account.handle.toLowerCase();
      const previous = found.get(key);
      if (!previous || (previous.displayName === previous.handle && account.displayName !== account.handle)) {
        found.set(key, account);
      }
    }
    return [...found.values()];
  }

  function findAccount(handle) {
    const anchor = [...document.querySelectorAll(profileLinksSelector)]
      .find(item => handleFromAnchor(item).toLowerCase() === handle.toLowerCase());
    if (!anchor) return null;
    const card = profileCard(anchor);
    const controls = [...card.querySelectorAll(controlsSelector)];
    const control = controls.find(item => actionState(item) === "follow");
    const state = controls.map(actionState).find(value =>
      value === "followed" || value === "requested"
    ) || "";
    return { anchor, card, control, state };
  }

  async function autoFollowFive() {
    const candidates = collectVisibleAccounts().filter(account => account.status === "new");
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
        state = findAccount(account.handle)?.state || "";
        if (state) break;
      }
      attempted.push({
        handle: account.handle,
        status: state === "followed" ? "followed" :
          state === "requested" ? "requested" : "unconfirmed"
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
      const accounts = collectVisibleAccounts();
      sendResponse({
        ok: true,
        accounts,
        page: location.href,
        diagnostics: {
          profileLinksFound: document.querySelectorAll(profileLinksSelector).length,
          profileHrefSamples: [...document.querySelectorAll('a[href]')]
            .map(anchor => anchor.getAttribute("href") || "")
            .filter(href => href.toLowerCase().includes("profile"))
            .slice(0, 8),
          followerScreen: Boolean(document.querySelector('[data-testid*="profileFollowersScreen"]')),
          followingScreen: Boolean(document.querySelector('[data-testid*="profileFollowsScreen"]')),
          pageTitle: document.title
        }
      });
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
