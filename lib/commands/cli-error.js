/**
 * CliError is thrown by CLI command `run()` functions to signal a user-facing
 * failure with a specific exit code. The bin/pear-git dispatcher catches these
 * and translates `err.code` into `process.exit(code)`.
 *
 * The error message is assumed to have already been written to stderr by the
 * caller before throwing.
 */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} code
   */
  constructor (message, code) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}
