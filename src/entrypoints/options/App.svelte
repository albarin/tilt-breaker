<script lang="ts">
  import { onMount } from 'svelte';
  import { COOLDOWN_MINUTES, GAME_TYPES, type Settings, type GameType } from '../../core/types';
  import { getSettings, setSettings } from '../../state/storage';
  import { NO_ACCOUNT_HINT, watchAccount } from '../../ui/account.svelte';
  import { NAMES } from '../../ui/format';
  import Icon from '../../ui/Icon.svelte';

  let settings = $state<Settings | null>(null);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** Bumped to rebuild the fields when a failed save has to undo what they show. */
  let formKey = $state(0);

  const { account, stop } = watchAccount();

  /**
   * Writing to local storage is near-instant. Without a floor the "saving" state would be
   * a few-millisecond flicker that nobody could read.
   */
  const MIN_SAVING_MS = 400;
  const SAVED_MS = 1200;

  onMount(() => {
    void (async () => {
      settings = await getSettings();
    })();
    return stop;
  });

  let saveSeq = 0;

  async function save(patch: Partial<Settings>) {
    const seq = ++saveSeq;
    saveState = 'saving';
    try {
      const [saved] = await Promise.all([
        setSettings(patch),
        new Promise((done) => setTimeout(done, MIN_SAVING_MS)),
      ]);
      // A newer edit is already in flight; its save supersedes this one.
      if (seq !== saveSeq) return;
      settings = saved;
      saveState = 'saved';

      // If another save started meanwhile, this timer must not hide it.
      setTimeout(() => {
        if (saveState === 'saved') saveState = 'idle';
      }, SAVED_MS);
    } catch (error) {
      // A write that throws used to leave "Saving…" on screen for good, which reads as
      // still trying. Say it failed, and put the fields back to what is really stored —
      // rebuilt from scratch, because an unchanged value does not re-render on its own.
      if (seq !== saveSeq) return;
      console.error('[tilt-breaker] could not save settings', error);
      settings = await getSettings();
      formKey++;
      saveState = 'error';
    }
  }

  /**
   * A whole number at least `min`, or `null` if the field cannot give one.
   *
   * Every numeric field goes through this. Without it, clearing the losses field left
   * `Number('') === 0` behind, and a threshold of zero blocks after a single loss.
   */
  function wholeNumber(raw: string, min: number): number | null {
    const text = raw.trim();
    if (text === '') return null;
    const value = Number(text);
    return Number.isInteger(value) && value >= min ? value : null;
  }

  /** Empty means no limit. That is how rapid deliberately stays uncapped. */
  function changeLimit(gameType: GameType, input: HTMLInputElement) {
    if (settings === null) return;
    const stored = settings.limits[gameType] ?? '';
    // A malformed entry ('3-', a lone 'e') also reads as an empty value; badInput tells
    // it apart from a deliberate clear, the only '' allowed to mean "no limit".
    if (input.validity.badInput) return revert(input, stored);
    const raw = input.value.trim();
    const value = raw === '' ? null : wholeNumber(raw, 0);
    if (raw !== '' && value === null) return revert(input, stored);
    // The plain object, not `settings.limits` read back: reactive state hands out a proxy,
    // and storage cannot clone one.
    const limits = { ...settings.limits, [gameType]: value };
    settings.limits = limits;
    void save({ limits });
  }

  /**
   * Puts a rejected value back, so the field never shows something we did not store.
   * Written straight to the DOM: the state did not change, so a re-render skips it.
   */
  function revert(input: HTMLInputElement, stored: number | '') {
    input.value = String(stored);
  }

  function changeLosses(input: HTMLInputElement) {
    if (settings === null) return;
    const value = wholeNumber(input.value, 1);
    if (value === null) return revert(input, settings.tilt.losses);
    const tilt = { losses: value };
    settings.tilt = tilt;
    void save({ tilt });
  }

  function changeGap(input: HTMLInputElement) {
    if (settings === null) return;
    const value = wholeNumber(input.value, 0);
    if (value === null) return revert(input, settings.gapMinutes);
    settings.gapMinutes = value;
    void save({ gapMinutes: value });
  }
</script>

<main>
  <p class="account">
    {#if account.name !== null}
      <!-- Decoration: if it fails to load it just goes away, the name stays. -->
      {#if account.avatar !== null}
        <img src={account.avatar} alt="" onerror={account.dropAvatar} />
      {/if}
      <strong>{account.name}</strong>
    {:else}
      No account yet. Open <a href="https://www.chess.com/" target="_blank" rel="noreferrer"
        >chess.com</a
      >
      while signed in. {NO_ACCOUNT_HINT}
    {/if}
  </p>

  {#if settings !== null}
    <!-- Keyed so a failed save can rebuild the fields: putting back a value they already
         show is not a state change, and Svelte would skip the DOM write. -->
    {#key formKey}
      <section>
        <h2>Games per day</h2>
        <p class="hint">
          Most games you may play per game type.<br />Leave blank for no limit.
        </p>
        {#each GAME_TYPES as gameType (gameType)}
          <label>
            <span class="mode"><Icon {gameType} />{NAMES[gameType]}</span>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="no limit"
              value={settings.limits[gameType] ?? ''}
              onchange={(e) => changeLimit(gameType, e.currentTarget)}
            />
          </label>
        {/each}
      </section>

      <section>
        <h2>Between games</h2>
        <p class="hint">
          Minutes you must wait after finishing a game,<br />whatever its type. Zero switches it
          off.
        </p>
        <label>
          <span>Minutes</span>
          <input
            type="number"
            min="0"
            step="5"
            value={settings.gapMinutes}
            onchange={(e) => changeGap(e.currentTarget)}
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
            onchange={(e) => changeLosses(e.currentTarget)}
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
          <span>Block the rematch button</span>
        </label>
      </section>
    {/key}
  {/if}

  {#if saveState !== 'idle'}
    <p class="toast" class:failed={saveState === 'error'} role="status">
      {#if saveState === 'saving'}
        <span class="spinner" aria-hidden="true"></span>Saving…
      {:else if saveState === 'error'}
        Not saved. The fields show what is stored.
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
    background: var(--bg);
    color: var(--text);
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    min-height: 100vh;
    box-sizing: border-box;
  }

  .account {
    margin: 0 0 2.25rem;
    color: var(--muted);
    font-size: 1.1875rem;
  }

  /*
   * Inline rather than a flex row. The no-account branch is a full sentence with a link
   * in it, and a flex container would break the loose text into separate items with gaps
   * between them.
   */
  .account img {
    width: 1.6rem;
    height: 1.6rem;
    margin-right: 0.45rem;
    border-radius: 0.3rem;
    object-fit: cover;
    vertical-align: -0.4rem;
  }

  .account a {
    color: #e8e5e1;
    font-weight: 600;
  }

  .account strong {
    color: var(--text);
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
    color: var(--muted);
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
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: var(--field);
    color: inherit;
    font: inherit;
    font-size: 1.0625rem;
  }

  input[type='checkbox'] {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: var(--green);
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
    background: var(--green);
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  /* Stays until the next save: unlike "Saved", it is not good news to be missed. */
  .toast.failed {
    background: #b0574f;
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
