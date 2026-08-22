<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '#i18n';
  import { NO_ACCOUNT_HINT, noAccountAround, watchAccount } from '../../ui/account.svelte';
  import { watchView, type View } from '../../ui/load';
  import {
    COLORS,
    NAMES,
    blockNote,
    formatRatingDelta,
    formatTime,
    pendingFraction,
    usedFraction,
  } from '../../ui/format';
  import Icon from '../../ui/Icon.svelte';

  let view = $state<View | null>(null);

  /**
   * Only game types that have a quota are shown.
   *
   * The others would be a reminder that you can still go play something else, which is
   * the opposite of what is needed when you open this.
   */
  const limited = $derived(view?.rows.filter((r) => r.limit !== null) ?? []);

  // Kept current while the popup is open: the game you have just played reaches the
  // archive a few seconds after it ends, which is usually mid-way through reading this.
  const day = watchView((next) => {
    view = next;
  });

  // A new account means new counts, so the view is asked for again when one is detected.
  const { account, stop } = watchAccount(() => void day.refresh());

  onMount(() => () => {
    day.stop();
    stop();
  });
</script>

<main>
  <header>
    <!-- The short name: see the catalogue. This header is a title and an account in 22rem. -->
    <h1>{i18n.t('extension.shortName')}</h1>
    {#if account.name !== null}
      <span class="account">
        <!-- Decoration: if it fails to load it just goes away, name and all else stay. -->
        {#if account.avatar !== null}
          <img src={account.avatar} alt="" onerror={account.dropAvatar} />
        {/if}
        {account.name}
      </span>
    {/if}
  </header>

  {#if view === null}
    <p class="muted">{i18n.t('popup.checking')}</p>
  {:else}
    <!--
      With no account there is nothing to count, so the rows would be three empty
      placeholders pretending to be data. Only the notice shows.
    -->
    {#if view.problem === 'no-account'}
      {@const around = noAccountAround()}
      <p class="warning">
        {around.before}<a href="https://www.chess.com/" target="_blank" rel="noreferrer"
          >chess.com</a
        >{around.after}
        {NO_ACCOUNT_HINT}
      </p>
    {:else}
      {#if view.problem === 'network-error'}
        <p class="warning">{i18n.t('popup.networkError')}</p>
      {/if}

      {#if view.gapUntil !== undefined}
        <p class="gap">{i18n.t('popup.nextGame', [formatTime(view.gapUntil)])}</p>
      {/if}

      <!--
        The counts below are short by the game that has just ended, and will be for a few
        seconds more. Saying so is the difference between numbers that are behind and
        numbers that are wrong — and the popup is asking again while this is on screen.
      -->
      {#if view.settling === true}
        <p class="settling">{i18n.t('popup.settling')}</p>
      {/if}

      <ul>
        {#each limited as row (row.gameType)}
          {@const blocked = !row.decision.allow}
          {@const note = blockNote(row)}
          {@const rating = account.ratings[row.gameType]}
          <li class:blocked>
            <div class="row">
              <!--
                The rating rides with the name, small and muted: it is context for the
                count beside it, not a number the day is being judged by — what today did
                to it is already on the tally line below, where the judging belongs.

                Absent for a game type you have never played, and absent until the profile
                has been read. The name simply stands alone, as it did before.
              -->
              <span class="name">
                <Icon gameType={row.gameType} />{NAMES[row.gameType]}
                {#if rating !== undefined}<span class="elo">{rating}</span>{/if}
              </span>
              <span class="count">{row.used}<span class="of">/{row.limit}</span></span>
            </div>

            <!--
              The bar says at a glance what a redundant "N left" used to repeat, and in red
              what a sentence under the row used to. Taken from the decision and not from
              the note below, which most blocks no longer write.

              A game chess.com has counted and the archive has not published gets the end
              of the bar in the same colour, faded: it is quota spent, which is why it is
              on the bar at all, and it is not yet a game we can describe, which is why it
              is not drawn as solid as the ones beside it.
            -->
            <div class="bar">
              <div
                class="fill"
                style:width="{(usedFraction(row) - pendingFraction(row)) * 100}%"
                style:background={blocked ? '#b0574f' : COLORS[row.gameType]}
              ></div>
              {#if row.pending > 0}
                <div
                  class="fill unpublished"
                  style:width="{pendingFraction(row) * 100}%"
                  style:background={blocked ? '#b0574f' : COLORS[row.gameType]}
                ></div>
              {/if}
            </div>

            <!--
              How the games went, not just how many. Hidden at zero games: three zeroes
              say nothing the "0/N" above has not already said.

              The rating rides the same line, pushed to the far edge: it is the other
              answer to "how did today go", and on its own line it would carry more weight
              than the record it belongs to. It is left out when a game could not be
              measured, rather than shown short.
            -->
            {#if row.used > 0}
              <p class="tally">
                <!--
                  The three counts appear only once there is a result to put in them. A
                  game chess.com has counted and the archive has not published yet is on
                  the row above, in `used`, and here it is named rather than filed as a
                  loss it may not be — "0W 0D 0L" beside a game you just played would be
                  three wrong answers where one honest one will do.
                -->
                {#if row.tally.wins + row.tally.draws + row.tally.losses > 0}
                  <span class="win">{i18n.t('popup.wins', [row.tally.wins])}</span>
                  <span class="draw">{i18n.t('popup.draws', [row.tally.draws])}</span>
                  <span class="loss">{i18n.t('popup.losses', [row.tally.losses])}</span>
                {/if}
                {#if row.pending > 0}
                  <span class="unpublished">{i18n.t('popup.unpublished', [row.pending])}</span>
                {/if}
                {#if row.ratingDelta !== null}
                  <span
                    class="rating"
                    class:up={row.ratingDelta > 0}
                    class:down={row.ratingDelta < 0}>{formatRatingDelta(row.ratingDelta)}</span
                  >
                {/if}
              </p>
            {/if}

            <!--
              The streak stays behind the block it used to sit behind. It is a warning
              about where the evening is heading, and once a type is blocked the evening is
              not heading there any more.
            -->
            {#if note !== null}
              <p class="note">{note}</p>
            {:else if !blocked && row.lossStreak > 1}
              <p class="note streak">{i18n.t('common.lossStreak', row.lossStreak)}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <button class="cc-button" onclick={() => browser.runtime.openOptionsPage()}
      >{i18n.t('popup.settings')}</button
    >
  {/if}
</main>

<style>
  main {
    width: 22rem;
    padding: 1.25rem 1.25rem 1.4rem;
    background: var(--bg);
    color: var(--text);
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
  }

  header {
    display: flex;
    /* Centred rather than on the baseline: the avatar has no baseline to sit on. */
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1.1rem;
  }

  h1 {
    margin: 0;
    font-size: 1.1875rem;
    font-weight: 650;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    color: var(--muted);
    font-size: 0.9375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account img {
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
    border-radius: 0.25rem;
    object-fit: cover;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  li {
    padding: 0.7rem 0.85rem 0.8rem;
    border-radius: 0.5rem;
    background: #302e2b;
  }

  li.blocked {
    background: #382c2b;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 1.0625rem;
    font-weight: 600;
  }

  /*
    Deliberately quieter than everything around it — smaller than the tally, muted like
    the "/6" — so the row still reads count first and rating only if you look for it.
  */
  .elo {
    color: var(--muted);
    font-size: 0.8125rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .count {
    font-variant-numeric: tabular-nums;
    font-size: 1.25rem;
    font-weight: 650;
  }

  .of {
    color: var(--muted);
    font-size: 0.9375rem;
    font-weight: 400;
  }

  .bar {
    display: flex;
    height: 0.3rem;
    border-radius: 0.15rem;
    background: var(--field);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: inherit;
    transition: width 0.25s ease;
  }

  /*
    Faded rather than a colour of its own: a second hue on a 0.3rem bar would read as a
    different kind of game rather than as the same game, less certain. It sits over the
    track, so what shows through is the empty quota it is on its way to spending.
  */
  .fill.unpublished {
    opacity: 0.45;
  }

  .tally {
    display: flex;
    gap: 0.7rem;
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .tally .win {
    color: #81b64c;
  }

  .tally .loss {
    color: #e0a8a2;
  }

  /*
    Quieter than the counts beside it: it is a game we know of and cannot describe, and it
    reads as a note about the row rather than as a fourth result.

    Pushed to the far edge, into the place the day's rating would have taken. The two can
    never appear together — a game we cannot describe is what makes the rating untellable,
    which is `ratingDeltaOf` returning null — so this stands where the missing number
    would have been, which is the plainest way to say why it is missing.
  */
  .tally .unpublished {
    margin-left: auto;
    font-weight: 500;
    font-style: italic;
  }

  /* Pushed to the right edge, away from the three counts it does not belong with. */
  .tally .rating {
    margin-left: auto;
  }

  .tally .rating.up {
    color: #81b64c;
  }

  .tally .rating.down {
    color: #e0a8a2;
  }

  .note {
    margin: 0.5rem 0 0;
    font-size: 0.9375rem;
    color: #e0a8a2;
  }

  .note.streak {
    color: #e0a04a;
  }

  .gap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.9rem;
    padding: 0.6rem 0.75rem;
    border-radius: 0.4rem;
    background: #33302c;
    color: #e0c9a0;
    font-size: 1rem;
    font-weight: 600;
  }

  /* Quieter than the gap notice: that one is a rule being applied to you, this one is
     the extension admitting it is still catching up. */
  .settling {
    margin: 0 0 0.7rem;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .warning a {
    color: inherit;
    font-weight: 600;
  }

  .warning {
    margin: 0 0 0.9rem;
    padding: 0.6rem 0.7rem;
    border-radius: 0.4rem;
    background: #34302a;
    color: #d8c9a8;
    font-size: 0.9375rem;
    line-height: 1.45;
  }

  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 1rem;
  }

  /* Sizing only: ui/button.css carries the colour and the depth, shared with the overlay. */
  button {
    width: 100%;
    margin-top: 1.1rem;
    padding: 0.7rem 1rem;
    /* Not `font: inherit`: the shorthand would take the shared weight with it. */
    font-family: inherit;
    font-size: 1rem;
  }
</style>
