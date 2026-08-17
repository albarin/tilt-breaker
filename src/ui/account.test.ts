import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { avatarItem, detectedUsernameItem, rememberRatings } from '../state/storage';
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

  it('carries the ratings of the account on screen', async () => {
    await detectedUsernameItem.setValue('crabinloan');
    await rememberRatings('crabinloan', 'played', { bullet: 1204 });

    const { account, stop } = watchAccount();
    await vi.waitFor(() => expect(account.ratings).toEqual({ bullet: 1204 }));
    stop();
  });

  /**
   * The profile is read on a timer and the archive with every game, so the two disagree
   * for as long as it takes the slower one to come round — and for that minute the played
   * one is the number you were just given.
   */
  it('prefers what a game type was last played to over what the profile says', async () => {
    await detectedUsernameItem.setValue('crabinloan');
    await rememberRatings('crabinloan', 'profile', { bullet: 1204, rapid: 1455 });
    await rememberRatings('crabinloan', 'played', { bullet: 1192 });

    const { account, stop } = watchAccount();
    await vi.waitFor(() => expect(account.ratings).toEqual({ bullet: 1192, rapid: 1455 }));
    stop();
  });

  /**
   * The name and the ratings are stored apart and land in either order, so a sign-in
   * whose fetch has not caught up must show nothing rather than the previous player's
   * numbers beside your game types.
   */
  it('shows nothing while the stored ratings belong to someone else', async () => {
    await detectedUsernameItem.setValue('crabinloan');
    await rememberRatings('someoneelse', 'played', { bullet: 2400 });

    const { account, stop } = watchAccount();
    await vi.waitFor(() => expect(account.name).toBe('crabinloan'));
    expect(account.ratings).toEqual({});

    await rememberRatings('crabinloan', 'played', { bullet: 1204 });
    await vi.waitFor(() => expect(account.ratings).toEqual({ bullet: 1204 }));
    stop();
  });

  it('stops listening when told to', async () => {
    const { account, stop } = watchAccount();
    stop();

    await detectedUsernameItem.setValue('crabinloan');
    expect(account.name).toBeNull();
  });
});
