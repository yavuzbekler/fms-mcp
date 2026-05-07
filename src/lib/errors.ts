export class FmsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FmsError";
    this.code = code;
  }
}

export class InvalidPathError extends FmsError {
  constructor(message: string) {
    super("INVALID_PATH", message);
    this.name = "InvalidPathError";
  }
}

export class PathOutsideWorkspaceError extends FmsError {
  constructor(message: string) {
    super("PATH_OUTSIDE_WORKSPACE", message);
    this.name = "PathOutsideWorkspaceError";
  }
}

export class ReservedPathError extends FmsError {
  constructor(message: string) {
    super("RESERVED_PATH", message);
    this.name = "ReservedPathError";
  }
}

export class ToolNotFoundError extends FmsError {
  constructor(message: string) {
    super("TOOL_NOT_FOUND", message);
    this.name = "ToolNotFoundError";
  }
}

export class ValidationError extends FmsError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class FileNotFoundError extends FmsError {
  constructor(message: string) {
    super("FILE_NOT_FOUND", message);
    this.name = "FileNotFoundError";
  }
}

export class FileTooLargeError extends FmsError {
  constructor(message: string) {
    super("FILE_TOO_LARGE", message);
    this.name = "FileTooLargeError";
  }
}

export class IsDirectoryError extends FmsError {
  constructor(message: string) {
    super("IS_DIRECTORY", message);
    this.name = "IsDirectoryError";
  }
}

export class NotDirectoryError extends FmsError {
  constructor(message: string) {
    super("NOT_DIRECTORY", message);
    this.name = "NotDirectoryError";
  }
}

export class DestinationExistsError extends FmsError {
  constructor(message: string) {
    super("DESTINATION_EXISTS", message);
    this.name = "DestinationExistsError";
  }
}

export class OccurrenceCountMismatchError extends FmsError {
  constructor(message: string) {
    super("OCCURRENCE_MISMATCH", message);
    this.name = "OccurrenceCountMismatchError";
  }
}

export class OldStringNotFoundError extends FmsError {
  constructor(message: string) {
    super("OLD_STRING_NOT_FOUND", message);
    this.name = "OldStringNotFoundError";
  }
}

export class UnsupportedEncodingError extends FmsError {
  constructor(message: string) {
    super("UNSUPPORTED_ENCODING", message);
    this.name = "UnsupportedEncodingError";
  }
}

export class CommandSpawnError extends FmsError {
  constructor(message: string) {
    super("COMMAND_SPAWN_FAILED", message);
    this.name = "CommandSpawnError";
  }
}

export class ProcessNotFoundError extends FmsError {
  constructor(message: string) {
    super("PROCESS_NOT_FOUND", message);
    this.name = "ProcessNotFoundError";
  }
}

export class ProcessAlreadyExitedError extends FmsError {
  constructor(message: string) {
    super("PROCESS_ALREADY_EXITED", message);
    this.name = "ProcessAlreadyExitedError";
  }
}

export class TooManyProcessesError extends FmsError {
  constructor(message: string) {
    super("TOO_MANY_PROCESSES", message);
    this.name = "TooManyProcessesError";
  }
}

export class CommandTimeoutError extends FmsError {
  constructor(message: string) {
    super("COMMAND_TIMEOUT", message);
    this.name = "CommandTimeoutError";
  }
}

export function serializeError(err: unknown): { error: { code: string; message: string } } {
  if (err instanceof FmsError) {
    return { error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: { code: "UNKNOWN_ERROR", message } };
}
