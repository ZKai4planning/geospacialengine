export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, d) => new AppError(400, 'BAD_REQUEST', m, d);
export const notFound = (m) => new AppError(404, 'NOT_FOUND', m);
export const upstream = (m, d) => new AppError(502, 'UPSTREAM_ERROR', m, d);
export const unauthorized = (m) => new AppError(401, 'UNAUTHORIZED', m);
export const forbidden = (m) => new AppError(403, 'FORBIDDEN', m);
export const conflict = (m, d) => new AppError(409, 'CONFLICT', m, d);
