// @vitest-environment happy-dom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { getSettings } from '../../state/storage';
import App from './App.svelte';

/**
 * The settings page had no test at all, and three of the bugs it shipped lived here: a
 * typo that wiped a limit, a rejected value left on screen, and reactive state handed
 * straight to storage, which cannot clone a proxy. None of them is visible to the type
 * checker, and none is reachable from the pure functions the rest of the suite covers.
 *
 * The storage double refuses uncloneable values, same as a browser — see src/test-setup.
 */

let app: Record<string, unknown> | null = null;

/** The page, mounted and settled: settings are read asynchronously on mount. */
async function open() {
  document.body.innerHTML = '<div id="app"></div>';
  app = mount(App, { target: document.getElementById('app')! });
  await vi.waitFor(() => expect(numberFields()).not.toHaveLength(0));
}

const numberFields = () =>
  [...document.querySelectorAll('input[type="number"]')] as HTMLInputElement[];

/** Fields in DOM order: the three limits, the gap, then the losing streak. */
const field = (name: 'bullet' | 'blitz' | 'rapid' | 'gap' | 'losses') =>
  numberFields()[{ bullet: 0, blitz: 1, rapid: 2, gap: 3, losses: 4 }[name]]!;

/** Types into a field the way a person does: replace the text, then leave it. */
function edit(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The two checkboxes, in DOM order: block the rematch button, hide the resign one. */
const toggle = (name: 'rematch' | 'resign') =>
  document.querySelectorAll('input[type="checkbox"]')[
    { rematch: 0, resign: 1 }[name]
  ] as HTMLInputElement;

const toast = () => document.querySelector('.toast')?.textContent?.trim() ?? null;

const confirmation = () => document.querySelector('dialog') as HTMLDialogElement;
const choice = (which: 'keep' | 'raise') =>
  document.querySelector(`.${which}`) as HTMLButtonElement | null;

/**
 * What the background says you have played today. The page asks for it on mount, and
 * without an answer it never questions an edit — so a test about the question has to
 * supply one.
 */
function playedToday(used: Partial<Record<'bullet' | 'blitz' | 'rapid', number>>) {
  // `as never`: the fake types its answer as void, and the real one answers a Status.
  const answer = {
    decisions: {},
    blockRematch: true,
    view: {
      rows: Object.entries(used).map(([gameType, played]) => ({
        gameType,
        used: played,
        limit: null,
        tally: { wins: 0, draws: 0, losses: played },
        ratingDelta: null,
        lossStreak: 0,
        decision: { allow: true },
      })),
    },
  };
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(answer as never);
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  if (app !== null) unmount(app);
  app = null;
});

describe('the settings page', () => {
  it('shows what is stored', async () => {
    await open();
    expect(field('bullet').value).toBe('8');
    expect(field('losses').value).toBe('3');
  });

  /**
   * The one that shipped. Reactive state hands out a proxy when read back, and storage
   * structured-clones: every limit change rejected, the page sat on "Saving…" and nothing
   * reached disk.
   */
  it('saves a changed limit', async () => {
    await open();
    edit(field('bullet'), '4');

    await vi.waitFor(async () => expect((await getSettings()).limits.bullet).toBe(4));
    expect(toast()).not.toMatch(/not saved/i);
  });

  it('saves a changed losing streak', async () => {
    await open();
    edit(field('losses'), '5');

    await vi.waitFor(async () => expect((await getSettings()).tilt.losses).toBe(5));
  });

  it('saves a changed gap', async () => {
    await open();
    edit(field('gap'), '30');

    await vi.waitFor(async () => expect((await getSettings()).gapMinutes).toBe(30));
  });

  /** Clearing a limit is how rapid deliberately stays uncapped. */
  it('an emptied limit means no limit', async () => {
    await open();
    edit(field('bullet'), '');

    await vi.waitFor(async () => expect((await getSettings()).limits.bullet).toBeNull());
  });

  it('a value below the minimum is refused and put back', async () => {
    await open();
    edit(field('losses'), '0');

    await vi.waitFor(() => expect(field('losses').value).toBe('3'));
    expect((await getSettings()).tilt.losses).toBe(3);
  });

  /**
   * Two edits inside the saving floor: the second used to be built from the first's stale
   * snapshot and silently reverted it.
   */
  it('a second quick edit does not revert the first', async () => {
    await open();
    edit(field('bullet'), '1');
    edit(field('blitz'), '2');

    await vi.waitFor(async () => {
      const { limits } = await getSettings();
      expect([limits.bullet, limits.blitz]).toEqual([1, 2]);
    });
  });

  it('saves the rematch toggle', async () => {
    await open();
    const checkbox = toggle('rematch');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(async () => expect((await getSettings()).blockRematch).toBe(false));
  });

  it('saves the resign toggle', async () => {
    await open();
    const checkbox = toggle('resign');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(async () => expect((await getSettings()).hideResign).toBe(true));
  });

  /**
   * Raising a quota you have already spent is the edit this whole extension exists to
   * interrupt, and it is made at the worst possible moment: you have run out, and the dial
   * is right there. It is still allowed — it just has to be meant.
   */
  describe('raising a limit already spent today', () => {
    it('asks first, and saves nothing until it is answered', async () => {
      playedToday({ bullet: 8 });
      await open();
      await vi.waitFor(() => expect(choice('keep')).toBeNull());

      edit(field('bullet'), '12');

      await vi.waitFor(() => expect(confirmation().open).toBe(true));
      expect((await getSettings()).limits.bullet).toBe(8);
    });

    it('saying no puts the field back', async () => {
      playedToday({ bullet: 8 });
      await open();
      edit(field('bullet'), '12');

      await vi.waitFor(() => expect(choice('keep')).not.toBeNull());
      choice('keep')!.click();

      await vi.waitFor(() => expect(field('bullet').value).toBe('8'));
      expect((await getSettings()).limits.bullet).toBe(8);
    });

    it('saying yes raises it', async () => {
      playedToday({ bullet: 8 });
      await open();
      edit(field('bullet'), '12');

      await vi.waitFor(() => expect(choice('raise')).not.toBeNull());
      choice('raise')!.click();

      await vi.waitFor(async () => expect((await getSettings()).limits.bullet).toBe(12));
    });

    /** No limit at all is the largest raise there is. */
    it('clearing it asks too', async () => {
      playedToday({ bullet: 8 });
      await open();
      edit(field('bullet'), '');

      await vi.waitFor(() => expect(confirmation().open).toBe(true));
      expect((await getSettings()).limits.bullet).toBe(8);
    });

    it('lowering it needs no question', async () => {
      playedToday({ bullet: 8 });
      await open();
      edit(field('bullet'), '4');

      await vi.waitFor(async () => expect((await getSettings()).limits.bullet).toBe(4));
      expect(confirmation().open).toBe(false);
    });

    it('a type with games left is asked nothing', async () => {
      playedToday({ bullet: 2 });
      await open();
      edit(field('bullet'), '12');

      await vi.waitFor(async () => expect((await getSettings()).limits.bullet).toBe(12));
      expect(confirmation().open).toBe(false);
    });

    /**
     * The background cannot always be reached, and a page that guessed would be asking
     * "are you sure?" about a day it knows nothing about.
     */
    it('with nothing known about today, nothing is questioned', async () => {
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValue(new Error('no background'));
      await open();
      edit(field('bullet'), '12');

      await vi.waitFor(async () => expect((await getSettings()).limits.bullet).toBe(12));
      expect(confirmation().open).toBe(false);
    });
  });

  /** A write that fails must say so, not leave "Saving…" up as though it were still trying. */
  it('says when a save fails, and puts the fields back', async () => {
    await open();
    const failing = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValue(new Error('storage is full'));

    edit(field('bullet'), '4');

    await vi.waitFor(() => expect(toast()).toMatch(/not saved/i));
    expect(field('bullet').value).toBe('8');
    failing.mockRestore();
  });
});
