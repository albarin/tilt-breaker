<script lang="ts">
  /**
   * Time-class icons, drawn here rather than taken from chess.com: theirs are theirs and
   * we cannot serve them from the extension. They keep the metaphors you already know
   * from the site — bullet, bolt and stopwatch — each in its own colour so they are told
   * apart at a glance and not only by shape.
   */
  import type { GameType } from '../core/types';
  import { COLORS } from './format';

  let { gameType }: { gameType: GameType } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" style:color={COLORS[gameType]}>
  {#if gameType === 'bullet'}
    <!-- A straight tip on purpose: at 20px a rounded ogive is indistinguishable from a
         capsule, whereas the angular profile does read as a projectile. -->
    <path fill="currentColor" d="M4.4 7h5.8l7.8 5-7.8 5H4.4A1.4 1.4 0 0 1 3 15.6V8.4A1.4 1.4 0 0 1 4.4 7z" />
  {:else if gameType === 'blitz'}
    <path fill="currentColor" d="M13.4 2 5.6 13.3h4.9L9.4 22l8.6-11.7h-5.2z" />
  {:else}
    <g
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.6 1.8" />
      <path d="M9.6 2.5h4.8" />
    </g>
  {/if}
</svg>

<style>
  svg {
    width: 1.3em;
    height: 1.3em;
    flex: none;
  }
</style>
