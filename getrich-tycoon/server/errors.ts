import type { ErrorCode } from '../shared/protocol';

/** An expected, user-facing error. Its message is safe to show to players. */
export class GameError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export const fail = (code: ErrorCode, message: string): never => {
  throw new GameError(code, message);
};

export function assert(cond: unknown, code: ErrorCode, message: string): asserts cond {
  if (!cond) throw new GameError(code, message);
}
