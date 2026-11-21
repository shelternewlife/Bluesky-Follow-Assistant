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
  const visible = accounts.filter(account =>
    (account.handle || "").toLowerCase().includes(query) ||
    (account.displayName || "").toLowerCase().includes(query)
  );
  $("count").textContent = String(accounts.length);
  $("accounts").replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = accounts.length ? "No matching accounts." : "No accounts collected yet.";
    $("accounts").append(empty);
  }
  for (const account of visible) {
    const row = document.createElement("div");
    row.className = "account";
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.alt = "";
    avatar.src = account.avatar || "";
    avatar.onerror = () => { avatar.style.visibility = "hidden"; };
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
    const state = ["followed", "requested", "unconfirmed"].includes(account.status) ? account.status : "new";
    status.className = "dot " + state;
    status.title = ({followed:"Follow confirmed",requested:"Follow request sent",unconfirmed:"Follow not confirmed",new:"Not followed yet"})[state];
    status.setAttribute("aria-label", status.title);
    row.append(avatar, details, status);
    $("accounts").append(row);
  }
}
async function activeBlueskyTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://bsky.app/")) {
    $("status").textContent = "Open the Bluesky page containing the accounts first.";
    return null;
  }
  return tab;
}
$("collect").addEventListener("click", async () => {
  $("status").textContent = "Collecting visible accounts…";
  try {
    const tab = await activeBlueskyTab();
    if (!tab) return;
    const response = await chrome.tabs.sendMessage(tab.id, {type:"BFA_COLLECT_VISIBLE"});
    if (!response?.ok) throw new Error("Collection failed");
    const diagnostics = response.diagnostics || {};
    const byHandle = new Map(accounts.map(account => [account.handle.toLowerCase(), account]));
    for (const account of response.accounts) {
      const previous = byHandle.get(account.handle.toLowerCase());
      byHandle.set(account.handle.toLowerCase(), {
        ...previous, ...account,
        status: account.status !== "new" ? account.status : previous?.status || "new"
      });
    }
    accounts = [...byHandle.values()];
    await saveAccounts();
    const count = Array.isArray(response.accounts) ? response.accounts.length : 0;
    const hrefSamples = (diagnostics.profileHrefSamples || []).slice(0, 3).join(" | ");
    $("status").textContent = count
      ? "Collected " + count + " visible account(s)."
      : "0 accounts extracted. Page: " + (response.page || tab.url) +
        " · profile links found: " + (diagnostics.profileLinksFound ?? "unknown") +
        " · followers screen: " + (diagnostics.followerScreen ? "yes" : "no") +
        (hrefSamples ? " · link samples: " + hrefSamples : " · no profile href samples") +
        " · title: " + (diagnostics.pageTitle || document.title || "unknown");
  } catch (error) {
    $("status").textContent = "Collection error: " + (error?.message || String(error));
  }
});
$("autoFollow").addEventListener("click", async () => {
  const button = $("autoFollow");
  button.disabled = true;
  $("status").textContent = "Following up to five eligible visible accounts…";
  try {
    const tab = await activeBlueskyTab();
    if (!tab) return;
    const response = await chrome.tabs.sendMessage(tab.id, {type:"BFA_AUTO_FOLLOW_FIVE"});
    if (!response?.ok) throw new Error("Follow action failed");
    const byHandle = new Map(accounts.map(account => [account.handle.toLowerCase(), account]));
    for (const result of response.results) {
      const key = result.handle.toLowerCase();
      const existing = byHandle.get(key) || {handle:result.handle,displayName:result.handle};
      byHandle.set(key, {...existing,status:result.status});
    }
    accounts = [...byHandle.values()];
    await saveAccounts();
    const followed = response.followed || 0;
    const requested = response.results.filter(item => item.status === "requested").length;
    const uncertain = response.results.filter(item => item.status === "unconfirmed").length;
    $("status").textContent = followed + " follow(s) confirmed" +
      (requested ? " · " + requested + " request(s) sent" : "") +
      (uncertain ? " · stopped because one result could not be confirmed" : "") + ".";
  } catch {
    $("status").textContent = "Automatic follow did not run. Refresh Bluesky and try again.";
  } finally {
    button.disabled = false;
  }
});
$("search").addEventListener("input", render);
$("clearList").addEventListener("click", async () => {
  if (!confirm("Clear the locally saved account list?")) return;
  accounts = [];
  await saveAccounts();
  $("status").textContent = "The saved list was cleared.";
});
loadAccounts();
