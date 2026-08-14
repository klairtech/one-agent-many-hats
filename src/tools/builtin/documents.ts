/**
 * Retrieval over the indexed workspace.
 *
 * `search_files` is a regex: it finds the string you already know. This finds the passage
 * you could only describe. They are different tools and the descriptions say so, because
 * tool selection is the model's decision and the description is the main lever on it.
 *
 * Results arrive with `path:line-line — Heading > Subheading` attached, so an answer built
 * on them can cite a location a human can open.
 */

import { HatsError } from '../../core/errors.js';
import type { ToolHandler, ToolResult } from '../types.js';

export const searchDocuments: ToolHandler = {
  spec: {
    name: 'search_documents',
    description:
      'Search the workspace by meaning as well as by wording, and get back passages with their file, line range and heading trail. Use this when you want the part of a document that discusses something, and use search_files instead when you know the exact string. Requires the workspace to have been indexed.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you are looking for, phrased as you would say it to a person.',
        },
        limit: {
          type: 'integer',
          description: 'How many passages. Default 6.',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    if (!ctx.documents) {
      throw new HatsError(
        'TOOL_FAILED',
        'no document index is available in this run',
        {},
      );
    }
    const query = String(args['query']);
    const limit = Number(args['limit'] ?? ctx.config.rag.topK);

    const result = await ctx.documents.search(query, limit);

    if (result.indexedChunks === 0) {
      return {
        summary:
          'This workspace has not been indexed yet, so there is nothing to search. Tell the user to run `hats index`, and use search_files or read_file in the meantime.',
        payload: [],
        failed: true,
      };
    }
    if (result.hits.length === 0) {
      return {
        summary:
          `nothing matched "${query}" across ${result.indexedChunks} indexed passages.` +
          (result.caveat ? `\n${result.caveat}` : ''),
        payload: [],
        provenance: { query, mode: result.mode },
      };
    }

    const body = result.hits
      .map(
        (h, i) =>
          `${i + 1}. [${h.citation}] (${h.matched} match, ${h.score})\n${indent(h.chunk.text)}`,
      )
      .join('\n\n');

    return {
      summary:
        `${result.hits.length} passage(s) for "${query}" — ${result.mode} search over ${result.indexedChunks} passages.` +
        (result.caveat ? `\n\n${result.caveat}` : '') +
        `\n\n${body}`,
      payload: result.hits.map((h) => ({
        citation: h.citation,
        path: h.chunk.path,
        startLine: h.chunk.startLine,
        endLine: h.chunk.endLine,
        headings: h.chunk.headings,
        text: h.chunk.text,
        score: h.score,
        matched: h.matched,
      })),
      provenance: { query, mode: result.mode, indexedChunks: result.indexedChunks },
    };
  },
};

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `   ${l}`)
    .join('\n')
    .slice(0, 1_200);
}

export const documentTools: ToolHandler[] = [searchDocuments];
