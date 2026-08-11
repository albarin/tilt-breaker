<script lang="ts">
  import { onMount } from 'svelte';
  import { COOLDOWN_MINUTES, GAME_TYPES, type Settings, type GameType } from '../../core/types';
  import { getSettings, setSettings } from '../../state/storage';
  import { i18n } from '#i18n';
  import { NO_ACCOUNT_HINT, noAccountAround, watchAccount } from '../../ui/account.svelte';
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
      {@const around = noAccountAround()}
      {around.before}<a href="https://www.chess.com/" target="_blank" rel="noreferrer">chess.com</a
      >{around.after}
      {NO_ACCOUNT_HINT}
    {/if}
  </p>

  {#if settings !== null}
    <!-- Keyed so a failed save can rebuild the fields: putting back a value they already
         show is not a state change, and Svelte would skip the DOM write. -->
    {#key formKey}
      <section>
        <h2>{i18n.t('options.quota.heading')}</h2>
        <p class="hint">
          {i18n.t('options.quota.hint')}<br />{i18n.t('options.quota.hintBlank')}
        </p>
        {#each GAME_TYPES as gameType (gameType)}
          <label>
            <span class="mode"><Icon {gameType} />{NAMES[gameType]}</span>
            <input
              type="number"
              min="0"
              step="1"
              placeholder={i18n.t('options.quota.placeholder')}
              value={settings.limits[gameType] ?? ''}
              onchange={(e) => changeLimit(gameType, e.currentTarget)}
            />
          </label>
        {/each}
      </section>

      <section>
        <h2>{i18n.t('options.gap.heading')}</h2>
        <p class="hint">
          {i18n.t('options.gap.hint')}<br />{i18n.t('options.gap.hintOff')}
        </p>
        <label>
          <span>{i18n.t('options.gap.label')}</span>
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
        <h2>{i18n.t('options.tilt.heading')}</h2>
        <p class="hint">
          {i18n.t('options.tilt.hint', [COOLDOWN_MINUTES])}
        </p>
        <label>
          <span>{i18n.t('options.tilt.label')}</span>
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
        <h2>{i18n.t('options.rematch.heading')}</h2>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.blockRematch}
            onchange={(e) => save({ blockRematch: e.currentTarget.checked })}
          />
          <span>{i18n.t('options.rematch.label')}</span>
        </label>
      </section>
    {/key}
  {/if}

  <!--
    The toast sits in the layout with its space always reserved, rather than floating over
    the corner. In the dialog the page ends where the content ends, so a floating toast
    had nothing below the form to cover but the form: it landed on the rematch checkbox,
    the one control that puts it on screen by being clicked.

    The live region is the container, not the toast, so it is already there to announce
    what appears inside it.
  -->
  <footer class="status" role="status">
    {#if saveState !== 'idle'}
      <p class="toast" class:failed={saveState === 'error'}>
        {#if saveState === 'saving'}
          <span class="spinner" aria-hidden="true"></span>{i18n.t('options.saving')}
        {:else if saveState === 'error'}
          {i18n.t('options.saveFailed')}
        {:else}
          {i18n.t('options.saved')}
        {/if}
      </p>
    {/if}
  </footer>
</main>

<style>
  /*
   * The spacing here is budgeted, not chosen by eye. This page opens in the browser's
   * embedded dialog, and Chrome caps that dialog at 640px including its own title bar,
   * so the four sections and the save toast have to end inside roughly 570px or the last
   * of them is reachable only by scrolling something that does not look scrollable.
   * `scripts/smoke-options.mjs` measures the built page in every language shipped and
   * fails if any of them stops fitting: the translations run some 20px longer than the
   * English, so English on its own would not notice.
   */
  main {
    max-width: 26rem;
    margin: 0 auto;
    padding: 0.9rem 1.5rem 1rem;
    background: var(--bg);
    color: var(--text);
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    box-sizing: border-box;
  }

  .account {
    margin: 0 0 0.65rem;
    color: var(--muted);
    font-size: 1rem;
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
    margin: 0 0 0.35rem;
    font-size: 0.8125rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9b9691;
  }

  section {
    margin-bottom: 0.6rem;
  }

  .hint {
    margin: -0.2rem 0 0.45rem;
    color: var(--muted);
    font-size: 0.875rem;
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
    margin-bottom: 0.2rem;
    font-size: 1rem;
  }

  label.check {
    display: flex;
    gap: 0.65rem;
    align-items: center;
  }

  input[type='number'] {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: var(--field);
    color: inherit;
    font: inherit;
    font-size: 1rem;
  }

  input[type='checkbox'] {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: var(--green);
  }

  /* Its height is held whether or not there is anything to say, so the form does not
     jump every time a save starts and finishes. */
  .status {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-height: 2rem;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0.4rem 0.9rem;
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
