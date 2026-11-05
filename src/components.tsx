// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight, Check, ChevronDown, Info, Search, Wallet, X } from 'lucide-react';
import { canForward, listNetworks, prettyName, type Network } from './chains';
import { brand, networkBrand } from './brand';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), label = useId();
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    el.querySelector<HTMLElement>('[data-dialog-focus]')?.focus();
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    el.addEventListener('cancel', cancel);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { el.removeEventListener('cancel', cancel); el.close(); document.body.style.overflow = original; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby={label} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
  }}>
    <div className="dialog-heading"><h2 id={label}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

export function ChainIcon({ chain, small = false }: { chain: Network; small?: boolean }) {
  const asset = networkBrand(chain);
  return <span className={`chain-badge ${small ? 'small' : ''}`} aria-hidden="true"><span className={`chain-icon ${small ? 'small' : ''}`}>
    <img src={asset.file} data-brand={asset.key} width={small ? 20 : 25} height={small ? 20 : 25} alt="" draggable={false} />
  </span></span>;
}
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  function position() {
    if (!trigger.current || !panel.current?.matches(':popover-open')) return;
    const anchor = trigger.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
    panel.current.style.left = `${Math.max(16, Math.min(innerWidth - box.width - 16, anchor.left + anchor.width / 2 - box.width / 2))}px`;
    panel.current.style.top = `${Math.max(16, anchor.bottom + 8 + box.height > innerHeight - 16 ? anchor.top - box.height - 8 : anchor.bottom + 8)}px`;
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  return <><button ref={trigger} type="button" className="info-trigger" aria-label={label} aria-expanded={open} aria-controls={id} popoverTarget={id}><Info size={14} /></button>
    <div ref={panel} id={id} popover="auto" role="note" aria-label={label} className="info-panel" onToggle={() => { const visible = panel.current?.matches(':popover-open') ?? false; setOpen(visible); if (visible) position(); }}>{children}</div></>;
}
export function UsdcIcon() { return <img className="usdc-icon" src={brand('USDC').file} data-brand="USDC" width={32} height={32} alt="" aria-hidden="true" draggable={false} />; }
export function WalletConnectIcon() { return <img className="wc-icon" src={brand('WalletConnect').file} data-brand="WalletConnect" width={35} height={35} alt="" aria-hidden="true" draggable={false} />; }
export function InstalledWalletIcon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`wallet-option-icon ${icon && !failed ? 'has-official-icon' : ''}`} aria-hidden="true">
    {icon && !failed ? <img src={icon} width={35} height={35} alt="" draggable={false} onError={() => setFailed(true)} /> : <Wallet size={20} />}
  </span>;
}
export function NetworkButton({ chain, label, onClick, disabled }: { chain: Network; label: string; onClick: () => void; disabled?: boolean }) {
  return <button className="network-button" onClick={onClick} disabled={disabled} aria-label={`${label}: ${prettyName(chain)}. Choose network`}><ChainIcon chain={chain} /><span>{prettyName(chain)}</span><ChevronDown size={16} /></button>;
}
export function NetworkPicker({ testnet, current, excluded, onSelect, onClose, title }: { testnet: boolean; current: Network; excluded?: string; onSelect: (c: Network) => void; onClose: () => void; title: string }) {
  const [search, setSearch] = useState('');
  const choices = listNetworks(testnet).filter(c => `${c.name} ${c.chainId}`.toLowerCase().includes(search.toLowerCase()));
  return <Modal title={title} onClose={onClose}>
    <label className="search-field"><Search size={18} /><input data-dialog-focus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search networks" aria-label="Search networks" /></label>
    <div className="network-list">{choices.length ? choices.map(c => <button key={c.chain} disabled={c.chain === excluded} className="network-option" onClick={() => onSelect(c)}>
      <ChainIcon chain={c} /><span><strong>{prettyName(c)}</strong><small>{c.chain === excluded ? 'Already selected' : canForward(c) ? 'Convenience or manual' : `Manual / ${c.nativeCurrency.symbol} gas`}</small></span>{c.chain === current.chain && <Check size={18} />}
    </button>) : <p className="empty-text">No matching CCTP networks.</p>}</div>
    <p className="dialog-footnote">{listNetworks(testnet).length} {testnet ? 'testnets' : 'networks'} / Circle CCTP</p>
  </Modal>;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'error' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Route({ source, destination }: { source: Network; destination: Network }) {
  return <div className="route-preview"><span><ChainIcon chain={source} small />{prettyName(source)}</span><ArrowDown size={16} /><span><ChainIcon chain={destination} small />{prettyName(destination)}</span></div>;
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13} /></a>;
}
