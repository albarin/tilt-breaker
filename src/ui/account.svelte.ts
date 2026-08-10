import { avatarItem, detectedUsernameItem } from '../state/storage';

/** What both pages say when no chess.com tab has reported an account yet. */
export const NO_ACCOUNT_HINT = 'It can take a while, so come back in a minute.';

export type Account = {
  /** The detected account, or `null` until a chess.com tab reports one. */
  readonly name: string | null;
  /** Its avatar. Decoration, so `null` is ordinary rather than a failure. */
  readonly avatar: string | null;
  /** Call when the image fails to load: the name and everything else stay. */
  dropAvatar: () => void;
};

/**
 * The detected account, kept current.
 *
 * Both the popup and the settings page show it and both had grown their own copy of this,
 * which had already drifted apart in wording. Detection needs a chess.com tab to report
 * in, seconds after install, and the avatar lands a moment after the name — so an
 * already-open page has to fill itself in rather than tell you to reopen it.
 *
 * Watches those two keys and no others: reacting to every storage write would answer the
 * day snapshot our own sync just caused.
 *
 * Call inside a component's `onMount` and run the returned function on teardown.
 */
export function watchAccount(onChange?: () => void): { account: Account; stop: () => void } {
  let name = $state<string | null>(null);
  let avatar = $state<string | null>(null);
  // Whether a watch has spoken for that key yet. Not a null check: a watch reporting
  // `null` — the account signed out — must not be undone by a read that started earlier.
  let nameLive = false;
  let avatarLive = false;

  const unwatch = [
    detectedUsernameItem.watch((value) => {
      nameLive = true;
      name = value;
      onChange?.();
    }),
    avatarItem.watch((value) => {
      avatarLive = true;
      avatar = value;
    }),
  ];

  void (async () => {
    const [storedName, storedAvatar] = await Promise.all([
      detectedUsernameItem.getValue(),
      avatarItem.getValue(),
    ]);
    if (!nameLive) name = storedName;
    if (!avatarLive) avatar = storedAvatar;
  })();

  return {
    account: {
      get name() {
        return name;
      },
      get avatar() {
        return avatar;
      },
      dropAvatar: () => {
        // Also settled: an image we just watched fail must not come back from a read
        // that was already in flight.
        avatarLive = true;
        avatar = null;
      },
    },
    stop: () => unwatch.forEach((off) => off()),
  };
}
