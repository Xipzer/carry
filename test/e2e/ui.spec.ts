// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockServices } from './mocks';
import { baseTransfer, BURN_HASH } from '../fixtures';

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await page.getByRole('button', { name: /Browser wallet/ }).click();
  await expect(page.getByRole('button', { name: '0x1111...1111' })).toBeVisible();
}

test('convenience progresses from finality to receiving to completion without status clicks', async ({ page }) => {
  const options = { attested: false, autoReceive: false };
  const mock = await mockServices(page, options); await page.clock.install(); await page.goto('/'); await connect(page);
  await page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true }).check();
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  await expect(page.getByText(/Circle completes receiving automatically/)).toBeVisible();
  options.attested = true; await page.clock.fastForward(16000);
  await expect(page.getByRole('heading', { name: 'Receiving USDC', exact: true })).toBeVisible();
  options.autoReceive = true; await page.clock.fastForward(16000);
  await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(2);
});

test('reopening a pending transfer detects completion without reconnecting a wallet', async ({ page }) => {
  const options = { attested: false, autoReceive: false };
  const mock = await mockServices(page, options); await page.goto('/'); await connect(page);
  await page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true }).check();
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  options.attested = true; options.autoReceive = true;
  await page.evaluate(() => localStorage.removeItem('carry.wallet')); await page.reload();
  await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(2);
});

test('status tracking resumes immediately after reconnecting to the internet', async ({ page, context }) => {
  const options = { attested: false, autoReceive: false };
  const mock = await mockServices(page, options); await page.goto('/'); await connect(page);
  await page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true }).check();
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  await context.setOffline(true); await expect(page.getByText('Offline. Updates resume when you reconnect.')).toBeVisible();
  options.attested = true; options.autoReceive = true;
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(2);
});

for (const changed of [false, true]) test(`saved approval error offers a fresh review and protects changed records: ${changed}`, async ({ page }) => {
  const mock = await mockServices(page);
  await page.addInitScript(t => localStorage.setItem('carry.transfers.v1', JSON.stringify([t])), {
    ...baseTransfer(), phase: 'attention', sourceIntent: false, burnHash: undefined, approvalHash: BURN_HASH,
    destination: 'HyperEVM', error: 'The approval did not complete. No USDC was sent. Check wallet activity before trying again.',
  });
  await page.route('**/*', async route => {
    if (route.request().method() === 'POST') {
      let body: any; try { body = route.request().postDataJSON(); } catch {}
      if (body?.method === 'eth_call' && body.params[0]?.data?.startsWith('0xdd62ed3e')) {
        await route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result: '0x' + (100000000n).toString(16).padStart(64, '0') } }); return;
      }
    }
    await route.fallback();
  });
  await page.goto('/'); await connect(page);
  await page.getByRole('button', { name: 'Continue your transfer' }).click();
  if (changed) await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('carry.transfers.v1')!); rows[0].sourceIntent = true;
    localStorage.setItem('carry.transfers.v1', JSON.stringify(rows));
  });
  await page.getByRole('button', { name: 'Review again', exact: true }).click();
  if (changed) {
    await expect(page.getByRole('alert')).toContainText('changed'); expect(mock.sent).toHaveLength(0); return;
  }
  await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('HyperEVM'); expect(mock.sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(1); expect(mock.sent[0].data).not.toMatch(/^0x095ea7b3/);
});

test('refresh restores the approved wallet and draft without prompting or restoring a signed review', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('button', { name: 'Use HyperEVM for receiving', exact: true }).click();
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('123.456');
  await page.getByRole('button', { name: 'Your wallet', exact: true }).click();
  await page.getByRole('textbox', { name: 'Receiving wallet address' }).fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.addInitScript(() => {
    const p = (window as any).ethereum, request = p.request.bind(p);
    p.request = (args: any) => { if (args.method === 'eth_requestAccounts' || args.method === 'eth_sendTransaction') throw new Error('Refresh must not prompt'); return request(args); };
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '0x1111...1111' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'USDC amount' })).toHaveValue('123.456');
  await expect(page.getByRole('textbox', { name: 'Receiving wallet address' })).toHaveValue('0x2222222222222222222222222222222222222222');
  await expect(page.getByRole('button', { name: 'To: HyperEVM. Choose network' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Confirm & send' })).toBeDisabled();
  expect(mock.sent).toHaveLength(0);
});

test('refresh preserves an open transfer view without resending, and explicit disconnect persists', async ({ page }) => {
  const mock = await mockServices(page, { history: true }); await page.goto('/'); await connect(page);
  await page.getByRole('button', { name: 'Continue your transfer' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: '0x1111...1111' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('carry.wallet'))).toBeNull();
  expect(mock.sent).toHaveLength(0);
});

test('refresh never restores a revoked wallet account', async ({ page }) => {
  await mockServices(page); await page.goto('/'); await connect(page);
  await page.addInitScript(() => {
    const p = (window as any).ethereum, request = p.request.bind(p);
    p.request = (args: any) => args.method === 'eth_accounts' ? Promise.resolve([]) : request(args);
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '0x1111...1111' })).toHaveCount(0);
});

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
}

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    expect(await dialog.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.left >= 15 && box.right <= innerWidth - 15 && box.top >= 15 && box.bottom <= innerHeight - 15 && el.scrollWidth <= el.clientWidth;
    })).toBe(true);
  }
}

test('dark is the default even with a light system preference; the choice survives reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mockServices(page); await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#101318');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('carry.theme'))).toBe('light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f6f9');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the stored theme is applied before the React bundle runs', async ({ page }) => {
  await mockServices(page);
  await page.route('**/src/main.tsx', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#root')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.setItem('carry.theme', 'light'));
  await page.reload();
  await expect(page.locator('#root')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f6f9');
});

test('theme choices sync between open tabs', async ({ page, context }) => {
  await mockServices(page); await page.goto('/');
  const other = await context.newPage(); await mockServices(other); await other.goto('/');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await other.close();
});

test('the theme toggle still works when browser storage refuses writes', async ({ page }) => {
  await mockServices(page, { storage: 'unavailable' }); await page.goto('/');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('detail popovers support keyboard dismissal, light dismissal and viewport edges', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Fee breakdown', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const fees = page.getByRole('note', { name: 'Fee breakdown', exact: true });
  await expect(fees).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(await fees.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 15 && box.right <= innerWidth - 15 && box.top >= 15 && box.bottom <= innerHeight - 15; })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(fees).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { name: 'Transfer USDC', exact: true }).click();
  await expect(fees).toBeHidden();
  await page.getByRole('button', { name: 'Receiving options', exact: true }).click();
  await expect(page.getByRole('note', { name: 'Receiving options' })).toContainText('Both need source gas.');
  await trigger.click();
  await expect(page.locator('[popover]:popover-open')).toHaveCount(1);
  await expect(fees).toBeVisible();
});

test('Escape closes a dialog popover before closing its parent dialog', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  await page.getByRole('button', { name: 'Connection and network settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('button', { name: 'WalletConnect setup' }).click();
  const note = dialog.getByRole('note', { name: 'WalletConnect setup' });
  await expect(note).toBeVisible(); await page.keyboard.press('Escape');
  await expect(note).toBeHidden(); await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

test('dialog padding does not dismiss the dialog, but the actual backdrop does', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Connection and network settings' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const box = await dialog.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 6, box!.y + box!.height / 2);
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('panels, receiving options and dialogs share the spacing and radius tokens', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const values = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return {
      card: style('.transfer-card').borderRadius,
      panels: ['.send-panel', '.receive-panel'].map(selector => ({ padding: style(selector).padding, radius: style(selector).borderRadius, width: box(selector).width, left: box(selector).left })),
      choices: [...document.querySelectorAll('.receiving-option')].map(el => ({ height: el.getBoundingClientRect().height, padding: getComputedStyle(el).padding, radius: getComputedStyle(el).borderRadius })),
    };
  });
  expect(values.card).toBe('24px'); expect(values.panels[0]).toEqual(values.panels[1]);
  expect(values.panels[0].radius).toBe('16px'); expect(values.choices[0]).toEqual(values.choices[1]);
  expect(values.choices[0].padding).toBe('12px'); expect(values.choices[0].radius).toBe('12px');
  await page.getByRole('button', { name: 'Connection and network settings' }).click();
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).borderRadius)).toBe(values.card);
});

test('320px layouts keep presets inline, amounts readable and all dialogs contained', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 720 });
  await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true }).check();
  const amount = page.getByRole('textbox', { name: 'USDC amount' });
  await amount.fill('100.123456');
  await expect(page.getByTestId('received-amount')).toHaveText('100.023456 USDC');
  expect(await amount.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const value of ['10000000', '10000000.000000', '9999999.999999', '0.000001']) {
    await amount.fill(value); expect(await amount.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await amount.fill('100.123456');
  const presets = await page.getByRole('group', { name: 'Destination presets' }).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
  expect(presets[0]).toBe(presets[1]); await contained(page);
  await page.getByRole('button', { name: 'Connection and network settings' }).click(); await contained(page);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible(); await contained(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Recover an existing transfer' }).click(); await contained(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'To: Arbitrum. Choose network' }).click(); await contained(page);
  await page.getByRole('textbox', { name: 'Search networks' }).fill('no-such-network');
  await expect(page.getByText('No matching CCTP networks.')).toBeVisible();
});

for (const theme of ['dark', 'light']) {
  test(`form and supporting dialogs are accessible in ${theme} mode`, async ({ page }) => {
    test.setTimeout(120000);
    await mockServices(page); await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await accessible(page);
    for (const name of ['Connection and network settings', 'Connect wallet', 'Activity', 'Recover an existing transfer', 'About']) {
      await page.getByRole('button', { name, exact: true }).last().click();
      await expect(page.getByRole('dialog')).toBeVisible(); await contained(page); await accessible(page);
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
    await page.getByRole('button', { name: 'Fee breakdown', exact: true }).click();
    await expect(page.getByRole('note', { name: 'Fee breakdown', exact: true })).toBeVisible(); await accessible(page);
  });

  test(`review, pending and completed transfers are accessible in ${theme} mode`, async ({ page }) => {
    test.setTimeout(120000);
    const mock = await mockServices(page, { attested: true }); await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await connect(page); await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
    await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible();
    await contained(page); await accessible(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Maximum USDC fee', { exact: true }).locator('..')).toContainText('0 USDC');
    await expect(dialog.locator('.recipient-detail')).toContainText('0x1111111111111111111111111111111111111111');
    await dialog.getByRole('button', { name: 'Review fee breakdown' }).click();
    await accessible(page); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Receive USDC', exact: true })).toBeEnabled();
    await expect(page.getByText('Do not send the source USDC again.')).toBeVisible();
    await contained(page); await accessible(page);
    await page.getByRole('button', { name: 'Receive USDC', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible();
    await contained(page); await accessible(page); expect(mock.sent).toHaveLength(3);
  });

  test(`warnings and errors remain readable in ${theme} mode`, async ({ page }, testInfo) => {
    const mock = await mockServices(page, { noGas: true }); await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await connect(page); await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
    await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('gas'); await accessible(page);
    await page.screenshot({ path: testInfo.outputPath('funding-error.png'), fullPage: true, scale: 'css' });
    await page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true }).check();
    await page.getByRole('button', { name: 'To: Arbitrum. Choose network' }).click();
    await page.getByRole('textbox', { name: 'Search networks' }).fill('Cronos');
    await page.getByRole('button', { name: /Cronos/ }).click();
    await expect(page.getByText('Convenience is unavailable here. Choose Manual or another network.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review transfer', exact: true })).toBeDisabled();
    await contained(page); await accessible(page); expect(mock.sent).toHaveLength(0);
  });

  test(`the local pairing QR is readable and accessible in ${theme} mode`, async ({ page }, testInfo) => {
    await mockServices(page); await page.goto('/');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await page.evaluate(async () => {
      const path = '/src/pairing.ts';
      const { pairingDialog } = await import(path);
      const dialog = pairingDialog(() => dialog.close());
      await dialog.show(`wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(32)}`);
    });
    const dialog = page.getByRole('dialog', { name: 'Connect with WalletConnect' });
    const qr = dialog.getByRole('img', { name: 'WalletConnect pairing QR code' });
    await expect.poll(() => qr.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth === 256)).toBe(true);
    await contained(page); await accessible(page);
    await dialog.screenshot({ path: testInfo.outputPath('pairing.png'), scale: 'css' });
    await page.getByRole('button', { name: 'Cancel connection' }).click(); await expect(dialog).toHaveCount(0);
  });
}

test('supporting help stays collapsed until requested and theme changes keep the form intact', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Your wallet', exact: true }).click();
  await page.getByRole('textbox', { name: 'Receiving wallet address' }).fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.getByRole('textbox', { name: 'USDC amount' })).toHaveValue('100');
  await expect(page.getByRole('textbox', { name: 'Receiving wallet address' })).toHaveValue('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByText(/Burns cannot be cancelled/)).toBeHidden();
  await page.locator('summary').filter({ hasText: 'Risks' }).click();
  await expect(page.getByText(/Burns cannot be cancelled/)).toBeVisible();
  expect(mock.sent).toHaveLength(0);
});
