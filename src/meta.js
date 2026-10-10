// Who wrote a report and in which format.
import { readFileSync } from 'node:fs';

export const TOOL = Object.freeze({
  name: 'shell-guard-bench',
  version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
});
export const SCHEMA_VERSION = 1;
