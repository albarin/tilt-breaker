// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Decision } from '../core/policy';
import { OVERLAY_CSS, REMATCH_COPY, copyFor, createOverlay, rematchCopy } from './overlay';

const at = (iso: string) => new Date(iso).getTime();
const NOON = at('2026-08-08T12:00:00');

describe('copyFor', () => {
  it('says nothing while you can play', () => {
    expect(copyFor({ allow: true }, 'blitz', NOON)).toBeNull();
  });

  it('a spent quota says how many and points at tomorrow', () => {
    const copy = copyFor({ allow: false, reason: 'quota', used: 5, limit: 5 }, 'blitz', NOON)!;
    // Capitalised: the mode names are not translated, and a proper noun keeps its
    // capital wherever a sentence puts it — including languages that capitalise nouns.
    expect(copy.title).toContain('Blitz');
    expect(copy.body).toContain('5 of 5');
    expect(copy.body).toContain('tomorrow');
  });

  // "0 of 0" would read as a bug when you have not played any.
  it('a quota of zero is not worded as spent', () => {
    const copy = copyFor({ allow: false, reason: 'quota', used: 0, limit: 0 }, 'bullet', NOON)!;
    expect(copy.title).not.toMatch(/that's your/i);
    expect(copy.body).not.toContain('0 of 0');
  });

  it('a streak says until when and how long is left', () => {
    const until = at('2026-08-08T12:45:00');
    const copy = copyFor({ allow: false, reason: 'tilt', losses: 3, until }, 'blitz', NOON)!;
    expect(copy.title).toContain('3 losses');
    expect(copy.body).toContain('12:45');
    expect(copy.body).toContain('45 min');
  });

  // Never announce a zero-minute wait: round up.
  it('never announces a wait of zero minutes', () => {
    const decision: Decision = { allow: false, reason: 'tilt', losses: 3, until: NOON + 10_000 };
    expect(copyFor(decision, 'blitz', NOON)!.body).toContain('1 min');
  });

  /**
   * Saying "rapid is still available" mid-impulse is an invitation to keep playing, not a
   * consolation. No blocking screen ever names another game type.
   */
  it('never mentions another game type', () => {
    const decisions: Decision[] = [
      { allow: false, reason: 'quota', used: 5, limit: 5 },
      { allow: false, reason: 'tilt', losses: 3, until: NOON + 60_000 },
    ];
    for (const decision of decisions) {
      const copy = copyFor(decision, 'blitz', NOON)!;
      expect(`${copy.title} ${copy.body}`).not.toMatch(/rapid|bullet/i);
    }
  });
});

describe('REMATCH_COPY', () => {
  // Rematch is blocked always, not for having played many, so it mentions no limit.
  it('explains itself without mentioning any limit', () => {
    expect(REMATCH_COPY.title).toBeTruthy();
    expect(REMATCH_COPY.body).not.toMatch(/quota|limit/i);
  });
});

describe('rematchCopy', () => {
  const GAP: Decision = { allow: false, reason: 'gap', until: at('2026-08-08T12:20:00') };
  const blocked = { decision: GAP, gameType: 'blitz' as const };

  it('says nothing when neither rule refuses', () => {
    expect(rematchCopy({ blockRematch: false, blocked: null, now: NOON })).toBeNull();
  });

  it('sends you to the lobby when the lobby would take you', () => {
    expect(rematchCopy({ blockRematch: true, blocked: null, now: NOON })).toEqual(REMATCH_COPY);
  });

  /**
   * The bug this exists to stop: "go back to the lobby" while the gap is running sends
   * you somewhere that refuses you too, and buries the only useful fact — the time.
   */
  it('the block that applies outranks the rematch rule', () => {
    const copy = rematchCopy({ blockRematch: true, blocked, now: NOON })!;
    expect(copy.body).not.toMatch(/lobby/i);
    expect(copy.body).toContain('12:20');
  });

  it('and still explains itself with the rematch rule switched off', () => {
    const copy = rematchCopy({ blockRematch: false, blocked, now: NOON })!;
    expect(copy.body).toContain('12:20');
  });

  /**
   * It names the game type it was handed, which is why the caller must hand it the one the
   * button would have started: a rapid button reporting the day's spent Bullet was the bug
   * that made the block carry the wrong true thing.
   */
  it('names the game type it was given, and no other', () => {
    const spentRapid: Decision = { allow: false, reason: 'quota', used: 3, limit: 3 };
    const copy = rematchCopy({
      blockRematch: true,
      blocked: { decision: spentRapid, gameType: 'rapid' },
      now: NOON,
    })!;
    expect(copy.title).toContain('Rapid');
    expect(copy.title).not.toContain('Bullet');
  });
});

describe('createOverlay', () => {
  it('does not mount until it is needed', () => {
    document.body.innerHTML = '';
    createOverlay(document);
    expect(document.body.children.length).toBe(0);
  });

  it('mounts on show and can be hidden', () => {
    document.body.innerHTML = '';
    const overlay = createOverlay(document);
    overlay.show(REMATCH_COPY);
    const host = document.body.firstElementChild as HTMLElement;
    expect(host.style.display).toBe('block');
    overlay.hide();
    expect(host.style.display).toBe('none');
  });

  // A closed shadow root so chess.com's styles cannot reach in and ours cannot leak out.
  it('isolates itself from the site in a shadow root', () => {
    document.body.innerHTML = '';
    createOverlay(document).show(REMATCH_COPY);
    const host = document.body.firstElementChild!;
    expect(host.shadowRoot).toBeNull();
    expect(host.innerHTML).toBe('');
  });
});

describe('stylesheet units', () => {
  /**
   * chess.com sets `html { font-size: 10px }`, and `rem` resolves against the document
   * root even inside a shadow root. With `rem` this screen rendered at 62.5% of its
   * intended size: the title measured 22.5px instead of 36. A shadow root isolates
   * styles, not units.
   */
  it('uses no rem, which would depend on chess.com font size', () => {
    expect(OVERLAY_CSS).not.toMatch(/\d\s*rem\b/);
  });

  it('pins an explicit font base so em is predictable', () => {
    expect(OVERLAY_CSS).toMatch(/font-size:\s*16px/);
  });

  /**
   * Centred copy with a full first line and a stub of a second reads as a mistake, and the
   * width alone cannot fix it: measured across the three catalogues, narrowing only moved
   * which words fell short. This is what evens them out, and it is easy to lose in a tidy-up
   * because nothing looks wrong without it until you read a long string in Spanish.
   */
  it('balances the lines rather than leaving a stub of a second one', () => {
    expect(OVERLAY_CSS).toMatch(/text-wrap:\s*balance/);
  });
});

/**
 * It covers the whole viewport at the top of the stacking order, so getting out of it
 * must not hang on one button working.
 */
describe('dismissing', () => {
  const mount = () => {
    document.body.innerHTML = '';
    const overlay = createOverlay(document);
    overlay.show(REMATCH_COPY);
    return { overlay, host: document.body.firstElementChild as HTMLElement };
  };

  it('Escape closes it', () => {
    const { host } = mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.style.display).toBe('none');
  });

  it('other keys leave it alone', () => {
    const { host } = mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(host.style.display).toBe('block');
  });

  // Otherwise it would keep swallowing Escape long after it is gone.
  it('stops listening once closed', () => {
    const { overlay, host } = mount();
    overlay.hide();
    overlay.show(REMATCH_COPY);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.style.display).toBe('none');
  });
});
