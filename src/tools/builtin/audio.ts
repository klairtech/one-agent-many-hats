/**
 * Turning audio into text — the "a format nobody hardcoded" case.
 *
 * Two routes, tried in that order:
 *   1. a local `whisper` or `whisper-cli` binary, if the user has one. Nothing leaves the
 *      machine, which matters more for a voice note than for most things.
 *   2. an OpenAI-compatible `/audio/transcriptions` endpoint on a configured provider.
 *
 * Route 2 uploads the file to a third party, so it is `network: true` and needs egress on.
 * Route 1 does not touch the network at all, and the tool says which one it used — a
 * transcript you cannot attribute is a transcript you cannot trust.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from '../../core/errors.js';
import { resolveApiKey } from '../../core/config.js';
import type { ToolHandler, ToolResult } from '../types.js';

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.oga', '.opus', '.webm', '.mp4', '.mpga']);
/** Most hosted endpoints cap at 25MB; failing here beats failing after the upload. */
const MAX_BYTES = 25 * 1024 * 1024;

export const transcribeAudio: ToolHandler = {
  spec: {
    name: 'transcribe_audio',
    description:
      'Transcribe an audio file in the workspace to text. Handles voice notes, recordings and the audio track of a video. Returns the transcript and says whether it was done locally or by a provider.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Audio file inside the workspace.' },
        language: {
          type: 'string',
          description: 'ISO code hint, e.g. en or hi. Omit to let it detect.',
        },
      },
      required: ['path'],
    },
    // Reads a file and produces text; it changes nothing. Network is what gates route 2.
    mutating: false,
    network: true,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const file = ctx.guard.resolve(String(args['path'] ?? ''), ctx.workspaceRoot);
    const ext = path.extname(file).toLowerCase();
    if (!AUDIO_EXT.has(ext)) {
      throw new HatsError('TOOL_INPUT_INVALID', `${ext || 'that file'} is not an audio format this can read`, {
        supported: [...AUDIO_EXT],
      });
    }
    const bytes = await readFile(file);
    if (bytes.length > MAX_BYTES) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `${(bytes.length / 1e6).toFixed(1)}MB is over the 25MB limit — split it first`,
        { bytes: bytes.length },
      );
    }
    const language = typeof args['language'] === 'string' ? args['language'] : undefined;

    // 1. Local, if a binary is there. Preferred: no upload, no key, no egress.
    const local = await transcribeLocally(file, language, ctx.signal);
    if (local) {
      return {
        summary: `Transcript of ${path.basename(file)} (local ${local.binary}, nothing left this machine):\n\n${local.text}`,
        payload: { text: local.text, via: 'local', binary: local.binary, file: path.basename(file) },
        provenance: { method: 'local', binary: local.binary },
      };
    }

    // 2. A provider endpoint. This uploads the audio, so egress has to be on.
    if (!ctx.config.network.enabled) {
      throw new HatsError(
        'NETWORK_DENIED',
        'no local whisper binary was found, and sending the audio to a provider needs tool network egress, which is off. Install whisper, or enable egress.',
        {},
        'rule/network-off-by-default',
      );
    }
    const remote = await transcribeRemotely(bytes, path.basename(file), language, ctx);
    return {
      summary: `Transcript of ${path.basename(file)} (via ${remote.provider}/${remote.model} — the audio was uploaded):\n\n${remote.text}`,
      payload: { text: remote.text, via: 'provider', provider: remote.provider, model: remote.model },
      provenance: { method: 'provider', provider: remote.provider, model: remote.model },
    };
  },
};

async function transcribeLocally(
  file: string,
  language: string | undefined,
  signal?: AbortSignal,
): Promise<{ text: string; binary: string } | null> {
  for (const binary of ['whisper-cli', 'whisper']) {
    const found = await run(binary, ['--help'], 5_000, signal).catch(() => null);
    if (!found || found.code !== 0) continue;

    const argv = [file, '--output_format', 'txt', '--output_dir', path.dirname(file)];
    if (language) argv.push('--language', language);
    const out = await run(binary, argv, 600_000, signal);
    if (out.code !== 0) continue;

    // whisper writes <name>.txt next to the input; fall back to stdout if it did not.
    const txt = file.replace(path.extname(file), '') + '.txt';
    const text = await readFile(txt, 'utf8').catch(() => out.stdout);
    if (text.trim()) return { text: text.trim(), binary };
  }
  return null;
}

async function transcribeRemotely(
  bytes: Buffer,
  filename: string,
  language: string | undefined,
  ctx: Parameters<NonNullable<ToolHandler['run']>>[1],
): Promise<{ text: string; provider: string; model: string }> {
  const entry = Object.entries(ctx.config.providers).find(
    ([, p]) => p.kind === 'openai-compat' && p.baseUrl,
  );
  if (!entry) {
    throw new HatsError(
      'CONFIG_MISSING',
      'no OpenAI-compatible provider is configured to transcribe with, and no local whisper binary was found',
      {},
    );
  }
  const [providerId, conf] = entry;
  const model = conf.transcribeModel ?? 'whisper-1';
  const key = resolveApiKey(providerId, conf);

  // multipart/form-data by hand: one more small thing to write, one less dependency.
  const boundary = `----hats${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  const field = (name: string, value: string) =>
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  field('model', model);
  if (language) field('language', language);
  field('response_format', 'json');
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      'utf8',
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  );

  const res = await fetch(`${conf.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: Buffer.concat(parts),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HatsError('PROVIDER_ERROR', `${providerId} transcription failed (${res.status}): ${text.slice(0, 300)}`, {
      status: res.status,
    });
  }
  let parsed: { text?: string };
  try {
    parsed = JSON.parse(text) as { text?: string };
  } catch {
    throw new HatsError('PROVIDER_ERROR', `${providerId} returned a non-JSON transcription`, {});
  }
  if (!parsed.text?.trim()) {
    throw new HatsError('TOOL_FAILED', 'the transcription came back empty', {});
  }
  return { text: parsed.text.trim(), provider: providerId, model };
}

function run(
  bin: string,
  argv: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: code ?? -1, stdout });
    });
  });
}

export const audioTools: ToolHandler[] = [transcribeAudio];
