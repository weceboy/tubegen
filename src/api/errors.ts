export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed.") {
    super("VALIDATION_ERROR", message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class JobError extends AppError {
  constructor(message: string) {
    super("JOB_ERROR", message, 500);
  }
}

export class PipelineStateError extends AppError {
  constructor(message: string) {
    super("PIPELINE_STATE_ERROR", message, 409);
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(message = "Required approval is missing.") {
    super("APPROVAL_REQUIRED", message, 409);
  }
}
