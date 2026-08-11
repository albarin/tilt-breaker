<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '#i18n';
  import { NO_ACCOUNT_HINT, noAccountAround, watchAccount } from '../../ui/account.svelte';
  import { loadView, type View } from '../../ui/load';
  import { COLORS, NAMES, blockReason, formatTime, usedFraction } from '../../ui/format';
  import Icon from '../../ui/Icon.svelte';

  let view = $state<View | null>(null);

  /**
   * Only game types that have a quota are shown.
   *
   * The others would be a reminder that you can still go play something else, which is
   * the opposite of what is needed when you open this.
   */
  const limited = $derived(view?.rows.filter((r) => r.limit !== null) ?? []);

  // A new account means new counts, so the view is reloaded when one is detected.
  const { account, stop } = watchAccount(() => void refresh());

  onMount(() => {
    void refresh();
    return stop;
  });

  async function refresh() {
    view = await loadView();
  }
</script>

<main>
  <header>
    <h1>{i18n.t('extension.name')}</h1>
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

      <ul>
        {#each limited as row (row.gameType)}
          {@const reason = blockReason(row)}
          <li class:blocked={reason !== null}>
            <div class="row">
              <span class="name"><Icon gameType={row.gameType} />{NAMES[row.gameType]}</span>
              <span class="count">{row.used}<span class="of">/{row.limit}</span></span>
            </div>

            <!-- The bar says at a glance what a redundant "N left" used to repeat. -->
            <div class="bar">
              <div
                class="fill"
                style:width="{usedFraction(row) * 100}%"
                style:background={reason === null ? COLORS[row.gameType] : '#b0574f'}
              ></div>
            </div>

            <!--
              How the games went, not just how many. Hidden at zero games: three zeroes
              say nothing the "0/N" above has not already said.
            -->
            {#if row.used > 0}
              <p class="tally">
                <span class="win">{i18n.t('popup.wins', [row.tally.wins])}</span>
                <span class="draw">{i18n.t('popup.draws', [row.tally.draws])}</span>
                <span class="loss">{i18n.t('popup.losses', [row.tally.losses])}</span>
              </p>
            {/if}

            {#if reason !== null}
              <p class="note">{reason}</p>
            {:else if row.lossStreak > 1}
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
    font: inherit;
    font-size: 1rem;
  }
</style>
