const $ = (id) => document.getElementById(id);
let accounts = [];
const selected = new Set();

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
    account.handle.toLowerCase().includes(query) ||
    (account.displayName || "").toLowerCase().includes(query) ||
    (account.description || "").toLowerCase().includes(query)
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

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(account.handle);
    checkbox.setAttribute("aria-label", `Select ${account.handle}`);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? selected.add(account.handle) : selected.delete(account.handle);
      updateButtons();
    });

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

    const open = document.createElement("button");
    open.className = "open-one";
    open.textContent = "Open";
    open.addEventListener("click", () => chrome.tabs.create({ url: account.url }));

    row.append(checkbox, avatar, details, open);
    $("accounts").append(row);
  }
  updateButtons();
}

function updateButtons() {
  const hasSelection = selected.size > 0;
  $("openSelected").disabled = !hasSelection;
  $("deleteSelected").disabled = !hasSelection;
}

$("collect").addEventListener("click", async () => {
  $("status").textContent = "Reading visible profile cards…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://bsky.app/")) {
      $("status").textContent = "Open a Bluesky followers page first.";
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "BFA_COLLECT_VISIBLE" });
    if (!response?.ok) throw new Error("The page did not return account data.");
    const known = new Set(accounts.map(account => account.handle.toLowerCase()));
    const fresh = response.accounts.filter(account => !known.has(account.handle.toLowerCase()));
    accounts = [...accounts, ...fresh];
    await saveAccounts();
    $("status").textContent = fresh.length
      ? `Added ${fresh.length} new account(s). ${response.accounts.length - fresh.length} duplicate(s) skipped.`
      : `No new accounts found in this visible section (${response.accounts.length} detected).`;
  } catch (error) {
    $("status").textContent = "Could not read this page. Refresh Bluesky and try again.";
  }
});

$("search").addEventListener("input", render);
$("selectVisible").addEventListener("click", () => {
  const query = $("search").value.trim().toLowerCase();
  accounts.filter(account =>
    account.handle.toLowerCase().includes(query) ||
    (account.displayName || "").toLowerCase().includes(query) ||
    (account.description || "").toLowerCase().includes(query)
  ).forEach(account => selected.add(account.handle));
  render();
});
$("clearSelection").addEventListener("click", () => { selected.clear(); render(); });
$("openSelected").addEventListener("click", async () => {
  const chosen = accounts.filter(account => selected.has(account.handle));
  for (const account of chosen) await chrome.tabs.create({ url: account.url, active: false });
  $("status").textContent = `Opened ${chosen.length} profile tab(s). Review and follow manually.`;
});
$("deleteSelected").addEventListener("click", async () => {
  accounts = accounts.filter(account => !selected.has(account.handle));
  selected.clear();
  await saveAccounts();
  $("status").textContent = "Selected accounts removed from local storage.";
});

loadAccounts();