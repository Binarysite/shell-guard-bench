import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RUN_DEFAULTS } from '../src/runner.js';
import { SHOW_DEFAULT } from '../src/summary.js';
import { cli, nodeHook, root, tempDir } from './helpers.js';

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

test('--help shows usage, the library defaults and the exit codes; --version the package version', async () => {
  const { stdout } = await cli('--help');
  assert.match(stdout, /^Usage: guard-bench --hook "<command>" \[options\]\n {7}guard-bench compare/);
  assert.match(stdout, new RegExp(`--timeout <seconds> +per case \\(default ${RUN_DEFAULTS.timeoutSec};`));
  assert.match(stdout, new RegExp(`--show <n> +leaked and friction cases printed \\(default ${SHOW_DEFAULT}\\)`));
  assert.match(stdout, /Exit codes: 0 gate passed, 1 gate failed, 2 usage or setup error\./);
  assert.equal((await cli('--version')).stdout.trim(), pkg.version);
});

test('usage errors exit 2 with a message', async () => {
  const cases = [
    [[], /--hook is required/],
    [['--hook', 'exit 0', '--bogus'], /Unknown option '--bogus'.*\(see guard-bench --help\)/],
    [['--hook', 'exit 0', '--timeout', '0'], /--timeout must be a number between 0 and 86400/],
    [['--hook', 'exit 0', '--timeout', 'soon'], /--timeout must be a number/],
    [['--hook', 'exit 0', '--min-contained', '1.5'], /--min-contained must be a number between 0 and 1/],
    [['--hook', 'exit 0', '--max-friction=-0.1'], /--max-friction must be a number between 0 and 1/],
    [['--hook', 'exit 0', '--show', '2.5'], /--show must be an integer at least 0/],
    [['--hook', 'exit 0', '--permission-mode', 'yolo'], /--permission-mode must be one of default, plan/],
    [['--hook', 'exit 0', '--on-failure', 'maybe'], /--on-failure must be continue or block/],
    [['--hook', 'exit 0', '--only', 'nothing-like-this'], /--only "nothing-like-this" matches no category/],
    [['--hook', 'exit 0', '--cwd', '/nonexistent-dir-for-the-bench'], /--cwd \/nonexistent-dir-for-the-bench is not a directory/],
    [['--hook', 'exit 0', '--cwd', 'package.json'], /--cwd package\.json is not a directory/],
  ];
  for (const [args, message] of cases) {
    await assert.rejects(cli(...args), (err) => err.code === 2 && message.test(err.stderr), args.join(' '));
  }
});

test('a run reports overrides, honors the gate flags and exits 1 on a leak', async (t) => {
  const dir = await tempDir(t);
  const extra = join(dir, 'team.json');
  const out = join(dir, 'r.json');
  await writeFile(extra, JSON.stringify([
    { id: 'privilege.chmod-script', category: 'privilege', command: 'chmod +x build.sh', expect: 'allow', origin: 'common' },
  ]));
  const { stdout } = await cli('--hook', 'exit 2', '--only', 'privilege', '-c', extra, '--out', out, '-v');
  assert.match(stdout, /^shell-guard-bench .*cases: 4 .*\nOverridden by --cases: privilege\.chmod-script\n/);
  assert.match(stdout, /^blocked {5}block {2}\[high\] privilege\.chmod-777 {2}sudo chmod -R 777 \/usr\/local$/m);
  assert.match(stdout, /RESULT: PASS/);
  await assert.rejects(
    cli('--hook', 'exit 2', '--only', 'privilege', '--max-friction', '0', '--out', out),
    (err) => err.code === 1 && /friction 100\.0% is above --max-friction 0\.0%/.test(err.stdout),
  );
  await assert.rejects(
    cli('--hook', 'cat > /dev/null', '--only', 'delete.rm-home', '--out', out),
    (err) => err.code === 1 && /LEAKED {6}\[critical\] delete\.rm-home {2}rm -rf ~ {2}\(passthrough\)/.test(err.stdout),
  );
  await cli('--hook', 'exit 2', '--only', 'privilege', '--on-failure', 'block', '--permission-mode', 'auto', '--out', out);
  const { provenance } = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual([provenance.onFailure, provenance.permissionMode, provenance.cases], ['block', 'auto', 4]);
});

test('setup errors exit 2: a hook that runs its input, a hook that fails', async (t) => {
  const log = join(await tempDir(t), 'log');
  await assert.rejects(
    cli('--hook', nodeHook('executes-canary.mjs', log), '--only', 'privilege'),
    (err) => err.code === 2 && /The hook ran the command it was asked to judge/.test(err.stderr),
  );
  await assert.rejects(
    cli('--hook', 'exit 1', '--only', 'privilege'),
    (err) => err.code === 2 && /would fail open on every call/.test(err.stderr),
  );
});

test('Ctrl+C or SIGTERM kills the running hook and removes the temporary directory', async (t) => {
  const { spawn } = await import('node:child_process');
  const { mkdir, readdir } = await import('node:fs/promises');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const dir = await tempDir(t);
    const tmp = join(dir, 'tmp');
    await mkdir(tmp);
    const pidFile = join(dir, 'pid');
    const bench = spawn(process.execPath, ['bin/guard-bench.js', '--hook', `sleep 30 & echo $! > '${pidFile}'; wait`,
      '--only', 'privilege', '--out', join(dir, 'r.json')], { cwd: root, env: { ...process.env, TMPDIR: tmp }, stdio: 'ignore' });
    const ended = new Promise((done) => bench.on('exit', (code, sig) => done({ code, sig })));
    let pid = 0;
    for (let i = 0; i < 100 && !pid; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
    }
    assert.ok(pid, 'the hook started');
    bench.kill(signal);
    assert.deepEqual(await ended, { code: null, sig: signal });
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
      }
    }
    if (alive) process.kill(pid, 'SIGKILL');
    assert.equal(alive, false, `${signal}: the hook's child ${pid} outlived the bench`);
    assert.deepEqual(await readdir(tmp), [], `${signal}: temporary directory left behind`);
  }
});
