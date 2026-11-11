// The one error the bench throws on purpose: it cannot be trusted to go on.

export const SETUP_ERROR_CODES = Object.freeze([
  'unsupported-platform', 'no-cases', 'invalid-case', 'invalid-promise', 'canary-executed', 'hook-failed-on-canary',
]);

export class SetupError extends Error {
  /**
   * @param {import('../index.js').SetupErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'SetupError';
    this.code = code;
  }
}

/**
 * What went wrong reading a file, for a message that names it.
 * @param {any} err a caught fs error
 */
export const fileProblem = (err) => (err?.code === 'ENOENT' ? 'file not found' : String(err?.message ?? err));
