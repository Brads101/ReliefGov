import { HttpError } from '../lib/errors.js';

export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: { status: 404, message: `Route not found: ${req.method} ${req.originalUrl}` }
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err instanceof HttpError ? err.status : err.status || 500;
  const expected = err instanceof HttpError;
  if (!expected) console.error('[ReliefGov] Unhandled error:', err);
  res.status(status).json({
    error: {
      status,
      message: err.message || 'Unexpected server error.',
      details: err.details
    }
  });
}

export default { notFoundHandler, errorHandler };
