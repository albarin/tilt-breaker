<script lang="ts">
  import { onMount } from 'svelte';
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

  onMount(async () => {
    view = await loadView();
  });
</script>

<main>
  <h1>Game limit</h1>

  {#if view === null}
    <p class="muted">Checking…</p>
  {:else}
    {#if view.problem === 'no-account'}
      <p class="warning">
        No account detected yet. Open chess.com while signed in and counting starts on its
        own.
      </p>
    {:else if view.problem === 'network-error'}
      <p class="warning">Could not reach chess.com. This is the last data known.</p>
    {/if}

    {#if view.gapUntil !== undefined}
      <p class="gap">Next game at {formatTime(view.gapUntil)}</p>
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

          {#if reason !== null}
            <p class="note">{reason}</p>
          {:else if row.lossStreak > 1}
            <p class="note streak">{row.lossStreak} losses in a row</p>
          {/if}
        </li>
      {/each}
    </ul>

    <button onclick={() => browser.runtime.openOptionsPage()}>Settings</button>
  {/if}
</main>

<style>
  main {
    width: 22rem;
    padding: 1.25rem 1.25rem 1.4rem;
    background: #262421;
    color: #f2f0ed;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }

  h1 {
    margin: 0 0 1.1rem;
    font-size: 1.1875rem;
    font-weight: 650;
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
    color: #8b8681;
    font-size: 0.9375rem;
    font-weight: 400;
  }

  .bar {
    height: 0.3rem;
    border-radius: 0.15rem;
    background: #1f1e1c;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: inherit;
    transition: width 0.25s ease;
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
    color: #8b8681;
    font-size: 1rem;
  }

  button {
    width: 100%;
    margin-top: 1.1rem;
    padding: 0.7rem 1rem;
    font: inherit;
    font-size: 1rem;
    /*
     * chess.com's own primary button, measured off the live "Start Game": a vertical
     * gradient, a bright inset line on top and a dark one underneath. That inset pair is
     * what makes it read as raised rather than flat.
     */
    border: 0;
    border-radius: 10px;
    background: linear-gradient(#81b64c 0%, #5d9948 100%);
    box-shadow:
      inset 0 1px 0 0 rgba(178, 224, 104, 0.4),
      inset 0 -1px 0 0 #45753c,
      inset 0 2px 4px 0 rgba(178, 224, 104, 0.5),
      inset 0 -2px 4px 0 rgba(69, 117, 60, 0.5),
      0 1px 2px 0 rgba(0, 0, 0, 0.14),
      0 2px 4px 0 rgba(0, 0, 0, 0.1);
    color: #fff;
    font-weight: 800;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
    cursor: pointer;
  }

  button:hover {
    background: linear-gradient(#8cc056 0%, #67a350 100%);
  }

  button:active {
    background: linear-gradient(#75a544 0%, #548a40 100%);
    box-shadow:
      inset 0 1px 3px 0 rgba(0, 0, 0, 0.3),
      inset 0 -1px 0 0 rgba(178, 224, 104, 0.25);
  }
</style>
