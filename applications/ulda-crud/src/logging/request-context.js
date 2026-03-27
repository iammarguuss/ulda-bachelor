import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const requestContextStorage = new AsyncLocalStorage();

/**
 * @typedef {object} RequestContext
 * @property {string} requestId
 * @property {"uk"|"en"} locale
 * @property {string} method
 * @property {string} path
 * @property {string} [route]
 * @property {string} [ip]
 */

function normalizeLocale(value) {
  const locale = String(value ?? "").toLowerCase();
  return locale.startsWith("uk") ? "uk" : "en";
}

function detectLocale(req) {
  if (typeof req.query?.lang === "string" && req.query.lang) {
    return normalizeLocale(req.query.lang);
  }
  const preferred = req.get("x-lang") || req.get("accept-language") || "en";
  return normalizeLocale(preferred);
}

/**
 * Returns the current async request context or an empty object outside request scope.
 *
 * @returns {Partial<RequestContext>}
 */
function getRequestContext() {
  return requestContextStorage.getStore() ?? {};
}

/**
 * Runs a callback inside the current request context enriched with extra fields.
 *
 * @template T
 * @param {Partial<RequestContext>} extraContext
 * @param {() => T} callback
 * @returns {T}
 */
function withRequestContext(extraContext, callback) {
  const current = getRequestContext();
  return requestContextStorage.run({ ...current, ...extraContext }, callback);
}

/**
 * Express middleware that initializes request-scoped identifiers and locale.
 *
 * @param {*} req
 * @param {*} res
 * @param {*} next
 */
function requestContextMiddleware(req, res, next) {
  const context = {
    requestId: randomUUID(),
    locale: detectLocale(req),
    method: req.method,
    path: req.originalUrl ?? req.url,
    route: req.path,
    ip: req.ip
  };

  req.requestId = context.requestId;
  req.locale = context.locale;
  res.locals.requestId = context.requestId;
  res.locals.locale = context.locale;

  requestContextStorage.run(context, () => next());
}

export {
  getRequestContext,
  requestContextMiddleware,
  withRequestContext
};
