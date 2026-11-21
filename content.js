(() => {
  if (window.__blueskyFollowAssistantLoaded) return;
  window.__blueskyFollowAssistantLoaded = true;

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clean = v => (v || "").replace(/\s+/g, " ").trim();

  function parseListContext() {
    const m = location.pathname.match(
      /^\/profile\/([^/]+)\/(followers|follows|following)\/?$/i
    );
    if (!m) return null;
    const actor = decodeURIComponent(m[1]);
    const kind = m[2].toLowerCase();
    const isFollowers = kind === "followers";
    return {
      actor,
      isFollowers,
      endpoint: isFollowers
        ? "app.bsky.graph.getFollowers"
        : "app.bsky.graph.getFollows",
      listKey: isFollowers ? "followers" : "follows"
    };
  }

  async function fetchAccountsFromApi(ctx, limit = 50) {
    const url =
      "https://public.api.bsky.app/xrpc/" +
      ctx.endpoint +
      "?actor=" +
      encodeURIComponent(ctx.actor) +
      "&limit=" +
      limit;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error("API " + res.status + " " + res.statusText);
    const data = await res.json();
    const items = data[ctx.listKey] || [];
    return items.map(function (p) {
      return {
        handle: p.handle || p.did,
        did: p.did || "",
        displayName: p.displayName || p.handle || p.did || "?",
        avatar: p.avatar || "",
        url:
          "https://bsky.app/profile/" +
          encodeURIComponent(p.handle || p.did),
        status: "new",
        source: "api"
      };
    });
  }

  const profileLinksSelector = 'a[href*="/profile/"]';
  const controlsSelector =
    'button, [role="button"], [data-testid*="follow" i]';

  function normalizeLabel(text) {
    return clean(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘ʼʹ′]/g, "'")
      .replace(/[^a-z0-9'@ ]/g, "");
  }

  function actionState(el) {
    if (!el) return "";
    const raw = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("data-testid"),
      el.innerText,
      el.textContent
    ]
      .filter(Boolean)
      .join(" ");
    const label = normalizeLabel(raw);

    if (
      /following|unfollow|abonne|abonnee|suivi|suivie|ne plus suivre|neplussuivre/.test(
        label
      )
    )
      return "followed";
    if (/requested|pending|demande|en attente|enattente|awaiting/.test(label))
      return "requested";
    if (
      /follow|s'abonner|sabonner|suivre|abonner|follow back|followback/.test(
        label
      )
    )
      return "follow";
    return "";
  }

  function handleFromHref(href) {
    try {
      const u = new URL(href, location.origin);
      const m = u.pathname.match(/^\/profile\/([^/]+)\/?$/i);
      return m ? decodeURIComponent(m[1]).replace(/^@/, "") : "";
    } catch (e) {
      return "";
    }
  }

  function scanDomForFollowState() {
    const map = new Map();
    const links = document.querySelectorAll(profileLinksSelector);

    for (let i = 0; i < links.length; i++) {
      const anchor = links[i];
      const h = handleFromHref(anchor.getAttribute("href") || anchor.href);
      if (!h) continue;
      const key = h.toLowerCase();

      let node = anchor;
      let control = null;
      let state = "";
      for (let d = 0; d < 8 && node; d++) {
        const buttons = node.querySelectorAll(controlsSelector);
        for (let b = 0; b < buttons.length; b++) {
          const s = actionState(buttons[b]);
          if (s) {
            state = s;
            if (s === "follow") control = buttons[b];
            break;
          }
        }
        if (state) break;
        node = node.parentElement;
      }

      if (state) {
        const prev = map.get(key);
        if (!prev || state !== "new") {
          map.set(key, { status: state, control: control || (prev && prev.control) });
        }
      }
    }
    return map;
  }

  function findFollowControlForHandle(handle) {
    const target = handle.toLowerCase();
    const links = document.querySelectorAll(profileLinksSelector);
    for (let i = 0; i < links.length; i++) {
      const anchor = links[i];
      const h = handleFromHref(anchor.getAttribute("href") || anchor.href);
      if (h.toLowerCase() !== target) continue;

      let node = anchor;
      for (let d = 0; d < 8 && node; d++) {
        const buttons = node.querySelectorAll(controlsSelector);
        for (let b = 0; b < buttons.length; b++) {
          if (actionState(buttons[b]) === "follow") return buttons[b];
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  async function collectAccounts() {
    const ctx = parseListContext();
    const diagnostics = {
      url: location.href,
      pageTitle: document.title || "",
      listContext: ctx
        ? { actor: ctx.actor, isFollowers: ctx.isFollowers }
        : null,
      profileLinksInDom: document.querySelectorAll(profileLinksSelector).length,
      apiUsed: false,
      apiError: null,
      domStatesFound: 0
    };

    let accounts = [];

    if (ctx) {
      try {
        accounts = await fetchAccountsFromApi(ctx, 50);
        diagnostics.apiUsed = true;
      } catch (err) {
        diagnostics.apiError = String(err.message || err);
      }
    }

    if (accounts.length === 0) {
      const found = new Map();
      const links = document.querySelectorAll(profileLinksSelector);
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        const h = handleFromHref(a.getAttribute("href") || a.href);
        if (!h) continue;
        const key = h.toLowerCase();
        if (found.has(key)) continue;

        let display = h;
        const parent = a.closest("div") || a.parentElement;
        if (parent) {
          const lines = (parent.innerText || "")
            .split("\n")
            .map(clean)
            .filter(Boolean);
          for (let L = 0; L < lines.length; L++) {
            const line = lines[L];
            if (
              line !== h &&
              line.length < 60 &&
              !/^@/.test(line) &&
              !/follow|abon|suiv/i.test(line)
            ) {
              display = line;
              break;
            }
          }
        }
        found.set(key, {
          handle: h,
          did: h.indexOf("did:") === 0 ? h : "",
          displayName: display,
          avatar: "",
          url: "https://bsky.app/profile/" + encodeURIComponent(h),
          status: "new",
          source: "dom"
        });
      }
      accounts = Array.from(found.values());
    }

    const domMap = scanDomForFollowState();
    diagnostics.domStatesFound = domMap.size;

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      const key = (acc.handle || "").toLowerCase();
      const didKey = (acc.did || "").toLowerCase();
      const info = domMap.get(key) || (didKey ? domMap.get(didKey) : null);
      if (info) {
        acc.status = info.status === "follow" ? "new" : info.status;
      }
    }

    return { accounts: accounts, diagnostics: diagnostics };
  }

  async function autoFollowFive() {
    const collected = await collectAccounts();
    const candidates = collected.accounts.filter(function (a) {
      return a.status === "new";
    });
    const attempted = [];

    for (let i = 0; i < candidates.length; i++) {
      if (attempted.length >= 5) break;
      const account = candidates[i];

      let control = findFollowControlForHandle(account.handle);
      if ((!control || control.disabled) && account.did && account.did !== account.handle) {
        control = findFollowControlForHandle(account.did);
      }
      if (!control || control.disabled) continue;

      try {
        control.click();
      } catch (e) {
        attempted.push({ handle: account.handle, status: "unconfirmed" });
        break;
      }

      let confirmed = "";
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline) {
        await wait(400);
        const map = scanDomForFollowState();
        const info =
          map.get(account.handle.toLowerCase()) ||
          (account.did ? map.get(account.did.toLowerCase()) : null);
        if (info && (info.status === "followed" || info.status === "requested")) {
          confirmed = info.status;
          break;
        }
        if (!findFollowControlForHandle(account.handle)) {
          confirmed = "followed";
          break;
        }
      }

      attempted.push({
        handle: account.handle,
        status: confirmed || "unconfirmed"
      });

      if (!confirmed) break;
      await wait(500);
    }

    return {
      ok: true,
      limit: 5,
      attempted: attempted.length,
      followed: attempted.filter(function (r) {
        return r.status === "followed";
      }).length,
      results: attempted
    };
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === "BFA_COLLECT_VISIBLE") {
      collectAccounts()
        .then(function (result) {
          sendResponse({
            ok: true,
            accounts: result.accounts,
            page: location.href,
            diagnostics: result.diagnostics
          });
        })
        .catch(function (err) {
          sendResponse({
            ok: false,
            error: String(err.message || err),
            page: location.href
          });
        });
      return true;
    }

    if (message && message.type === "BFA_AUTO_FOLLOW_FIVE") {
      autoFollowFive()
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({
            ok: false,
            error: String(err.message || err)
          });
        });
      return true;
    }

    return false;
  });
})();
