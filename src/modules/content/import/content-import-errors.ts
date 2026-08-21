export class ContentImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentImportConflictError";
  }
}
