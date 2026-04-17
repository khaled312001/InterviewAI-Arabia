// Wrap async route handlers so thrown errors reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom HTTP error carrying a status code + message.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

// BigInt JSON serialization (MySQL IDs are BigInt under Prisma).
BigInt.prototype.toJSON = function () {
  return this.toString();
};
