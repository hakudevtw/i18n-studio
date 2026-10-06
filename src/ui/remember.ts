const KEY = "i18n-studio.lang";
let session: string | null = null;

/** The language the user picked last. localStorage may be blocked; then it lasts for the session only. */
export const readRemembered = (): string | null => {
  try {
    return localStorage.getItem(KEY) ?? session;
  } catch {
    return session;
  }
};

export const remember = (locale: string) => {
  session = locale;
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // storage unavailable: the choice lives for this page view only
  }
};

/** Forget the remembered choice (used by tests and by nothing else). */
export const forget = () => {
  session = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
};
