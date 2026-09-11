export function RateGuide() {
  return <details className="rate-guide simple-rate-guide">
    <summary>What does the yearly rate mean?</summary>
    <p>It expresses the rate over one year, even when a market ends sooner. It is not a promise of what you will earn.</p>
    <p><strong>APY</strong> includes assumed reinvestment of earnings. <strong>APR</strong> does not. <strong>Source rate</strong> means the platform has not confirmed that calculation method.</p>
    <p>Rates, fees, and coin prices can affect your return. For a fixed market, check the end date and terms. The quote can change before you enter, and leaving early can change your return.</p>
  </details>;
}

export function BeginnerGuide() {
  return <div className="beginner-guide">
    <p>VaultWatch helps you follow earning rates offered by crypto platforms. Adding a vault saves it to your watchlist. It does not invest or move any money.</p>
    <ol className="getting-started"><li><strong>Find a vault.</strong> Search for a name or a coin you already use, or upload a screenshot.</li><li><strong>Add it to your watchlist.</strong> You can follow several vaults without connecting a wallet.</li><li><strong>Check back here.</strong> See the latest rate and whether an update is missing. Select a vault name for more details.</li></ol>
    <dl className="plain-glossary">
      <div><dt>Vault</dt><dd>A place on a crypto platform that offers a way to earn a return. The rules and risks differ between markets.</dd></div>
      <div><dt>Platform</dt><dd>The crypto service behind a vault, such as Morpho or Pendle.</dd></div>
      <div><dt>Total deposits (TVL)</dt><dd>The total value everyone has deposited in a vault, shown in US dollars. It is not your personal balance.</dd></div>
      <div><dt>Network</dt><dd>The blockchain it runs on, such as Ethereum or Base. Similar names on different networks can refer to different vaults.</dd></div>
      <div><dt>Fixed Markets</dt><dd>Markets with an end date. The “Fixed asset” tag describes the type of rate, not a guarantee that the coin's price stays the same.</dd></div>
    </dl>
    <RateGuide />
    <p className="meta">Your list stays on this device. Rates are checked every minute while the page is open; background tabs can delay updates.</p>
  </div>;
}
