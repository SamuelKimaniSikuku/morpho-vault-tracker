import { exportWatchlist, watchlistToHash } from "../src/transfer";
import { fixedRateType, vaultLink } from "../src/sources";
import { maturityDate } from "../src/midnight";
import { dataStatus, DEFAULT_SETTINGS, marketSizeLabel, savedWatchlist, validSettings, vaultKey, type Reading, type WatchedVault } from "./model";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const themeButton = el<HTMLButtonElement>("theme"), refresh = el<HTMLButtonElement>("refresh");
let theme: "light" | "dark" = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
let refreshing = false, rendering = 0;
function applyTheme(value: "light" | "dark") {
  theme = value; document.documentElement.dataset.theme = value;
  themeButton.textContent = value === "light" ? "Dark mode" : "Light mode";
}
applyTheme(theme);
function status(message: string) { el("status").textContent = message; el("status").hidden = false; }
async function send(type: string, args: Record<string, unknown> = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...args });
  if (!response?.ok) throw new Error(response?.error ?? "The extension did not respond. Try again.");
  return response.result;
}
function handleError(error: unknown) { status(error instanceof Error ? error.message : "That action could not finish. Try again."); }
function node(tag: string, className: string, text?: string) {
  const value = document.createElement(tag); value.className = className;
  if (text != null) value.textContent = text; return value;
}
function money(n: number | null | undefined) {
  return n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n);
}
const names: Record<string, string> = { morpho: "Morpho", yearn: "Yearn", beefy: "Beefy", aave: "Aave", compound: "Compound", defi: "DeFiLlama", pendle: "Pendle", spectra: "Spectra" };
const labels = { updated: "Updated", stale: "Old data · refresh unavailable", unavailable: "Some data unavailable", loading: "Waiting for first check", "no-offers": "No active lending offers", "no-quote": "No current rate quote", matured: "Matured", unlisted: "No longer listed" };

function marketRow(v: WatchedVault, reading?: Reading) {
  const li = node("li", ""), row = node("div", "row"), info = node("div", "vault-info");
  const destination = vaultLink(v), name = node(destination ? "a" : "span", "vault-name", v.name);
  if (destination) { const a = name as HTMLAnchorElement; a.href = destination.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = destination.label; }
  info.append(name);
  const meta = node("div", "meta"); meta.append(node("span", "tag", names[v.protocol]), node("span", "", v.network));
  if (v.fixedTerm) meta.append(node("span", "fixed", "Fixed asset"));
  info.append(meta);
  if (v.fixedTerm) info.append(node("div", "checked", `Maturity: ${maturityDate(v.fixedTerm.maturity)}`));
  const state = dataStatus(reading), live = reading?.live;
  const hideQuote = ["matured", "unlisted", "no-offers", "no-quote"].includes(state);
  const stats = node("div", "stats");
  stats.append(node("div", "rate", !hideQuote && live?.netApyPct != null ? `${live.netApyPct.toFixed(2)}%` : "—"));
  stats.append(node("div", "rate-kind", live?.rateType ?? (v.fixedTerm ? fixedRateType(v) : "Yearly rate")));
  const size = node("div", "size", `${marketSizeLabel(v)}: ${hideQuote ? "—" : money(live?.tvlUsd)}`); stats.append(size);
  const remove = node("button", "remove", "×") as HTMLButtonElement; remove.type = "button";
  remove.title = `Remove ${v.name}`; remove.setAttribute("aria-label", remove.title);
  remove.addEventListener("click", () => {
    remove.disabled = true;
    void send("remove-vault", { key: vaultKey(v) }).then(() => status(`${v.name} removed from the extension.`)).catch(handleError).finally(() => { remove.disabled = false; });
  });
  row.append(info, stats, remove); li.append(row);
  const checked = node("div", state === "updated" ? "checked" : "checked state", labels[state]);
  if (live) {
    const date = new Date(live.fetchedAt);
    const when = date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    checked.append(document.createTextNode(` · Last data ${when}`));
  }
  li.append(checked); return li;
}
async function render() {
  const sequence = ++rendering;
  const stored = await chrome.storage.local.get(null);
  if (sequence !== rendering) return;
  const list = savedWatchlist(stored.watchlist), readings = stored.readings ?? {};
  el("count").textContent = String(list.length); el("empty").hidden = list.length > 0;
  if (!list.length) el<HTMLDetailsElement>("transfer").open = true;
  const content = document.createDocumentFragment();
  for (const v of list) content.append(marketRow(v, readings[vaultKey(v)]));
  el("list").replaceChildren(content);
  el("last-check").textContent = stored.lastCheckAt ? `Last attempt ${new Date(stored.lastCheckAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No checks yet";
  const warning = stored.checkError ?? stored.notificationError;
  el("warning").hidden = !warning; el("warning").textContent = warning ?? "";
}
async function refreshNow() {
  if (refreshing) return;
  refreshing = true; refresh.disabled = true; refresh.textContent = "Checking…";
  try {
    const result = await send("check-now");
    status(result.failed ? `Checked ${result.total} markets. ${result.failed} could not refresh; old data is marked below.` : `Checked ${result.total} markets. Unavailable quotes are marked below.`);
    await render();
  } catch (error) { handleError(error); }
  finally { refreshing = false; refresh.disabled = false; refresh.textContent = "Refresh"; }
}
async function importText(text: string) {
  const result = await send("import-watchlist", { text });
  status(`${result.added} added · ${result.skippedDuplicates} already watched · ${result.skippedInvalid} invalid entries skipped.`);
  await render();
  void send("check-now").then(render).catch(handleError);
}
themeButton.addEventListener("click", () => {
  const next = theme === "light" ? "dark" : "light";
  applyTheme(next); void send("set-theme", { theme: next }).catch(handleError);
});
refresh.addEventListener("click", () => { void refreshNow(); });
el("import").addEventListener("click", () => el<HTMLInputElement>("import-file").click());
el("import-file").addEventListener("change", async () => {
  const input = el<HTMLInputElement>("import-file"), file = input.files?.[0]; input.value = "";
  if (!file) return;
  if (file.size > 1_048_576) { status("Choose a backup smaller than 1 MB."); return; }
  try { await importText(await file.text()); } catch (error) { handleError(error); }
});
el("link-form").addEventListener("submit", event => {
  event.preventDefault(); void importText(el<HTMLTextAreaElement>("backup-link").value).catch(handleError);
});
el("export").addEventListener("click", () => {
  void chrome.storage.local.get("watchlist").then(({ watchlist }) => { exportWatchlist(savedWatchlist(watchlist)); status("Watchlist exported."); }).catch(handleError);
});
el("copy").addEventListener("click", async () => {
  try {
    const { watchlist } = await chrome.storage.local.get("watchlist");
    const link = `https://vaultwatch.xyz/${watchlistToHash(savedWatchlist(watchlist))}`;
    const field = el<HTMLTextAreaElement>("backup-link"); field.value = link;
    try { await navigator.clipboard.writeText(link); status("Backup link copied. It contains your selected markets; share it only if you want to share your list."); }
    catch { field.focus(); field.select(); status("Copy the selected backup link below."); }
  } catch (error) { handleError(error); }
});
el("settings").addEventListener("submit", event => {
  event.preventDefault();
  const settings = { enabled: el<HTMLInputElement>("alerts-enabled").checked, ratePp: Number(el<HTMLInputElement>("rate-threshold").value), sizePct: Number(el<HTMLInputElement>("size-threshold").value), direction: el<HTMLSelectElement>("direction").value };
  void send("save-settings", { settings }).then(() => status("Alert settings saved for this extension.")).catch(handleError);
});
el("test").addEventListener("click", () => {
  void send("test-notification").then(() => status("Test sent to Chrome. If it doesn't appear, check your device's notification and Focus settings.")).catch(handleError);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["watchlist", "readings", "lastCheckAt", "notificationError", "checkError"].some(key => key in changes)) void render().catch(handleError);
});
async function start() {
  const stored = await chrome.storage.local.get(["theme", "settings"]);
  if (stored.theme === "light" || stored.theme === "dark") applyTheme(stored.theme);
  const settings = validSettings(stored.settings) ? stored.settings : DEFAULT_SETTINGS;
  el<HTMLInputElement>("alerts-enabled").checked = settings.enabled;
  el<HTMLInputElement>("rate-threshold").value = String(settings.ratePp);
  el<HTMLInputElement>("size-threshold").value = String(settings.sizePct);
  el<HTMLSelectElement>("direction").value = settings.direction;
  await render(); await send("mark-read");
}
void start().catch(handleError);
// Re-evaluate freshness while the popup stays open; does not fetch market data.
setInterval(() => { void render().catch(handleError); }, 30_000);
