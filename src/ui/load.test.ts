import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../messaging';
import { ASK_EVERY_MS, ASK_FOR_MS, watchView } from './load';
import type { View } from '../messaging';

vi.mock('../messaging', () => ({ sendMessage: vi.fn() }));

const asked = vi.mocked(sendMessage);

const view = (used: number): View => ({
  rows: [
    {
      gameType: 'blitz',
      used,
      limit: 6,
      tally: { wins: 0, draws: 0, losses: used },
      ratingDelta: null,
      lossStreak: used,
      decision: { allow: true },
    },
  ],
});

const answers = (...views: View[]) => {
  for (const value of views) {
    asked.mockResolvedValueOnce({ decisions: {}, blockRematch: true, view: value } as never);
  }
};

describe('watchView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    asked.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows what it is told, straight away', async () => {
    answers(view(2));
    const seen: View[] = [];
    const day = watchView((next) => seen.push(next));
    await vi.advanceTimersByTimeAsync(0);
    day.stop();

    expect(seen).toEqual([view(2)]);
  });

  /**
   * The bug this exists for: the archive publishes a finished game seconds after it ends,
   * so the first answer can predate the game just played — and it used to stay on screen.
   */
  it('asks again while the popup is open, and shows what changed', async () => {
    answers(view(2), view(2), view(3));
    const seen: View[] = [];
    const day = watchView((next) => seen.push(next));

    await vi.advanceTimersByTimeAsync(ASK_EVERY_MS * 2);
    day.stop();

    expect(asked).toHaveBeenCalledTimes(3);
    expect(seen.at(-1)).toEqual(view(3));
  });

  it('gives up asking rather than polling all evening', async () => {
    answers(...Array.from({ length: 20 }, () => view(1)));
    const day = watchView(() => {});

    await vi.advanceTimersByTimeAsync(ASK_FOR_MS * 3);
    day.stop();

    expect(asked.mock.calls.length).toBeLessThanOrEqual(ASK_FOR_MS / ASK_EVERY_MS + 1);
  });

  /**
   * `loadView` answers an unreachable background with an empty view, which is honest for
   * the first ask and destructive for the fifth: the counts would blink away because one
   * poll of many did not land.
   */
  it('a failed ask leaves what is on screen alone', async () => {
    answers(view(2));
    asked.mockRejectedValueOnce(new Error('no background'));
    const seen: View[] = [];
    const day = watchView((next) => seen.push(next));

    await vi.advanceTimersByTimeAsync(ASK_EVERY_MS);
    day.stop();

    expect(seen).toEqual([view(2)]);
  });

  /**
   * The interval does not wait for the answer. On a slow connection that used to pile
   * requests for the same thing on top of each other, and their answers can land out of
   * order — the older one last, undoing what the newer one had already corrected.
   */
  it('never asks twice at once', async () => {
    let answer = () => {};
    asked.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = () => resolve({ decisions: {}, blockRematch: true, view: view(2) } as never);
      }),
    );
    answers(view(3));
    const seen: View[] = [];
    const day = watchView((next) => seen.push(next));

    await vi.advanceTimersByTimeAsync(ASK_EVERY_MS * 3);
    expect(asked).toHaveBeenCalledTimes(1);

    answer();
    await vi.advanceTimersByTimeAsync(ASK_EVERY_MS);
    day.stop();

    expect(seen).toEqual([view(2), view(3)]);
  });

  // Nothing arrives after the popup is gone, including an answer already in flight.
  it('stops for good when told to', async () => {
    answers(view(2), view(3));
    const seen: View[] = [];
    const day = watchView((next) => seen.push(next));
    day.stop();

    await vi.advanceTimersByTimeAsync(ASK_EVERY_MS * 3);

    expect(seen).toEqual([]);
  });
});
