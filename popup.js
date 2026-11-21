const $ = id => document.getElementById(id);
let accounts = [];

async function load() {
  const data = await chrome.storage.local.get({ accounts: [] });
  accounts = Array.isArray(data.accounts) ? data.accounts : [];
  render();
}
async function save() {
  await chrome.storage.local.set({ accounts });
  render();
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const list = accounts.filter(a =>
    !q ||
    (a.handle || "").toLowerCase().includes(q) ||
    (a.displayName || "").toLowerCase().includes(q)
  );

  $("count").textContent = String(accounts.length);
  $("list").replaceChildren();

  if (!list.length) {
    const el = document.createElement("div");
    el.className = "empty";
    el.textContent = accounts.length ? "No match." : "No accounts collected yet.";
    $("list").append(el);
    return;
  }

  for (const a of list) {
    const row = document.createElement("div");
    row.className = "account";

    const img = document.createElement("img");
    img.className = "avatar";
    img.src = a.avatar || "";
    img.alt = "";
    img.onerror = () => { img.style.visibility = "hidden"; };

    const details = document.createElement("div");
    details.className = "details";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = a.displayName || a.handle;
    const handle = document.createElement("div");
    handle.className = "handle";
    handle.textContent = "@" + a.handle;
    details.append(name, handle);

    const state = ["followed", "requested", "unconfirmed"].includes(a.status)
      ? a.status
      : "new";
    const dot = document.createElement("i");
    dot.className = "dot " + state;
    dot.title = state;

    row.append(img, details, dot);
    $("list").append(row);
  }
}

async function getBlueskyTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://bsky.app/")) {
    $("status").textContent = "Open a Bluesky followers or following page first.";
    return null;
  }
  return tab;
}

function setStatus(msg) {
  $("status").textContent = msg;
}

async function runInPage(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args
  });
  return results?.[0]?.result;
}

function pageCollect() {
  const path = location.pathname;
  const m = path.match(/^\/profile\/([^/]+)\/(followers|follows|following)\/?$/i);
  if (!m) {
    return {
      ok: false,
      error: "Not on a followers/following page. Current path: " + path
    };
  }

  const actor = decodeURIComponent(m[1]);
  const isFollowers = m[2].toLowerCase() === "followers";
  const endpoint = isFollowers
    ? "app.bsky.graph.getFollowers"
    : "app.bsky.graph.getFollows";
  const listKey = isFollowers ? "followers" : "follows";

  return (async () => {
    try {
      const allItems = [];
      let cursor = undefined;
      const pageSize = 100;
      const hardCap = 5000;
      let pages = 0;

      while (allItems.length < hardCap) {
        let url =
          "https://public.api.bsky.app/xrpc/" +
          endpoint +
          "?actor=" +
          encodeURIComponent(actor) +
          "&limit=" +
          pageSize;
        if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) {
          if (allItems.length === 0) {
            return { ok: false, error: "API error " + res.status };
          }
          break;
        }
        const data = await res.json();
        const items = data[listKey] || [];
        pages++;
        if (!items.length) break;
        allItems.push(...items);
        cursor = data.cursor;
        if (!cursor) break;
        await new Promise(r => setTimeout(r, 120));
      }

      function norm(t) {
        return (t || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[’‘']/g, "'");
      }
      function btnState(btn) {
        const label = norm(
          (btn.getAttribute("aria-label") || "") +
            " " +
            (btn.innerText || "")
        );
        if (/(^|[^a-z])(s'abonner|sabonner|suivre|follow back|followback|\bfollow\b)([^a-z]|$)/.test(label)) return "follow";
        if (/(^|[^a-z])(requested|pending|demande|en attente|awaiting)([^a-z]|$)/.test(label)) return "requested";
        if (/(^|[^a-z])(following|unfollow|\babonne\b|abonnee|\bsuivi\b|suivie)([^a-z]|$)/.test(label)) return "followed";
        return "";
      }

      const stateMap = new Map();
      document.querySelectorAll('a[href*="/profile/"]').forEach(a => {
        try {
          const href = a.getAttribute("href") || "";
          const hm = href.match(/\/profile\/([^/]+)\/?$/i);
          if (!hm) return;
          const h = decodeURIComponent(hm[1]).toLowerCase();
          let node = a;
          for (let i = 0; i < 6 && node; i++) {
            const btns = node.querySelectorAll("button, [role='button']");
            for (const b of btns) {
              const s = btnState(b);
              if (s) {
                stateMap.set(h, s === "follow" ? "new" : s);
                return;
              }
            }
            node = node.parentElement;
          }
        } catch (_) {}
      });

      const seen = new Map();
      for (const p of allItems) {
        const handle = p.handle || p.did;
        const key = handle.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          handle,
          did: p.did || "",
          displayName: p.displayName || handle,
          avatar: p.avatar || "",
          url: "https://bsky.app/profile/" + encodeURIComponent(handle),
          status: stateMap.get(key) || stateMap.get((p.did || "").toLowerCase()) || "new"
        });
      }
      const accounts = Array.from(seen.values());

      return {
        ok: true,
        accounts,
        actor,
        source: "api",
        count: accounts.length,
        pages,
        truncated: !!cursor && allItems.length >= hardCap
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  })();
}

function pageAutoFollow(handles) {
  function norm(t) {
    return (t || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’‘']/g, "'");
  }
  function btnState(btn) {
    const label = norm(
      (btn.getAttribute("aria-label") || "") + " " + (btn.innerText || "")
    );
    if (/(^|[^a-z])(s'abonner|sabonner|suivre|follow back|followback|\bfollow\b)([^a-z]|$)/.test(label)) return "follow";
    if (/(^|[^a-z])(requested|pending|demande|en attente|awaiting)([^a-z]|$)/.test(label)) return "requested";
    if (/(^|[^a-z])(following|unfollow|\babonne\b|abonnee|\bsuivi\b|suivie)([^a-z]|$)/.test(label)) return "followed";
    return "";
  }

  function findFollowButton(handle) {
    const target = handle.toLowerCase();
    const links = document.querySelectorAll('a[href*="/profile/"]');
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const hm = href.match(/\/profile\/([^/]+)\/?$/i);
      if (!hm) continue;
      const h = decodeURIComponent(hm[1]).toLowerCase();
      if (h !== target) continue;

      let node = a;
      for (let i = 0; i < 7 && node; i++) {
        const btns = node.querySelectorAll("button, [role='button']");
        for (const b of btns) {
          if (btnState(b) === "follow" && !b.disabled) return b;
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  function currentState(handle) {
    const target = handle.toLowerCase();
    const links = document.querySelectorAll('a[href*="/profile/"]');
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const hm = href.match(/\/profile\/([^/]+)\/?$/i);
      if (!hm) continue;
      const h = decodeURIComponent(hm[1]).toLowerCase();
      if (h !== target) continue;

      let node = a;
      for (let i = 0; i < 7 && node; i++) {
        const btns = node.querySelectorAll("button, [role='button']");
        for (const b of btns) {
          const s = btnState(b);
          if (s === "followed" || s === "requested") return s;
        }
        node = node.parentElement;
      }
    }
    return "";
  }

  function scrollListDown() {
    const candidates = [
      document.querySelector('[data-testid="profileFollowersScreen"]'),
      document.querySelector('[data-testid="profileFollowsScreen"]'),
      document.querySelector('main'),
      document.scrollingElement
    ].filter(Boolean);
    for (const el of candidates) {
      try {
        el.scrollBy(0, Math.min(900, el.clientHeight || 600));
      } catch (_) {}
    }
    window.scrollBy(0, 800);
  }

  return (async () => {
    const results = [];
    const pending = handles.slice();
    let idleRounds = 0;

    while (pending.length && results.length < 100) {
      let progressed = false;

      for (let i = 0; i < pending.length; ) {
        const handle = pending[i];
        const btn = findFollowButton(handle);
        if (!btn) {
          i++;
          continue;
        }

        try {
          btn.click();
        } catch (e) {
          results.push({ handle, status: "unconfirmed" });
          pending.splice(i, 1);
          progressed = true;
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        let status = "";
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 350));
          status = currentState(handle);
          if (status === "followed" || status === "requested") break;
          if (!findFollowButton(handle)) {
            status = "followed";
            break;
          }
        }
        results.push({ handle, status: status || "unconfirmed" });
        pending.splice(i, 1);
        progressed = true;
        await new Promise(r => setTimeout(r, 450));
      }

      if (!pending.length) break;

      if (!progressed) {
        idleRounds++;
        scrollListDown();
        await new Promise(r => setTimeout(r, 900));
        if (idleRounds >= 8) {
          for (const h of pending) {
            results.push({ handle: h, status: "unconfirmed" });
          }
          pending.length = 0;
          break;
        }
      } else {
        idleRounds = 0;
      }
    }

    return {
      ok: true,
      results,
      followed: results.filter(r => r.status === "followed").length,
      remainingNotInDom: pending.length
    };
  })();
}

$("btnCollect").addEventListener("click", async () => {
  setStatus("Collecting…");
  try {
    const tab = await getBlueskyTab();
    if (!tab) return;

    const result = await runInPage(tab.id, pageCollect);

    if (!result?.ok) {
      setStatus("Failed: " + (result?.error || "unknown error"));
      return;
    }

    const map = new Map(accounts.map(a => [a.handle.toLowerCase(), a]));
    for (const a of result.accounts) {
      const prev = map.get(a.handle.toLowerCase());
      map.set(a.handle.toLowerCase(), {
        ...prev,
        ...a,
        status: a.status !== "new" ? a.status : (prev?.status || "new")
      });
    }
    accounts = [...map.values()];
    await save();

    const extra = result.truncated
      ? " (stopped at safety cap)"
      : (result.pages ? " (" + result.pages + " API page(s))" : "");
    setStatus(
      "Collected " + result.count + " account(s) via API for @" + result.actor + extra
    );
  } catch (e) {
    const msg = e.message || String(e);
    let extra = "";
    if (msg.includes("Cannot access") || msg.includes("scripting")) {
      extra = " — Reload the Bluesky tab and try again.";
    }
    setStatus("Error: " + msg + extra);
  }
});

$("btnFollow").addEventListener("click", async () => {
  const btn = $("btnFollow");
  btn.disabled = true;
  setStatus("Following up to 100 eligible accounts…");
  try {
    const tab = await getBlueskyTab();
    if (!tab) return;

    const candidates = accounts
      .filter(a => a.status === "new")
      .slice(0, 100)
      .map(a => a.handle);

    if (!candidates.length) {
      setStatus("No eligible accounts (all already followed or list empty).");
      return;
    }

    const result = await runInPage(tab.id, pageAutoFollow, [candidates]);

    if (!result?.ok) {
      setStatus("Follow failed.");
      return;
    }

    const map = new Map(accounts.map(a => [a.handle.toLowerCase(), a]));
    for (const r of result.results || []) {
      const prev = map.get(r.handle.toLowerCase()) || { handle: r.handle };
      map.set(r.handle.toLowerCase(), { ...prev, status: r.status });
    }
    accounts = [...map.values()];
    await save();

    const followed = result.followed || 0;
    const requested = (result.results || []).filter(r => r.status === "requested").length;
    const unconf = (result.results || []).filter(r => r.status === "unconfirmed").length;

    setStatus(
      followed + " followed" +
      (requested ? ", " + requested + " requested" : "") +
      (unconf ? ", " + unconf + " unconfirmed" : "") +
      "."
    );
  } catch (e) {
    setStatus("Error: " + (e.message || e));
  } finally {
    btn.disabled = false;
  }
});

$("search").addEventListener("input", render);
$("btnClear").addEventListener("click", async () => {
  if (!confirm("Clear the list?")) return;
  accounts = [];
  await save();
  setStatus("List cleared.");
});

load();
