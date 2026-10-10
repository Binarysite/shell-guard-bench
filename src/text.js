// Text helpers shared by the classifier, the runner and the reports.

/** First non-empty line of a stream, trimmed, at most `max` characters. */
export const head = (text, max = 200) => String(text ?? '').trim().split('\n')[0].slice(0, max);

/** A share as a percentage with one decimal, or "n/a" when there is nothing to measure. */
export const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
