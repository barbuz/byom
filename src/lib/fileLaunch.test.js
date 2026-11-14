import { describe, it, expect, vi, afterEach } from 'vitest';
import { consumeLaunchedFiles } from './fileLaunch.js';

afterEach(() => {
  delete globalThis.window.launchQueue;
  vi.restoreAllMocks();
});

describe('consumeLaunchedFiles', () => {
  it('returns false when the File Handling API is unavailable', () => {
    expect(consumeLaunchedFiles(() => {})).toBe(false);
  });

  it('delivers the launched files to the consumer', async () => {
    const file = new File([new Uint8Array([1])], 'shared.byom', { type: 'application/zip' });
    let consumer;
    window.launchQueue = { setConsumer: (fn) => { consumer = fn; } };

    const received = [];
    expect(consumeLaunchedFiles((files) => received.push(...files))).toBe(true);

    await consumer({ files: [{ getFile: async () => file }] });
    expect(received).toEqual([file]);
  });

  it('skips a handle that cannot be read', async () => {
    const good = new File([new Uint8Array([2])], 'ok.byom');
    let consumer;
    window.launchQueue = { setConsumer: (fn) => { consumer = fn; } };

    const received = [];
    consumeLaunchedFiles((files) => received.push(...files));

    await consumer({
      files: [
        { getFile: async () => { throw new Error('gone'); } },
        { getFile: async () => good },
      ],
    });
    expect(received).toEqual([good]);
  });

  it('does nothing when the launch carries no files', async () => {
    let consumer;
    window.launchQueue = { setConsumer: (fn) => { consumer = fn; } };

    const onFiles = vi.fn();
    consumeLaunchedFiles(onFiles);

    await consumer({ files: [] });
    await consumer(undefined);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
