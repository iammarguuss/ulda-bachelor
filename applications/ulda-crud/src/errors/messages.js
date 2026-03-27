const localizedMessages = {
  en: {
    "errors.validation": "The request data is invalid.",
    "errors.notFound": "The requested resource was not found.",
    "errors.database": "The service could not complete the database operation.",
    "errors.verification": "The ULDA verification step was not accepted.",
    "errors.internal": "The server could not complete the request.",
    "errors.routeNotFound": "The requested page or endpoint was not found.",
    "next.reviewInput": "Review the request data and try again.",
    "next.checkAddress": "Check the URL or request target and try again.",
    "next.retryLater": "Try again later or contact the project maintainer.",
    "next.useNextState": "Generate the next valid ULDA state and try again."
  },
  uk: {
    "errors.validation": "Дані запиту мають некоректний формат.",
    "errors.notFound": "Запитаний ресурс не знайдено.",
    "errors.database": "Сервіс не зміг виконати операцію з базою даних.",
    "errors.verification": "ULDA-перевірка не була прийнята.",
    "errors.internal": "Сервер не зміг виконати запит.",
    "errors.routeNotFound": "Запитану сторінку або endpoint не знайдено.",
    "next.reviewInput": "Перевірте дані запиту та спробуйте ще раз.",
    "next.checkAddress": "Перевірте адресу або ціль запиту й спробуйте ще раз.",
    "next.retryLater": "Спробуйте пізніше або зверніться до супроводу проєкту.",
    "next.useNextState": "Згенеруйте наступний коректний ULDA-стан і повторіть запит."
  }
};

/**
 * @param {"uk"|"en"|string} locale
 * @param {string} key
 * @returns {string}
 */
function translate(locale, key) {
  const normalizedLocale = String(locale ?? "en").toLowerCase().startsWith("uk") ? "uk" : "en";
  return localizedMessages[normalizedLocale]?.[key] ?? localizedMessages.en[key] ?? key;
}

/**
 * Builds a safe user-facing error response without leaking stack traces.
 *
 * @param {{ errorId: string, code: string, messageKey: string, nextStepKey: string }} error
 * @param {"uk"|"en"|string} locale
 * @param {string} requestId
 * @returns {{ ok: false, error: { id: string, code: string, message: string, nextStep: string, requestId: string } }}
 */
function createLocalizedErrorBody(error, locale, requestId) {
  return {
    ok: false,
    error: {
      id: error.errorId,
      code: error.code,
      message: translate(locale, error.messageKey),
      nextStep: translate(locale, error.nextStepKey),
      requestId
    }
  };
}

export {
  createLocalizedErrorBody,
  translate
};
