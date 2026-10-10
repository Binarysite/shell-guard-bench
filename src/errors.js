// The one error the bench throws on purpose: it cannot be trusted to go on.

export const SETUP_ERROR_CODES = Object.freeze([
  'unsupported-platform', 'no-cases', 'invalid-case', 'canary-executed', 'hook-failed-on-canary',
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
