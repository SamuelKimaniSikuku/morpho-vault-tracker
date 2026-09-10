import { createController } from "./controller";

const ALARM = "vault-check";
const controller = createController({
  get: () => chrome.storage.local.get(null),
  set: data => chrome.storage.local.set(data),
  notify: async notice => {
    if (await chrome.notifications.getPermissionLevel() !== "granted") throw new Error("Notifications are blocked. Enable them in Chrome and your device settings.");
    await chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", ...notice });
  },
  badge: async count => {
    await chrome.action.setBadgeBackgroundColor({ color: "#255be3" });
    await chrome.action.setBadgeText({ text: count > 0 ? count > 99 ? "99+" : String(count) : "" });
  },
});

async function ensureAlarm() {
  if ((await chrome.alarms.get(ALARM))?.periodInMinutes !== 5) {
    await chrome.alarms.create(ALARM, { periodInMinutes: 5, delayInMinutes: 0.5 });
  }
}
async function handle(message: unknown) {
  // A bulk market feed can involve several paginated requests. Keep only this
  // operation alive, using Chrome's documented long-operation pattern.
  const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => {}); }, 25_000);
  try { await ensureAlarm(); return await controller.dispatch(message); }
  finally { clearInterval(keepAlive); }
}
function reportError(error: unknown) {
  console.warn("Vault Watch:", error);
  void chrome.storage.local.set({ checkError: "The check could not finish. Try Refresh." });
}

// Register synchronously on every worker start; persisted storage owns data.
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm().catch(reportError); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().catch(reportError); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void handle({ type: "check-now" }).catch(reportError);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  void handle(message).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error instanceof Error ? error.message : "The action could not finish. Try again." }));
  return true;
});
void ensureAlarm().catch(reportError);
