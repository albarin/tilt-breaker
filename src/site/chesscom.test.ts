// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyClick,
  findRematchButtons,
  readOwnUsername,
  readSelectedGameType,
  gameTypeOfOption,
} from './chesscom';

/**
 * The markup here is copied from inspecting the live chess.com: the classes, attributes
 * and texts are what the site returns, not an invention.
 *
 * Mind what these do and do not protect. If chess.com changes its markup these tests keep
 * passing and *blocking* silently stops working. What they do protect is breaking it
 * during a refactor. Counting no longer depends on any of this: it comes from the API.
 */

function render(html: string): void {
  document.body.innerHTML = html;
}

const el = (id: string) => document.getElementById(id);

beforeEach(() => {
  document.body.innerHTML = '';
});

/** A replica of the real dropdown: four sections, each with its time-class icon. */
const LOBBY = `
  <div class="new-game-component">
    <div class="time-selector-next-component">
      <button id="toggle">
        <svg data-glyph="game-time-blitz"></svg>
        <span>3 min (Blitz)</span>
      </button>
      <div class="time-selector-section-component">
        <span class="time-selector-section-icon"><svg data-glyph="game-time-bullet"></svg></span>
        <button class="time-selector-button-button" id="b1">1 min</button>
      </div>
      <div class="time-selector-section-component">
        <span class="time-selector-section-icon"><svg data-glyph="game-time-blitz"></svg></span>
        <button class="time-selector-button-button" id="z1">3 min</button>
        <button class="time-selector-button-button" id="z2"><span id="z2child">3 + 2</span></button>
      </div>
      <div class="time-selector-section-component">
        <span class="time-selector-section-icon"><svg data-glyph="game-time-rapid"></svg></span>
        <button class="time-selector-button-button" id="r1">10 min</button>
      </div>
      <div class="time-selector-section-component">
        <span class="time-selector-section-icon"><svg data-glyph="game-time-daily"></svg></span>
        <button class="time-selector-button-button" id="d1">1 day</button>
      </div>
    </div>
    <div class="new-game-primary"><button id="start">Start Game</button></div>
  </div>`;

/** A replica of the real game-over modal, with its four controls. */
const MODAL = `
  <div class="game-over-modal-shell-container">
    <button id="close" class="game-over-modal-header-close"></button>
    <a id="review" href="/analysis">Game Review</a>
    <button id="new">New 1 min</button>
    <button id="rematch">Rematch</button>
  </div>`;

describe('readSelectedGameType', () => {
  it('reads the selected game type off the icon', () => {
    render(LOBBY);
    expect(readSelectedGameType(document)).toBe('blitz');
  });

  it('returns null with no lobby on screen', () => {
    render('<div class="board-layout-main"></div>');
    expect(readSelectedGameType(document)).toBeNull();
  });
});

describe('gameTypeOfOption', () => {
  it('classifies by the section the option lives in', () => {
    render(LOBBY);
    expect(gameTypeOfOption(el('b1')!)).toBe('bullet');
    expect(gameTypeOfOption(el('z1')!)).toBe('blitz');
    expect(gameTypeOfOption(el('r1')!)).toBe('rapid');
  });

  // The section outranks the text. `"1 day"` starts with a number but is no live control.
  it('correspondence is not a limitable game type', () => {
    render(LOBBY);
    expect(gameTypeOfOption(el('d1')!)).toBeNull();
  });

  it('falls back to the label with no section around', () => {
    render('<button class="time-selector-button-button" id="loose">3 + 2</button>');
    expect(gameTypeOfOption(el('loose')!)).toBe('blitz');
  });
});

describe('classifyClick', () => {
  it('recognises a dropdown option', () => {
    render(LOBBY);
    expect(classifyClick(el('b1'))).toEqual({ kind: 'lobbyOption', gameType: 'bullet' });
  });

  // The `<span>` inside is what gets clicked, not the button: closest() has to walk up.
  it('works when a child of the option is clicked', () => {
    render(LOBBY);
    expect(classifyClick(el('z2child'))).toEqual({ kind: 'lobbyOption', gameType: 'blitz' });
  });

  /**
   * The bug that forced the cases apart: the selector lives inside the new-game panel, so
   * without this ordering picking "1 day" would read as pressing "Start Game" and get
   * blocked using whichever game type was selected before.
   */
  it('a correspondence option is not mistaken for Start Game', () => {
    render(LOBBY);
    expect(classifyClick(el('d1'))).toEqual({ kind: 'lobbyOption', gameType: null });
  });

  it('opening the dropdown is not starting a game', () => {
    render(LOBBY);
    expect(classifyClick(el('toggle'))).toEqual({ kind: 'timeSelector' });
  });

  it('recognises Start Game by its container', () => {
    render(LOBBY);
    expect(classifyClick(el('start'))).toEqual({ kind: 'startGame' });
  });

  it('recognises rematch and "New N min"', () => {
    render(MODAL);
    expect(classifyClick(el('rematch'))).toEqual({ kind: 'rematch' });
    expect(classifyClick(el('new'))).toEqual({ kind: 'rematch' });
  });

  // Reviewing a game is not playing another.
  it('lets links through', () => {
    render(MODAL);
    expect(classifyClick(el('review'))).toEqual({ kind: 'other' });
  });

  /**
   * The close X is a `<button>` inside the modal too. Blocking it would strand the modal
   * on screen with no way to dismiss it.
   */
  it('never blocks the close button', () => {
    render(MODAL);
    expect(classifyClick(el('close'))).toEqual({ kind: 'other' });
  });

  it('ignores the rest of the site', () => {
    render('<button id="other">Resign</button>');
    expect(classifyClick(el('other'))).toEqual({ kind: 'other' });
    expect(classifyClick(null)).toEqual({ kind: 'other' });
  });
});

describe('findRematchButtons', () => {
  // Hiding them is the point: seeing the button fires the impulse even when it does
  // nothing.
  it('finds the ones to hide', () => {
    render(MODAL);
    expect(
      findRematchButtons(document)
        .map((b) => b.id)
        .sort(),
    ).toEqual(['new', 'rematch']);
  });

  it('never returns the close button', () => {
    render(MODAL);
    expect(findRematchButtons(document).map((b) => b.id)).not.toContain('close');
  });

  it('with no modal there is nothing to hide', () => {
    render('<div class="board-layout-main"></div>');
    expect(findRematchButtons(document)).toEqual([]);
  });
});

describe('readOwnUsername', () => {
  const NAV = (user: string) => `
    <nav id="sidebar-main-menu" class="sidebar-container">
      <a class="sidebar-link" href="https://www.chess.com/member/${user}">${user}</a>
    </nav>`;

  it('reads the signed-in account from the sidebar', () => {
    render(NAV('crabinloan'));
    expect(readOwnUsername(document)).toBe('crabinloan');
  });

  /**
   * What makes the selector reliable: during a game the opponent also has a `/member/`
   * link, but theirs sits around the board. Mixing them up would count someone else's
   * games.
   */
  it('does not mistake the opponent for your account', () => {
    render(`
      ${NAV('crabinloan')}
      <div class="board-layout-main">
        <a href="https://www.chess.com/member/Nnsolo11">Nnsolo11</a>
      </div>`);
    expect(readOwnUsername(document)).toBe('crabinloan');
  });

  it('signed out means no account', () => {
    render('<nav id="sidebar-main-menu"><a href="/login">Log In</a></nav>');
    expect(readOwnUsername(document)).toBeNull();
  });

  it('decodes escaped names', () => {
    render(NAV('a%20b'));
    expect(readOwnUsername(document)).toBe('a b');
  });
});
