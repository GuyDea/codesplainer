import { describe, expect, it } from 'vitest';
import { extractJson, looksLikeDiagram } from '../../src/agents/extract';

const diagram = { title: 'T', nodes: [{ id: 'a', label: 'A' }], edges: [] };

describe('extractJson', () => {
  it('parses a pure JSON answer', () => {
    expect(extractJson(JSON.stringify(diagram))).toEqual(diagram);
    expect(extractJson(`\uFEFF  ${JSON.stringify({ ok: true })}\n`)).toEqual({ ok: true });
  });

  it('prefers the last valid ```json fence', () => {
    const text = [
      'First try:',
      '```json',
      JSON.stringify({ title: 'old', nodes: [{ id: 'x' }] }),
      '```',
      'Broken one:',
      '```json',
      '{ "title": "bad", "nodes": [ }',
      '```',
      'Final:',
      '```json',
      JSON.stringify(diagram),
      '```',
    ].join('\n');
    expect(extractJson(text)).toEqual(diagram);
  });

  it('finds JSON embedded in prose with braces inside strings', () => {
    const inner = { title: 'Uses {braces} and "quotes" \\ ok', nodes: [{ id: 'a', label: 'x}' }] };
    const text = `Sure! Here is the diagram {as requested}:\n${JSON.stringify(inner)}\nHope it helps :}`;
    expect(extractJson(text)).toEqual(inner);
  });

  it('prefers an object with a node list over other objects', () => {
    const text = `Config: {"a": 1}\nDiagram: ${JSON.stringify(diagram)}\nMeta: {"b": 2}`;
    expect(extractJson(text)).toEqual(diagram);
    const wrapped = `Result: {"result": ${JSON.stringify(diagram)}}`;
    expect(looksLikeDiagram(extractJson(wrapped))).toBe(true);
  });

  it('repairs trailing commas, comments and smart quotes', () => {
    expect(extractJson('{"title": "T", "nodes": [{"id": "a",},], // done\n}')).toEqual({
      title: 'T',
      nodes: [{ id: 'a' }],
    });
    expect(extractJson('Answer: {“ok”: true}')).toEqual({ ok: true });
  });

  it('falls back to the largest object and returns undefined without JSON', () => {
    expect(extractJson('a {"x": 1} b {"y": {"z": 2}}')).toEqual({ y: { z: 2 } });
    expect(extractJson('no json here, just {prose}')).toBeUndefined();
    expect(extractJson('')).toBeUndefined();
  });

  it('accepts a custom preference', () => {
    const text = '{"ok": false} then {"ok": true, "final": 1} then {"other": 1}';
    expect(
      extractJson(text, { prefer: (v) => typeof v === 'object' && v !== null && 'final' in v }),
    ).toEqual({
      ok: true,
      final: 1,
    });
  });
});
