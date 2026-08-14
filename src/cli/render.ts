/**
 * Terminal output. The only place in the codebase that writes to stdout for humans
 * (REPO_RULES §5).
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const NO_COLOR = Boolean(process.env['NO_COLOR']) || !stdout.isTTY;

const CODES = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  grey: '\u001b[90m',
} as const;

type Colour = keyof typeof CODES;

export function paint(text: string, ...colours: Colour[]): string {
  if (NO_COLOR) return text;
  return colours.map((c) => CODES[c]).join('') + text + CODES.reset;
}

export const out = {
  line(text = ''): void {
    stdout.write(text + '\n');
  },
  dim(text: string): void {
    stdout.write(paint(text, 'grey') + '\n');
  },
  ok(text: string): void {
    stdout.write(paint('  ok  ', 'green') + text + '\n');
  },
  warn(text: string): void {
    stdout.write(paint(' warn ', 'yellow') + text + '\n');
  },
  fail(text: string): void {
    stdout.write(paint(' fail ', 'red') + text + '\n');
  },
  heading(text: string): void {
    stdout.write('\n' + paint(text, 'bold') + '\n');
  },
  keyValue(key: string, value: string, width = 18): void {
    stdout.write(`  ${paint(key.padEnd(width), 'grey')} ${value}\n`);
  },
  table(rows: string[][], headers?: string[]): void {
    const all = headers ? [headers, ...rows] : rows;
    const widths: number[] = [];
    for (const row of all) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i] ?? 0, stripAnsi(cell).length);
      });
    }
    const render = (row: string[], dim = false) =>
      row
        .map((cell, i) => cell + ' '.repeat(Math.max(0, (widths[i] ?? 0) - stripAnsi(cell).length)))
        .join('  ')
        .trimEnd();
    if (headers) stdout.write('  ' + paint(render(headers), 'grey', 'bold') + '\n');
    for (const row of rows) stdout.write('  ' + render(row) + '\n');
  },
};

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function eventPrefix(type: string): string {
  switch (type) {
    case 'route':
      return paint('route ', 'magenta');
    case 'compose':
      return paint('load  ', 'magenta');
    case 'step':
      return paint('step  ', 'blue');
    case 'hat':
      return paint('hat   ', 'cyan');
    case 'tool':
      return paint('tool  ', 'grey');
    case 'stage':
      return paint('stage ', 'blue');
    case 'gate':
      return paint('gate  ', 'yellow');
    case 'review':
      return paint('review', 'yellow');
    case 'note':
      return paint('note  ', 'grey');
    default:
      return '      ';
  }
}

export interface Prompter {
  question(text: string): Promise<string>;
  confirm(text: string, defaultYes?: boolean): Promise<boolean>;
  /** Reads without echoing. For anything that must not end up in scrollback. */
  secret(text: string): Promise<string>;
  close(): void;
}

export function createPrompter(): Prompter {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return {
    async question(text: string): Promise<string> {
      return (await rl.question(text)).trim();
    },
    async confirm(text: string, defaultYes = false): Promise<boolean> {
      const suffix = defaultYes ? '[Y/n]' : '[y/N]';
      const answer = (await rl.question(`${text} ${suffix} `)).trim().toLowerCase();
      if (!answer) return defaultYes;
      return answer === 'y' || answer === 'yes';
    },
    async secret(text: string): Promise<string> {
      // Raw mode rather than muting readline's output, so nothing reaches the terminal at
      // all — a token in scrollback outlives the process that read it.
      if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
        // Piped input cannot echo anyway, and refusing here would break `hats ... < file`.
        return (await rl.question(text)).trim();
      }
      stdout.write(text);
      // readline is holding stdin; it has to let go before raw reads can work.
      rl.pause();
      const previouslyRaw = stdin.isRaw === true;
      stdin.setRawMode(true);
      stdin.resume();

      return new Promise<string>((resolve) => {
        let value = '';
        const finish = () => {
          stdin.off('data', onData);
          stdin.setRawMode(previouslyRaw);
          stdout.write('\n');
          rl.resume();
          resolve(value.trim());
        };
        const onData = (buf: Buffer) => {
          for (const byte of buf) {
            if (byte === 3) {
              // ctrl-c: leave the terminal as we found it rather than dying in raw mode.
              stdin.off('data', onData);
              stdin.setRawMode(previouslyRaw);
              stdout.write('\n');
              process.exit(130);
            }
            if (byte === 13 || byte === 10) return finish();
            if (byte === 127 || byte === 8) {
              value = value.slice(0, -1);
              continue;
            }
            if (byte >= 32) value += String.fromCharCode(byte);
          }
        };
        stdin.on('data', onData);
      });
    },
    close(): void {
      rl.close();
    },
  };
}

/** Non-interactive stand-in: refuses rather than guessing what the human would say. */
export const headlessPrompter: Prompter = {
  async question(): Promise<string> {
    throw new Error('a question was asked but this session is not interactive');
  },
  async confirm(): Promise<boolean> {
    return false;
  },
  async secret(): Promise<string> {
    throw new Error('a secret was asked for but this session is not interactive');
  },
  close(): void {},
};
