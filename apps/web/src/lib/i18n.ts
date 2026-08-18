import type { LanguageCode } from './farm-config';

/**
 * Messages for the screens a farm worker actually uses.
 *
 * Deliberately NOT the whole product. The daily round, the bottom navigation
 * and the messages around them are what someone standing in a pen at 6am reads;
 * the trial balance is an English accounting document read at a desk by someone
 * who chose to open it. Translating everything would be a great deal of work
 * that nobody benefits from, and it would dilute the effort that should go into
 * getting the pen screens exactly right.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THESE TRANSLATIONS NEED A NATIVE SPEAKER'S REVIEW BEFORE THEY REACH WORKERS.
 *
 * They were written by someone who is not a native speaker of Hausa, Yorùbá or
 * Igbo. Yorùbá and Igbo are tonal and written with diacritics that change
 * meaning, and agricultural vocabulary varies by region. A wrong word on a
 * mortality form does not merely read badly — it produces wrong data, which is
 * worse than the English the worker was struggling with.
 *
 * The product says so where a farm selects one of these, rather than leaving it
 * to be discovered.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * No i18n library on purpose. This is one flat catalogue with typed keys, which
 * is enough for this many strings and adds no dependency to an install that has
 * been fragile.
 */

export type MessageKey =
  // The round
  | 'round.title'
  | 'round.subtitle'
  | 'round.date'
  | 'round.progress'
  | 'round.stop'
  | 'round.recorded'
  | 'round.back'
  | 'round.next'
  | 'round.skip'
  | 'round.review'
  | 'round.nothingYet'
  | 'round.sameAsYesterday'
  | 'round.carriedOver'
  | 'round.restored'
  // Sections
  | 'feed.title'
  | 'feed.type'
  | 'feed.quantity'
  | 'feed.reducesStock'
  | 'production.title'
  | 'mortality.title'
  | 'mortality.lost'
  | 'mortality.reducesPopulation'
  | 'mortality.cause'
  | 'mortality.photo'
  | 'notes.title'
  | 'notes.optional'
  | 'notes.placeholder'
  // Problems
  | 'problem.pickCause'
  | 'problem.tooMany'
  | 'problem.photoRequired'
  | 'problem.explain'
  // Navigation
  | 'nav.home'
  | 'nav.record'
  | 'nav.store'
  | 'nav.more'
  // Outbox
  | 'outbox.offline'
  | 'outbox.waiting'
  | 'outbox.saved';

type Catalogue = Record<MessageKey, string>;

const EN: Catalogue = {
  'round.title': 'Daily round',
  'round.subtitle': 'What happened today',
  'round.date': 'Date',
  'round.progress': 'Progress',
  'round.stop': 'Stop {n} of {total}',
  'round.recorded': '{done} of {total} recorded',
  'round.back': 'Back',
  'round.next': 'Next',
  'round.skip': 'Skip',
  'round.review': 'Review round',
  'round.nothingYet': 'Nothing recorded yet. Enter at least one figure at any stop.',
  'round.sameAsYesterday': 'Same as yesterday',
  'round.carriedOver': 'Carried over from yesterday. Check each figure before moving on.',
  'round.restored': 'Your unfinished round was restored.',

  'feed.title': 'Feed',
  'feed.type': 'Feed type',
  'feed.quantity': 'Quantity',
  'feed.reducesStock': 'Reduces feed stock',
  'production.title': 'What was collected',
  'mortality.title': 'Deaths',
  'mortality.lost': 'Lost today',
  'mortality.reducesPopulation': 'Reduces the number here',
  'mortality.cause': 'What caused it',
  'mortality.photo': 'Photograph',
  'notes.title': 'Notes',
  'notes.optional': 'Optional',
  'notes.placeholder': 'Anything unusual — weather, behaviour, equipment',

  'problem.pickCause': 'Pick a cause. Deaths without one cannot be looked into later.',
  'problem.tooMany': 'That is more than there are here.',
  'problem.photoRequired': 'A photograph is required for deaths on this farm.',
  'problem.explain': 'That is well away from yesterday. Add a note saying why.',

  'nav.home': 'Home',
  'nav.record': 'Record',
  'nav.store': 'Store',
  'nav.more': 'More',

  'outbox.offline': 'No connection. Your work is saved on this phone.',
  'outbox.waiting': '{n} waiting to send',
  'outbox.saved': 'Sent',
};

const HA: Catalogue = {
  'round.title': 'Zagayen yau',
  'round.subtitle': 'Abin da ya faru yau',
  'round.date': 'Kwanan wata',
  'round.progress': 'Ci gaba',
  'round.stop': 'Tsayi {n} daga {total}',
  'round.recorded': 'An rubuta {done} daga {total}',
  'round.back': 'Baya',
  'round.next': 'Na gaba',
  'round.skip': 'Tsallake',
  'round.review': 'Duba zagayen',
  'round.nothingYet': 'Ba a rubuta komai ba tukuna. Sa aƙalla lamba ɗaya.',
  'round.sameAsYesterday': 'Kamar jiya',
  'round.carriedOver': 'An kwafo daga jiya. Duba kowace lamba kafin ka ci gaba.',
  'round.restored': 'An dawo da zagayen da ba a gama ba.',

  'feed.title': 'Abinci',
  'feed.type': 'Nau’in abinci',
  'feed.quantity': 'Yawa',
  'feed.reducesStock': 'Zai rage abincin da ke ajiye',
  'production.title': 'Abin da aka tara',
  'mortality.title': 'Mutuwa',
  'mortality.lost': 'Adadin da suka mutu yau',
  'mortality.reducesPopulation': 'Zai rage adadin da ke nan',
  'mortality.cause': 'Me ya jawo',
  'mortality.photo': 'Hoto',
  'notes.title': 'Bayani',
  'notes.optional': 'Ba dole ba',
  'notes.placeholder': 'Duk abin da ba a saba gani ba — yanayi, hali, na’ura',

  'problem.pickCause': 'Zaɓi dalili. Mutuwa ba tare da dalili ba ba za a iya bincika ta ba.',
  'problem.tooMany': 'Wannan ya fi adadin da ke nan.',
  'problem.photoRequired': 'Ana buƙatar hoto don mutuwa a wannan gonar.',
  'problem.explain': 'Wannan ya bambanta sosai da jiya. Rubuta dalili.',

  'nav.home': 'Gida',
  'nav.record': 'Rubuta',
  'nav.store': 'Ajiya',
  'nav.more': 'Ƙari',

  'outbox.offline': 'Babu haɗi. An ajiye aikinka a wannan wayar.',
  'outbox.waiting': '{n} suna jira a aika',
  'outbox.saved': 'An aika',
};

const YO: Catalogue = {
  'round.title': 'Ìrìnàjò ojoojúmọ́',
  'round.subtitle': 'Ohun tí ó ṣẹlẹ̀ lónìí',
  'round.date': 'Ọjọ́',
  'round.progress': 'Ìtẹ̀síwájú',
  'round.stop': 'Ibùdó {n} nínú {total}',
  'round.recorded': 'A ti kọ {done} nínú {total}',
  'round.back': 'Padà',
  'round.next': 'Tókàn',
  'round.skip': 'Fò ó',
  'round.review': 'Ṣàyẹ̀wò ìrìnàjò',
  'round.nothingYet': 'A kò tí ì kọ nǹkan kan. Kọ ó kéré tán nọ́mbà kan.',
  'round.sameAsYesterday': 'Bí ti àná',
  'round.carriedOver': 'A ṣẹ̀dà rẹ̀ láti àná. Ṣàyẹ̀wò nọ́mbà kọ̀ọ̀kan kí o tó tẹ̀síwájú.',
  'round.restored': 'A ti dá ìrìnàjò tí kò parí padà.',

  'feed.title': 'Oúnjẹ',
  'feed.type': 'Irú oúnjẹ',
  'feed.quantity': 'Iye',
  'feed.reducesStock': 'Yóò dín oúnjẹ tí ó wà ní ilé ìtajà kù',
  'production.title': 'Ohun tí a kójọ',
  'mortality.title': 'Ikú',
  'mortality.lost': 'Iye tí ó kú lónìí',
  'mortality.reducesPopulation': 'Yóò dín iye tí ó wà níbí kù',
  'mortality.cause': 'Ohun tí ó fà á',
  'mortality.photo': 'Àwòrán',
  'notes.title': 'Àkíyèsí',
  'notes.optional': 'Kì í ṣe dandan',
  'notes.placeholder': 'Ohunkóhun tí kò wọ́pọ̀ — ojú ọjọ́, ìwà, ẹ̀rọ',

  'problem.pickCause': 'Yan ohun tí ó fà á. Ikú láìsí ìdí kò ṣeé ṣàyẹ̀wò lẹ́yìn náà.',
  'problem.tooMany': 'Èyí pọ̀ ju iye tí ó wà níbí lọ.',
  'problem.photoRequired': 'Àwòrán jẹ́ dandan fún ikú ní oko yìí.',
  'problem.explain': 'Èyí yàtọ̀ gan-an sí ti àná. Kọ ìdí rẹ̀.',

  'nav.home': 'Ilé',
  'nav.record': 'Kọ',
  'nav.store': 'Ilé ìtajà',
  'nav.more': 'Sí i',

  'outbox.offline': 'Kò sí ìsopọ̀. A ti fi iṣẹ́ rẹ pamọ́ sí fóònù yìí.',
  'outbox.waiting': '{n} ń dúró láti ránṣẹ́',
  'outbox.saved': 'A ti ránṣẹ́',
};

const IG: Catalogue = {
  'round.title': 'Njem ụbọchị',
  'round.subtitle': 'Ihe mere taa',
  'round.date': 'Ụbọchị',
  'round.progress': 'Ọganihu',
  'round.stop': 'Nkwụsị {n} nʼime {total}',
  'round.recorded': 'Edeela {done} nʼime {total}',
  'round.back': 'Laghachi',
  'round.next': 'Osote',
  'round.skip': 'Wụfee',
  'round.review': 'Nyochaa njem',
  'round.nothingYet': 'Edebeghị ihe ọ bụla. Tinye opekempe otu ọnụọgụ.',
  'round.sameAsYesterday': 'Otu ka ụnyaahụ',
  'round.carriedOver': 'E si nʼụnyaahụ bute ya. Lelee ọnụọgụ ọ bụla tupu ị gaa nʼihu.',
  'round.restored': 'E weghachiri njem ị na-emechabeghị.',

  'feed.title': 'Nri',
  'feed.type': 'Ụdị nri',
  'feed.quantity': 'Ọnụọgụ',
  'feed.reducesStock': 'Ọ ga-ebelata nri dị nʼụlọ nkwakọba',
  'production.title': 'Ihe achịkọtara',
  'mortality.title': 'Ọnwụ',
  'mortality.lost': 'Ole nwụrụ taa',
  'mortality.reducesPopulation': 'Ọ ga-ebelata ọnụọgụ dị ebe a',
  'mortality.cause': 'Ihe kpatara ya',
  'mortality.photo': 'Foto',
  'notes.title': 'Ndetu',
  'notes.optional': 'Ọ bụghị mmanye',
  'notes.placeholder': 'Ihe ọ bụla na-adịghị adị — ihu igwe, àgwà, akụrụngwa',

  'problem.pickCause': 'Họrọ ihe kpatara ya. Ọnwụ na-enweghị ihe kpatara ya agaghị enwe nyocha.',
  'problem.tooMany': 'Nke a karịrị ọnụọgụ dị ebe a.',
  'problem.photoRequired': 'Achọrọ foto maka ọnwụ nʼugbo a.',
  'problem.explain': 'Nke a dị iche nke ukwuu na ụnyaahụ. Dee ihe kpatara ya.',

  'nav.home': 'Ụlọ',
  'nav.record': 'Dee',
  'nav.store': 'Ụlọ nkwakọba',
  'nav.more': 'Ọzọ',

  'outbox.offline': 'Enweghị njikọ. Echekwara ọrụ gị na ekwentị a.',
  'outbox.waiting': '{n} na-echere izipu',
  'outbox.saved': 'Ezigala',
};

const CATALOGUES: Record<LanguageCode, Catalogue> = {
  en: EN,
  ha: HA,
  yo: YO,
  ig: IG,
};

/** Languages whose wording has not been checked by a native speaker. */
export const NEEDS_REVIEW: LanguageCode[] = ['ha', 'yo', 'ig'];

/**
 * Look up a message.
 *
 * Falls back to English on a missing key rather than showing the key itself — a
 * worker seeing `mortality.lost` on a form learns nothing, and an English label
 * they half-recognise is recoverable.
 */
export function t(
  language: LanguageCode,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const message = CATALOGUES[language]?.[key] ?? EN[key] ?? key;
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** A bound translator, so components do not thread the language everywhere. */
export function translator(language: LanguageCode) {
  return (key: MessageKey, vars?: Record<string, string | number>) =>
    t(language, key, vars);
}
