// Background service worker: checks watched vaults every 5 minutes via
// chrome.alarms, fires a Chrome notification when APY/TVL moves past the
// thresholds, and shows an unread-alert count on the toolbar badge.
//
// MV3 note: this worker is killed and restarted constantly, so ALL state
// lives in chrome.storage.local - never in module-level variables.

import { fetchLive, vaultKey, resetBulkCaches, APY_DELTA_PP, TVL_DELTA_PCT } from "./lib.js";

const ALARM_NAME = "vault-check";
const CHECK_PERIOD_MIN = 5;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MIN, delayInMinutes: 0.1 });
});

// Recreate the alarm on browser startup too - alarms usually persist, but
// this is cheap insurance against profiles where they don't.
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MIN, delayInMinutes: 0.1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runCheck();
});

// The popup can ask for an immediate refresh after importing a watchlist.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "check-now") {
    runCheck().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
});

async function runCheck() {
  const { watchlist = [], state = {}, unread = 0 } = await chrome.storage.local.get([
    "watchlist",
    "state",
    "unread",
  ]);
  if (watchlist.length === 0) return;

  resetBulkCaches();
  const newState = {};
  let newAlerts = 0;

  for (const v of watchlist) {
    const key = vaultKey(v);
    let live;
    try {
      live = await fetchLive(v);
    } catch (err) {
      console.warn(`check failed for ${v.name}: ${err.message}`);
      if (state[key]) newState[key] = state[key]; // keep baseline through transient failures
      continue;
    }

    newState[key] = { apyPct: live.apyPct, tvlUsd: live.tvlUsd, at: Date.now() };

    const prev = state[key];
    if (!prev) continue;

    const label = `${v.name} (${v.network})`;
    const apyDelta = live.apyPct - prev.apyPct;
    const tvlDeltaPct = prev.tvlUsd ? ((live.tvlUsd - prev.tvlUsd) / prev.tvlUsd) * 100 : 0;

    if (Math.abs(apyDelta) >= APY_DELTA_PP) {
      newAlerts++;
      notify(
        `${label} APY ${apyDelta > 0 ? "up" : "down"}`,
        `${prev.apyPct.toFixed(2)}% → ${live.apyPct.toFixed(2)}% (${apyDelta > 0 ? "+" : ""}${apyDelta.toFixed(2)}pp)`
      );
    }
    if (Math.abs(tvlDeltaPct) >= TVL_DELTA_PCT) {
      newAlerts++;
      notify(
        `${label} TVL ${tvlDeltaPct > 0 ? "up" : "down"} ${Math.abs(tvlDeltaPct).toFixed(1)}%`,
        `$${Math.round(prev.tvlUsd).toLocaleString("en-US")} → $${Math.round(live.tvlUsd).toLocaleString("en-US")}`
      );
    }
  }

  const totalUnread = unread + newAlerts;
  await chrome.storage.local.set({ state: newState, unread: totalUnread, lastCheckAt: Date.now() });
  await updateBadge(totalUnread);
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 2,
  });
}

async function updateBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: "#ff5c5c" });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}
