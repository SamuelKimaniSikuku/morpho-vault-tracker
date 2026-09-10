# Vault Watch Chrome extension 1.1.0

This package updates the existing [Vault Watch listing](https://chromewebstore.google.com/detail/vault-watch/ihpmmgimhbeakjpodpkdpohmgcejhnbc), extension ID `ihpmmgimhbeakjpodpkdpohmgcejhnbc`. The store was serving 1.0.0 when checked on 10 September 2026. Upload this as a new package on that same item to retain its identity and installed users.

## What changed

- The extension now builds from the website's market-provider and import code, including Morpho Midnight, Pendle, Spectra, and other DeFiLlama pools.
- Missing rates remain unavailable. Real zero and negative rates are preserved. APR, APY, reported rates, and fixed quotes retain their own labels.
- Failed refreshes preserve the actual reading time and show old data. Matured and unlisted fixed markets no longer show an active quote.
- Alerts compare consecutive fresh readings of the same rate type. Missing data, cached responses, source failures, and long browser sleep do not create false change alerts. Recovery starts a new baseline.
- Alert thresholds, direction, and an off switch are saved locally. A test button checks Chrome notification delivery.
- Refreshes are coalesced; imports, removals, and settings changes are serialized to avoid lost edits. Checkpoints survive worker restarts. The 1.0.0 watchlist is retained, while unvalidated old readings are replaced with a fresh baseline.
- The popup has light/dark modes, clear network and fixed-asset tags, backup-link import, file import/export, and per-market data status.
- No account, content script, wallet connection, browsing-history permission, or automatic website sync was added.

## Build and install for testing

From the project root, with dependencies installed and Python 3 available:

```sh
npm run build:extension
```

This type-checks the extension, builds `dist-extension/`, validates required files, and creates `vaultwatch-extension-1.1.0.zip`. The ZIP includes all required compiled scripts, styles, icons, manifest, and privacy text. It is not a source-code ZIP.

1. Extract `vaultwatch-extension-1.1.0.zip` into a folder.
2. In desktop Chrome, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Select the extracted folder containing `manifest.json`. If working from source, select `dist-extension`, not `extension`.
4. Pin the extension. Disable your older Vault Watch copy during this test to avoid duplicate notifications. Export its list first if needed.
5. In the website, export your list or copy its backup link. In the extension, open **Import & backup** and import it. Imports merge lists; they do not synchronize deletions.

[Google's local testing instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)

## Checks that still need your desktop Chrome

- Confirm ordinary vaults and at least one fixed market from each provider import on the intended network and display the same rate type as the provider. Allow for different source update times.
- Toggle light/dark mode, close and reopen the popup, and check that the theme and alert settings persist.
- Use **Send test notification**. Verify your operating system actually displays it; check Focus/Do Not Disturb and Chrome notification settings if it does not.
- Close the Vault Watch website tab but leave Chrome running and the computer awake. Reopen the popup after about five minutes and confirm the latest check attempt advances. Source timestamps may remain unchanged when feeds are cached.
- Disconnect from the internet, press Refresh, and verify old data is marked clearly. Reconnect and refresh again.
- Restart Chrome and check that background monitoring resumes. Sleep and scheduling may delay checks; this is not a 24/7 monitoring service.
- Confirm `chrome://extensions` shows no extension errors. Capture genuine screenshots of the light and dark popup with sample public markets for the store listing.

Automated tests use simulated Chrome storage and notifications. Installation, native notification delivery, and visual appearance in Chrome still require these manual checks: the available test browser blocks its extension-management page.

## Store submission

1. Sign into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the account that owns the existing Vault Watch item. You already have a published item; there is no need to register a second developer account.
2. Open Vault Watch, select **Package → Upload New Package**, and upload `vaultwatch-extension-1.1.0.zip`.
3. Replace the old listing claim “syncs with vaultwatch.xyz” with “Transfer your watchlist using a backup file or link; website and extension lists are stored separately.”
4. Use the description below, add real screenshots, and review privacy declarations and permission explanations against the package. The bundled `privacy.html` contains the extension-specific policy; use https://vaultwatch.xyz/extension-privacy.html as the listing's public privacy URL after it is published.
5. Submit the update for review after desktop testing. Google review and store publication are separate from saving code to GitHub. Keep the existing public item public; changing to private would require unpublishing it.

The update adds API access for `api.morpho.org`, `api-v2.pendle.finance`, and `api.spectra.finance` so fixed markets can load. Existing users may need to accept the new access after Chrome updates the extension.

[Google's update instructions](https://developer.chrome.com/docs/webstore/update)

## Suggested store description

Follow your selected vaults and fixed markets in a simple watchlist, without connecting a wallet.

Vault Watch displays public rates and market data from Morpho, Yearn, Beefy, Aave, Compound, DeFiLlama, Pendle, and Spectra. Fixed Markets from Morpho Midnight, Pendle, and Spectra are supported on Ethereum and Base.

- See yearly rates, networks, market size, and when data was received.
- Keep APR, APY, and fixed-market quotes clearly labelled.
- Choose light or dark mode.
- Set rate and market-size alert thresholds, choose decreases only or both directions, or switch change alerts off.
- Test notifications from the popup.
- Import and export a watchlist file, or paste a Vault Watch backup link.

Checks run about every five minutes while Chrome is running and your device is awake. Browser scheduling, sleep, source availability, and operating-system notification settings affect delivery. Alerts compare consecutive fresh readings; after an outage or long sleep, the next reading starts a new baseline.

Your website and extension watchlists are stored separately. Import again to add website changes; imports do not remove existing markets. Watchlists and preferences stay in local extension storage. Public data services receive normal requests, which can include market identifiers and your IP address. No analytics, advertising, wallet connection, or account is required.

Rates can change. Fixed rates shown are current market quotes, not the return locked by an individual investor. Vault Watch does not invest, execute transactions, or access your funds. Crypto can lose value.

## Permission explanations for the dashboard

| Permission | Purpose |
| --- | --- |
| storage | Save selected public markets, recent readings, alert preferences, theme, and unread count locally. |
| alarms | Schedule a periodic background check while Chrome is running. |
| notifications | Display market-change alerts and a test notification requested by the user. |
| blue-api.morpho.org | Read public Morpho V1 and V2 vault rates and deposit data. |
| api.morpho.org | Read public Morpho Midnight fixed-market books, token metadata, prices, and market state. |
| ydaemon.yearn.fi | Read public Yearn vault rates and deposit data. |
| api.beefy.finance | Read public Beefy rates and deposit data. |
| yields.llama.fi | Read public Aave, Compound, and other pool metrics from DeFiLlama. |
| api-v2.pendle.finance | Read public Pendle fixed-market quotes and token metadata. |
| api.spectra.finance | Read public Spectra fixed-market quotes and liquidity. |

Single purpose: monitor a user-selected list of public vault and fixed-market rates and notify the user of configured changes.

All executable code is included in the extension package; API responses are used as data, never executed as remote code.
