/**
 * An error we raise on purpose. Its message is written by us and is safe to
 * send to the client. Never put user input or a key in it.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
