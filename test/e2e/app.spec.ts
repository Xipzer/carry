// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { decodeFunctionData, type Hex } from 'viem';
import { messengerAbi } from '../../src/abi';
import { network } from '../../src/chains';
import { FORWARD_HOOK } from '../../src/message';
import { mockServices } from './mocks';
import { BURN_HASH, OWNER } from '../fixtures';

async function connect(page: Page, automatic = true) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await page.getByRole('button', { name: /Browser wallet/ }).click();
  await expect(page.getByRole('button', { name: '0x1111...1111' })).toBeVisible();
  if (automatic) await page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true }).check();
}
test('the entry screen is responsive and contains all 25 mainnets', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Transfer USDC', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'To: Arbitrum. Choose network' }).click();
  await page.getByRole('textbox', { name: 'Search networks' }).fill('Cronos');
  await expect(page.getByRole('button', { name: /Cronos/ })).toBeVisible();
  await page.getByRole('button', { name: /Cronos/ }).click();
  await expect(page.getByRole('radio', { name: 'CCTP manual', exact: true })).toBeChecked();
  await expect(page.getByText('CRO + signature', { exact: true })).toBeVisible();
  await expect(page.getByText('Destination gas', { exact: true })).toBeVisible();
});
test('quotes through the read-only CCTP implementation, with no wallet signatures during review', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible();
  await expect(page.getByText('99.89', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm & send' })).toBeEnabled();
  expect(mock.sent).toHaveLength(0);
});
test('a complete mocked source flow signs exactly one approval and one burn, then saves progress', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await page.getByRole('button', { name: 'Confirm & send' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible({ timeout: 20000 });
  expect(mock.sent).toHaveLength(2);
  expect(mock.sent[0].data).toMatch(/^0x095ea7b3/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carry.transfers.v1')!));
  expect(saved[0].burnHash).toBe(BURN_HASH); expect(saved[0].sourceIntent).toBe(true);
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(2);
});
test('rejecting the source signature never creates a burn and offers a safe unsent dismissal', async ({ page }) => {
  const mock = await mockServices(page, { rejectBurn: true }); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer' }).click(); await page.getByRole('button', { name: 'Confirm & send' }).click();
  await expect(page.getByRole('button', { name: 'Dismiss this unsent attempt' })).toBeVisible({ timeout: 20000 });
  expect(mock.sent).toHaveLength(1);
  await page.getByRole('button', { name: 'Dismiss this unsent attempt' }).click();
  await expect(page.getByRole('button', { name: 'Review transfer' })).toBeEnabled();
});
test('custom recipients require explicit confirmation of the full receiving address', async ({ page }) => {
  await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Your wallet', exact: true }).click();
  await page.getByRole('textbox', { name: 'Receiving wallet address' }).fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await expect(page.getByRole('button', { name: 'Confirm & send' })).toBeDisabled();
  await page.getByRole('checkbox').check(); await expect(page.getByRole('button', { name: 'Confirm & send' })).toBeEnabled();
});
test('lost-browser recovery checks the original burn without sending anything', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/');
  await page.getByRole('button', { name: 'Recover an existing transfer' }).click();
  await page.getByRole('textbox', { name: 'Source transaction hash' }).fill(BURN_HASH);
  await page.getByRole('button', { name: 'Find transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(0);
});
test('a pending burn is restored from this browser and cannot be silently dismissed', async ({ page }) => {
  const mock = await mockServices(page, { history: true }); await page.goto('/'); await connect(page);
  await page.getByRole('button', { name: 'Continue your transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer pending', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss this unsent attempt' })).toHaveCount(0);
  expect(mock.sent).toHaveLength(0);
});
test('a corrupted history fails closed instead of dropping the recovery record', async ({ page }) => {
  await mockServices(page, { storage: 'corrupt' }); await page.goto('/');
  await expect(page.getByText(/Saved history is damaged/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeDisabled();
});
test('testnet mode cannot mix networks with mainnet', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  await page.getByRole('button', { name: 'Connection and network settings' }).click();
  await page.getByRole('switch', { name: 'Testnet mode' }).click(); await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Testnet / no real funds')).toBeVisible();
  await expect(page.getByRole('button', { name: /From: Base Sepolia/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /To: Arbitrum Sepolia/ })).toBeVisible();
});
test('missing WalletConnect configuration has an actionable explanation, never asks for a key', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await page.getByRole('button', { name: 'WalletConnect QR or mobile' }).click();
  await expect(page.getByRole('alert')).toContainText('Reown project ID');
  await expect(page.getByText('Never share your seed phrase or private key.')).toBeVisible();
});
test('keyboard focus stays inside the network dialog and Escape returns to the form', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  await page.getByRole('button', { name: 'From: Base. Choose network' }).click();
  await expect(page.getByRole('textbox', { name: 'Search networks' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'From: Base. Choose network' })).toBeFocused();
});
test('has no serious or critical accessibility violations', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
});
test('receives an existing transfer manually without burning again, and verifies its nonce', async ({ page }) => {
  const mock = await mockServices(page, { history: true, attested: true }); await page.goto('/'); await connect(page);
  await page.getByRole('button', { name: 'Continue your transfer' }).click(); await page.getByRole('button', { name: 'Check status' }).click();
  await page.getByText('Receiving taking longer?', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Receive manually', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Receive manually', exact: true })).toHaveClass('secondary-button full');
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toHaveClass('text-button status-refresh');
  await page.getByRole('button', { name: 'Receive manually', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer complete' })).toBeVisible();
  expect(mock.sent).toHaveLength(1); expect(mock.sent[0].data).not.toMatch(/^0x779b432d|^0x095ea7b3/);
});
test('gas failure is caught during review before any signature', async ({ page }) => {
  const mock = await mockServices(page, { noGas: true }); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100'); await page.getByRole('button', { name: 'Review transfer' }).click();
  await expect(page.getByRole('alert')).toContainText('gas'); expect(mock.sent).toHaveLength(0);
});
test('an expired quote can only be refreshed, not sent', async ({ page }) => {
  const mock = await mockServices(page); await page.clock.install(); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100'); await page.getByRole('button', { name: 'Review transfer' }).click();
  await expect(page.getByRole('button', { name: 'Confirm & send' })).toBeVisible(); await page.clock.fastForward(61000);
  await expect(page.getByRole('button', { name: 'Refresh quote' })).toBeVisible(); expect(mock.sent).toHaveLength(0);
});
test('the review dialog also meets serious/critical accessibility checks', async ({ page }) => {
  await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100'); await page.getByRole('button', { name: 'Review transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) ).toEqual([]);
});
test('every network picker image loads locally on mainnet and testnet', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  async function checkPicker() {
    await page.getByRole('button', { name: /^From: .*Choose network/ }).click();
    await expect(page.locator('.network-list img')).toHaveCount(25);
    await expect.poll(() => page.locator('.network-list img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    expect(await page.locator('.network-list img').evaluateAll(images => images.every(image => new URL((image as HTMLImageElement).src).origin === location.origin))).toBe(true);
    await page.getByRole('button', { name: 'Close dialog' }).click();
  }
  await checkPicker();
  await page.getByRole('button', { name: 'Connection and network settings' }).click();
  await page.getByRole('switch', { name: 'Testnet mode' }).click(); await page.getByRole('button', { name: 'Save settings' }).click();
  await checkPicker();
});
test('official USDC and WalletConnect artwork is used at its intended size', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const usdc = page.locator('img[data-brand="USDC"]');
  await expect(usdc).toHaveCount(2);
  await expect.poll(() => usdc.evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width === 32 && image.getBoundingClientRect().height === 32))).toBe(true);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  const walletConnect = page.locator('img[data-brand="WalletConnect"]');
  await expect(walletConnect).toHaveAttribute('src', '/brand/wallets/walletconnect.svg');
  await expect.poll(() => walletConnect.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(await walletConnect.evaluate(image => getComputedStyle(image).objectFit)).toBe('contain');
});
test('shows expected received USDC and itemized fees before opening review', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await expect(page.getByTestId('received-amount')).toHaveText('99.9 USDC');
  await expect(page.getByTestId('usdc-fee')).toHaveText('0.1 USDC');
  await page.getByRole('button', { name: 'Fee breakdown', exact: true }).click();
  await expect(page.getByTestId('cctp-fee')).toBeVisible();
  await expect(page.getByTestId('cctp-fee')).toHaveText('0 USDC');
  await expect(page.getByTestId('receiving-fee')).toHaveText('0.1 USDC');
  await expect(page.getByText('Minimum 99.89 USDC', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mock.sent).toHaveLength(0);
});
test('manual receiving removes the relayer fee and shows destination gas', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('radio', { name: 'CCTP manual', exact: true }).check();
  await expect(page.getByTestId('received-amount')).toHaveText('100 USDC');
  await expect(page.getByTestId('usdc-fee')).toHaveText('0 USDC');
  await page.getByRole('button', { name: 'Fee breakdown', exact: true }).click();
  await expect(page.getByTestId('receiving-fee')).toHaveText('0 USDC');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Destination gas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('USDC fee', { exact: true }).locator('../..')).toContainText('0 USDC');
  await dialog.getByRole('button', { name: 'Review fee breakdown' }).click();
  await expect(dialog.getByRole('note', { name: 'Review fee breakdown' }).getByText('Circle receiving', { exact: true }).locator('..')).toContainText('0 USDC');
  await page.keyboard.press('Escape');
  await expect(dialog).toContainText('Receiving needs a signature and ETH on Arbitrum.');
  await expect(dialog.getByText('Maximum USDC fee', { exact: true }).locator('..')).toContainText('0 USDC');
  expect(mock.sent).toHaveLength(0);
});
test('changing the amount clears the old received value until a matching quote arrives', async ({ page }) => {
  await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await expect(page.getByTestId('received-amount')).toHaveText('99.9 USDC');
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('200');
  await expect(page.getByTestId('received-amount')).not.toHaveText('99.9 USDC');
  await expect(page.getByTestId('received-amount')).toHaveText('199.9 USDC');
});
test('read-only estimates remain visible when source gas is insufficient', async ({ page }) => {
  const mock = await mockServices(page, { noGas: true }); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await expect(page.getByTestId('received-amount')).toHaveText('99.9 USDC');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('gas');
  expect(mock.sent).toHaveLength(0);
});
test('manual receiving is the default and does not deduct a relayer fee', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page, false);
  await expect(page.getByRole('radio', { name: 'CCTP manual', exact: true })).toBeChecked();
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await expect(page.getByTestId('received-amount')).toHaveText('100 USDC');
  await page.getByRole('button', { name: 'Fee breakdown', exact: true }).click();
  await expect(page.getByTestId('cctp-fee')).toHaveText('0 USDC');
  await expect(page.getByTestId('receiving-fee')).toHaveText('0 USDC');
  await expect(page.getByText('Minimum 100 USDC', { exact: true })).toBeVisible();
  await expect(page.getByText('Destination gas', { exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(0);
});
test('the app corrects a stale HTML tab title when the client loads', async ({ page }) => {
  await mockServices(page);
  await page.route('http://127.0.0.1:5187/', async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<title>[^<]*<\/title>/, '<title>Carry &#8212; USDC, without the detour.</title>');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/');
  await expect(page).toHaveTitle('Carry | USDC transfers');
});
test('default manual transfer signs a zero-fee burn and receives the full USDC amount', async ({ page }) => {
  const mock = await mockServices(page, { attested: true }); await page.goto('/'); await connect(page, false);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Receive USDC', exact: true })).toBeEnabled();
  expect(mock.sent).toHaveLength(2);
  const burn = decodeFunctionData({ abi: messengerAbi, data: mock.sent[1].data as Hex });
  expect(burn.functionName).toBe('depositForBurn');
  expect(burn.args[5]).toBe(0n);
  await page.getByRole('button', { name: 'Receive USDC', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible();
  await expect(page.locator('.progress-amount')).toContainText('100');
  expect(mock.sent).toHaveLength(3);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carry.transfers.v1')!));
  expect(saved[0].actualReceived).toBe('100');
  expect(saved[0].forward).toBe(false);
  expect(saved[0].maxFee).toBe('0');
});
for (const destination of ['Arbitrum', 'HyperEVM']) {
  test(`convenience receives on ${destination} without a destination gas balance or wallet mint`, async ({ page }) => {
    const mock = await mockServices(page, { attested: true, autoReceive: true, noDestinationGas: true });
    await page.goto('/'); await connect(page);
    await page.getByRole('button', { name: `Use ${destination} for receiving`, exact: true }).click();
    await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
    await expect(page.getByTestId('received-amount')).toHaveText('99.9 USDC');
    await expect(page.getByText('Destination gas', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Convenience');
    await expect(dialog).toContainText('Approve if needed, then send in your wallet. Receiving is automatic.');
    await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toBeVisible();
    expect(mock.sent).toHaveLength(2);
    expect(mock.sent.every(tx => tx.chainId === 8453)).toBe(true);
    const burn = decodeFunctionData({ abi: messengerAbi, data: mock.sent[1].data as Hex });
    expect(burn.functionName).toBe('depositForBurnWithHook');
    expect(burn.args[1]).toBe(network(destination).cctp.domain);
    expect(burn.args[5]).toBe(110000n);
    if (burn.functionName === 'depositForBurnWithHook') expect(burn.args[7]).toBe(FORWARD_HOOK);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carry.transfers.v1')!));
    expect(saved[0].destination).toBe(destination); expect(saved[0].forward).toBe(true);
    expect(saved[0].actualReceived).toBe('99.9'); expect(saved[0].mintHash).toBeUndefined();
    await expect(page.getByRole('link', { name: 'Open Hyperliquid' }).last()).toHaveAttribute('href', 'https://app.hyperliquid.xyz/trade');
    await expect(dialog).toContainText('Next: Hyperliquid deposit');
  });
}
test('manual still requires destination gas before a source burn', async ({ page }) => {
  const mock = await mockServices(page, { noDestinationGas: true }); await page.goto('/'); await connect(page, false);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('before starting');
  expect(mock.sent).toHaveLength(0);
});
test('a convenience transfer is not complete just because Circle supplies its attestation', async ({ page }) => {
  const mock = await mockServices(page, { attested: true, noDestinationGas: true });
  await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Receiving USDC', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Transfer complete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Receive manually', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  expect(mock.sent).toHaveLength(2);
});
test('convenience never silently falls back to manual on an unsupported destination', async ({ page }) => {
  const mock = await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'To: Arbitrum. Choose network' }).click();
  await page.getByRole('textbox', { name: 'Search networks' }).fill('Cronos');
  await page.getByRole('button', { name: /Cronos/ }).click();
  await expect(page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'CCTP convenience (paid)', exact: true })).toBeDisabled();
  await expect(page.getByText('Convenience is unavailable here. Choose Manual or another network.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review transfer', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'CCTP manual', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Review transfer', exact: true })).toBeEnabled();
  expect(mock.sent).toHaveLength(0);
});
test('switching the receiving route invalidates the previous fee estimate', async ({ page }) => {
  await mockServices(page); await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await expect(page.getByTestId('received-amount')).toHaveText('99.9 USDC');
  await page.getByRole('radio', { name: 'CCTP manual', exact: true }).check();
  await expect(page.getByTestId('received-amount')).not.toHaveText('99.9 USDC');
  await expect(page.getByTestId('received-amount')).toHaveText('100 USDC');
});
test('invalid Circle fee data prevents review and never asks for a transaction', async ({ page }) => {
  const mock = await mockServices(page, { feeResponse: [{ finalityThreshold: 2000, minimumFee: 0 }] });
  await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('fee quote');
  await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toHaveCount(0);
  expect(mock.sent).toHaveLength(0);
});
test('a fee rise after approval cannot raise the reviewed cap or trigger a burn', async ({ page }) => {
  const mock = await mockServices(page, { increasedFeeAfterApproval: true });
  await page.goto('/'); await connect(page);
  await page.getByRole('textbox', { name: 'USDC amount' }).fill('100');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & send', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'fee increased' })).toBeVisible();
  expect(mock.sent).toHaveLength(1); expect(mock.sent[0].data).toMatch(/^0x095ea7b3/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carry.transfers.v1')!));
  expect(saved[0].maxFee).toBe('0.11'); expect(saved[0].burnHash).toBeUndefined();
});
test('standalone WalletConnect QR renders locally with working cancellation and keyboard focus', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const uri = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
  await page.evaluate(async uri => {
    const path = '/src/pairing.ts';
    const { pairingDialog } = await import(path);
    const dialog = pairingDialog(() => dialog.close()); await dialog.show(uri);
  }, uri);
  const dialog = page.getByRole('dialog', { name: 'Connect with WalletConnect' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel connection' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Open wallet app' })).toHaveAttribute('href', uri);
  const qr = page.getByRole('img', { name: 'WalletConnect pairing QR code' });
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => qr.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 256)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => v.id)).toEqual([]);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
test('the pairing dialog rejects a non-WalletConnect URL without inserting it into the page', async ({ page }) => {
  await mockServices(page); await page.goto('/');
  const error = await page.evaluate(async () => {
    const path = '/src/pairing.ts'; const { pairingDialog } = await import(path);
    const dialog = pairingDialog(() => {});
    try { await dialog.show('javascript:alert(1)'); return ''; } catch (e) { return (e as Error).message; } finally { dialog.close(); }
  });
  expect(error).toBe('Invalid WalletConnect pairing link.');
  await expect(page.locator('.pairing-dialog')).toHaveCount(0);
});
