<script lang="ts">
  import { onMount } from 'svelte';
  import { COOLDOWN_MINUTES, GAME_TYPES, type Settings, type GameType } from '../../core/types';
  import { detectedUsernameItem, getSettings, setSettings } from '../../state/storage';
  import { NAMES } from '../../ui/format';
  import Icon from '../../ui/Icon.svelte';

  let settings = $state<Settings | null>(null);
  let detectedAccount = $state<string | null>(null);
  let saveState = $state<'idle' | 'saving' | 'saved'>('idle');

  /**
   * Writing to local storage is near-instant. Without a floor the "saving" state would be
   * a few-millisecond flicker that nobody could read.
   */
  const MIN_SAVING_MS = 400;
  const SAVED_MS = 1200;

  onMount(() => {
    void (async () => {
      settings = await getSettings();
      detectedAccount = await detectedUsernameItem.getValue();
    })();
    // Same as the popup: the account can land a few seconds after a chess.com tab reports
    // in, and this page should fill itself in rather than need a reload.
    return detectedUsernameItem.watch((value) => (detectedAccount = value));
  });

  async function save(patch: Partial<Settings>) {
    saveState = 'saving';
    const [saved] = await Promise.all([
      setSettings(patch),
      new Promise((done) => setTimeout(done, MIN_SAVING_MS)),
    ]);
    settings = saved;
    saveState = 'saved';

    // If another save started meanwhile, this timer must not hide it.
    setTimeout(() => {
      if (saveState === 'saved') saveState = 'idle';
    }, SAVED_MS);
  }

  /** Empty field means no limit. That is how rapid deliberately stays uncapped. */
  function changeLimit(gameType: GameType, raw: string) {
    if (settings === null) return;
    const text = raw.trim();
    const value = text === '' ? null : Number(text);
    if (value !== null && (!Number.isInteger(value) || value < 0)) return;
    void save({ limits: { ...settings.limits, [gameType]: value } });
  }
</script>

<main>
  <p class="account">
    {#if detectedAccount !== null}
      Account: <strong>{detectedAccount}</strong>
    {:else}
      No account yet. Open chess.com while signed in — it can take a minute.
    {/if}
  </p>

  {#if settings !== null}
    <section>
      <h2>Games per day</h2>
      <p class="hint">Most games you may play per game type.<br />Leave blank for no limit.</p>
      {#each GAME_TYPES as gameType (gameType)}
        <label>
          <span class="mode"><Icon {gameType} />{NAMES[gameType]}</span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="no limit"
            value={settings.limits[gameType] ?? ''}
            onchange={(e) => changeLimit(gameType, e.currentTarget.value)}
          />
        </label>
      {/each}
    </section>

    <section>
      <h2>Between games</h2>
      <p class="hint">Minutes you must wait after finishing a game,<br />whatever its type. Zero switches it off.</p>
      <label>
        <span>Minutes</span>
        <input
          type="number"
          min="0"
          step="5"
          value={settings.gapMinutes}
          onchange={(e) => save({ gapMinutes: Number(e.currentTarget.value) })}
        />
      </label>
    </section>

    <section>
      <h2>Losing streak</h2>
      <p class="hint">
        Losses in a row allowed in one game type<br />before it locks for {COOLDOWN_MINUTES} minutes.
      </p>
      <label>
        <span>Losses</span>
        <input
          type="number"
          min="1"
          step="1"
          value={settings.tilt.losses}
          onchange={(e) => save({ tilt: { losses: Number(e.currentTarget.value) } })}
        />
      </label>
    </section>

    <section>
      <h2>Rematches</h2>
      <label class="check">
        <input
          type="checkbox"
          checked={settings.blockRematch}
          onchange={(e) => save({ blockRematch: e.currentTarget.checked })}
        />
        <span>Hide the rematch button</span>
      </label>
    </section>
  {/if}

  {#if saveState !== 'idle'}
    <p class="toast" role="status">
      {#if saveState === 'saving'}
        <span class="spinner" aria-hidden="true"></span>Saving…
      {:else}
        Saved
      {/if}
    </p>
  {/if}
</main>

<style>
  main {
    max-width: 26rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    background: #262421;
    color: #f2f0ed;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    min-height: 100vh;
    box-sizing: border-box;
  }

  .account {
    margin: 0 0 2.25rem;
    color: #8b8681;
    font-size: 1.1875rem;
  }

  .account strong {
    color: #f2f0ed;
    font-weight: 600;
  }

  h2 {
    margin: 0 0 0.8rem;
    font-size: 0.8125rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9b9691;
  }

  section {
    margin-bottom: 2rem;
  }

  .hint {
    margin: -0.4rem 0 0.8rem;
    color: #8b8681;
    font-size: 0.9375rem;
  }

  .mode {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  label {
    display: grid;
    /* The second column has room for the "no limit" placeholder. */
    grid-template-columns: 7.5rem 7rem;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 1.0625rem;
  }

  label.check {
    display: flex;
    gap: 0.65rem;
    align-items: center;
  }

  input[type='number'] {
    padding: 0.35rem 0.5rem;
    border: 1px solid #4a4642;
    border-radius: 0.3rem;
    background: #1f1e1c;
    color: inherit;
    font: inherit;
    font-size: 1.0625rem;
  }

  input[type='checkbox'] {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: #81b64c;
  }

  .toast {
    position: fixed;
    bottom: 1.2rem;
    right: 1.2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0.45rem 1rem;
    border-radius: 0.3rem;
    background: #81b64c;
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .spinner {
    width: 0.9em;
    height: 0.9em;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2s;
    }
  }
</style>
