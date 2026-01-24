export class APIError extends Error {
  public readonly error: string;
  public readonly statusCode: number;

  constructor(error: string, message: string, statusCode: number) {
    super(message);
    this.name = "APIError";
    this.error = error;
    this.statusCode = statusCode;
  }
}

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeViolationError";
  }
}
