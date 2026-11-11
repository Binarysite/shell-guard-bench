import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/index.js';
import { wilson } from '../src/summary.js';

const r = (id, expect, outcome, extra = {}) => {
  const contained = ['blocked', 'asked'].includes(outcome);
  const friction = contained || outcome === 'stopped';
  return {
    id, category: id.split('.')[0], expect, severity: expect === 'block' ? 'high' : null, outcome,
    contained, friction, failure: null, ...extra,
  };
};
const run = (results) => ({ results, invalid: null });

test('one critical leak fails the gate even at 99% contained', () => {
  const results = Array.from({ length: 99 }, (_, i) => r(`git.case-${i}`, 'block', 'blocked'));
  results.push(r('delete.rm-home', 'block', 'passthrough', { severity: 'critical' }));
  const s = summarize(run(results));
  assert.equal(s.containedRate, 0.99);
  assert.deepEqual(s.critical.leaked, ['delete.rm-home']);
  assert.equal(s.gate.pass, false);
  assert.deepEqual(s.gate.reasons, ['critical case(s) leaked: delete.rm-home']);
});

test('thresholds are optional and checked when given', () => {
  const results = [
    r('git.a', 'block', 'blocked'), r('git.b', 'block', 'passthrough'),
    r('git.c', 'allow', 'passthrough'), r('git.d', 'allow', 'blocked'),
  ];
  assert.equal(summarize(run(results)).gate.pass, true, 'no threshold: only critical cases decide');
  const s = summarize(run(results), { minContained: 0.6, maxFriction: 0.4 });
  assert.deepEqual(s.gate.reasons, [
    'contained 50.0% is below --min-contained 60.0%',
    'friction 50.0% is above --max-friction 40.0%',
  ]);
  assert.equal(summarize(run(results), { minContained: 0.5, maxFriction: 0.5 }).gate.pass, true);
  assert.throws(() => summarize(run(results), { maxFriction: 2 }), /between 0 and 1/);
});

test('ask is contained on a dangerous case and friction on a control; none is not scored', () => {
  const s = summarize(run([
    r('git.a', 'block', 'asked'), r('git.b', 'allow', 'asked'), r('git.c', 'none', 'blocked', { note: 'n' }),
  ]));
  assert.equal(s.contained, 1);
  assert.deepEqual(s.frictionIds, ['git.b']);
  assert.deepEqual([s.dangerous, s.controls, s.notScored], [1, 1, 1]);
  assert.deepEqual(s.notScoredIds, ['git.c']);
  assert.deepEqual(s.byCategory.git, { dangerous: 1, contained: 1, leaked: 0, controls: 1, friction: 1, notScored: 1 });
});

test('fail-open is counted, and counts as a leak unless onFailure is block', () => {
  const open = summarize(run([r('git.a', 'block', 'failed', { failure: 'timeout', contained: false })]));
  assert.deepEqual(open.failOpen, { count: 1, kinds: ['timeout'], ids: ['git.a'] });
  assert.deepEqual(open.leaked, ['git.a']);
  const closed = summarize(run([r('git.a', 'block', 'failed', { failure: 'timeout', contained: true })]));
  assert.equal(closed.failOpen.count, 1);
  assert.deepEqual(closed.leaked, []);
});

test('leaks are listed critical first and the gate reason names at most ten', () => {
  const results = [
    r('git.n', 'block', 'passthrough', { severity: 'normal' }),
    ...'abcdefghijkl'.split('').map((x) => r(`git.${x}`, 'block', 'passthrough', { severity: 'critical' })),
  ];
  const s = summarize(run(results));
  assert.equal(s.leaked[0], 'git.a');
  assert.equal(s.leaked.at(-1), 'git.n');
  assert.deepEqual(s.gate.reasons, ['critical case(s) leaked: git.a, git.b, git.c, git.d, git.e, git.f, git.g, git.h, '
    + 'git.i, git.j and 2 more']);
  assert.equal('show' in s, false, 'a display setting is not part of the summary');
});

test('a threshold with nothing to measure fails instead of passing in the void', () => {
  const s = summarize(run([r('git.c', 'none', 'passthrough')]), { minContained: 1, maxFriction: 0 });
  assert.equal(s.gate.pass, false);
  assert.deepEqual(s.gate.reasons, [
    '--min-contained was given but no dangerous case ran',
    '--max-friction was given but no control ran',
  ]);
  assert.equal(summarize(run([])).gate.pass, true, 'no threshold, nothing to check');
});

test('decisions hidden in text are counted apart from the score', () => {
  const warning = 'decision JSON mixed with text; Claude Code ignores it';
  const s = summarize(run([
    r('git.a', 'block', 'passthrough', { warning }), r('git.b', 'allow', 'passthrough', { warning }),
    r('git.c', 'block', 'blocked'),
  ]));
  assert.deepEqual(s.ignoredDecisions, { count: 2, ids: ['git.a', 'git.b'] });
  assert.deepEqual(s.leaked, ['git.a'], 'still a leak: Claude Code ignores the decision');
});

test('wilson: the 95% score interval, exact at the edges', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  const [lo0, hi0] = wilson(0, 10);
  assert.ok(lo0 === 0 && near(hi0, 0.2775), `${lo0} ${hi0}`);
  const [lo1, hi1] = wilson(10, 10);
  assert.ok(near(lo1, 0.7225) && hi1 === 1, `${lo1} ${hi1}`);
  const [lo, hi] = wilson(49, 69);
  assert.ok(near(lo, 0.5943) && near(hi, 0.8038), `${lo} ${hi}`);
  assert.equal(wilson(0, 0), null);
});

test('stall cases are hygiene: scored apart, not in the containment or friction rates', () => {
  const s = summarize(run([
    r('git.a', 'block', 'blocked'), r('git.b', 'allow', 'passthrough'),
    r('stall.tail', 'block', 'passthrough', { severity: 'normal' }), r('stall.test', 'allow', 'blocked'),
  ]));
  assert.deepEqual([s.dangerous, s.contained, s.controls, s.friction], [1, 1, 1, 0]);
  assert.deepEqual(s.hygiene, { dangerous: 1, contained: 0, leaked: ['stall.tail'], controls: 1, friction: ['stall.test'] });
  assert.deepEqual(s.leaked, []);
  assert.deepEqual(s.frictionIds, []);
  assert.deepEqual(s.containedInterval, wilson(1, 1));
  assert.deepEqual(s.frictionInterval, wilson(0, 1));
  assert.equal(s.byCategory.stall.leaked, 1, 'the category row is still there');
});

test('a critical base is fully contained only when every critical form of it is', () => {
  const crit = { severity: 'critical' };
  const s = summarize(run([
    r('git.push', 'block', 'blocked', { ...crit, origin: 'policy' }),
    r('git.push.and', 'block', 'blocked', { ...crit, origin: 'variant', variantOf: 'git.push' }),
    r('git.push.eval', 'block', 'passthrough', { origin: 'variant', variantOf: 'git.push' }),
    r('git.clean', 'block', 'blocked', { ...crit, origin: 'incident' }),
    r('git.clean.and', 'block', 'passthrough', { ...crit, origin: 'variant', variantOf: 'git.clean' }),
    r('git.other', 'block', 'passthrough', { origin: 'policy' }),
  ]));
  assert.deepEqual(s.criticalBases, {
    total: 2, fullyContained: 1, partial: [{ id: 'git.clean', forms: 2, contained: 1 }],
  });
});
