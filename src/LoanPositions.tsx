import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Dialog, Icon, age, formatRate } from "./ui";
import { blankLoan, loadLoanPositions, saveLoanPositions, loanDraft, validateLoan, sameLoanReading, loanAmount, loanDollars, type LoanDraft, type LoanPosition } from "./loan-positions";

function LoanFields({ value, onChange, index, count }: { value: LoanDraft; onChange: (value: LoanDraft) => void; index: number; count: number }) {
  const input = (key: keyof LoanDraft, label: string, options: { required?: boolean; numeric?: boolean; placeholder?: string; list?: string } = {}) => <label>{label}<input aria-label={count > 1 ? `Loan ${index + 1}: ${label}` : label} value={value[key] ?? ""} onChange={e => onChange({ ...value, [key]: e.target.value })} required={options.required} inputMode={options.numeric ? "decimal" : "text"} placeholder={options.placeholder} list={options.list} maxLength={60} autoComplete="off" /></label>;
  return <>
    <div className="loan-entry-grid">
      {input("network", "Network", { required: true, placeholder: "Choose or type a network", list: "loan-networks" })}
      <div className="loan-amount-fields">{input("borrowedAmount", "Borrowed amount", { required: true, numeric: true, placeholder: "100" })}{input("borrowedToken", "Borrowed coin", { required: true, placeholder: "USDC" })}</div>
      <div className="loan-amount-fields">{input("collateralAmount", "Collateral amount", { required: true, numeric: true, placeholder: "0.01" })}{input("collateralToken", "Collateral coin", { required: true, placeholder: "ETH" })}</div>
      {input("ratePct", "Yearly interest (%)", { numeric: true, placeholder: "Optional" })}
      {input("health", "Health", { numeric: true, placeholder: "Optional" })}
      {input("interestAmount", `Interest so far${value.borrowedToken ? ` (${value.borrowedToken})` : ""}`, { numeric: true, placeholder: "Optional" })}
    </div>
    <details className="loan-extra-fields"><summary>More details (optional)</summary><div className="loan-entry-grid">
      {input("borrowedUsd", "Loan value (USD)", { numeric: true })}
      {input("collateralUsd", "Collateral value (USD)", { numeric: true })}
      {input("interestUsd", "Interest value (USD)", { numeric: true })}
      {input("utilizationPct", "Market utilization (%)", { numeric: true })}
      {input("platform", "Platform", { placeholder: "For example, Morpho" })}
    </div></details>
  </>;
}

export function LoanPositions({ now }: { now: number }) {
  const [initial] = useState(loadLoanPositions);
  const [positions, setPositions] = useState(initial.positions);
  const [editor, setEditor] = useState<LoanDraft[] | null>(null);
  const [upload, setUpload] = useState<{ name: string; url: string } | null>(null);
  const [viewImage, setViewImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<{ loan: LoanPosition; index: number } | null>(null);
  const input = useRef<HTMLInputElement>(null), target = useRef<string | undefined>(undefined);
  const reading = useRef<AbortController | null>(null), run = useRef(0);
  useEffect(() => () => { run.current++; reading.current?.abort(); }, []);
  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.url); }, [upload]);

  function cancel() {
    run.current++; reading.current?.abort(); setBusy(false); setEditor(null); setUpload(null); setError(""); setViewImage(false);
  }
  function startEdit(loan?: LoanPosition) {
    cancel(); setMessage(""); setEditor([loan ? loanDraft(loan) : blankLoan()]);
  }
  function chooseScreenshot(id?: string) { target.current = id; input.current?.click(); }
  function persist(next: LoanPosition[]) {
    if (initial.error) return false;
    if (!saveLoanPositions(next)) { setError("These changes could not be saved on this device. Free some browser storage and try again."); return false; }
    setPositions(next); setError(""); return true;
  }
  async function readScreenshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) { setError("Choose an image smaller than 20 MB."); return; }
    const editTarget = target.current;
    cancel(); const thisRun = ++run.current, controller = new AbortController(); reading.current = controller;
    setUpload({ name: file.name, url: URL.createObjectURL(file) }); setBusy(true); setMessage("");
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const { extractLoanCandidates } = await import("./ocr");
      const candidates = await extractLoanCandidates(file, controller.signal);
      if (run.current !== thisRun) return;
      if (!candidates.length) { setError("No loan rows could be read. Include the Loan, Collateral, and Rate column headings, or use Add loan."); return; }
      if (editTarget && candidates.length !== 1) { setError("To update this loan, crop the screenshot to one position with its column headings."); return; }
      setEditor(candidates.slice(0, 10).map(draft => ({ ...draft, id: editTarget, platform: positions.find(p => p.id === editTarget)?.platform ?? "", uploadName: file.name })));
      setMessage(candidates.length > 10 ? "Showing the first 10 loans. Upload the remaining rows in a separate image." : "");
    } catch (e) {
      if (run.current === thisRun) setError(controller.signal.aborted ? "Reading took too long. Try a smaller screenshot or use Add loan." : e instanceof Error ? `Could not read this image. ${e.message}` : "Could not read this image. Try another screenshot or use Add loan.");
    } finally { clearTimeout(timer); if (run.current === thisRun) setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (!editor?.length || busy) return;
    const next = [...positions]; let added = 0, updated = 0, duplicates = 0;
    for (const [index, draft] of editor.entries()) {
      const result = validateLoan(draft);
      if (result.error || !result.value) { setError(`${editor.length > 1 ? `Loan ${index + 1}: ` : ""}${result.error}`); return; }
      if (draft.id) {
        const at = next.findIndex(p => p.id === draft.id);
        if (at < 0) { setError("This loan was removed. Close the form and add it again."); return; }
        next[at] = { ...result.value, id: draft.id, savedAt: Date.now(), uploadName: draft.uploadName }; updated++;
      } else if (next.some(p => sameLoanReading(p, result.value))) duplicates++;
      else { next.push({ ...result.value, id: crypto.randomUUID(), savedAt: Date.now(), uploadName: draft.uploadName }); added++; }
    }
    if (!persist(next)) return;
    cancel(); setRemoved(null);
    setMessage([added ? `${added} loan${added === 1 ? "" : "s"} added.` : "", updated ? "Loan updated." : "", duplicates ? `${duplicates} identical reading${duplicates === 1 ? " was" : "s were"} already saved.` : ""].filter(Boolean).join(" "));
  }
  function remove(loan: LoanPosition, index: number) {
    if (!persist(positions.filter(p => p.id !== loan.id))) return;
    if (editor?.some(d => d.id === loan.id)) cancel();
    setRemoved({ loan, index }); setMessage("Loan removed.");
  }
  function undo() {
    if (!removed) return;
    const next = [...positions]; next.splice(Math.min(removed.index, next.length), 0, removed.loan);
    if (persist(next)) { setRemoved(null); setMessage("Loan restored."); }
  }
  return <section className="loan-positions" aria-label="Your loans">
    <div className="workspace-heading"><div><h1>Your loans</h1><p>Keep your borrowing positions in one place.</p></div><div className="workspace-actions"><button className="button" disabled={busy || !!initial.error} onClick={() => startEdit()}><Icon name="plus" />Add loan</button><button className="button button-primary" disabled={busy || !!initial.error} onClick={() => chooseScreenshot()}><Icon name="import" />{busy ? "Reading…" : "Upload screenshot"}</button></div></div>
    <input ref={input} hidden type="file" accept="image/*" aria-label="Upload loan screenshot" onChange={readScreenshot} />
    <datalist id="loan-networks">{["Ethereum", "Base", "Arbitrum One", "Optimism", "Polygon", "BNB Chain", "Avalanche", "Sonic", "Monad", "HyperEVM", "Katana"].map(n => <option key={n} value={n} />)}</datalist>
    {(initial.error || error) && <p className="notice notice-warning" role="alert">{initial.error || error}</p>}
    {message && <div className="notice" role="status"><span>{message}</span>{removed && <button className="text-button" onClick={undo}>Undo</button>}<button className="icon-button" aria-label="Dismiss loan message" onClick={() => { setMessage(""); setRemoved(null); }}><Icon name="close" /></button></div>}
    {(editor || upload) && <div className="loan-editor inline-add-panel">
      <div className="inline-panel-heading"><h2>{busy ? "Reading your screenshot…" : upload ? "Review your loan details" : editor?.[0]?.id ? "Edit loan" : "Add loan"}</h2><button className="icon-button" aria-label="Close loan form" onClick={cancel}><Icon name="close" /></button></div>
      {upload && <div className="loan-upload-preview"><img src={upload.url} alt="Uploaded loan screenshot" /><div><strong>{upload.name}</strong><p className="meta">{busy ? "Reading the image on this device…" : "Check the numbers and network before saving."}</p></div><button className="text-button" onClick={() => setViewImage(true)}>View screenshot</button></div>}
      {editor && <form onSubmit={save} aria-label="Loan details">
        <p className="meta loan-form-help">Enter the borrowed and collateral amounts. Leave anything you do not know blank.</p>
        {editor.map((draft, i) => <fieldset key={i} className="loan-draft"><legend>{editor.length > 1 ? `Loan ${i + 1}` : "Position details"}</legend>{editor.length > 1 && <button type="button" className="text-button" onClick={() => setEditor(current => current!.filter((_, at) => at !== i))}>Skip loan {i + 1}</button>}<LoanFields value={draft} index={i} count={editor.length} onChange={value => setEditor(current => current!.map((d, at) => at === i ? value : d))} /></fieldset>)}
        <div className="button-row loan-form-actions"><button className="button button-primary" type="submit" disabled={busy || !editor.length}>{editor[0]?.id ? "Save changes" : editor.length > 1 ? `Save ${editor.length} loans` : "Save loan"}</button><button className="button" type="button" onClick={cancel}>Cancel</button>{editor.length === 1 && editor[0]?.id && <button className="text-button" type="button" onClick={() => chooseScreenshot(editor[0].id)}>Update from screenshot</button>}</div>
      </form>}
    </div>}
    {positions.length > 0 ? <><p className="meta loan-count">{positions.length} saved loan{positions.length === 1 ? "" : "s"} · Saved readings, not live balances</p><div className="position-columns" aria-hidden="true"><span>Borrowed</span><span>Collateral</span><span>Yearly interest</span><span>Health</span><span>Interest so far</span><span /></div><ul className="position-list">{positions.map((loan, index) => <li key={loan.id}>
      <div className="position-row"><div className="position-identity"><strong>{loanAmount(loan.borrowedAmount, loan.borrowedToken)}</strong><p className="vault-meta">{loan.network}{loan.platform ? ` · ${loan.platform}` : ""}</p>{loan.borrowedUsd != null && <small>{loanDollars(loan.borrowedUsd)}</small>}</div>
        <div className="simple-vault-metric"><span className="mobile-metric-label">Collateral</span><strong>{loanAmount(loan.collateralAmount, loan.collateralToken)}</strong>{loan.collateralUsd != null && <small>{loanDollars(loan.collateralUsd)}</small>}</div>
        <div className="simple-vault-metric"><span className="mobile-metric-label">Yearly interest</span><strong>{formatRate(loan.ratePct)}</strong></div>
        <div className="simple-vault-metric"><span className="mobile-metric-label">Health</span><strong>{loanAmount(loan.health)}</strong><small>As recorded</small></div>
        <div className="simple-vault-metric"><span className="mobile-metric-label">Interest so far</span><strong>{loanAmount(loan.interestAmount, loan.borrowedToken)}</strong>{loan.interestUsd != null && <small>{loanDollars(loan.interestUsd)}</small>}</div>
        <div className="position-actions"><button className="text-button" aria-label={`Edit loan ${index + 1} ${loan.borrowedToken}`} disabled={busy} onClick={() => startEdit(loan)}>Edit</button><button className="icon-button vault-remove" aria-label={`Remove loan ${index + 1} ${loan.borrowedToken}`} disabled={busy} onClick={() => remove(loan, index)}><Icon name="close" /></button></div>
      </div><details className="position-details"><summary>Details · Saved {age(loan.savedAt, now)}{loan.uploadName ? " · Screenshot" : ""}</summary><dl><div><dt>Market utilization</dt><dd>{formatRate(loan.utilizationPct)}</dd></div><div><dt>Source</dt><dd>{loan.uploadName || "Entered manually"}</dd></div><div><dt>Saved on this device</dt><dd>{new Date(loan.savedAt).toLocaleString()}</dd></div></dl><p className="meta">Health and utilization are the values reported by your lending platform. They are not recalculated here.</p></details>
    </li>)}</ul><p className="table-note">Edit a loan or use “Update from screenshot” to refresh its saved reading. Interest does not update automatically.</p></> : !editor && !upload && <div className="vault-empty"><h2>Keep track of what you have borrowed.</h2><p>Upload a screenshot of your borrow positions, or add a loan yourself.</p></div>}
    <Dialog open={viewImage && !!upload} title="Uploaded loan screenshot" onClose={() => setViewImage(false)} wide>{upload && <img className="loan-full-preview" src={upload.url} alt={upload.name} />}</Dialog>
  </section>;
}
