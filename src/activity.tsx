// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { Check, CheckCircle2, Circle, Clock3, Copy, Download, ExternalLink as ExternalIcon, LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { attachMintHash } from './bridge';
import { duration, explorer, network, prettyName } from './chains';
import { ExternalLink, Modal, Notice, Route } from './components';
import { canDismiss, friendlyError, money, shortAddress, type Transfer } from './model';
import { HyperliquidNextStep, receivingRouteName } from './receiving';
import type { TrackingStatus } from './tracking';

export const phaseLabel = (t: Transfer) => ({ prepared: 'Preparing transfer', approving: 'USDC approval', 'source-signing': 'Confirm transfer', 'source-pending': 'Source transaction pending', attesting: 'Transfer pending', ready: t.forward ? 'Receiving USDC' : 'Ready to receive', 'mint-signing': 'Confirm receiving', 'mint-pending': 'Receiving USDC', complete: 'Complete', attention: 'Action required', cancelled: 'Dismissed' })[t.phase];

export function exportTransfers(transfers: Transfer[]) {
  const blob = new Blob([JSON.stringify({ app: 'Carry', version: 1, exportedAt: new Date().toISOString(), transfers }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `carry-recovery-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Activity({ transfers, onSelect, onRecover, onClose }: { transfers: Transfer[]; onSelect: (id: string) => void; onRecover: () => void; onClose: () => void }) {
  return <Modal title="Activity" onClose={onClose} wide>
    {!transfers.length ? <div className="empty-state"><Clock3 size={28} /><p>No transfers yet.</p></div> : <div className="activity-list">{transfers.map(t => <button className="activity-row" key={t.id} onClick={() => onSelect(t.id)}>
      <span className={`activity-symbol ${t.phase === 'complete' ? 'success' : ''}`}>{t.phase === 'complete' ? <Check size={20} /> : t.phase === 'attention' ? <TriangleAlert size={19} /> : <Clock3 size={19} />}</span>
      <span><strong>{money(t.amount)} USDC</strong><small>{prettyName(network(t.source))} to {prettyName(network(t.destination))}{network(t.source).isTestnet ? ' (testnet)' : ''}</small></span>
      <span className="activity-state"><strong>{phaseLabel(t)}</strong><small>{new Date(t.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span>
    </button>)}</div>}
    <div className="activity-actions"><button className="secondary-button" onClick={onRecover}><RotateCcw size={15} />Recover a transfer</button>{transfers.length > 0 && <button className="text-button" onClick={() => exportTransfers(transfers)}><Download size={15} />Export history</button>}</div>
    <p className="dialog-footnote">Missing a transfer? Recover with its source hash.</p>
  </Modal>;
}

export function Progress({ transfer: t, busy, connected, externalError, tracking, online = true, onClose, onCheck, onFinish, onRecover, onRefresh, onDismiss, onUpdate, onConnect, onRetry }: {
  transfer: Transfer; busy: boolean; connected: boolean; externalError?: string; onClose: () => void; onCheck: () => void; onFinish: () => void; onRecover: () => void; onRefresh: () => void; onDismiss: () => void; onUpdate: (t: Transfer) => void; onConnect: () => void; onRetry: () => void;
  tracking?: TrackingStatus; online?: boolean;
}) {
  const [copied, setCopied] = useState(false), [mintHash, setMintHash] = useState(''), [error, setError] = useState(''), [attaching, setAttaching] = useState(false);
  const source = network(t.source), destination = network(t.destination);
  const complete = t.phase === 'complete', sent = Boolean(t.burnHash) && !t.sourceFailed;
  const index = complete ? 4 : t.mintIntent || t.mintHash || ['mint-signing', 'mint-pending', 'ready'].includes(t.phase) ? 3 : sent ? t.phase === 'source-pending' ? 1 : 2 : t.sourceIntent ? 1 : 0;
  async function attach() {
    setAttaching(true); setError('');
    try { await attachMintHash(t, mintHash.trim(), onUpdate); } catch (e) { setError(friendlyError(e)); } finally { setAttaching(false); }
  }
  return <Modal title={complete ? 'Transfer complete' : phaseLabel(t)} onClose={onClose}>
    <div className={`progress-emblem ${complete ? 'done' : ''}`}>{complete ? <CheckCircle2 size={29} /> : t.phase === 'attention' ? <TriangleAlert size={27} /> : <LoaderCircle size={29} className={busy ? 'spin' : ''} />}</div>
    <div className="progress-amount">{money(complete && t.actualReceived ? t.actualReceived : t.amount)} <span>USDC</span></div>
    <Route source={source} destination={destination} />
    {sent && !complete && t.forward && !t.mintIntent && <p className="automatic-receiving">Circle completes receiving automatically. No more signatures needed. You can close this tab.</p>}
    {complete && <p className="automatic-receiving">USDC arrived in the receiving wallet on {prettyName(destination)}.</p>}
    {!complete && <ol className="step-list">{['Approve USDC', 'Send on ' + prettyName(source), 'Circle confirmation', 'Receive on ' + prettyName(destination)].map((label, i) => <li key={label} className={index > i ? 'step-done' : index === i ? 'step-current' : ''}>
      <span>{index > i ? <Check size={14} /> : <Circle size={9} />}</span><div><strong>{label}</strong>{index === i && <small>{i === 0 ? 'Confirm in your wallet if requested.' : i === 1 ? sent ? 'Waiting for network confirmation.' : 'Confirm in your wallet.' : i === 2 ? duration(source, t.speed) + ' from sending.' : t.forward ? 'Circle pays destination gas.' : `Signature and ${destination.nativeCurrency.symbol} gas needed.`}</small>}</div>
    </li>)}</ol>}
    <div className="transfer-details"><span>Receiving route</span><strong>{receivingRouteName(t.forward)}</strong></div>
    {complete && <HyperliquidNextStep destination={destination} complete />}
    {t.error && <Notice tone={complete ? 'info' : 'warning'}>{t.error}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {externalError && <Notice tone="error">{externalError}</Notice>}
    {sent && !complete && <p className="recovery-reassurance"><ShieldCheck size={16} />Do not send the source USDC again.</p>}
    <div className="transfer-details"><span>Receiving address</span><strong title={t.recipient}>{shortAddress(t.recipient)}</strong></div>
    {t.burnHash && <div className="transaction-link"><ExternalLink href={explorer(source, t.burnHash)}>Source transaction</ExternalLink><button className="text-button" aria-label={copied ? 'Copied source transaction hash' : 'Copy hash: source transaction'} onClick={async () => { try { await navigator.clipboard.writeText(t.burnHash!); setCopied(true); } catch { setError('Clipboard unavailable. Download the recovery details instead.'); } }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy hash'}</button></div>}
    {t.approvalHash && !t.burnHash && <div className="transaction-link"><ExternalLink href={explorer(source, t.approvalHash)}>Token approval transaction</ExternalLink></div>}
    {t.mintHash && <div className="transaction-link"><ExternalLink href={explorer(destination, t.mintHash)}>Receiving transaction</ExternalLink></div>}
    {t.failedMintHash && <div className="transaction-link"><ExternalLink href={explorer(destination, t.failedMintHash)}>Previous receiving attempt</ExternalLink></div>}
    <div className="progress-actions">
      {complete ? <button className="primary-button" onClick={onClose}>Close <Check size={17} /></button> : <>
        {t.phase === 'ready' && !t.forward && <button className="primary-button" disabled={busy} onClick={connected ? onFinish : onConnect}>{busy ? <LoaderCircle size={17} className="spin" /> : <ExternalIcon size={17} />}{connected ? 'Receive USDC' : 'Connect wallet to receive'}</button>}
        {sent && <div className="tracking-status" aria-live="polite"><span className={online && !tracking?.error ? 'tracking-dot' : 'tracking-dot paused'} /><span>{!online ? 'Offline. Updates resume when you reconnect.' : tracking?.error ?? (tracking?.checking ? 'Updating status automatically...' : 'Updates automatically every 15 seconds')}</span></div>}
        {t.burnHash && <button className="text-button status-refresh" disabled={busy || tracking?.checking || !online} onClick={onCheck}><RotateCcw size={14} />Check status</button>}
        {t.phase === 'ready' && t.forward && Date.now() - t.createdAt > 120000 && <details className="recovery-options"><summary>Receiving taking longer?</summary><p>Circle is still receiving automatically. Manual receiving needs {destination.nativeCurrency.symbol} gas; the original USDC fee still applies.</p><button className="secondary-button full" disabled={busy} onClick={connected ? onFinish : onConnect}>{connected ? 'Receive manually' : 'Connect to receive manually'}</button></details>}
        {!t.burnHash && !busy && t.sourceIntent && <button className="primary-button" onClick={onRecover}>Add source transaction hash</button>}
        {t.error?.includes('proof expired') && <button className="secondary-button full" disabled={busy} onClick={onRefresh}>Refresh proof</button>}
      </>}
      {t.mintIntent && !t.mintHash && t.phase === 'attention' && <div className="mint-recovery"><label htmlFor="mint-hash">Destination transaction hash</label><input id="mint-hash" className="plain-input" placeholder="0x... from destination wallet activity" value={mintHash} onChange={e => setMintHash(e.target.value)} /><button className="secondary-button full" disabled={busy || attaching || !mintHash} onClick={attach}>{attaching ? 'Checking...' : 'Verify receiving transaction'}</button></div>}
      {!busy && canDismiss(t) && !['complete', 'cancelled'].includes(t.phase) && <><button className="primary-button" onClick={connected ? onRetry : onConnect}>{connected ? 'Review again' : 'Connect wallet to review'}</button><button className="text-button dismiss-button" onClick={onDismiss}>Dismiss this unsent attempt</button></>}
      <details className="recovery-options"><summary>Recovery details</summary><p>Progress is saved in this browser automatically. Download a backup to recover on another device.</p><button className="text-button export-button" onClick={() => exportTransfers([t])}><Download size={14} />Save recovery details</button></details>
    </div>
    {!sent && t.approvalHash && <p className="dialog-footnote">Dismissing does not revoke the token approval.</p>}
  </Modal>;
}
