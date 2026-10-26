import type { Language } from '@mezgeb/shared';

/**
 * User-facing server text (CLAUDE.md rule 9). Placeholders are `{name}`.
 * TODO(i18n-review): Amharic and Afaan Oromo are drafts; a native speaker must review them
 * before the pilot.
 */
const messages = {
  'sms.otp': {
    en: 'Your Nota code is {code}. It expires in {minutes} minutes. Never share it.',
    am: 'የኖታ ማረጋገጫ ኮድዎ {code} ነው። በ{minutes} ደቂቃ ውስጥ ያበቃል። ለማንም አያጋሩ።',
    om: 'Koodiin Nota keessan {code} dha. Daqiiqaa {minutes} keessatti ni dhumata. Nama kamiifuu hin qoodinaa.',
  },
  // Pilot kit "Invite" template.
  'sms.invite': {
    en: '{shop} added you to Nota, your shared dube book. See every purchase and your balance: {link}',
    am: '{shop} በኖታ ላይ አክሎዎታል፤ የጋራ የዱቤ ደብተርዎ ነው። እያንዳንዱን ግዢና ቀሪ ሂሳብዎን ይመልከቱ፦ {link}',
    om: '{shop} Nota irratti isin dabaleera, kitaaba dube keessan kan waliinii. Bittaa hundaafi haftee keessan ilaalaa: {link}',
  },
  // ADR-011: the shop asks to go over the customer's hard stop once.
  'sms.raise_code': {
    en: '{shop} asks to put {amount} more than your limit on your dube, once. If you agree, give the shop this code: {code}. It works for {minutes} minutes.',
    am: '{shop} ከገደብዎ በላይ {amount} በዱቤዎ ላይ አንድ ጊዜ ለመመዝገብ ይጠይቃል። ከተስማሙ ይህን ኮድ ለሱቁ ይስጡ፦ {code}። ለ{minutes} ደቂቃ ያገለግላል።',
    om: '{shop} daangaa keessan ol {amount} dube keessan irratti al tokko galmeessuuf gaafata. Yoo walii galtan, koodii kana suuqiidhaaf kennaa: {code}. Daqiiqaa {minutes}f hojjeta.',
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
    en: '{shop}: {amount} was recorded as taken by {name}, whom you removed or paused. Check it in Nota.',
    am: '{shop}፦ {amount} በ{name} እንደተወሰደ ተመዝግቧል፤ {name} ከዝርዝርዎ ተሰርዟል ወይም ቆሟል። በኖታ ይመልከቱ።',
    om: '{shop}: {amount} akka {name}n fudhatametti galmeeffameera; {name} haqameera ykn dhaabbateera. Nota keessatti ilaalaa.',
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
    en: '{customer} disputed a {amount} entry: {reason}. Open Nota to resolve it.',
    am: '{customer} የ{amount} መዝገብን ተቃውመዋል፦ {reason}። ለመፍታት ኖታን ይክፈቱ።',
    om: '{customer} galmee {amount} mormaniiru: {reason}. Furuuf Nota banaa.',
  },
  // ADR-012: staff asked the owner to correct an entry.
  'sms.correction_request': {
    en: 'Your staff asked to correct an entry for {customer} by {amount}: {reason}. Open Nota to answer.',
    am: 'ሰራተኛዎ የ{customer}ን መዝገብ በ{amount} እንዲታረም ጠይቀዋል፦ {reason}። ለመመለስ ኖታን ይክፈቱ።',
    om: 'Hojjetaan keessan galmee {customer} {amount}n akka sirreeffamu gaafateera: {reason}. Deebisuuf Nota banaa.',
  },
  // M11 statement PDF (LED-7, US-14).
  'statement.title': { en: 'Dube statement', am: 'የዱቤ መግለጫ', om: 'Ibsa dube' },
  'statement.shop': { en: 'Shop', am: 'ሱቅ', om: 'Suuqii' },
  'statement.customer': { en: 'Customer', am: 'ደንበኛ', om: 'Maamila' },
  'statement.period': { en: 'Period', am: 'ጊዜ', om: 'Yeroo' },
  'statement.opening': {
    en: 'Balance at the start',
    am: 'በመጀመሪያ የነበረ ቀሪ ሂሳብ',
    om: 'Haftee jalqabaa',
  },
  'statement.closing': {
    en: 'Balance at the end',
    am: 'በመጨረሻ ያለ ቀሪ ሂሳብ',
    om: 'Haftee dhumaa',
  },
  'statement.col_date': { en: 'Date', am: 'ቀን', om: 'Guyyaa' },
  'statement.col_what': { en: 'What', am: 'ምን', om: 'Maal' },
  'statement.col_who': { en: 'Taken by', am: 'የወሰደው', om: 'Kan fudhate' },
  'statement.col_amount': { en: 'Amount', am: 'መጠን', om: 'Hanga' },
  'statement.col_balance': { en: 'Balance', am: 'ቀሪ', om: 'Haftee' },
  'statement.purchase': { en: 'Purchase', am: 'ግዢ', om: 'Bittaa' },
  'statement.payment': { en: 'Payment', am: 'ክፍያ', om: 'Kaffaltii' },
  'statement.correction': { en: 'Correction', am: 'እርማት', om: 'Sirreeffama' },
  'statement.who_customer': { en: 'Customer', am: 'ደንበኛ', om: 'Maamila' },
  'statement.who_delivery': { en: 'Delivery', am: 'በማድረስ', om: 'Geejjiba' },
  'statement.no_entries': {
    en: 'Nothing was recorded in this period.',
    am: 'በዚህ ጊዜ ምንም አልተመዘገበም።',
    om: 'Yeroo kana keessa homtuu hin galmoofne.',
  },
  'statement.chain': {
    en: 'Last entry number {seq}, check code {hash}',
    am: 'የመጨረሻ መዝገብ ቁጥር {seq}፣ ማረጋገጫ ኮድ {hash}',
    om: 'Lakkoofsa galmee dhumaa {seq}, koodii mirkaneessaa {hash}',
  },
  'statement.generated': {
    en: 'Made by Nota on {date}. Nota never adds interest or fees.',
    am: 'በኖታ በ{date} የተዘጋጀ። ኖታ ወለድ ወይም ክፍያ አይጨምርም።',
    om: "Notaan {date} qophaa'e. Nota dhala ykn kaffaltii hin dabalu.",
  },
  // ADR-013 payments.
  'sms.payment_recorded': {
    en: '{shop} recorded your payment of {amount} ({method}). New balance: {balance}.',
    am: '{shop} የ{amount} ክፍያዎን ({method}) መዝግቧል። አዲስ ቀሪ ሂሳብ፦ {balance}።',
    om: '{shop} kaffaltii keessan {amount} ({method}) galmeesseera. Haftee haaraa: {balance}.',
  },
  'sms.payme': {
    en: '{shop} asks you to pay {amount} on your dube. {message}{details}',
    am: '{shop} በዱቤዎ ላይ {amount} እንዲከፍሉ ይጠይቃል። {message}{details}',
    om: '{shop} dube keessan irratti {amount} akka kaffaltan gaafata. {message}{details}',
  },
  'sms.payme_details': {
    en: 'Pay to: {details}. ',
    am: 'የሚከፈልበት፦ {details}። ',
    om: 'Itti kaffalaa: {details}. ',
  },
  'sms.payme_due': {
    en: 'Please pay by {date}. ',
    am: 'እስከ {date} ይክፈሉ። ',
    om: 'Hanga {date} kaffalaa. ',
  },
  'sms.payment_reported': {
    en: '{customer} says they paid {amount} by {method}. Open Nota to confirm it.',
    am: '{customer} {amount} በ{method} እንደከፈሉ ይናገራሉ። ለማረጋገጥ ኖታን ይክፈቱ።',
    om: '{customer} {amount} {method}n akka kaffalan himu. Mirkaneessuuf Nota banaa.',
  },
  'sms.payment_confirmed': {
    en: '{shop} confirmed your payment of {amount}. New balance: {balance}.',
    am: '{shop} የ{amount} ክፍያዎን አረጋግጧል። አዲስ ቀሪ ሂሳብ፦ {balance}።',
    om: '{shop} kaffaltii keessan {amount} mirkaneesseera. Haftee haaraa: {balance}.',
  },
  'sms.payment_rejected': {
    en: '{shop} did not accept your payment report of {amount}: {reason}. You can report it again.',
    am: '{shop} የ{amount} የክፍያ ሪፖርትዎን አልተቀበለም፦ {reason}። እንደገና ሪፖርት ማድረግ ይችላሉ።',
    om: "{shop} gabaasa kaffaltii keessan {amount} hin fudhanne: {reason}. Irra deebi'uun gabaasuu dandeessu.",
  },
  'payment_method.cash': { en: 'cash', am: 'በጥሬ ገንዘብ', om: 'maallaqa harkaa' },
  'payment_method.telebirr': { en: 'telebirr', am: 'ቴሌብር', om: 'telebirr' },
  'payment_method.cbe_birr': { en: 'CBE Birr', am: 'ሲቢኢ ብር', om: 'CBE Birr' },
  'payment_method.mpesa': { en: 'M-PESA', am: 'ኤም-ፔሳ', om: 'M-PESA' },
  'payment_method.bank_transfer': { en: 'bank transfer', am: 'በባንክ ዝውውር', om: 'baankii' },
  'payment_method.other': { en: 'another way', am: 'በሌላ መንገድ', om: 'karaa biraa' },
  // ADR-014 delivery orders.
  'sms.order_received': {
    en: 'New delivery order from {customer} ({count} items). Open Nota to answer it.',
    am: 'ከ{customer} አዲስ የማድረስ ትዕዛዝ ({count} ዕቃዎች)። ለመመለስ ኖታን ይክፈቱ።',
    om: 'Ajaja geejjibaa haaraa {customer} irraa (meeshaa {count}). Deebisuuf Nota banaa.',
  },
  'sms.order_priced': {
    en: '{shop} priced your order: {total}. It will be on its way soon.',
    am: '{shop} ትዕዛዝዎን ዋጋ አውጥቷል፦ {total}። በቅርቡ ይላካል።',
    om: '{shop} ajaja keessan gatii baaseera: {total}. Dhiheenyatti ni ergama.',
  },
  'sms.order_out': {
    en: '{shop}: your order is on its way.',
    am: '{shop}፦ ትዕዛዝዎ በመንገድ ላይ ነው።',
    om: '{shop}: ajajni keessan karaa irra jira.',
  },
  'sms.order_declined': {
    en: '{shop} could not take your order: {reason}',
    am: '{shop} ትዕዛዝዎን መቀበል አልቻለም፦ {reason}',
    om: '{shop} ajaja keessan fudhachuu hin dandeenye: {reason}',
  },
  // ADR-015: the representative's own notices.
  'sms.rep_you_added': {
    en: '{customer} added you: you may take goods on their dube at {shop}.',
    am: '{customer} አክለውዎታል፤ በ{shop} በዱቤያቸው ዕቃ መውሰድ ይችላሉ።',
    om: '{customer} isin dabalaniiru: {shop} irraa dube isaanii irratti meeshaa fudhachuu dandeessu.',
  },
  'sms.rep_you_removed': {
    en: '{customer} removed you: you can no longer take goods on their dube at {shop}.',
    am: '{customer} አስወግደውዎታል፤ ከዚህ በኋላ በ{shop} በዱቤያቸው ዕቃ መውሰድ አይችሉም።',
    om: '{customer} isin haqaniiru: kana booda {shop} irraa dube isaanii irratti meeshaa fudhachuu hin dandeessan.',
  },
  // Time limit (ADR-007 due dates) and the other side changing a limit.
  'sms.due_soon': {
    en: '{shop}: your dube balance of {balance} is due on {date}.',
    am: '{shop}፦ የ{balance} የዱቤ ቀሪ ሂሳብዎ እስከ {date} ይከፈላል።',
    om: '{shop}: haftee dube keessan {balance} hanga {date} kaffalama.',
  },
  'sms.due_today': {
    en: '{shop}: your dube balance of {balance} is due today.',
    am: '{shop}፦ የ{balance} የዱቤ ቀሪ ሂሳብዎ ዛሬ ይከፈላል።',
    om: "{shop}: haftee dube keessan {balance} har'a kaffalama.",
  },
  'sms.due_today_shop': {
    en: '{customer} owes {balance}, due today.',
    am: '{customer} {balance} ዕዳ አለባቸው፤ ዛሬ ይከፈላል።',
    om: "{customer} {balance} qabu, har'a kaffalama.",
  },
  'sms.limit_changed_shop': {
    en: '{customer} changed their own dube limit.',
    am: '{customer} የራሳቸውን የዱቤ ገደብ ቀይረዋል።',
    om: '{customer} daangaa dube isaanii jijjiiraniiru.',
  },
  'sms.limit_changed_customer': {
    en: '{shop} changed your dube limit.',
    am: '{shop} የዱቤ ገደብዎን ቀይሯል።',
    om: '{shop} daangaa dube keessan jijjiireera.',
  },
  'sms.payment_report_reminder': {
    en: '{customer} reported a payment of {amount} two days ago. Open Nota to confirm or reject it.',
    am: '{customer} ከሁለት ቀን በፊት የ{amount} ክፍያ ሪፖርት አድርገዋል። ለማረጋገጥ ወይም ለመቃወም ኖታን ይክፈቱ።',
    om: '{customer} guyyaa lama dura kaffaltii {amount} gabaasaniiru. Mirkaneessuuf ykn diduuf Nota banaa.',
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
