(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const clean = value => (value || "").replace(/\s+/g, " ").trim();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const controlsSelector = 'button,[role="button"],[data-testid*="follow"]';

  function handleFromAnchor(anchor) {
    try {
      const path = new URL(anchor.href, location.origin).pathname;
      return decodeURIComponent(path.split("/")[2] || "").replace(/^@/, "");
    } catch { return ""; }
  }

  function actionState(element) {
    const label = clean([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.innerText,
      element.textContent
    ].filter(Boolean).join(" ")).toLowerCase().replace(/[^a-z]/g, "");
    if (label.includes("following") || label.includes("unfollow")) return "followed";
    if (label.includes("requested") || label.includes("pending")) return "requested";
    if (label.includes("follow")) return "follow";
    return "";
  }

  function profileCard(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 12 && node?.parentElement; depth++) {
      node = node.parentElement;
      const text = clean(node.innerText);
      if (!text || text.length > 2200) continue;
      const controls = [...node.querySelectorAll(controlsSelector)];
      if (controls.some(control => actionState(control))) return node;
    }
    return anchor.parentElement || anchor;
  }

  function findAccount(handle) {
    const anchor = [...document.querySelectorAll('a[href*="/profile/"]')]
      .find(item => handleFromAnchor(item).toLowerCase() === handle.toLowerCase());
    if (!anchor) return null;
    const card = profileCard(anchor);
    const controls = [...card.querySelectorAll(controlsSelector)];
    const control = controls.find(item => actionState(item) === "follow");
    const state = controls.map(actionState).find(value => value === "followed" || value === "requested") || "";
    return { anchor, card, control, state };
  }

  function collectVisibleAccounts() {
    const found = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/profile/"]')) {
      const handle = handleFromAnchor(anchor);
      if (!handle) continue;
      const card = profileCard(anchor);
      const lines = (card.innerText || "").split(/\n+/).map(clean).filter(Boolean);
      const ignored = /^(follow|following|requested|unfollow|s'abonner|abonné|abonner|suivi)$/i;
      const displayName = lines.find(line =>
        line !== handle && !ignored.test(line) && !/^@?\S+\.bsky\.social$/i.test(line)
      ) || handle;
      const controls = [...card.querySelectorAll(controlsSelector)];
      const existingState = controls.map(actionState).find(value =>
        value === "followed" || value === "requested"
      );
      if (!found.has(handle.toLowerCase())) {
        found.set(handle.toLowerCase(), {
          handle,
          displayName: displayName.slice(0, 100),
          avatar: card.querySelector("img[src]")?.src || "",
          url: "https://bsky.app/profile/" + encodeURIComponent(handle),
          status: existingState || "new"
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
        state = updated?.state || "";
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
