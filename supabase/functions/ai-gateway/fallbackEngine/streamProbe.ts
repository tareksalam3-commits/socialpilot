// A provider can return HTTP 200 and still hand back nothing usable — an
// empty stream, a stream that only ever emits an embedded `error` object, or
// one that stalls forever. Read a bounded number of leading chunks (or until
// we see real content/reasoning) before deciding this attempt actually
// worked. Chunks consumed here are buffered and replayed to the client once
// we commit to this attempt, so nothing is lost — the user never sees the
// provider(s) that failed silently underneath.

export type StreamProbeResult =
  | { ok: true; leadingChunks: Uint8Array[]; leadingText: string }
  | { ok: false; error: string };

const STREAM_PROBE_MAX_CHUNKS = 60;
const STREAM_PROBE_TIMEOUT_MS = 12_000;

export async function probeStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<StreamProbeResult> {
  const leadingChunks: Uint8Array[] = [];
  const probeDecoder = new TextDecoder();
  let buffer = '';
  let sawContent = false;
  let sawReasoning = false;
  let leadingText = '';
  const deadline = Date.now() + STREAM_PROBE_TIMEOUT_MS;

  for (let i = 0; i < STREAM_PROBE_MAX_CHUNKS; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      const timeoutMarker = Symbol('timeout');
      const result = await Promise.race([
        reader.read(),
        new Promise<typeof timeoutMarker>((resolve) => setTimeout(() => resolve(timeoutMarker), remaining)),
      ]);
      if (result === timeoutMarker) break;
      ({ done, value } = result as ReadableStreamReadResult<Uint8Array>);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'stream read error' };
    }

    if (done) break;
    if (!value) continue;

    leadingChunks.push(value);
    buffer += probeDecoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]' || payload === '') continue;
      try {
        const json = JSON.parse(payload);
        if (json.error) {
          return { ok: false, error: typeof json.error === 'string' ? json.error : JSON.stringify(json.error) };
        }
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          sawContent = true;
          leadingText += delta.content;
        }
        if (delta?.reasoning) sawReasoning = true;
      } catch {
        // partial JSON split across chunk boundary — wait for more
      }
    }

    // Keep reading a little past the first content token so leadingText has
    // enough of the response to judge echo on (short of that, both the echo
    // check and a legitimate short reply would look the same).
    if (sawContent && leadingText.length >= 60) return { ok: true, leadingChunks, leadingText };
  }

  if (sawContent) return { ok: true, leadingChunks, leadingText };

  // The model was actively reasoning within the probe window but hadn't
  // produced visible content yet — that's a working provider, just a slow
  // one. Let it keep streaming rather than false-failing it.
  if (sawReasoning) return { ok: true, leadingChunks, leadingText };

  return { ok: false, error: 'No content received from provider within probe window' };
}
