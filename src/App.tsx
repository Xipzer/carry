// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownUp, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, History, LoaderCircle, Settings2, ShieldCheck, Unplug, Wallet, WifiOff } from 'lucide-react';
import { formatUnits, getAddress, type Address } from 'viem';
import { balances, estimateTransfer, finishTransfer, quoteTransfer, recoverTransfer, refreshProof, startTransfer, storeRecovery, syncTransfer } from './bridge';
import { canForward, duration, listNetworks, network, prettyName, type Network } from './chains';
import { Activity, exportTransfers, Progress } from './activity';
import { ExternalLink, InfoTip, InstalledWalletIcon, Modal, NetworkButton, NetworkPicker, Notice, Route, UsdcIcon, WalletConnectIcon } from './components';
import { amountUnits, canDismiss, exclusive, friendlyError, gasAmount, intentKey, isUnfinished, money, readTransfers, recipientAddress, saveTransfer, shortAddress, storageAvailable, type FeeEstimate, type Intent, type Quote, type Transfer } from './model';
import { connectProvider, discoverWallets, walletConnect, type Provider, type WalletOption } from './wallet';
import { FundingDestinations, HyperliquidNextStep, ReceivingOptions, initialReceivingMode, receiveAutomatically, receivingRouteName } from './receiving';
import { ThemeToggle } from './theme';
import { readDraft, saveDraft, savedWallet, rememberWallet } from './session';
import { trackTransfers, type TrackingStatus } from './tracking';

type Panel = 'wallet' | 'settings' | 'source' | 'destination' | 'review' | 'activity' | 'progress' | 'recover' | 'help' | null;
type Connection = { provider: Provider; address: Address; name: string; id?: string };
function initialHistory() {
  try { return { rows: readTransfers(), error: '' }; } catch { return { rows: [] as Transfer[], error: 'Saved history is damaged or unavailable. Sending is off. Export recovery data before changing browser settings.' }; }
}
function readProjectId() { try { return localStorage.getItem('carry.walletconnect.projectId') || import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ''; } catch { return import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ''; } }

export default function App() {
  const [initial] = useState(initialHistory), [transfers, setTransfers] = useState(initial.rows), [storageError, setStorageError] = useState(initial.error);
  const [draft] = useState(() => readDraft(initial.rows));
  const [testnet, setTestnet] = useState(() => network(draft?.source ?? 'Base').isTestnet), [source, setSource] = useState<Network>(() => network(draft?.source ?? 'Base')), [destination, setDestination] = useState<Network>(() => network(draft?.destination ?? 'Arbitrum'));
  const [amount, setAmount] = useState(draft?.amount ?? ''), [custom, setCustom] = useState(draft?.custom ?? false), [recipient, setRecipient] = useState(draft?.recipient ?? '');
  const [receivingMode, setReceivingMode] = useState(() => draft?.receivingMode ?? initialReceivingMode());
  const [connection, setConnection] = useState<Connection | null>(null), [wallets, setWallets] = useState<WalletOption[]>([]), [projectId, setProjectId] = useState(readProjectId);
  const [returnToProgress, setReturnToProgress] = useState(false);
  const [retryReview, setRetryReview] = useState(false);
  const [tracking, setTracking] = useState<Record<string, TrackingStatus>>({});
  const tracker = useRef<ReturnType<typeof trackTransfers> | null>(null);
  const [panel, setPanel] = useState<Panel>(draft?.panel ?? null), [selectedId, setSelectedId] = useState(draft?.selectedId ?? ''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [busyLabel, setBusyLabel] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null), [balanceError, setBalanceError] = useState(false), [balanceRevision, setBalanceRevision] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null), [now, setNow] = useState(Date.now()), [acknowledged, setAcknowledged] = useState(false);
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null), [estimateLoading, setEstimateLoading] = useState(false), [estimateError, setEstimateError] = useState(''), [estimateRevision, setEstimateRevision] = useState(0);
  const [online, setOnline] = useState(navigator.onLine), [recoveryHash, setRecoveryHash] = useState(draft?.recoveryHash ?? ''), [recoverySource, setRecoverySource] = useState(draft?.recoverySource ?? source.chain as string), [recoveryTestnet, setRecoveryTestnet] = useState(draft?.recoveryTestnet ?? false), [recoveryTarget, setRecoveryTarget] = useState<string | null>(draft?.recoveryTarget ?? null);
  const working = useRef(false), latestRows = useRef(transfers), connectionRef = useRef(connection), panelRef = useRef(panel);
  latestRows.current = transfers; connectionRef.current = connection; panelRef.current = panel;
  const current = transfers.find(t => t.id === selectedId);
  const unfinished = transfers.filter(isUnfinished);
  const ownUnfinished = connection && unfinished.find(t => t.owner.toLowerCase() === connection.address.toLowerCase());
  const close = useCallback(() => { setPanel(null); setError(''); }, []);
  const observe = useCallback((t: Transfer) => {
    setTransfers(rows => [t, ...rows.filter(r => r.id !== t.id && !(t.burnHash && r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash.toLowerCase()))]);
  }, []);
  const remember = useCallback((t: Transfer) => {
    observe(t);
    try { saveTransfer(t); } catch { setStorageError('Your latest progress could not be saved in this browser. Download the recovery details now; keep transaction hashes before closing this page.'); }
  }, [observe]);
  async function run(label: string, fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setBusyLabel(label); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { working.current = false; setBusy(false); setBusyLabel(''); setBalanceRevision(v => v + 1); }
  }
  function openActivity() { setError(''); setPanel('activity'); }
  function openRecovery(target?: Transfer) {
    setRecoveryTarget(target?.id ?? null); setRecoveryHash('');
    setRecoveryTestnet(target ? network(target.source).isTestnet : testnet);
    setRecoverySource(target?.source ?? source.chain); setError(''); setPanel('recover');
  }
  function openWallet() { setError(''); setReturnToProgress(panel === 'progress' && Boolean(current)); setPanel('wallet'); }
  function connected(value: Connection) { rememberWallet({ id: value.id ?? 'walletconnect', name: value.name, address: value.address }); setConnection(value); setError(''); setPanel(returnToProgress ? 'progress' : null); }

  function reviewUnsent(t: Transfer) {
    if (!connection) { openWallet(); return; }
    void run('Preparing fresh review', async () => {
      await exclusive(t.owner, async () => {
        const latest = readTransfers().find(row => row.id === t.id);
        if (!latest || !canDismiss(latest) || latest.phase === 'cancelled' || latest.phase === 'complete') throw new Error('This transfer changed. Check its current status before continuing.');
        if (connectionRef.current?.address.toLowerCase() !== latest.owner.toLowerCase()) throw new Error('Connect the wallet that started this transfer.');
        const cancelled = { ...latest, phase: 'cancelled' as const };
        saveTransfer(cancelled); observe(cancelled);
        setSource(network(latest.source)); setDestination(network(latest.destination)); setTestnet(network(latest.source).isTestnet);
        setAmount(latest.amount); setRecipient(latest.recipient); setCustom(latest.recipient.toLowerCase() !== latest.owner.toLowerCase());
        setReceivingMode(latest.forward ? 'automatic' : 'manual'); setQuote(null); setAcknowledged(false); setPanel(null);
        setRetryReview(true);
      });
    });
  }
  useEffect(() => {
    if (!retryReview || busy) return;
    setRetryReview(false); review();
  }, [retryReview, busy]);

  useEffect(() => {
    saveDraft({ source: source.chain, destination: destination.chain, amount, custom, recipient, receivingMode,
      panel: panel === 'activity' || panel === 'progress' || panel === 'recover' || panel === 'help' ? panel : null,
      selectedId, recoveryHash, recoverySource, recoveryTestnet, recoveryTarget });
  }, [source, destination, amount, custom, recipient, receivingMode, panel, selectedId, recoveryHash, recoverySource, recoveryTestnet, recoveryTarget]);
  useEffect(() => {
    let active = true;
    const saved = savedWallet();
    if (!saved) return;
    void (async () => {
      try {
        let provider: Provider | undefined;
        if (saved.id === 'walletconnect') {
          if (!/^[a-fA-F0-9]{32}$/.test(projectId)) return;
          const { connectWalletConnect } = await import('./walletconnect');
          provider = await connectWalletConnect(projectId, source, true);
        } else {
          const options = await discoverWallets();
          provider = options.find(w => w.id === saved.id)?.provider;
          if (!provider) { const matches = options.filter(w => w.name === saved.name); if (matches.length === 1) provider = matches[0].provider; }
        }
        if (!provider) return;
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (active && !connectionRef.current && panelRef.current !== 'wallet' && accounts[0]?.toLowerCase() === saved.address.toLowerCase()) {
          setConnection({ provider, address: getAddress(accounts[0]), name: saved.name, id: saved.id });
        }
      } catch { /* Locked or revoked wallets stay disconnected, without prompting. */ }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    const sync = (event: StorageEvent) => { if (event.key === 'carry.transfers.v1' && !working.current) { try { setTransfers(readTransfers()); } catch { setStorageError('Saved history changed but could not be read. Export recovery details before sending again.'); } } };
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    if (panel !== 'wallet') return;
    let live = true;
    discoverWallets().then(w => { if (live) setWallets(w); }).catch(() => { if (live) setWallets([]); });
    return () => { live = false; };
  }, [panel]);
  useEffect(() => {
    if (!connection) return;
    rememberWallet({ id: connection.id ?? 'walletconnect', name: connection.name, address: connection.address });
  }, [connection]);
  useEffect(() => {
    if (!connection) return;
    const { provider } = connection;
    const accounts = (...args: unknown[]) => {
      const values = args[0] as string[];
      setQuote(null);
      if (panelRef.current === 'review') setPanel(null);
      if (Array.isArray(values) && values[0]) {
        try { setConnection(c => c ? { ...c, address: getAddress(values[0]) } : null); }
        catch { setConnection(null); }
      } else setConnection(null);
    };
    const chain = () => { setQuote(null); if (panelRef.current === 'review') setPanel(null); };
    const disconnected = () => { rememberWallet(null); setConnection(null); setQuote(null); };
    provider.on?.('accountsChanged', accounts); provider.on?.('chainChanged', chain); provider.on?.('disconnect', disconnected);
    return () => { provider.removeListener?.('accountsChanged', accounts); provider.removeListener?.('chainChanged', chain); provider.removeListener?.('disconnect', disconnected); };
  }, [connection?.provider]);
  useEffect(() => {
    let active = true;
    setBalance(null); setBalanceError(false);
    if (connection && online) balances(source, connection.address).then(b => { if (active) setBalance(b.usdc); }).catch(() => { if (active) setBalanceError(true); });
    return () => { active = false; };
  }, [source, connection?.address, online, balanceRevision]);
  useEffect(() => { setQuote(null); setAcknowledged(false); setError(''); }, [source, destination, amount, custom, recipient, connection?.address, receivingMode]);
  useEffect(() => {
    let active = true;
    setEstimateLoading(false); setEstimateError('');
    if (busy || panel === 'review') return;
    if (!connection || !online || !amount) { setEstimate(null); return; }
    let details: Intent;
    try { details = intent(); amountUnits(details.amount); }
    catch { setEstimate(null); return; }
    setEstimateLoading(true);
    const timer = setTimeout(async () => {
      try {
        const next = await estimateTransfer(details, connection.provider);
        if (active && connectionRef.current?.address === details.owner) setEstimate(next);
      } catch (e) {
        if (active) { setEstimate(null); setEstimateError(friendlyError(e)); }
      } finally { if (active) setEstimateLoading(false); }
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [source, destination, amount, custom, recipient, connection?.address, connection?.provider, receivingMode, online, busy, panel, estimateRevision]);
  useEffect(() => {
    const refresh = () => {
      if (connectionRef.current && !working.current && navigator.onLine && document.visibilityState === 'visible' && panelRef.current !== 'review') setEstimateRevision(value => value + 1);
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    if (panel !== 'review') return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [panel]);
  useEffect(() => {
    let active = true;
    const monitor = trackTransfers({ rows: () => latestRows.current,
      available: () => !working.current && navigator.onLine && document.visibilityState === 'visible',
      check: t => syncTransfer(t, row => { if (active) observe(row); }),
      status: (id, status) => { if (active) setTracking(current => ({ ...current, [id]: status })); },
    });
    tracker.current = monitor;
    const wake = () => { if (navigator.onLine && document.visibilityState === 'visible') monitor.wake(); };
    window.addEventListener('online', wake); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    monitor.wake();
    return () => { active = false; monitor.stop(); tracker.current = null; window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [observe]);
  const trackedHashes = unfinished.filter(t => t.burnHash && !t.sourceFailed).map(t => t.burnHash).join(',');
  useEffect(() => { if (!busy) tracker.current?.wake(); }, [trackedHashes, busy]);

  function intent(): Intent {
    if (!connection) throw new Error('Connect your wallet first.');
    return { source: source.chain, destination: destination.chain, amount, owner: connection.address, recipient: custom ? recipientAddress(recipient.trim()) : connection.address, speed: 'SLOW', forward: receiveAutomatically(receivingMode, destination) };
  }
  function review() {
    if (!connection) { openWallet(); return; }
    if (ownUnfinished) { setSelectedId(ownUnfinished.id); setPanel('progress'); return; }
    void run('Checking transfer', async () => {
      storageAvailable(); amountUnits(amount);
      const i = intent(), q = await quoteTransfer(i, connection.provider);
      if (!connectionRef.current || connectionRef.current.address !== i.owner || intentKey(i) !== intentKey(intent())) throw new Error('Details changed while checking. Review again.');
      setQuote(q); setEstimate(q); setNow(Date.now()); setAcknowledged(false); setPanel('review');
    });
  }
  function send() {
    if (!connection || !quote) return;
    void run('Waiting for wallet', async () => {
      if (intentKey(quote.intent) !== intentKey(intent())) throw new Error('Details changed. Review a fresh quote.');
      const result = await startTransfer(quote, connection.provider, t => { observe(t); setSelectedId(t.id); setPanel('progress'); });
      observe(result); setQuote(null);
    });
  }
  function switchMode(value: boolean) {
    if (busy) return;
    setTestnet(value); const choices = listNetworks(value);
    setSource(choices.find(c => c.chain.startsWith('Base')) ?? choices[0]); setDestination(choices.find(c => c.chain.startsWith('Arbitrum')) ?? choices[1]);
    setAmount(''); setRecipient(''); setCustom(false);
  }
  function selectTransfer(id: string) { setSelectedId(id); setError(''); setPanel('progress'); }
  const remaining = quote ? Math.max(0, Math.ceil((60000 - now + quote.createdAt) / 1000)) : 0;
  const mainnetEnabled = import.meta.env.VITE_ENABLE_MAINNET_TRANSFERS === 'true';
  const sendingEnabled = testnet || mainnetEnabled;
  const needsAcknowledgement = quote && (quote.contractRecipient || quote.intent.recipient.toLowerCase() !== quote.intent.owner.toLowerCase());
  let amountError = '';
  if (amount) { try { const n = amountUnits(amount); if (balance !== null && n > balance) amountError = 'Not enough native USDC on ' + prettyName(source) + '.'; } catch (e) { amountError = friendlyError(e); } }
  let currentEstimate: FeeEstimate | null = null;
  try { if (estimate && intentKey(estimate.intent) === intentKey(intent()) && Date.now() - estimate.createdAt < 60000) currentEstimate = estimate; } catch { /* No quote for incomplete form details. */ }
  const routeAvailable = receivingMode === 'manual' || canForward(destination);
  const forward = receivingMode === 'automatic' && canForward(destination);
  const quotePlaceholder = estimateLoading ? 'Getting quote...' : 'Not quoted';

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="Carry home"><img src="/carry.svg" width="33" height="33" alt="" /><span>carry<span className="brand-dot">.</span></span></a>
      <nav className="desktop-nav" aria-label="Main navigation"><button className="nav-link active" onClick={close}>Transfer</button><button className="nav-link" onClick={openActivity}>Activity{unfinished.length > 0 && <span className="nav-count">{unfinished.length}</span>}</button></nav>
      <div className="header-actions"><button className="icon-button mobile-activity" aria-label="Activity" onClick={openActivity}><History size={20} /></button><ThemeToggle /><button className="wallet-button" aria-label={connection ? undefined : 'Connect wallet'} disabled={busy} onClick={connection ? () => setPanel('wallet') : openWallet}>{connection ? <><span className="connected-dot" />{shortAddress(connection.address)}<ChevronDown size={14} /></> : <><Wallet size={16} /><span className="desktop-wallet-label">Connect wallet</span><span className="mobile-wallet-label" aria-hidden="true">Connect</span></>}</button></div>
    </header>
    <main>
      <div className="transfer-area">
        {!mainnetEnabled && !testnet && <div className="preview-banner">Mainnet sending is off.<button onClick={() => switchMode(true)} disabled={busy}>Use testnet<ArrowUpRight size={12} /></button></div>}
        {mainnetEnabled && !testnet && <div className="preview-banner mainnet-banner" role="status">Experimental mainnet.<button onClick={() => setPanel('help')} disabled={busy}>Risks<ArrowUpRight size={12} /></button></div>}
        {!online && <Notice tone="warning"><WifiOff size={16} />You're offline. Reconnect before continuing. Your saved progress stays here.</Notice>}
        {storageError && <Notice tone="error">{storageError}<button className="text-button" onClick={() => { try { const raw = localStorage.getItem('carry.transfers.v1'); const blob = new Blob([raw || JSON.stringify(transfers)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'carry-local-recovery.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { exportTransfers(transfers); } }}>Download local recovery data</button></Notice>}
        {testnet && <div className="testnet-banner">Testnet / no real funds</div>}
        <section className="transfer-card" aria-label="Transfer USDC">
          <div className="card-heading"><h1>Transfer USDC</h1><button className="icon-button" onClick={() => { setError(''); setPanel('settings'); }} aria-label="Connection and network settings" disabled={busy}><Settings2 size={18} /></button></div>
          <div className="send-panel">
            <div className="panel-top"><span className="field-label">From</span><NetworkButton chain={source} label="From" disabled={busy} onClick={() => setPanel('source')} /></div>
            <div className="amount-row"><label htmlFor="amount" className="sr-only">USDC amount</label><input id="amount" placeholder="0.00" autoComplete="off" inputMode="decimal" spellCheck={false} value={amount} style={{ '--amount-chars': Math.max(4, amount.length) } as CSSProperties} disabled={busy} onChange={e => setAmount(e.target.value)} aria-invalid={Boolean(amountError)} aria-describedby={amountError ? 'amount-error' : undefined} /><span className="token-label"><UsdcIcon />USDC</span></div>
            <div className="balance-row"><span>{connection ? balanceError ? <button className="text-button" onClick={() => setBalanceRevision(v => v + 1)}>Retry balance</button> : balance === null ? 'Loading balance...' : <>Balance <strong>{money(balance)}</strong> USDC</> : 'Wallet not connected'}</span>{connection && balance !== null && balance > 0n && source.nativeCurrency.symbol !== 'USDC' && <button disabled={busy} className="max-button" onClick={() => setAmount(formatUnits(balance, 6))}>MAX</button>}</div>
          </div>
          <div className="swap-wrap"><button className="swap-button" disabled={busy} onClick={() => { setSource(destination); setDestination(source); }} aria-label="Swap sending and receiving networks"><ArrowDownUp size={17} /></button></div>
          <div className="receive-panel">
            <div className="panel-top"><span className="field-label">To</span><NetworkButton chain={destination} label="To" disabled={busy} onClick={() => setPanel('destination')} /></div>
            <div className="received-quote">
              <div><span className="field-label">You receive</span>
                <strong data-testid="received-amount" aria-live="polite">{currentEstimate ? `${money(currentEstimate.estimatedReceived)} USDC` : !connection ? 'Connect for a quote' : !amount || amountError ? 'Enter an amount' : quotePlaceholder}</strong>
                {currentEstimate && <small>Minimum {money(currentEstimate.minimumReceived)} USDC</small>}</div><UsdcIcon />
            </div>
          </div>
          <FundingDestinations source={source} destination={destination} disabled={busy} onSelect={setDestination} />
          {amountError && <p id="amount-error" className="field-error" role="alert">{amountError}</p>}
          <div className="recipient-row"><span>Recipient</span><button className={`text-button ${custom ? 'custom-active' : ''}`} disabled={busy} onClick={() => setCustom(v => !v)}>{custom ? 'Different address' : 'Your wallet'}<ChevronDown size={13} className={custom ? 'rotate' : ''} /></button></div>
          {custom && <div className="recipient-field"><label className="sr-only" htmlFor="recipient">Receiving wallet address</label><input id="recipient" className="plain-input" placeholder="0x... receiving address" autoComplete="off" spellCheck={false} value={recipient} disabled={busy} onChange={e => setRecipient(e.target.value)} /><p>Use a wallet you control on {prettyName(destination)}.</p></div>}
          <ReceivingOptions mode={receivingMode} destination={destination} disabled={busy} onChange={setReceivingMode} />
          <div className="quote-summary">
            <div><span>USDC fee<InfoTip label="Fee breakdown"><dl className="info-fees"><div><dt>CCTP</dt><dd data-testid="cctp-fee">{currentEstimate ? `${money(currentEstimate.cctpFee)} USDC` : quotePlaceholder}</dd></div><div><dt>Circle receiving</dt><dd data-testid="receiving-fee">{currentEstimate ? `${money(currentEstimate.receivingFee)} USDC` : quotePlaceholder}</dd></div><div><dt>Carry</dt><dd>0 USDC</dd></div></dl>Deducted from USDC. Network gas is separate.</InfoTip></span><strong data-testid="usdc-fee">{currentEstimate ? `${money(currentEstimate.fee)} USDC` : quotePlaceholder}</strong></div>
            <div><span>Source gas<InfoTip label="Source gas estimate">Paid in {source.nativeCurrency.symbol} on {prettyName(source)} for approval and sending. This is a funding budget, not a fixed charge. Your wallet shows the final cost.</InfoTip></span><strong data-testid="source-gas">{currentEstimate ? `${gasAmount(currentEstimate.sourceGas, source.nativeCurrency.decimals)} ${source.nativeCurrency.symbol}` : quotePlaceholder}</strong></div>
            {!forward && <div><span>Destination gas</span><strong>{currentEstimate ? `${gasAmount(currentEstimate.destinationGas, destination.nativeCurrency.decimals)} ${destination.nativeCurrency.symbol}` : quotePlaceholder}</strong></div>}
            <div><span>Arrival<InfoTip label="Transfer timing">Standard CCTP waits for source-chain finality. Times are estimates, not deadlines. You can close this page and check Activity later.</InfoTip></span><strong>{duration(source, 'SLOW').replace('Usually under a minute', '<1 min').replace('minutes', 'min').replace('hours', 'h')}</strong></div>
          </div>
          {estimateError && <Notice tone="warning">Quote unavailable. {estimateError}</Notice>}
          {!routeAvailable && <Notice tone="warning">Convenience is unavailable here. Choose Manual or another network.</Notice>}
          {error && !panel && <Notice tone="error">{error}</Notice>}
          <button className="primary-button send-button" onClick={review} disabled={busy || !online || Boolean(storageError) || Boolean(connection && !ownUnfinished && (!amount || amountError || !routeAvailable))}>{busy ? <><LoaderCircle size={18} className="spin" />{busyLabel}</> : !connection ? <>Connect wallet<ArrowRight size={18} /></> : ownUnfinished ? <>Continue your transfer<ArrowRight size={18} /></> : <>Review transfer<ArrowRight size={18} /></>}</button>
          <HyperliquidNextStep destination={destination} />
        </section>
        <button className="recover-link" onClick={() => openRecovery()}><RotateArrow />Recover an existing transfer<ArrowUpRight size={13} /></button>
      </div>
    </main>
    <footer className="site-footer"><span>Circle CCTP / Unaffiliated</span><div><button onClick={() => setPanel('help')}><CircleHelp size={14} />About</button><ExternalLink href="https://developers.circle.com/cctp/concepts/supported-chains-and-domains">Networks</ExternalLink></div></footer>

    {(panel === 'source' || panel === 'destination') && <NetworkPicker title={panel === 'source' ? 'Sending from' : 'Receiving on'} current={panel === 'source' ? source : destination} excluded={panel === 'source' ? destination.chain : source.chain} testnet={testnet} onSelect={c => { panel === 'source' ? setSource(c) : setDestination(c); close(); }} onClose={close} />}
    {panel === 'wallet' && <Modal title={connection ? 'Your wallet' : 'Connect your wallet'} onClose={close}>
      {error && <Notice tone="error">{error}</Notice>}
      {connection ? <><div className="wallet-connected"><span className="wallet-avatar"><Wallet size={26} /></span><h3>{shortAddress(connection.address)}</h3><p>{connection.name}</p><code className="full-address">{connection.address}</code></div><button className="secondary-button full" disabled={busy} onClick={() => void run('Disconnecting', async () => { rememberWallet(null); await connection.provider.disconnect?.(); setConnection(null); setQuote(null); close(); })}><Unplug size={16} />Disconnect</button><p className="dialog-footnote">Saved transfers stay in Activity.</p></> : <>
        {wallets.map(w => <button className="wallet-option" disabled={busy} key={w.id} onClick={() => void run('Connecting wallet', async () => { const address = await connectProvider(w.provider); connected({ provider: w.provider, address, name: w.name, id: w.id }); })}><InstalledWalletIcon icon={w.icon} /><span><strong>{w.name}</strong><small>Browser extension</small></span><ArrowRight size={17} /></button>)}
        <button className="wallet-option" disabled={busy} onClick={() => void run('Opening WalletConnect', async () => { const provider = await walletConnect(projectId.trim(), returnToProgress && current ? network(current.destination) : source); const address = await connectProvider(provider); connected({ provider, address, name: 'WalletConnect' }); })}><WalletConnectIcon /><span><strong>WalletConnect</strong><small>QR or mobile</small></span>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}</button>
        {!projectId && <div className="wallet-setup-note">WalletConnect isn't configured. <button className="text-button" onClick={() => { setError(''); setPanel('settings'); }}>Settings<ArrowUpRight size={12} /></button></div>}
        {!wallets.length && <p className="dialog-footnote">No extension found. Use a mobile wallet.</p>}
        <div className="wallet-safety"><ShieldCheck size={16} /><p>Never share your seed phrase or private key.</p></div>
      </>}
    </Modal>}
    {panel === 'settings' && <Modal title="Settings" onClose={close}>
      <div className="settings-row"><div><strong>Testnet mode</strong><p>Test USDC only.</p></div><button role="switch" aria-checked={testnet} aria-label="Testnet mode" disabled={busy} className={`toggle ${testnet ? 'on' : ''}`} onClick={() => switchMode(!testnet)}><span /></button></div>
      <div className="settings-field"><div className="field-heading"><label htmlFor="project-id">WalletConnect project ID</label><InfoTip label="WalletConnect setup">A public Reown ID for QR and mobile pairing. Allowlist this site's origin in Reown. Browser extensions don't need one.</InfoTip></div><input id="project-id" className="plain-input" value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="32-character project ID" autoComplete="off" spellCheck={false} /><ExternalLink href="https://dashboard.reown.com">Get a project ID</ExternalLink></div>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="primary-button" onClick={() => { try { const id = projectId.trim(); if (id && !/^[a-fA-F0-9]{32}$/.test(id)) throw new Error('A Reown project ID has 32 hexadecimal characters.'); localStorage.setItem('carry.walletconnect.projectId', id); setProjectId(id); close(); } catch (e) { setError(friendlyError(e)); } }}>Save settings<Check size={16} /></button>
    </Modal>}
    {panel === 'review' && quote && <Modal title="Review transfer" onClose={close}>
      <p className="review-overline">Minimum received</p><div className="review-amount">{money(quote.minimumReceived)}<span> USDC</span></div><Route source={source} destination={destination} />
      <dl className="review-details">
        <div><dt>Receiving route</dt><dd>{receivingRouteName(quote.intent.forward)}</dd></div>
        <div><dt>You send</dt><dd>{money(quote.intent.amount)} USDC</dd></div>
        <div><dt>Estimated received</dt><dd>{money(quote.estimatedReceived)} USDC</dd></div>
        <div><dt className="field-heading"><span>USDC fee</span><InfoTip label="Review fee breakdown"><dl className="info-fees"><div><dt>CCTP</dt><dd>{money(quote.cctpFee)} USDC</dd></div><div><dt>Circle receiving</dt><dd>{money(quote.receivingFee)} USDC</dd></div><div><dt>Carry</dt><dd>0 USDC</dd></div></dl>Deducted from USDC. Network gas is separate.</InfoTip></dt><dd>{money(quote.fee)} USDC</dd></div>
        <div><dt>Maximum USDC fee</dt><dd>{money(quote.maxFee)} USDC</dd></div>
        <div><dt className="field-heading"><span>Source gas</span><InfoTip label="Review gas estimate">{quote.warnings.join(' ') || 'Gas is estimated. Your wallet shows the final cost.'}</InfoTip></dt><dd>{gasAmount(quote.sourceGas, source.nativeCurrency.decimals)} {source.nativeCurrency.symbol}</dd></div>
        {!quote.intent.forward && <div><dt>Destination gas</dt><dd>{gasAmount(quote.destinationGas, destination.nativeCurrency.decimals)} {destination.nativeCurrency.symbol}</dd></div>}
        <div><dt>Estimated arrival</dt><dd>{duration(source, quote.intent.speed)}</dd></div>
        <div className="recipient-detail"><dt>Receiving address</dt><dd>{quote.intent.recipient}</dd></div>
      </dl>
      {needsAcknowledgement && <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /><span>I checked the full {quote.contractRecipient ? 'contract ' : ''}address, control it on {prettyName(destination)} and can access its USDC.</span></label>}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="route-note">{quote.intent.forward ? 'Approve if needed, then send in your wallet. Receiving is automatic.' : `Receiving needs a signature and ${destination.nativeCurrency.symbol} on ${prettyName(destination)}.`}</p>
      {!testnet && <Notice tone="warning">Experimental. Live validation pending. Burns cannot be cancelled.</Notice>}
      <button className="primary-button" disabled={busy || !online || !sendingEnabled || Boolean(needsAcknowledgement && !acknowledged)} onClick={remaining > 0 ? send : review}>{busy ? <LoaderCircle size={17} className="spin" /> : remaining > 0 ? <Wallet size={17} /> : <Clock3 size={17} />}{!sendingEnabled ? 'Mainnet sending is disabled' : busy ? busyLabel : remaining > 0 ? 'Confirm & send' : 'Refresh quote'}</button>
      <p className="dialog-footnote">{remaining > 0 ? `Quote expires in ${remaining}s.` : 'Quote expired. Refresh before sending.'} Gas is estimated.</p>
    </Modal>}
    {panel === 'activity' && <Activity transfers={transfers} onSelect={selectTransfer} onRecover={() => openRecovery()} onClose={close} />}
    {panel === 'progress' && current && <Progress transfer={current} busy={busy} connected={Boolean(connection)} externalError={error} tracking={tracking[current.id]} online={online} onClose={close} onConnect={openWallet} onUpdate={observe}
      onRetry={() => reviewUnsent(current)}
      onCheck={() => void run('Checking status', async () => { await syncTransfer(current, observe); })}
      onFinish={() => void run('Finishing receiving', async () => { if (!connection) throw new Error('Connect a wallet to pay destination gas.'); await finishTransfer(current, connection.provider, connection.address, observe); })}
      onRecover={() => openRecovery(current)} onRefresh={() => void run('Refreshing proof', async () => { await refreshProof(current, observe); })}
      onDismiss={() => { if (canDismiss(current)) remember({ ...current, phase: 'cancelled', error: undefined }); close(); }} />}
    {panel === 'recover' && <Modal title="Recover a transfer" onClose={close}>
      <p className="muted dialog-intro">Find a transfer using its source hash. No wallet needed.</p>
      <div className="segmented"><button className={!recoveryTestnet ? 'selected' : ''} onClick={() => { setRecoveryTestnet(false); setRecoverySource('Base'); }} disabled={busy || Boolean(recoveryTarget)}>Mainnet</button><button className={recoveryTestnet ? 'selected' : ''} onClick={() => { setRecoveryTestnet(true); setRecoverySource(listNetworks(true).find(c => c.chain.startsWith('Base'))!.chain); }} disabled={busy || Boolean(recoveryTarget)}>Testnet</button></div>
      <label className="input-label" htmlFor="recovery-source">Sending network</label><select id="recovery-source" className="plain-input" value={recoverySource} disabled={busy || Boolean(recoveryTarget)} onChange={e => setRecoverySource(e.target.value)}>{listNetworks(recoveryTestnet).map(c => <option key={c.chain} value={c.chain}>{prettyName(c)}</option>)}</select>
      <label className="input-label" htmlFor="source-hash">Source transaction hash</label><input id="source-hash" className="plain-input hash-input" value={recoveryHash} onChange={e => setRecoveryHash(e.target.value)} placeholder="0x... from wallet activity" autoComplete="off" spellCheck={false} disabled={busy} />
      {error && <Notice tone="error">{error}</Notice>}
      <button className="primary-button recovery-submit" disabled={busy || !online || !recoveryHash} onClick={() => void run('Finding your transfer', async () => {
        let recovered = await recoverTransfer(network(recoverySource), recoveryHash.trim());
        if (storageError) observe(recovered);
        else recovered = await storeRecovery(recovered, recoveryTarget, observe);
        selectTransfer(recovered.id);
      })}>{busy ? <LoaderCircle size={17} className="spin" /> : <History size={17} />}{busy ? 'Checking transfer...' : 'Find transfer'}</button>
      <p className="dialog-footnote">Use the send hash, not the approval. Recovery never burns again.</p>
    </Modal>}
    {panel === 'help' && <Modal title="About transfers" onClose={close}>
      <div className="help-content">
        <details><summary>Fees and receiving</summary><p>Native USDC only. Convenience pays Circle to receive for you; Manual needs your signature and destination gas. Both need source gas. Carry adds no fee.</p></details>
        <details><summary>Timing</summary><p>Standard CCTP waits for finality, often 15-30 minutes. Linea can take 6-32 hours. Delays are possible.</p></details>
        <details><summary>Recovery</summary><p>Keep the source transaction hash. Activity saves progress in this browser; the hash restores it elsewhere. Recovery never repeats the burn.</p></details>
        <details><summary>Risks</summary><p>{mainnetEnabled ? 'Experimental mainnet build.' : 'Mainnet sending is off.'} Dependencies have no known advisories, but full independent audit and live transfer validation remain outstanding. Circle can pause or restrict transfers. Burns cannot be cancelled.</p></details>
        <details><summary>Hyperliquid</summary><p>USDC arrives in your wallet, not HyperCore. Deposit through Hyperliquid afterwards. Carry provides no privacy feature.</p></details>
        <ExternalLink href="https://developers.circle.com/cctp/concepts/forwarding-service">Circle forwarding</ExternalLink><ExternalLink href="https://docs.arc.io/app-kit/references/bridge-error-recovery">Circle recovery</ExternalLink>
      </div>
    </Modal>}
  </div>;
}
function RotateArrow() { return <History size={14} />; }
