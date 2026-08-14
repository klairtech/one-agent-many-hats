/**
 * Sending mail, over SMTP, with no dependency.
 *
 * Node ships TLS and sockets but no SMTP client, so this is one — enough of RFC 5321 to
 * send a message and no more: EHLO, AUTH LOGIN/PLAIN, MAIL FROM, RCPT TO, DATA. Implicit
 * TLS on 465 and STARTTLS on 587 both work, which covers essentially every provider.
 *
 * The boundary that matters here is **who it can write to**. `config.email.allowRecipients`
 * is checked in this tool before anything is sent, and a standing grant scoped to
 * `recipients` is checked again in the approver. The agent cannot invent an address, and
 * "email the dealership" only works if a human wrote that address down first. That is
 * deliberate: choosing who to contact on your behalf is your decision, not the model's.
 */

import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';

import { HatsError } from '../../core/errors.js';
import { getCredential } from '../../core/credentials.js';
import type { ToolHandler, ToolResult } from '../types.js';

export const sendEmail: ToolHandler = {
  spec: {
    name: 'send_email',
    description:
      'Send a plain-text email to an address the user has already allowed. You cannot send to an address that is not on that list. Use it to deliver a report, an alert or a summary the user asked for.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient address. Must be one the user has configured; comma-separate for several.',
        },
        subject: { type: 'string', description: 'Subject line.' },
        body: { type: 'string', description: 'Plain-text body. No HTML, no attachments.' },
      },
      required: ['to', 'subject', 'body'],
    },
    mutating: true,
    network: true,
    minProfile: 'assisted',
  },

  async run(args, ctx): Promise<ToolResult> {
    const conf = ctx.config.email;
    if (!conf?.host || !conf.from) {
      throw new HatsError(
        'CONFIG_MISSING',
        'no mail server is configured. The user sets config.email (host, port, from) and stores the password with: hats channel token email',
        {},
      );
    }
    if (!ctx.config.network.enabled) {
      throw new HatsError('NETWORK_DENIED', 'send_email needs tool network egress, which is off', {}, 'rule/network-off-by-default');
    }

    const to = String(args['to'] ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (to.length === 0) throw new HatsError('TOOL_INPUT_INVALID', 'send_email needs a recipient', {});

    const allowed = (conf.allowRecipients ?? []).map((a) => a.toLowerCase().trim());
    if (allowed.length === 0) {
      throw new HatsError(
        'TOOL_NOT_ALLOWED',
        'no recipients are allowed yet. The user lists permitted addresses in config.email.allowRecipients; there is no wildcard.',
        {},
        'rule/mutation-requires-approval',
      );
    }
    const refused = to.filter((r) => !allowed.includes(r.toLowerCase()));
    if (refused.length > 0) {
      throw new HatsError(
        'TOOL_NOT_ALLOWED',
        `not an allowed recipient: ${refused.join(', ')}. You cannot add one — the user decides who you may write to.`,
        { refused, allowedCount: allowed.length },
        'rule/mutation-requires-approval',
      );
    }

    const subject = String(args['subject'] ?? '').replace(/[\r\n]/g, ' ').slice(0, 300);
    const body = String(args['body'] ?? '');

    // Recorded before it leaves the machine. Mail is not recallable.
    ctx.logger.warn('email.pending', { to, subject, bytes: body.length });

    const password = getCredential('email');
    await smtpSend({
      host: conf.host,
      port: conf.port ?? 587,
      user: conf.user ?? conf.from,
      password,
      from: conf.from,
      fromName: conf.fromName,
      to,
      subject,
      body,
    });

    return {
      summary: `Sent "${subject}" to ${to.join(', ')} (${body.length} characters).`,
      payload: { to, subject, bytes: body.length, from: conf.from },
      provenance: { host: conf.host, from: conf.from },
    };
  },
};

interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  password: string | undefined;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  body: string;
}

export async function smtpSend(opts: SmtpOptions): Promise<void> {
  const session = await openSession(opts.host, opts.port);
  try {
    await session.expect(220);
    let caps = await session.cmd(`EHLO ${hostnameFor(opts.from)}`, 250);

    if (session.plain && /STARTTLS/i.test(caps)) {
      await session.cmd('STARTTLS', 220);
      await session.upgrade(opts.host);
      caps = await session.cmd(`EHLO ${hostnameFor(opts.from)}`, 250);
    }

    if (opts.password) {
      if (/AUTH[^\n]*PLAIN/i.test(caps)) {
        const token = Buffer.from(`\0${opts.user}\0${opts.password}`, 'utf8').toString('base64');
        await session.cmd(`AUTH PLAIN ${token}`, 235);
      } else {
        await session.cmd('AUTH LOGIN', 334);
        await session.cmd(Buffer.from(opts.user, 'utf8').toString('base64'), 334);
        await session.cmd(Buffer.from(opts.password, 'utf8').toString('base64'), 235);
      }
    }

    await session.cmd(`MAIL FROM:<${opts.from}>`, 250);
    for (const rcpt of opts.to) await session.cmd(`RCPT TO:<${rcpt}>`, 250);
    await session.cmd('DATA', 354);
    await session.write(buildMessage(opts) + '\r\n.\r\n');
    await session.expect(250);
    await session.cmd('QUIT', 221).catch(() => undefined);
  } finally {
    session.close();
  }
}

function buildMessage(opts: SmtpOptions): string {
  const from = opts.fromName ? `${encodeHeader(opts.fromName)} <${opts.from}>` : opts.from;
  return [
    `From: ${from}`,
    `To: ${opts.to.join(', ')}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    // So a recipient can tell this was sent by an agent rather than typed by a person.
    'X-Sent-By: klair-hats (automated)',
    '',
    // Dot-stuffing: a line that is just "." would otherwise end the message early.
    opts.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
  ].join('\r\n');
}

/** RFC 2047 for anything outside ASCII, so accents in a subject do not arrive as mojibake. */
function encodeHeader(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function hostnameFor(from: string): string {
  return from.split('@')[1] ?? 'localhost';
}

interface SmtpSession {
  plain: boolean;
  expect(code: number): Promise<string>;
  cmd(line: string, code: number): Promise<string>;
  write(data: string): Promise<void>;
  upgrade(host: string): Promise<void>;
  close(): void;
}

function openSession(host: string, port: number): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    // 465 is implicit TLS; everything else starts plain and usually upgrades via STARTTLS.
    const implicit = port === 465;
    let socket: Socket | TLSSocket = implicit
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port });

    let buffer = '';
    let pending: { code: number; resolve: (s: string) => void; reject: (e: Error) => void } | null = null;
    const timer = setTimeout(() => reject(new HatsError('TOOL_TIMEOUT', `SMTP: ${host}:${port} did not answer`, {})), 30_000);

    const attach = () => {
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        // A multiline reply ends with "250 x"; "250-x" means more is coming.
        const match = /^(\d{3})(?: [^\n]*)?\r?\n$/m.exec(buffer.slice(-buffer.length));
        if (!/\r?\n$/.test(buffer)) return;
        const lines = buffer.trimEnd().split(/\r?\n/);
        const last = lines[lines.length - 1] ?? '';
        if (/^\d{3}-/.test(last)) return;
        void match;
        const code = Number(last.slice(0, 3));
        const text = buffer;
        buffer = '';
        if (!pending) return;
        const p = pending;
        pending = null;
        if (code === p.code) p.resolve(text);
        else p.reject(new HatsError('TOOL_FAILED', `SMTP ${host}: expected ${p.code}, got: ${text.trim()}`, { code }));
      });
      socket.on('error', (e: Error) => {
        clearTimeout(timer);
        pending?.reject(new HatsError('TOOL_FAILED', `SMTP ${host}: ${e.message}`, {}));
      });
    };
    attach();

    const expect = (code: number) =>
      new Promise<string>((res, rej) => {
        pending = { code, resolve: res, reject: rej };
      });

    const session: SmtpSession = {
      plain: !implicit,
      expect,
      async cmd(line: string, code: number) {
        const waiting = expect(code);
        socket.write(line + '\r\n');
        return waiting;
      },
      async write(data: string) {
        socket.write(data);
      },
      async upgrade(serverName: string) {
        const plainSocket = socket as Socket;
        plainSocket.removeAllListeners('data');
        plainSocket.removeAllListeners('error');
        socket = tlsConnect({ socket: plainSocket, servername: serverName });
        session.plain = false;
        buffer = '';
        attach();
        await new Promise<void>((res, rej) => {
          (socket as TLSSocket).once('secureConnect', () => res());
          socket.once('error', rej);
        });
      },
      close() {
        clearTimeout(timer);
        socket.destroy();
      },
    };

    socket.once(implicit ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      resolve(session);
    });
    socket.once('error', (e: Error) => reject(new HatsError('TOOL_FAILED', `SMTP ${host}: ${e.message}`, {})));
  });
}

export const emailTools: ToolHandler[] = [sendEmail];
