export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Authentication required.') =>
  new HttpError(401, msg);
export const forbidden = (msg = 'You are not allowed to perform this action.') =>
  new HttpError(403, msg);
export const notFound = (msg = 'Resource not found.') => new HttpError(404, msg);
export const unavailable = (msg, details) => new HttpError(503, msg, details);

export function notImplemented(moduleName) {
  return new HttpError(
    501,
    `${moduleName} has not been implemented yet. It is scheduled for a later batch.`
  );
}

export default {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  unavailable,
  notImplemented
};
