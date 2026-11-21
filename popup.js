const $ = id => document.getElementById(id);
let accounts = [];

async function loadAccounts() {
  const stored = await chrome.storage.local.get({ accounts: [] });
  accounts = Array.isArray(stored.accounts) ? stored.accounts : [];
  render();
}
async function saveAccounts() {
  await chrome.storage.local.set({ accounts });
  render();
}
function render() {
  const query = $("search").value.trim().toLowerCase();
  const visible = accounts.filter(
    a =>
      (a.handle || "").toLowerCase().includes(query) ||
      (a.displayName || "").toLowerCase().includes(query)
  );
  $("count").textContent = String(accounts.length);
  $("accounts").replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = accounts.length
      ? "No matching accounts."
      : "No accounts collected yet.";
    $("accounts").append(empty);
  }
  for (const account of visible) {
    const row = document.createElement("div");
    row.className = "account";
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.alt = "";
    avatar.src = account.avatar || "";
    avatar.onerror = () => {
      avatar.style.visibility = "hidden";
    };
    const details = document.createElement("div");
    details.className = "details";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = account.displayName || account.handle;
    const handle = document.createElement("div");
    handle.className = "handle";
    handle.textContent = "@" + account.handle;
    details.append(name, handle);
    const status = document.createElement("span");
    const state = ["followed", "requested", "unconfirmed"].includes(
      account.status
    )
      ? account.status
      : "new";
    status.className = "dot " + state;
    status.title = {
      followed: "Follow confirmed",
      requested: "Follow request sent",
      unconfirmed: "Follow not confirmed",
      new: "Not followed yet"
    }[state];
    status.setAttribute("aria-label", status.title);
    row.append(avatar, details, status);
    $("accounts").append(row);
  }
}

async function activeBlueskyTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://bsky.app/")) {
    $("status").textContent =
      "Open a Bluesky followers or following page first.";
    return null;
  }
  return tab;
}

$("collect").addEventListener("click", async () => {
  $("status").textContent = "Collecting accounts…";
  try {
    const tab = await activeBlueskyTab();
    if (!tab) return;

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "BFA_COLLECT_VISIBLE"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Collection failed");
    }

    const diagnostics = response.diagnostics || {};
    const byHandle = new Map(
      accounts.map(a => [a.handle.toLowerCase(), a])
    );

    for (const account of response.accounts || []) {
      const key = account.handle.toLowerCase();
      const previous = byHandle.get(key);
      byHandle.set(key, {
        ...previous,
        ...account,
        status:
          account.status !== "new"
            ? account.status
            : previous?.status || "new"
      });
    }
    accounts = [...byHandle.values()];
    await saveAccounts();

    const count = (response.accounts || []).length;
    if (count > 0) {
      $("status").textContent =
        "Collected " +
        count +
        " account(s)" +
        (diagnostics.apiUsed ? " (via Bluesky API)" : " (from page)") +
        ".";
    } else {
      $("status").textContent =
        "0 accounts. " +
        "api=" +
        (diagnostics.apiUsed ? "yes" : "no") +
        (diagnostics.apiError ? " error:" + diagnostics.apiError : "") +
        " · linksInDom=" +
        (diagnostics.profileLinksInDom ?? "?") +
        " · context=" +
        (diagnostics.listContext
          ? diagnostics.listContext.actor +
            (diagnostics.listContext.isFollowers ? "/followers" : "/follows")
          : "none") +
        " · " +
        (response.page || tab.url);
    }
  } catch (error) {
    const msg = error?.message || String(error);
    let hint = "";
    if (
      msg.includes("Could not establish connection") ||
      msg.includes("Receiving end does not exist")
    ) {
      hint =
        " → Reload the Bluesky tab (F5) after installing/updating the extension.";
    }
    $("status").textContent = "Collection error: " + msg + hint;
  }
});

$("autoFollow").addEventListener("click", async () => {
  const button = $("autoFollow");
  button.disabled = true;
  $("status").textContent = "Following up to 5 eligible accounts…";
  try {
    const tab = await activeBlueskyTab();
    if (!tab) return;

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "BFA_AUTO_FOLLOW_FIVE"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Follow action failed");
    }

    const byHandle = new Map(
      accounts.map(a => [a.handle.toLowerCase(), a])
    );
    for (const result of response.results || []) {
      const key = result.handle.toLowerCase();
      const existing = byHandle.get(key) || {
        handle: result.handle,
        displayName: result.handle
      };
      byHandle.set(key, { ...existing, status: result.status });
    }
    accounts = [...byHandle.values()];
    await saveAccounts();

    const followed = response.followed || 0;
    const requested = (response.results || []).filter(
      r => r.status === "requested"
    ).length;
    const uncertain = (response.results || []).filter(
      r => r.status === "unconfirmed"
    ).length;

    $("status").textContent =
      followed +
      " follow(s) confirmed" +
      (requested ? " · " + requested + " request(s) sent" : "") +
      (uncertain
        ? " · stopped (one result could not be confirmed)"
        : "") +
      ".";
  } catch (error) {
    $("status").textContent =
      "Automatic follow failed. Reload the Bluesky page and try again. (" +
      (error?.message || error) +
      ")";
  } finally {
    button.disabled = false;
  }
});

$("search").addEventListener("input", render);
$("clearList").addEventListener("click", async () => {
  if (!confirm("Clear the locally saved account list?")) return;
  accounts = [];
  await saveAccounts();
  $("status").textContent = "List cleared.";
});

loadAccounts();
