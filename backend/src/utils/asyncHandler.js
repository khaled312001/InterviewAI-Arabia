// Wrap async route handlers so thrown errors reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom HTTP error carrying a status code + message.
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message   Human-readable fallback. Clients should prefer `code`.
   * @param {object} [details]
   * @param {string} [code]    Stable machine-readable identifier, e.g. QUOTA_EXCEEDED.
   *
   * `code` exists because the client cannot localise or branch on a prose
   * string: a 402 for "out of daily questions" and a 503 for "the model is
   * down" were rendering as the same generic failure with a Retry button that
   * could only fail again.
   */
  constructor(status, message, details, code) {
    super(message);
    this.status = status;
    if (details) this.details = details;
    if (code) this.code = code;
  }
}

// BigInt JSON serialization (MySQL IDs are BigInt under Prisma).
BigInt.prototype.toJSON = function () {
  return this.toString();
};
