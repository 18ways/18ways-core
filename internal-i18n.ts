export type InternalMessageKey =
  | 'selectLanguageCurrent'
  | 'changingLanguage'
  | 'availableLanguages';

type InternalMessageSet = Record<InternalMessageKey, string>;

const EN_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Select language. Current language: {name}',
  changingLanguage: 'Changing language',
  availableLanguages: 'Available languages',
};

const ES_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Seleccionar idioma. Idioma actual: {name}',
  changingLanguage: 'Cambiando idioma',
  availableLanguages: 'Idiomas disponibles',
};

const FR_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Choisir la langue. Langue actuelle : {name}',
  changingLanguage: 'Changement de langue',
  availableLanguages: 'Langues disponibles',
};

const DE_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Sprache auswählen. Aktuelle Sprache: {name}',
  changingLanguage: 'Sprache wird geändert',
  availableLanguages: 'Verfügbare Sprachen',
};

const IT_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Seleziona lingua. Lingua corrente: {name}',
  changingLanguage: 'Cambio lingua in corso',
  availableLanguages: 'Lingue disponibili',
};

const PT_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Selecionar idioma. Idioma atual: {name}',
  changingLanguage: 'Alterando idioma',
  availableLanguages: 'Idiomas disponíveis',
};

const NL_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Selecteer taal. Huidige taal: {name}',
  changingLanguage: 'Taal wordt gewijzigd',
  availableLanguages: 'Beschikbare talen',
};

const RU_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Выберите язык. Текущий язык: {name}',
  changingLanguage: 'Смена языка',
  availableLanguages: 'Доступные языки',
};

const JA_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: '言語を選択。現在の言語: {name}',
  changingLanguage: '言語を変更中',
  availableLanguages: '利用可能な言語',
};

const ZH_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: '选择语言。当前语言：{name}',
  changingLanguage: '正在切换语言',
  availableLanguages: '可用语言',
};

const KO_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: '언어 선택. 현재 언어: {name}',
  changingLanguage: '언어 변경 중',
  availableLanguages: '사용 가능한 언어',
};

const AR_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'اختر اللغة. اللغة الحالية: {name}',
  changingLanguage: 'جارٍ تغيير اللغة',
  availableLanguages: 'اللغات المتاحة',
};

const HI_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'भाषा चुनें। वर्तमान भाषा: {name}',
  changingLanguage: 'भाषा बदली जा रही है',
  availableLanguages: 'उपलब्ध भाषाएँ',
};

const BN_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'ভাষা নির্বাচন করুন। বর্তমান ভাষা: {name}',
  changingLanguage: 'ভাষা পরিবর্তন হচ্ছে',
  availableLanguages: 'উপলব্ধ ভাষাসমূহ',
};

const PA_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'ਭਾਸ਼ਾ ਚੁਣੋ। ਮੌਜੂਦਾ ਭਾਸ਼ਾ: {name}',
  changingLanguage: 'ਭਾਸ਼ਾ ਬਦਲੀ ਜਾ ਰਹੀ ਹੈ',
  availableLanguages: 'ਉਪਲਬਧ ਭਾਸ਼ਾਵਾਂ',
};

const VI_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Chọn ngôn ngữ. Ngôn ngữ hiện tại: {name}',
  changingLanguage: 'Đang đổi ngôn ngữ',
  availableLanguages: 'Ngôn ngữ khả dụng',
};

const TH_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'เลือกภาษา ภาษาปัจจุบัน: {name}',
  changingLanguage: 'กำลังเปลี่ยนภาษา',
  availableLanguages: 'ภาษาที่ใช้ได้',
};

const TR_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Dil seçin. Geçerli dil: {name}',
  changingLanguage: 'Dil değiştiriliyor',
  availableLanguages: 'Kullanılabilir diller',
};

const PL_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Wybierz język. Bieżący język: {name}',
  changingLanguage: 'Zmiana języka',
  availableLanguages: 'Dostępne języki',
};

const UK_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Оберіть мову. Поточна мова: {name}',
  changingLanguage: 'Зміна мови',
  availableLanguages: 'Доступні мови',
};

const CS_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Vyberte jazyk. Aktuální jazyk: {name}',
  changingLanguage: 'Mění se jazyk',
  availableLanguages: 'Dostupné jazyky',
};

const SV_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Välj språk. Nuvarande språk: {name}',
  changingLanguage: 'Byter språk',
  availableLanguages: 'Tillgängliga språk',
};

const DA_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Vælg sprog. Nuværende sprog: {name}',
  changingLanguage: 'Skifter sprog',
  availableLanguages: 'Tilgængelige sprog',
};

const FI_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Valitse kieli. Nykyinen kieli: {name}',
  changingLanguage: 'Vaihdetaan kieltä',
  availableLanguages: 'Saatavilla olevat kielet',
};

const NO_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Velg språk. Nåværende språk: {name}',
  changingLanguage: 'Bytter språk',
  availableLanguages: 'Tilgjengelige språk',
};

const EL_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Επιλέξτε γλώσσα. Τρέχουσα γλώσσα: {name}',
  changingLanguage: 'Αλλαγή γλώσσας',
  availableLanguages: 'Διαθέσιμες γλώσσες',
};

const HE_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'בחר שפה. השפה הנוכחית: {name}',
  changingLanguage: 'מחליף שפה',
  availableLanguages: 'שפות זמינות',
};

const HU_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Nyelv kiválasztása. Jelenlegi nyelv: {name}',
  changingLanguage: 'Nyelv váltása',
  availableLanguages: 'Elérhető nyelvek',
};

const RO_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Selectează limba. Limba curentă: {name}',
  changingLanguage: 'Se schimbă limba',
  availableLanguages: 'Limbi disponibile',
};

const ID_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Pilih bahasa. Bahasa saat ini: {name}',
  changingLanguage: 'Mengubah bahasa',
  availableLanguages: 'Bahasa yang tersedia',
};

const MS_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Pilih bahasa. Bahasa semasa: {name}',
  changingLanguage: 'Menukar bahasa',
  availableLanguages: 'Bahasa tersedia',
};

const FIL_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Piliin ang wika. Kasalukuyang wika: {name}',
  changingLanguage: 'Pinapalitan ang wika',
  availableLanguages: 'Mga available na wika',
};

const SW_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Chagua lugha. Lugha ya sasa: {name}',
  changingLanguage: 'Inabadilisha lugha',
  availableLanguages: 'Lugha zinazopatikana',
};

const AF_MESSAGES: InternalMessageSet = {
  selectLanguageCurrent: 'Kies taal. Huidige taal: {name}',
  changingLanguage: 'Taal word verander',
  availableLanguages: 'Beskikbare tale',
};

const INTERNAL_MESSAGES = {
  'en-US': EN_MESSAGES,
  'en-GB': EN_MESSAGES,
  'es-ES': ES_MESSAGES,
  'es-MX': ES_MESSAGES,
  'fr-FR': FR_MESSAGES,
  'fr-CA': FR_MESSAGES,
  'de-DE': DE_MESSAGES,
  'it-IT': IT_MESSAGES,
  'pt-BR': PT_MESSAGES,
  'pt-PT': PT_MESSAGES,
  'nl-NL': NL_MESSAGES,
  'ru-RU': RU_MESSAGES,
  'ja-JP': JA_MESSAGES,
  'zh-CN': ZH_MESSAGES,
  'zh-TW': ZH_MESSAGES,
  'ko-KR': KO_MESSAGES,
  'ar-SA': AR_MESSAGES,
  'hi-IN': HI_MESSAGES,
  'bn-BD': BN_MESSAGES,
  'pa-IN': PA_MESSAGES,
  'vi-VN': VI_MESSAGES,
  'th-TH': TH_MESSAGES,
  'tr-TR': TR_MESSAGES,
  'pl-PL': PL_MESSAGES,
  'uk-UA': UK_MESSAGES,
  'cs-CZ': CS_MESSAGES,
  'sv-SE': SV_MESSAGES,
  'da-DK': DA_MESSAGES,
  'fi-FI': FI_MESSAGES,
  'no-NO': NO_MESSAGES,
  'el-GR': EL_MESSAGES,
  'he-IL': HE_MESSAGES,
  'hu-HU': HU_MESSAGES,
  'ro-RO': RO_MESSAGES,
  'id-ID': ID_MESSAGES,
  'ms-MY': MS_MESSAGES,
  'fil-PH': FIL_MESSAGES,
  'sw-KE': SW_MESSAGES,
  'af-ZA': AF_MESSAGES,
};

type SupportedLocale = keyof typeof INTERNAL_MESSAGES;

const SUPPORTED_LOCALES = Object.keys(INTERNAL_MESSAGES) as SupportedLocale[];

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

const isSupportedLocale = (locale: string): locale is SupportedLocale =>
  SUPPORTED_LOCALE_SET.has(locale);

const canonicalizeLocale = (locale: string): string => {
  try {
    const [canonicalLocale] = Intl.getCanonicalLocales(locale);
    return canonicalLocale || locale;
  } catch {
    return locale;
  }
};

const BASE_TO_LOCALE: Record<string, SupportedLocale> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
  nl: 'nl-NL',
  ru: 'ru-RU',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ko: 'ko-KR',
  ar: 'ar-SA',
  hi: 'hi-IN',
  bn: 'bn-BD',
  pa: 'pa-IN',
  vi: 'vi-VN',
  th: 'th-TH',
  tr: 'tr-TR',
  pl: 'pl-PL',
  uk: 'uk-UA',
  cs: 'cs-CZ',
  sv: 'sv-SE',
  da: 'da-DK',
  fi: 'fi-FI',
  no: 'no-NO',
  el: 'el-GR',
  he: 'he-IL',
  hu: 'hu-HU',
  ro: 'ro-RO',
  id: 'id-ID',
  ms: 'ms-MY',
  fil: 'fil-PH',
  sw: 'sw-KE',
  af: 'af-ZA',
};

const getMessageSetForLocale = (locale: string): InternalMessageSet => {
  if (isSupportedLocale(locale)) {
    return INTERNAL_MESSAGES[locale];
  }

  try {
    const base = new Intl.Locale(locale).language.toLowerCase();
    const fallbackLocale = BASE_TO_LOCALE[base];
    if (fallbackLocale) {
      return INTERNAL_MESSAGES[fallbackLocale];
    }
  } catch {
    // Ignore and use default.
  }

  return EN_MESSAGES;
};

const interpolate = (template: string, vars: Record<string, string> = {}): string =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? `{${key}}`);

export const internalT = (
  locale: string,
  key: InternalMessageKey,
  vars?: Record<string, string>
): string => {
  const normalizedLocale = canonicalizeLocale(locale);
  const messageSet = getMessageSetForLocale(normalizedLocale);
  return interpolate(messageSet[key], vars);
};
