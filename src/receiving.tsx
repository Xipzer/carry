// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { canForward, listNetworks, prettyName, type Network } from './chains';
import { ChainIcon, ExternalLink, InfoTip } from './components';

export type ReceivingMode = 'manual' | 'automatic';
export function initialReceivingMode(): ReceivingMode {
  return import.meta.env.VITE_DEFAULT_RECEIVING === 'automatic' ? 'automatic' : 'manual';
}
export function receiveAutomatically(mode: ReceivingMode, destination: Network) {
  if (mode === 'automatic' && !canForward(destination)) throw new Error('Convenience receiving is not available on this network. Choose Manual or another destination.');
  return mode === 'automatic';
}
export const receivingRouteName = (forward: boolean) => forward ? 'Convenience' : 'Manual';
export const isHyperliquidDestination = (c: Network) => !c.isTestnet && ['Arbitrum', 'HyperEVM'].includes(c.chain);
export function fundingNetworks(testnet: boolean) {
  const choices = listNetworks(testnet);
  return ['Arbitrum', 'HyperEVM'].flatMap(id => choices.filter(c => c.chain === id || c.chain.startsWith(id + '_')));
}

export function FundingDestinations({ source, destination, disabled, onSelect }: {
  source: Network; destination: Network; disabled: boolean; onSelect: (c: Network) => void;
}) {
  return <div className="funding-destinations" role="group" aria-label="Destination presets">
    <div>{fundingNetworks(destination.isTestnet).map(c => <button key={c.chain} type="button" aria-label={`Use ${prettyName(c)} for receiving`} aria-pressed={destination.chain === c.chain}
      disabled={disabled || source.chain === c.chain} onClick={() => onSelect(c)}><ChainIcon chain={c} small />{prettyName(c)}</button>)}</div>
  </div>;
}

export function ReceivingOptions({ mode, destination, disabled, onChange }: {
  mode: ReceivingMode; destination: Network; disabled: boolean; onChange: (mode: ReceivingMode) => void;
}) {
  return <fieldset className="receiving-routes" disabled={disabled}>
    <legend><span>Receiving</span><InfoTip label="Receiving options">Convenience: Circle receives for you and deducts its fee from USDC. You need no destination gas or receiving signature. Manual: you sign and pay {destination.nativeCurrency.symbol} on {prettyName(destination)}. Both need source gas.</InfoTip></legend>
    <label className={`receiving-option ${mode === 'automatic' ? 'selected' : ''} ${!canForward(destination) ? 'unavailable' : ''}`}>
      <input type="radio" name="receiving-route" value="automatic" aria-label="CCTP convenience (paid)" checked={mode === 'automatic'} disabled={!canForward(destination)} onChange={() => onChange('automatic')} />
      <span><strong>Convenience</strong><small>{canForward(destination) ? 'No destination gas' : 'Unavailable'}</small></span>
    </label>
    <label className={`receiving-option ${mode === 'manual' ? 'selected' : ''}`}>
      <input type="radio" name="receiving-route" value="manual" aria-label="CCTP manual" checked={mode === 'manual'} onChange={() => onChange('manual')} />
      <span><strong>Manual</strong><small>{destination.nativeCurrency.symbol} + signature</small></span>
    </label>
  </fieldset>;
}

export function HyperliquidNextStep({ destination, complete = false }: { destination: Network; complete?: boolean }) {
  if (!isHyperliquidDestination(destination)) return null;
  return <div className="hyperliquid-next-step">
    <span>{complete ? 'Next: Hyperliquid deposit' : 'Using Hyperliquid?'}</span>
    <InfoTip label="Hyperliquid deposit">USDC arrives in your wallet on {prettyName(destination)}, not your HyperCore balance. Deposit through Hyperliquid afterwards. Its fees and sponsored-deposit options are separate.</InfoTip>
    <ExternalLink href="https://app.hyperliquid.xyz/trade">Open Hyperliquid</ExternalLink>
  </div>;
}
