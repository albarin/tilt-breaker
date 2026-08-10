import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { avatarItem, detectedUsernameItem } from '../state/storage';
import { watchAccount } from './account.svelte';

beforeEach(() => {
  fakeBrowser.reset();
});

/** Both pages render straight off this, and neither has a test of its own. */
describe('watchAccount', () => {
  it('reads what is already stored', async () => {
    await detectedUsernameItem.setValue('crabinloan');
    await avatarItem.setValue('https://img/a.png');

    const { account, stop } = watchAccount();
    await vi.waitFor(() => expect(account.name).toBe('crabinloan'));
    expect(account.avatar).toBe('https://img/a.png');
    stop();
  });

  /** Detection lands seconds after install, and an open page must fill itself in. */
  it('picks up an account that lands later, and says so', async () => {
    let told = 0;
    const { account, stop } = watchAccount(() => told++);
    expect(account.name).toBeNull();

    await detectedUsernameItem.setValue('crabinloan');
    await vi.waitFor(() => expect(account.name).toBe('crabinloan'));
    expect(told).toBeGreaterThan(0);
    stop();
  });

  /**
   * The reads start before the watches can fire, so a sign-out arriving first must not be
   * undone by a read that was already in flight.
   */
  it('a watch beats a read that started earlier', async () => {
    await detectedUsernameItem.setValue('crabinloan');

    const { account, stop } = watchAccount();
    await detectedUsernameItem.setValue(null);

    await vi.waitFor(() => expect(account.name).toBeNull());
    stop();
  });

  it('a failed avatar goes away and stays away', async () => {
    await avatarItem.setValue('https://img/broken.png');
    const { account, stop } = watchAccount();
    await vi.waitFor(() => expect(account.avatar).toBe('https://img/broken.png'));

    account.dropAvatar();
    flushSync();
    expect(account.avatar).toBeNull();
    stop();
  });

  it('stops listening when told to', async () => {
    const { account, stop } = watchAccount();
    stop();

    await detectedUsernameItem.setValue('crabinloan');
    expect(account.name).toBeNull();
  });
});
