// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
export function pairingDialog(onCancel: () => void) {
  const dialog = document.createElement('dialog'), heading = document.createElement('h2');
  const description = document.createElement('p'), image = document.createElement('img');
  const open = document.createElement('a'), copy = document.createElement('button'), cancel = document.createElement('button');
  const status = document.createElement('p'), previous = document.activeElement as HTMLElement | null;
  let closed = false, revision = 0;
  dialog.className = 'dialog pairing-dialog';
  heading.id = `pairing-${crypto.randomUUID()}`; heading.textContent = 'Connect with WalletConnect';
  dialog.setAttribute('aria-labelledby', heading.id);
  description.textContent = 'Scan, open a compatible wallet, or copy the link. Connecting sends no funds.';
  image.alt = 'WalletConnect pairing QR code'; image.width = image.height = 256; image.hidden = true;
  open.textContent = 'Open wallet app'; open.className = 'secondary-button';
  copy.textContent = 'Copy connection link'; copy.className = 'secondary-button';
  cancel.textContent = 'Cancel connection'; cancel.className = 'text-button';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  cancel.onclick = onCancel;
  dialog.addEventListener('cancel', event => { event.preventDefault(); onCancel(); });
  dialog.append(heading, description, image, open, copy, cancel, status);
  return {
    async show(uri: unknown) {
      if (closed) return;
      if (typeof uri !== 'string' || uri.length > 4096 || !/^wc:[0-9a-f]{64}@2\?/i.test(uri)) throw new Error('Invalid WalletConnect pairing link.');
      const current = ++revision;
      open.href = uri;
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(uri); status.textContent = 'Link copied. Keep it private.'; }
        catch { status.textContent = 'Clipboard unavailable. Scan the QR code or open your wallet app.'; }
      };
      if (!dialog.isConnected) { document.body.append(dialog); dialog.showModal(); cancel.focus(); }
      const { toDataURL } = await import('qrcode');
      const src = await toDataURL(uri, { errorCorrectionLevel: 'M', margin: 4, width: 256 });
      if (!closed && current === revision) { image.src = src; image.hidden = false; }
    },
    close() { closed = true; dialog.close(); dialog.remove(); previous?.focus(); },
  };
}
