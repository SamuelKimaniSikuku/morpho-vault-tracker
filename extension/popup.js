import { vaultKey, isValidVault } from "./lib.js";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const lastCheckEl = document.getElementById("last-check");
const importFileEl = document.getElementById("import-file");

// Opening the popup marks alerts as read.
chrome.storage.local.set({ unread: 0 });
chrome.action.setBadgeText({ text: "" });

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.hidden = false;
  setTimeout(() => (statusEl.hidden = true), 6000);
}

function fmtTvl(tvlUsd) {
  if (tvlUsd >= 1e9) return `$${(tvlUsd / 1e9).toFixed(2)}B`;
  if (tvlUsd >= 1e6) return `$${(tvlUsd / 1e6).toFixed(1)}M`;
  return `$${Math.round(tvlUsd).toLocaleString("en-US")}`;
}

async function render() {
  const { watchlist = [], state = {}, lastCheckAt } = await chrome.storage.local.get([
    "watchlist",
    "state",
    "lastCheckAt",
  ]);

  emptyEl.hidden = watchlist.length > 0;
  listEl.innerHTML = "";

  for (const v of watchlist) {
    const key = vaultKey(v);
    const s = state[key];

    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "vault-info";
    const name = document.createElement("div");
    name.className = "vault-name";
    name.textContent = v.name;
    name.title = v.name;
    const meta = document.createElement("div");
    meta.className = "vault-meta";
    meta.textContent = `${v.protocol} · ${v.network}`;
    info.append(name, meta);

    const stats = document.createElement("div");
    stats.className = "vault-stats";
    const apy = document.createElement("div");
    apy.className = "vault-apy";
    apy.textContent = s ? `${s.apyPct.toFixed(2)}%` : "…";
    const tvl = document.createElement("div");
    tvl.className = "vault-tvl";
    tvl.textContent = s ? fmtTvl(s.tvlUsd) : "awaiting first check";
    stats.append(apy, tvl);

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove";
    remove.addEventListener("click", async () => {
      const next = watchlist.filter((w) => vaultKey(w) !== key);
      await chrome.storage.local.set({ watchlist: next });
      render();
    });

    li.append(info, stats, remove);
    listEl.appendChild(li);
  }

  lastCheckEl.textContent = lastCheckAt
    ? `checked ${new Date(lastCheckAt).toLocaleTimeString()}`
    : "";
}

document.getElementById("refresh").addEventListener("click", async () => {
  showStatus("Checking…");
  await chrome.runtime.sendMessage({ type: "check-now" }).catch(() => {});
  render();
});

document.getElementById("import").addEventListener("click", () => importFileEl.click());

importFileEl.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  importFileEl.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.app !== "vaultwatch" || !Array.isArray(parsed.vaults)) {
      throw new Error("Not a Vault Watch export file.");
    }
    const { watchlist = [] } = await chrome.storage.local.get("watchlist");
    const keys = new Set(watchlist.map(vaultKey));
    let added = 0;
    for (const raw of parsed.vaults) {
      if (!isValidVault(raw)) continue;
      const key = vaultKey(raw);
      if (keys.has(key)) continue;
      keys.add(key);
      watchlist.push(raw);
      added++;
    }
    await chrome.storage.local.set({ watchlist });
    showStatus(`Imported ${added} vault${added === 1 ? "" : "s"}.`);
    await chrome.runtime.sendMessage({ type: "check-now" }).catch(() => {});
    render();
  } catch (err) {
    showStatus(`Import failed: ${err.message}`);
  }
});

document.getElementById("export").addEventListener("click", async () => {
  const { watchlist = [] } = await chrome.storage.local.get("watchlist");
  const payload = {
    app: "vaultwatch",
    version: 1,
    exportedAt: new Date().toISOString(),
    vaults: watchlist,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaultwatch-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

render();
