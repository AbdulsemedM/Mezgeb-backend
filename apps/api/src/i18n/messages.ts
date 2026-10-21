import type { Language } from '@mezgeb/shared';

/**
 * User-facing server text (CLAUDE.md rule 9). Placeholders are `{name}`.
 * TODO(i18n-review): Amharic and Afaan Oromo are drafts; a native speaker must review them
 * before the pilot.
 */
const messages = {
  'sms.otp': {
    en: 'Your Mezgeb code is {code}. It expires in {minutes} minutes. Never share it.',
    am: 'የመዝገብ ማረጋገጫ ኮድዎ {code} ነው። በ{minutes} ደቂቃ ውስጥ ያበቃል። ለማንም አያጋሩ።',
    om: 'Koodiin Mezgeb keessan {code} dha. Daqiiqaa {minutes} keessatti ni dhumata. Nama kamiifuu hin qoodinaa.',
  },
} as const satisfies Record<string, Record<Language, string>>;

export type MessageKey = keyof typeof messages;

export function t(
  key: MessageKey,
  language: Language,
  params: Record<string, string | number> = {},
): string {
  return messages[key][language].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
