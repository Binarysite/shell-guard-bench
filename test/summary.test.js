import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/index.js';

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

test('leaks are listed critical first and long reasons are cut at show', () => {
  const results = [
    r('git.n', 'block', 'passthrough', { severity: 'normal' }),
    ...['a', 'b', 'c'].map((x) => r(`git.${x}`, 'block', 'passthrough', { severity: 'critical' })),
  ];
  const s = summarize(run(results), { show: 2 });
  assert.deepEqual(s.leaked, ['git.a', 'git.b', 'git.c', 'git.n']);
  assert.deepEqual(s.gate.reasons, ['critical case(s) leaked: git.a, git.b and 1 more']);
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
