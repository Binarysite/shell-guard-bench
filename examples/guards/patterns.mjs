// Toy guard for the demo. Not for production.
// One pattern per critical base case of the corpus. Each pattern starts with the
// program it is about, so anchoring it to the start of the command is meaningful.
export const PATTERNS = [
  // rm with any recursive flag spelling, line continuations and a quoted $HOME; find on ~ that deletes.
  ['delete home', String.raw`(?:\\?rm(?:\s+(?:-[a-zA-Z]+|--[a-z-]+)|\s*\\\n)*\s+["']?(?:~|\$HOME|\$\{HOME\})["']?/?(?![\w./-])`
    + String.raw`|find\s+(?:~|\$HOME)\s.*(?:-delete|-exec\s+rm\b))`],
  ['delete root', String.raw`rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+/(?![\w.-])`],
  ['disk write', String.raw`dd\b.*\bof=/dev/(?!null\b|zero\b)`],
  ['broad pkill', String.raw`pkill\s+-f\b`],
  ['killall', String.raw`killall\b`],
  ['tmux kill-server', String.raw`tmux\s+kill-server\b`],
  ['rsync delete', String.raw`rsync\b.*--delete`],
  ['force push', String.raw`git\s+push\b.*(?:--force(?![-\w])|\s-f\b|\s\+\w)`],
  ['git clean', String.raw`git\s+clean\s+-[a-zA-Z]*f`],
  ['drop table', String.raw`(?:psql\b.*)?DROP\s+TABLE\b`],
  ['terraform destroy', String.raw`terraform\s+destroy\b`],
  ['delete namespace', String.raw`kubectl\s+delete\s+(?:namespace|ns)\b`],
  ['s3 recursive rm', String.raw`aws\s+s3\s+rm\b.*--recursive`],
];

/** Reads the PreToolUse event from stdin and returns the Bash command. */
export async function readCommand() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text).tool_input?.command ?? '';
}
