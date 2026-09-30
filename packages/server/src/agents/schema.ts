import { EDGE_KINDS, GRAPH_KINDS, NODE_KINDS } from '@codesplainer/shared';

/**
 * JSON Schema for the agent's final answer. Written to be valid for strict structured-output modes
 * (OpenAI strict: every property required, additionalProperties false, optional values nullable),
 * so the same schema works for `claude --json-schema` and `codex exec --output-schema`.
 * The lenient normalizer (normalizeGraphSpec) maps this raw shape onto the canonical GraphSpec.
 */
const nullableString = { type: ['string', 'null'] } as const;
const nullableInt = { type: ['integer', 'null'] } as const;

/** A code location (boxes and arrows). */
const REF_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['folder', 'path', 'startLine', 'endLine', 'symbol'],
  properties: {
    folder: { ...nullableString, description: 'Workspace folder alias.' },
    path: {
      type: 'string',
      description: 'Path relative to the folder root. Directory or file.',
    },
    startLine: nullableInt,
    endLine: nullableInt,
    symbol: {
      ...nullableString,
      description: 'Function/class/symbol name, if specific.',
    },
  },
} as const;

export const GRAPH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'kind', 'direction', 'nodes', 'edges', 'groups', 'suggestions'],
  properties: {
    title: { type: 'string', description: 'Diagram title, max 6 words.' },
    summary: { type: 'string', description: 'Direct answer, 1-2 short sentences.' },
    kind: { type: 'string', enum: [...GRAPH_KINDS] },
    direction: { type: 'string', enum: ['LR', 'TB'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'kind', 'detail', 'group', 'expandable', 'highlight', 'refs'],
        properties: {
          id: { type: 'string', description: 'Short kebab-case id, unique in this diagram.' },
          label: { type: 'string', description: 'Box label, 1-3 words.' },
          kind: { type: 'string', enum: [...NODE_KINDS] },
          detail: {
            type: 'string',
            description: 'What it does, max 10 words. Empty string if obvious.',
          },
          group: { ...nullableString, description: 'Id of a group in `groups`, or null.' },
          expandable: {
            type: 'boolean',
            description: 'True if it has inner workings worth a deeper diagram.',
          },
          highlight: {
            type: 'boolean',
            description: 'True for the 1-3 boxes that answer the question.',
          },
          refs: {
            type: 'array',
            description: 'Where this lives in the code. Verified paths only.',
            items: REF_ITEM_SCHEMA,
          },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'label', 'kind', 'step', 'refs'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          label: {
            type: 'string',
            description: 'Verb phrase, 1-3 words. Empty string if obvious.',
          },
          kind: { type: 'string', enum: [...EDGE_KINDS] },
          step: {
            ...nullableInt,
            description: 'Order for flow/sequence diagrams (1-based), else null.',
          },
          refs: {
            type: 'array',
            description:
              'Line where this arrow happens (the call, import, emit, read or write). [] if not seen.',
            items: REF_ITEM_SCHEMA,
          },
        },
      },
    },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string', description: '1-3 words.' },
        },
      },
    },
    suggestions: {
      type: 'array',
      description: '2-4 short follow-up questions (max 8 words each).',
      items: { type: 'string' },
    },
  },
};

/** Minimal schema used by provider smoke tests. */
export const TEST_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};
