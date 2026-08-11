import { describe, expect, it } from 'vitest';
import { parseMessagesFile, type ParsedMessage } from '@wxt-dev/i18n/build';

/**
 * The catalogues, held against the English one.
 *
 * This is the failure the rest of the suite cannot see: a key missing from `ca.yml` is
 * not an error anywhere. `getMessage` answers `''`, the element renders empty, and every
 * test still passes because they all run in English. Nothing catches it but a Catalan
 * user, who has no reason to report a blank line as a bug.
 *
 * So English is the contract and each translation is checked against it — not for what it
 * says, which no test can judge, but for having an answer to everything and putting the
 * same values into it.
 */

const DEFAULT_LOCALE = 'en';
const TRANSLATIONS = ['es', 'ca'];

async function catalogue(locale: string): Promise<Map<string, ParsedMessage>> {
  const messages = await parseMessagesFile(`src/locales/${locale}.yml`);
  return new Map(messages.map((message) => [message.key.join('.'), message]));
}

const english = await catalogue(DEFAULT_LOCALE);
const translations = new Map(
  await Promise.all(TRANSLATIONS.map(async (locale) => [locale, await catalogue(locale)] as const)),
);

describe.each(TRANSLATIONS)('%s', (locale) => {
  const translated = () => translations.get(locale)!;

  it('answers every string English has', () => {
    const missing = [...english.keys()].filter((key) => !translated().has(key));
    expect(missing).toEqual([]);
  });

  // A key here and nowhere else is either a typo or a leftover: no surface can read it.
  it('invents none of its own', () => {
    const extra = [...translated().keys()].filter((key) => !english.has(key));
    expect(extra).toEqual([]);
  });

  /**
   * A dropped `$2` is worse than a missing string: the sentence still reads, so nobody
   * looks twice, and the one fact it exists to carry — the time, the count — is gone.
   */
  it('keeps every substitution the English string takes', () => {
    for (const [key, message] of english) {
      expect({ key, subs: translated().get(key)?.substitutions }).toEqual({
        key,
        subs: message.substitutions,
      });
    }
  });

  // A plural that lost its forms silently renders the same words for 1 and for 5.
  it('keeps the plural forms plural', () => {
    for (const [key, message] of english) {
      if (message.type !== 'plural') continue;
      expect({ key, type: translated().get(key)?.type }).toEqual({ key, type: 'plural' });
    }
  });

  /**
   * The one token that must survive translation verbatim: the page splits the sentence on
   * it to put the chess.com link back. Translated away, the link disappears with it.
   */
  it('keeps the [link] marker', () => {
    const message = translated().get('common.noAccount');
    expect(message?.type === 'simple' && message.message).toContain('[link]');
  });
});
