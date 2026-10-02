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
  | 'mortality.carcass'
  | 'carcass.BURIED'
  | 'carcass.BURNT'
  | 'carcass.RENDERED'
  | 'carcass.COLLECTED'
  | 'carcass.OTHER'
  | 'weight.title'
  | 'weight.optional'
  | 'weight.count'
  | 'weight.total'
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
  | 'nav.approvals'
  | 'nav.buying'
  | 'nav.books'
  | 'nav.selling'
  | 'nav.money'
  // Processing order flow
  | 'order.raise'
  | 'order.dialog'
  | 'order.harvestMode'
  | 'order.feedMode'
  | 'order.stepSource'
  | 'order.stepRecipe'
  | 'order.stepOutput'
  | 'order.harvest'
  | 'order.product'
  | 'order.noHarvest'
  | 'order.checkHarvest'
  | 'order.farm'
  | 'order.branch'
  | 'order.feedFor'
  | 'order.snail'
  | 'order.poultry'
  | 'order.feedRecipe'
  | 'order.plannedOutput'
  | 'order.outputHint'
  | 'order.progressHint'
  | 'order.stepProgress'
  | 'order.harvestPlaceholder'
  | 'order.productPlaceholder'
  | 'order.recipeMissing'
  | 'order.outputTitle'
  | 'common.back'
  | 'common.continue'
  | 'common.done'
  | 'common.raising'
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
  'mortality.carcass': 'What was done with the dead',
  'carcass.BURIED': 'Buried',
  'carcass.BURNT': 'Burnt',
  'carcass.RENDERED': 'Rendered',
  'carcass.COLLECTED': 'Collected',
  'carcass.OTHER': 'Other',
  'weight.title': 'Weight sample',
  'weight.optional': 'Optional — a supervisor approves it',
  'weight.count': 'How many weighed',
  'weight.total': 'What they weighed together',
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
  'nav.approvals': 'Approvals',
  'nav.buying': 'Buy',
  'nav.books': 'Books',
  'nav.selling': 'Sell',
  'nav.money': 'Money',
  'order.raise': 'Raise an order',
  'order.dialog': 'Raise a processing order',
  'order.harvestMode': 'From a harvest',
  'order.feedMode': 'Feed mill',
  'order.stepSource': 'Source',
  'order.stepRecipe': 'Recipe',
  'order.stepOutput': 'Output',
  'order.harvest': 'Choose the harvest',
  'order.product': 'Choose the product',
  'order.noHarvest': 'No harvest is waiting for processing. Record or review a harvest first.',
  'order.checkHarvest': 'Check harvest readiness',
  'order.farm': 'Farm',
  'order.branch': 'Branch',
  'order.feedFor': 'Feed for',
  'order.snail': 'Snails',
  'order.poultry': 'Poultry',
  'order.feedRecipe': 'Choose the feed recipe',
  'order.plannedOutput': 'Planned output quantity',
  'order.outputHint': 'Enter the expected finished quantity in the recipe’s output unit.',
  'order.progressHint': 'Your entries stay in place if you go back.',
  'order.stepProgress': 'Step {step} of {total} · {label}',
  'order.harvestPlaceholder': 'Choose the harvest this order will process',
  'order.productPlaceholder': 'Choose the product for this batch',
  'order.recipeMissing': 'No active recipe is ready. Add and activate a recipe before continuing.',
  'order.outputTitle': 'Set the planned output',
  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.done': 'Done',
  'common.raising': 'Raising…',

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
  'mortality.carcass': 'Me aka yi da gawarwakin',
  'carcass.BURIED': 'An binne',
  'carcass.BURNT': 'An ƙone',
  'carcass.RENDERED': 'An sarrafa',
  'carcass.COLLECTED': 'An kwashe',
  'carcass.OTHER': 'Wani abu dabam',
  'weight.title': 'Samfurin nauyi',
  'weight.optional': 'Ba dole ba — mai kulawa zai amince',
  'weight.count': 'Nawa aka auna',
  'weight.total': 'Nauyinsu gaba ɗaya',
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
  'nav.approvals': 'Amincewa',
  'nav.buying': 'Sayayya',
  'nav.books': 'Littattafai',
  'nav.selling': 'Sayarwa',
  'nav.money': 'Kuɗi',
  'order.raise': 'Ɗaga oda',
  'order.dialog': 'Ɗaga odar sarrafawa',
  'order.harvestMode': 'Daga girbi',
  'order.feedMode': 'Niƙa abinci',
  'order.stepSource': 'Asali',
  'order.stepRecipe': 'Hanyar hadawa',
  'order.stepOutput': 'Abin da aka samar',
  'order.harvest': 'Zaɓi girbin',
  'order.product': 'Zaɓi samfurin',
  'order.noHarvest': 'Babu girbin da ke jiran sarrafawa. Yi ko duba girbi tukuna.',
  'order.checkHarvest': 'Duba shirye-shiryen girbi',
  'order.farm': 'Gona',
  'order.branch': 'Reshe',
  'order.feedFor': 'Abincin don',
  'order.snail': 'Katantanwa',
  'order.poultry': 'Kaji',
  'order.feedRecipe': 'Zaɓi hanyar haɗa abincin',
  'order.plannedOutput': 'Yawan abin da ake shirin samarwa',
  'order.outputHint': 'Shigar da yawan abin da ake sa ran samu bisa ma’aunin hanyar haɗin.',
  'order.progressHint': 'Abin da ka shigar zai tsaya idan ka koma baya.',
  'order.stepProgress': 'Mataki {step} cikin {total} · {label}',
  'order.harvestPlaceholder': 'Zaɓi girbin da wannan oda zai sarrafa',
  'order.productPlaceholder': 'Zaɓi samfurin wannan rukuni',
  'order.recipeMissing': 'Babu hanyar haɗawa mai aiki. Ƙara ta kuma kunna ta kafin ci gaba.',
  'order.outputTitle': 'Saita abin da ake shirin samarwa',
  'common.back': 'Baya',
  'common.continue': 'Ci gaba',
  'common.done': 'An gama',
  'common.raising': 'Ana ɗagawa…',

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
  'mortality.carcass': 'Kí ni a ṣe sí òkú wọn',
  'carcass.BURIED': 'A sin wọ́n',
  'carcass.BURNT': 'A sun wọ́n',
  'carcass.RENDERED': 'A ṣe wọ́n di ohun èlò',
  'carcass.COLLECTED': 'Wọ́n kó wọn lọ',
  'carcass.OTHER': 'Òmíràn',
  'weight.title': 'Àpẹẹrẹ ìwúwo',
  'weight.optional': 'Kò pọndandan — alábòójútó yóò fọwọ́ sí i',
  'weight.count': 'Mélòó ni a wọ̀n',
  'weight.total': 'Ìwúwo gbogbo wọn papọ̀',
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
  'nav.approvals': 'Ìfọwọ́sí',
  'nav.buying': 'Rírà',
  'nav.books': 'Ìwé ìṣúná',
  'nav.selling': 'Títà',
  'nav.money': 'Owó',
  'order.raise': 'Ṣẹ̀dá iṣẹ́',
  'order.dialog': 'Ṣẹ̀dá iṣẹ́ ìṣelọ́pọ̀',
  'order.harvestMode': 'Láti inú ìkórè',
  'order.feedMode': 'Ilé iṣẹ́ oúnjẹ ẹranko',
  'order.stepSource': 'Orísun',
  'order.stepRecipe': 'Ìlànà ìdàpọ̀',
  'order.stepOutput': 'Èso iṣẹ́',
  'order.harvest': 'Yan ìkórè',
  'order.product': 'Yan ọjà',
  'order.noHarvest': 'Kò sí ìkórè tó ń dúró de ìṣelọ́pọ̀. Kọ ìkórè sílẹ̀ tàbí ṣàyẹ̀wò rẹ̀ kọ́kọ́.',
  'order.checkHarvest': 'Ṣàyẹ̀wò ìmúrasílẹ̀ ìkórè',
  'order.farm': 'Oko',
  'order.branch': 'Ẹ̀ka',
  'order.feedFor': 'Oúnjẹ fún',
  'order.snail': 'Ìgbín',
  'order.poultry': 'Adìẹ',
  'order.feedRecipe': 'Yan ìlànà ìdàpọ̀ oúnjẹ',
  'order.plannedOutput': 'Iye èso iṣẹ́ tí a retí',
  'order.outputHint': 'Tẹ iye èso tí a retí ní ìwọ̀n ìlànà ìdàpọ̀ náà.',
  'order.progressHint': 'Àwọn ohun tí o ti tẹ yóò dúró síbẹ̀ bí o bá padà sẹ́yìn.',
  'order.stepProgress': 'Ìgbésẹ̀ {step} nínú {total} · {label}',
  'order.harvestPlaceholder': 'Yan ìkórè tí iṣẹ́ yìí yóò lò',
  'order.productPlaceholder': 'Yan ọjà fún ìpele yìí',
  'order.recipeMissing': 'Kò sí ìlànà tó ṣiṣẹ́. Fi ìlànà kún un kí o sì mú un ṣiṣẹ́ kí o tó tẹ̀síwájú.',
  'order.outputTitle': 'Ṣètò iye èso iṣẹ́ tí a retí',
  'common.back': 'Padà',
  'common.continue': 'Tẹ̀síwájú',
  'common.done': 'Parí',
  'common.raising': 'A ń ṣẹ̀dá…',

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
  'mortality.carcass': 'Gịnị ka e mere ozu ha',
  'carcass.BURIED': 'E liri ha',
  'carcass.BURNT': 'E sure ha ọkụ',
  'carcass.RENDERED': 'E mebere ha ihe ọzọ',
  'carcass.COLLECTED': 'A kpọrọ ha pụọ',
  'carcass.OTHER': 'Ihe ọzọ',
  'weight.title': 'Ihe nlele ịdị arọ',
  'weight.optional': 'Ọ bụghị iwu — onye nlekọta ga-akwado ya',
  'weight.count': 'Ole ka a tụrụ',
  'weight.total': 'Ịdị arọ ha niile ọnụ',
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
  'nav.approvals': 'Nkwado',
  'nav.buying': 'Ịzụ',
  'nav.books': 'Akwụkwọ ndekọ',
  'nav.selling': 'Ịre',
  'nav.money': 'Ego',
  'order.raise': 'Mepụta iwu',
  'order.dialog': 'Mepụta iwu nhazi',
  'order.harvestMode': 'Site nʼowuwe',
  'order.feedMode': 'Igwe nri anụmanụ',
  'order.stepSource': 'Isi mmalite',
  'order.stepRecipe': 'Ntụziaka',
  'order.stepOutput': 'Ihe e mepụtara',
  'order.harvest': 'Họrọ owuwe',
  'order.product': 'Họrọ ngwaahịa',
  'order.noHarvest': 'Enweghị owuwe na-eche nhazi. Buru ụzọ dekọọ owuwe ma ọ bụ lelee ya.',
  'order.checkHarvest': 'Lelee njikere owuwe',
  'order.farm': 'Ugbo',
  'order.branch': 'Alaka',
  'order.feedFor': 'Nri maka',
  'order.snail': 'Ejula',
  'order.poultry': 'Ọkụkọ',
  'order.feedRecipe': 'Họrọ ntụziaka nri',
  'order.plannedOutput': 'Ọnụọgụ ihe a na-atụ anya imepụta',
  'order.outputHint': 'Tinye ọnụọgụ ngwaahịa a tụrụ anya ya nʼotu nha ntụziaka ahụ.',
  'order.progressHint': 'Ihe i tinyere ga-adị ma ị laghachi azụ.',
  'order.stepProgress': 'Nzọụkwụ {step} n’ime {total} · {label}',
  'order.harvestPlaceholder': 'Họrọ owuwe iwu a ga-eji hazie',
  'order.productPlaceholder': 'Họrọ ngwaahịa maka ogbe a',
  'order.recipeMissing': 'Enweghị ntụziaka na-arụ ọrụ. Tinye ya ma mee ka ọ rụọ ọrụ tupu ịga n’ihu.',
  'order.outputTitle': 'Debe ihe a na-atụ anya imepụta',
  'common.back': 'Laghachi',
  'common.continue': 'Gaa nʼihu',
  'common.done': 'Emechaala',
  'common.raising': 'A na-emepụta…',

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
