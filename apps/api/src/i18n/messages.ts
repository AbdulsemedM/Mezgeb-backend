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
  // Pilot kit "Invite" template.
  'sms.invite': {
    en: '{shop} added you to Mezgeb, your shared dube book. See every purchase and your balance: {link}',
    am: '{shop} በመዝገብ ላይ አክሎዎታል፤ የጋራ የዱቤ ደብተርዎ ነው። እያንዳንዱን ግዢና ቀሪ ሂሳብዎን ይመልከቱ፦ {link}',
    om: '{shop} Mezgeb irratti isin dabaleera, kitaaba dube keessan kan waliinii. Bittaa hundaafi haftee keessan ilaalaa: {link}',
  },
  // Notifications matrix: "Purchase recorded" — items, amount, who took it, new balance.
  'sms.purchase': {
    en: '{shop}: {amount} on your dube ({items}), taken by {who}. New balance: {balance}.',
    am: '{shop}፦ {amount} በዱቤዎ ተመዝግቧል ({items})፣ የወሰደው {who}። አዲስ ቀሪ ሂሳብ፦ {balance}።',
    om: '{shop}: {amount} dube keessan irratti galmeeffameera ({items}), kan fudhate {who}. Haftee haaraa: {balance}.',
  },
  'who.customer': { en: 'you', am: 'እርስዎ', om: 'isin' },
  'who.delivery': { en: 'delivery', am: 'በማድረስ', om: 'geejjiba' },
  // "Correction recorded" — what changed and why.
  'sms.correction': {
    en: '{shop} corrected your dube by {amount}: {reason}. New balance: {balance}.',
    am: '{shop} ዱቤዎን በ{amount} አስተካክሏል፦ {reason}። አዲስ ቀሪ ሂሳብ፦ {balance}።',
    om: '{shop} dube keessan {amount}n sirreesseera: {reason}. Haftee haaraa: {balance}.',
  },
  // "Limit override used" — alert with reason.
  'sms.limit_override': {
    en: '{shop} sold over your dube limit. Reason given: {reason}.',
    am: '{shop} ከዱቤ ገደብዎ በላይ ሸጧል። የተሰጠው ምክንያት፦ {reason}።',
    om: '{shop} daangaa dube keessanii ol gurgureera. Sababni kenname: {reason}.',
  },
  // "Limit 80% / 100% reached".
  'sms.limit_80': {
    en: '{shop}: your dube balance has reached 80% of the {limit} limit.',
    am: '{shop}፦ የዱቤ ቀሪ ሂሳብዎ ከ{limit} ገደብ 80% ደርሷል።',
    om: '{shop}: hafteen dube keessanii daangaa {limit} keessaa 80% ga’eera.',
  },
  'sms.limit_100': {
    en: '{shop}: your dube balance has reached 100% of the {limit} limit.',
    am: '{shop}፦ የዱቤ ቀሪ ሂሳብዎ ከ{limit} ገደብ 100% ደርሷል።',
    om: '{shop}: hafteen dube keessanii daangaa {limit} keessaa 100% ga’eera.',
  },
  // Pilot kit "Purchase (representative receipt)" (REP-5, opt-in).
  'sms.rep_receipt': {
    en: '{shop}: {items} = {amount} recorded for {customer}.',
    am: '{shop}፦ {items} = {amount} ለ{customer} ተመዝግቧል።',
    om: '{shop}: {items} = {amount} {customer}f galmeeffameera.',
  },
  // ADR-003: an offline entry named a representative the customer had removed or paused.
  'sms.rep_inactive_entry': {
    en: '{shop}: {amount} was recorded as taken by {name}, whom you removed or paused. Check it in Mezgeb.',
    am: '{shop}፦ {amount} በ{name} እንደተወሰደ ተመዝግቧል፤ {name} ከዝርዝርዎ ተሰርዟል ወይም ቆሟል። በመዝገብ ይመልከቱ።',
    om: '{shop}: {amount} akka {name}n fudhatametti galmeeffameera; {name} haqameera ykn dhaabbateera. Mezgeb keessatti ilaalaa.',
  },
  // Notifications matrix: representative's own limit.
  'sms.rep_limit': {
    en: '{shop}: {name} has reached the {limit} limit you set.',
    am: '{shop}፦ {name} ያስቀመጡትን የ{limit} ገደብ ደርሰዋል።',
    om: '{shop}: {name} daangaa {limit} isin kaa’ettan ga’eera.',
  },
  // "Representative added or revoked" — change notice to the merchant.
  'sms.rep_added': {
    en: '{customer} added {name}, who may now take goods on their dube.',
    am: '{customer} {name}ን አክለዋል፤ አሁን በዱቤያቸው ዕቃ መውሰድ ይችላሉ።',
    om: '{customer} {name} dabalaniiru; amma dube isaanii irratti meeshaa fudhachuu danda’u.',
  },
  'sms.rep_revoked': {
    en: '{customer} removed {name}. Do not give goods to {name} on their dube any more.',
    am: '{customer} {name}ን አስወግደዋል። ከዚህ በኋላ ለ{name} በዱቤያቸው ዕቃ አይስጡ።',
    om: '{customer} {name} haqaniiru. Kana booda dube isaanii irratti {name}f meeshaa hin kenninaa.',
  },
  // "Entry disputed" — to the merchant (push from M10; SMS until then).
  'sms.dispute': {
    en: '{customer} disputed a {amount} entry: {reason}. Open Mezgeb to resolve it.',
    am: '{customer} የ{amount} መዝገብን ተቃውመዋል፦ {reason}። ለመፍታት መዝገብን ይክፈቱ።',
    om: '{customer} galmee {amount} mormaniiru: {reason}. Furuuf Mezgeb banaa.',
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
