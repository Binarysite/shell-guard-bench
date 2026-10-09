// Toy guard for the demo. Not for production.
// One pattern per critical base case of the corpus. Each pattern starts with the
// program it is about, so anchoring it to the start of the command is meaningful.
export const PATTERNS = [
  ['delete home', String.raw`(?:\\?rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:~|\$HOME)/?(?![\w./-])|find\s+(?:~|\$HOME)\s.*-delete)`],
  ['broad pkill', String.raw`pkill\s+-f\b`],
  ['killall', String.raw`killall\b`],
  ['tmux kill-server', String.raw`tmux\s+kill-server\b`],
  ['rsync delete', String.raw`rsync\b.*--delete`],
  ['force push', String.raw`git\s+push\b.*(?:--force(?![-\w])|\s-f\b|\s\+\w)`],
  ['git clean', String.raw`git\s+clean\s+-[a-zA-Z]*f`],
  ['drop table', String.raw`(?:psql\b.*)?DROP\s+TABLE\b`],
];

/** Reads the PreToolUse event from stdin and returns the Bash command. */
export async function readCommand() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text).tool_input?.command ?? '';
}
