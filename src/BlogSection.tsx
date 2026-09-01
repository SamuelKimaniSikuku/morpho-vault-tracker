// Blog posts rendered natively inside the app (site theme, light/dark aware).
// Each post also links out to its designed standalone explainer page and PDF.

export function BlogSection() {
  return (
    <section className="blog-section" id="blog">
      <div className="blog-header">
        <h2>📖 Blog</h2>
      </div>

      <article className="blog-post">
        <span className="blog-tag">MORPHO VAULTS</span>
        <h3>The exit that's always open.</h3>
        <p className="blog-lede">
          The #1 fear when you lend your money out: <em>"What if I can't get it back?"</em> Morpho
          vaults are built so that <strong>you can always leave — even when the vault has no cash on
          hand.</strong>
        </p>

        <div className="blog-body">
            <div className="blog-idea">
              <span className="blog-idea-label">THE IDEA</span>
              <p>
                If there's no cash to pay you out, you take <strong>the investments themselves</strong>{" "}
                instead — your slice, straight into your own wallet. No manager to ask. No waiting.
                Nobody can say no.
              </p>
            </div>

            <h4>How leaving works</h4>
            <ol className="blog-steps">
              <li>
                <strong>You want out.</strong> The vault's cash is all lent out and earning. Instead of
                waiting, you press the emergency exit.
              </li>
              <li>
                <strong>The system covers the gap.</strong> Behind the scenes, the missing cash is
                borrowed and repaid in the same instant — you never owe anything.
              </li>
              <li>
                <strong>You trade your receipt.</strong> Your vault shares are swapped for your slice of
                what the vault owns. This is automatic — no one approves it.
              </li>
              <li>
                <strong>You walk away with it.</strong> Your money's investments now sit in your own
                wallet. Keep them, or cash out when you're ready.
              </li>
            </ol>

            <p>
              At no point did you need anyone's permission.{" "}
              <strong>The exit is built into the vault itself — and nobody can ever remove it.</strong>
            </p>

            <h4>The fine print</h4>
            <ul className="blog-fine">
              <li>
                <strong>A small fee — up to 2%.</strong> It keeps the emergency exit from being abused.
                Slightly costly, never impossible.
              </li>
              <li>
                <strong>You get investments, not cash.</strong> You may need to wait to turn them into
                cash yourself.
              </li>
              <li>
                <strong>A few vaults are members-only.</strong> On those, the guarantee can be weaker —
                check before you deposit.
              </li>
              <li>
                <strong>You'll probably never need it.</strong> It's the fire escape, not the front
                door. Normal withdrawals just work.
              </li>
            </ul>

            <div className="blog-closing">
              <p>
                <strong>
                  Before you ask about the returns, ask: <em>"If everything goes wrong, can I still get
                  out on my own?"</em>
                </strong>
              </p>
              <p>
                Past platform collapses taught a hard lesson: "your money is safe" means nothing if
                withdrawal is a button someone else can switch off. Here, the worst case isn't frozen
                funds — it's a small fee and walking out with your investments in hand.{" "}
                <strong>That's what really owning your money means.</strong>
              </p>
            </div>

            <p className="blog-disclaimer">A plain-language explainer · not investment advice</p>
          </div>

        <div className="blog-actions">
          <a href="/blog/the-exit-thats-always-open.html">Open the designed explainer ↗</a>
          <a href="/blog/the-exit-thats-always-open.pdf" download>
            📄 Download this post as a PDF
          </a>
        </div>
      </article>
    </section>
  );
}
