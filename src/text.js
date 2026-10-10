// Text helpers shared by the classifier, the runner and the reports.

/** First non-empty line of a stream, trimmed, at most `max` characters. */
export const head = (text, max = 200) => String(text ?? '').trim().split('\n')[0].slice(0, max);

/** A share as a percentage with one decimal, or "n/a" when there is nothing to measure. */
export const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

/**
 * Control characters (C0 but tab, DEL and C1) written as \uXXXX. Case commands and
 * notes can come from someone else's --cases file and reasons from the hook, and an
 * escape sequence must not retitle or clear the terminal that prints them.
 */
export const printable = (text) => String(text)
  .replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
