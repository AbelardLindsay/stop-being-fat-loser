import { expect, it } from 'vitest';
import { parseSse } from '../src/openai.ts';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

it('parses events split across awkward chunk boundaries', async () => {
  const raw =
    ': keep-alive comment\r\n' +
    'event: response.output_text.delta\r\n' +
    'data: {"delta":"Hel"}\r\n' +
    '\r\n' +
    'data: line one\n' +
    'data: line two\n' +
    '\n' +
    'event: response.completed\n' +
    'data: {"ok":true}\n' +
    '\n';
  const at = (needle: string, offset = 0): number => raw.indexOf(needle) + offset;
  const cuts = [
    3, // inside the comment
    at('event: response.output', 4), // mid field name
    at('"Hel"}\r', 6) + 1, // between CR and LF of a data line
    at('"Hel"}\r', 8) + 1, // between CR and LF of the blank event separator
    at('line one', 4), // mid data value
    at('line two\n', 8), // just before a LF
    at('\n\nevent: response.completed', 1), // between the two LFs ending the second event
    at('{"ok"', 3), // mid JSON
  ].sort((a, b) => a - b);
  const chunks: string[] = [];
  let prev = 0;
  for (const c of cuts) {
    chunks.push(raw.slice(prev, c));
    prev = c;
  }
  chunks.push(raw.slice(prev));
  expect(chunks.filter((c) => c.endsWith('\r'))).toHaveLength(2);

  const events = [];
  for await (const ev of parseSse(streamOf(chunks))) events.push(ev);

  expect(events).toEqual([
    { event: 'response.output_text.delta', data: '{"delta":"Hel"}' },
    { data: 'line one\nline two' },
    { event: 'response.completed', data: '{"ok":true}' },
  ]);
});
