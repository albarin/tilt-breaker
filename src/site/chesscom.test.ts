// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyClick,
  findRematchButtons,
  gameIdFromPath,
  gameTypeFromQuickPlay,
  hasGameOverModal,
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

/**
 * The same pair again, in the sidebar. Copied from the live page: chess.com renders
 * "Rematch" and "New N min" twice when a game ends, and this copy outlives dismissing the
 * modal. "Game Review" sits beside them in its own container and must stay clickable.
 */
const SIDEBAR = `
  <div class="board-layout-sidebar" id="board-layout-sidebar">
    <div class="game-review-emphasis-content">
      <div class="game-review-buttons-component">
        <a id="side-review" class="cc-button-component" href="/analysis/game/live/1?tab=review"
           aria-label="Game Review">Game Review</a>
      </div>
      <div class="new-game-buttons-component">
        <div class="new-game-buttons-buttons">
          <button id="side-new" class="cc-button-component" type="button" aria-label="New 3 min">New 3 min</button>
          <button id="side-rematch" class="cc-button-component" type="button" aria-label="Rematch">Rematch</button>
        </div>
      </div>
    </div>
  </div>`;

/**
 * The game review, which is a page of its own and not the sidebar above. Copied from the
 * live `/analysis/game/live/{id}`, where it offers to start another game from four places:
 * the summary you land on, the review's action row, the pair under the move list, and the
 * primary button once the walkthrough ends.
 *
 * The last two are the awkward ones. chess.com gives "Highlights" and "New N min" the same
 * class and nothing else to tell them apart, and the primary button is one element that
 * reads "Next" all the way through and "New Game" at the end — the same class, a different
 * glyph.
 */
const REVIEW = `
  <div class="sidebar-component">
    <div class="sidebar-view-component">
      <div class="sidebar-tab-content-component sidebar-view-content">
        <div class="overview-view-container">
          <section class="overview-view-section overview-view-new-game">
            <button id="overview-new" class="cc-button-component cc-button-secondary cc-button-full">New 15 + 10</button>
          </section>
          <div class="tab-review-start-review-wrapper">
            <button id="start-review" class="cc-button-component tab-review-start-review-button">Start Review</button>
          </div>
        </div>
        <div class="tab-review-action-buttons">
          <button id="review-new" class="cc-button-component tab-review-new-game-button">
            <span id="review-new-child">New 15 + 10</span>
          </button>
        </div>
        <div class="move-by-move-container move-by-move-redesign">
          <div class="move-by-move-component move-by-move-redesign">
            <div class="move-by-move-coach-section">
              <div class="move-by-move-takeaways">
                <div class="flow-buttons-component flow-buttons-singleButton move-by-move-button">
                  <button id="flow-next" class="cc-button-component cc-button-primary flow-buttons-button" type="button">
                    <span aria-hidden="true" class="cc-icon-glyph cc-button-icon"><svg data-glyph="arrow-line-right"></svg></span>
                    <span class="cc-button-one-line flow-buttons-label">Next</span>
                  </button>
                </div>
              </div>
            </div>
            <div class="move-by-move-move-list-container move-by-move-hide-timestamps">
              <div class="move-by-move-buttons">
                <button id="highlights" class="cc-button-component cc-button-secondary cc-button-full" type="button">
                  <span aria-hidden="true" class="cc-icon-glyph cc-button-icon"><svg data-glyph="arrow-line-left"></svg></span>
                  <span class="">Highlights</span>
                </button>
                <button id="move-list-new" class="cc-button-component cc-button-secondary cc-button-full" type="button">
                  <span class="">New 15 + 10</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

/**
 * The same primary button once the walkthrough is over: same class, the arrow swapped for
 * the game-type glyph the lobby uses, and a word that would be a different word in every
 * other language.
 */
const REVIEW_ENDED = REVIEW.replace(
  `<span aria-hidden="true" class="cc-icon-glyph cc-button-icon"><svg data-glyph="arrow-line-right"></svg></span>
                    <span class="cc-button-one-line flow-buttons-label">Next</span>`,
  `<span aria-hidden="true" class="cc-icon-glyph cc-button-icon"><svg data-glyph="game-time-rapid"></svg></span>
                    <span class="cc-button-one-line flow-buttons-label">New Game</span>`,
);

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
   * The hole this closes: the sidebar keeps its own "Rematch" and "New N min" after the
   * modal is dismissed, and guarding only the modal left them as a way around every block.
   */
  it('recognises the sidebar pair as well as the modal one', () => {
    render(SIDEBAR);
    expect(classifyClick(el('side-rematch'))).toEqual({ kind: 'rematch' });
    expect(classifyClick(el('side-new'))).toEqual({ kind: 'rematch' });
  });

  // It sits beside them, and blocking it would take away the reason to stop and look.
  it('never touches the sidebar Game Review', () => {
    render(SIDEBAR);
    expect(classifyClick(el('side-review'))).toEqual({ kind: 'other' });
  });

  /**
   * The hole this closes: the review is a page of its own, so the modal's container and
   * the sidebar's both stop at its door. Its two "New N min" chained a game past every
   * block — the quota, the gap and the losing streak alike.
   */
  it('recognises every next-game button in the review', () => {
    render(REVIEW);
    expect(classifyClick(el('overview-new'))).toEqual({ kind: 'rematch' });
    expect(classifyClick(el('review-new'))).toEqual({ kind: 'rematch' });
    expect(classifyClick(el('review-new-child'))).toEqual({ kind: 'rematch' });
    expect(classifyClick(el('move-list-new'))).toEqual({ kind: 'rematch' });
  });

  // Reading a game you have already played is not playing another one.
  it('never touches the rest of the review', () => {
    render(REVIEW);
    expect(classifyClick(el('start-review'))).toEqual({ kind: 'other' });
    expect(classifyClick(el('highlights'))).toEqual({ kind: 'other' });
  });

  /**
   * One button, two jobs. Stepping through the review must stay possible while the quota
   * is spent — it is the opposite of playing another game — and the same element becomes
   * the way out of that quota the moment the walkthrough ends.
   */
  it('lets the review flow through, and stops it turning into a new game', () => {
    render(REVIEW);
    expect(classifyClick(el('flow-next'))).toEqual({ kind: 'other' });

    render(REVIEW_ENDED);
    expect(classifyClick(el('flow-next'))).toEqual({ kind: 'rematch' });
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
  // Greying them is the point: a button that looks ready and then refuses reads as the
  // page being broken rather than as a rule.
  it('finds the ones to grey out', () => {
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

  it('greys the sidebar pair too, and never Game Review', () => {
    render(MODAL + SIDEBAR);
    expect(
      findRematchButtons(document)
        .map((b) => b.id)
        .sort(),
    ).toEqual(['new', 'rematch', 'side-new', 'side-rematch']);
  });

  it('greys the review buttons, and nothing else in the review', () => {
    render(REVIEW);
    expect(
      findRematchButtons(document)
        .map((b) => b.id)
        .sort(),
    ).toEqual(['move-list-new', 'overview-new', 'review-new']);
  });

  it('greys the review primary only once it offers a game', () => {
    render(REVIEW_ENDED);
    expect(findRematchButtons(document).map((b) => b.id)).toContain('flow-next');
  });

  it('with no modal there is nothing to grey out', () => {
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

describe('quick-start links', () => {
  /**
   * The "Play 3 min" button on the home page pairs you straight away, skipping the lobby
   * entirely — so none of the lobby guards would ever see it.
   *
   * Markup and query string copied from the live home page.
   */
  const QUICK = `
    <div class="play-online-quick-links-component">
      <div class="play-online-quick-links-buttons">
        <a id="quick" href="/play/online/new?action=createLiveChallenge&rated=rated&base=180&timeIncrement=0">Play 3 min</a>
        <a id="lobby" href="/play/online">Play Online</a>
        <a id="bots" href="/play/computer">Play Bots</a>
        <a id="friend" href="/play/online/friend">Play a Friend</a>
      </div>
    </div>`;

  it('reads the game type out of the query string, in seconds', () => {
    expect(gameTypeFromQuickPlay('/play/online/new?base=60&timeIncrement=0')).toBe('bullet');
    expect(gameTypeFromQuickPlay('/play/online/new?base=180&timeIncrement=0')).toBe('blitz');
    expect(gameTypeFromQuickPlay('/play/online/new?base=600&timeIncrement=0')).toBe('rapid');
  });

  it('counts the increment, like everywhere else', () => {
    // 2|2 → 120 + 40×2 = 200s, which is blitz rather than bullet.
    expect(gameTypeFromQuickPlay('/play/online/new?base=120&timeIncrement=2')).toBe('blitz');
  });

  it('returns null without a usable time control', () => {
    expect(gameTypeFromQuickPlay('/play/online/new')).toBeNull();
    expect(gameTypeFromQuickPlay('/play/online/new?rated=rated')).toBeNull();
    expect(gameTypeFromQuickPlay(null)).toBeNull();
  });

  it('classifies the quick-start link', () => {
    render(QUICK);
    expect(classifyClick(el('quick'))).toEqual({ kind: 'quickPlay', gameType: 'blitz' });
  });

  /** The lobby link only opens the page we already guard, and bots are not counted. */
  it('leaves the neighbouring links alone', () => {
    render(QUICK);
    for (const id of ['lobby', 'bots', 'friend']) {
      expect(classifyClick(el(id)), id).toEqual({ kind: 'other' });
    }
  });
});

describe('spotting the end of a game', () => {
  const MODAL_OPEN = '<div class="game-over-modal-shell-container"><button>Rematch</button></div>';

  it('reads the game id from both URL shapes', () => {
    expect(gameIdFromPath('/game/172719499530')).toBe('172719499530');
    expect(gameIdFromPath('/game/live/172348397066')).toBe('172348397066');
  });

  // Correspondence is never counted, so its games are not watched either.
  it('ignores anything that is not a live game', () => {
    expect(gameIdFromPath('/game/daily/12345')).toBeNull();
    expect(gameIdFromPath('/play/online')).toBeNull();
    expect(gameIdFromPath('/')).toBeNull();
  });

  it('sees the modal that marks the finish', () => {
    render(MODAL_OPEN);
    expect(hasGameOverModal(document)).toBe(true);
  });

  it('does not see one mid-game', () => {
    render('<div class="board-layout-main"></div>');
    expect(hasGameOverModal(document)).toBe(false);
  });
});
