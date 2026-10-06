import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPositionWatch } from './geolocation.js';
import { flushPromises } from '../../tests/setup.js';

function watchIds() {
  return [...globalThis.__geolocationTestUtil.getWatchers().keys()];
}

function firstWatcher() {
  return [...globalThis.__geolocationTestUtil.getWatchers().entries()][0];
}

function emit(id, coords) {
  globalThis.__geolocationTestUtil.emitWatchPosition(id, coords);
}

// Fake only the watchdog's clock and interval; setTimeout stays real so
// flushPromises and Svelte's own scheduling keep working.
function useWatchdogTimers() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
}

function setVisibility(value) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  delete document.visibilityState;
});

describe('createPositionWatch', () => {
  it('registers a watch with the expected options', () => {
    const watch = createPositionWatch({});
    expect(watchIds()).toHaveLength(1);
    expect(firstWatcher()[1].options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    });
    watch.stop();
  });

  it('reports each fix through onChange', () => {
    const onChange = vi.fn();
    const watch = createPositionWatch({ onChange });
    emit(watchIds()[0], { latitude: 12.3, longitude: 45.6, accuracy: 7.8 });
    expect(onChange).toHaveBeenCalledWith({ latitude: 12.3, longitude: 45.6, accuracy: 7.8 });
    watch.stop();
  });

  it('warns and does not watch when geolocation is unsupported', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const geo = globalThis.__geolocationTestUtil;
    delete navigator.geolocation;
    const watch = createPositionWatch({});
    expect(warnSpy).toHaveBeenCalledWith('Geolocation not supported');
    expect(geo.getWatchers().size).toBe(0);
    watch.stop();
    warnSpy.mockRestore();
    navigator.geolocation = geo;
  });

  it('logs watch errors without crashing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = vi.fn();
    const watch = createPositionWatch({ onChange });
    globalThis.__geolocationTestUtil.emitWatchError(watchIds()[0], 'denied');
    expect(errorSpy).toHaveBeenCalledWith('GPS error:', expect.anything());
    expect(onChange).not.toHaveBeenCalled();
    watch.stop();
    errorSpy.mockRestore();
  });

  it('clears the watch on stop', () => {
    const watch = createPositionWatch({});
    expect(watchIds()).toHaveLength(1);
    watch.stop();
    expect(watchIds()).toHaveLength(0);
  });
});

describe('createPositionWatch watchdog', () => {
  it('re-arms and reports staleness when no fix ever arrives', async () => {
    useWatchdogTimers();
    const onStale = vi.fn();
    const watch = createPositionWatch({ onStale });
    const before = watchIds();
    expect(before).toHaveLength(1);

    vi.advanceTimersByTime(15000);
    await flushPromises();

    const after = watchIds();
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(onStale).toHaveBeenCalledWith(true);
    watch.stop();
  });

  it('does not re-arm while fresh fixes keep arriving', async () => {
    useWatchdogTimers();
    const watch = createPositionWatch({});
    const before = watchIds();

    for (let i = 0; i < 6; i++) {
      emit(before[0], { latitude: 12.3, longitude: 45.6, accuracy: 8 });
      vi.advanceTimersByTime(5000);
      await flushPromises();
    }

    expect(watchIds()).toEqual(before);
    watch.stop();
  });

  it('re-arms when an existing fix goes stale and clears the flag on a fresh fix', async () => {
    useWatchdogTimers();
    const onStale = vi.fn();
    const watch = createPositionWatch({ onStale });
    emit(watchIds()[0], { latitude: 12.3, longitude: 45.6, accuracy: 8 });
    const before = watchIds();

    vi.advanceTimersByTime(10000);
    await flushPromises();
    expect(watchIds()).toEqual(before);
    expect(onStale).not.toHaveBeenCalledWith(true);

    vi.advanceTimersByTime(5000);
    await flushPromises();
    const after = watchIds();
    expect(after[0]).not.toBe(before[0]);
    expect(onStale).toHaveBeenCalledWith(true);

    emit(after[0], { latitude: 1, longitude: 2, accuracy: 5 });
    expect(onStale).toHaveBeenCalledWith(false);
    watch.stop();
  });

  it('re-arms and resumes on becoming visible again', async () => {
    useWatchdogTimers();
    const onResume = vi.fn();
    const watch = createPositionWatch({ onResume });
    const before = watchIds();

    setVisibility('hidden');
    vi.advanceTimersByTime(4000);
    setVisibility('visible');
    await flushPromises();

    expect(watchIds()[0]).not.toBe(before[0]);
    expect(onResume).toHaveBeenCalled();
    watch.stop();
  });

  it('ignores visibility changes while the page is hidden', async () => {
    const watch = createPositionWatch({});
    const before = watchIds();
    setVisibility('hidden');
    await flushPromises();
    expect(watchIds()).toEqual(before);
    watch.stop();
  });

  it('does not re-arm for an incidental visibility blip', async () => {
    useWatchdogTimers();
    const watch = createPositionWatch({});
    setVisibility('hidden');
    setVisibility('visible');
    await flushPromises();
    const afterFirst = watchIds();

    setVisibility('hidden');
    setVisibility('visible');
    await flushPromises();
    expect(watchIds()).toEqual(afterFirst);
    watch.stop();
  });

  it('re-arms on pageshow', async () => {
    useWatchdogTimers();
    const watch = createPositionWatch({});
    const before = watchIds();
    window.dispatchEvent(new Event('pageshow'));
    await flushPromises();
    expect(watchIds()[0]).not.toBe(before[0]);
    watch.stop();
  });

  it('stops the watchdog and listeners on stop', async () => {
    useWatchdogTimers();
    const watch = createPositionWatch({});
    expect(watchIds()).toHaveLength(1);
    watch.stop();
    expect(watchIds()).toHaveLength(0);

    vi.advanceTimersByTime(60000);
    await flushPromises();
    expect(watchIds()).toHaveLength(0);

    window.dispatchEvent(new Event('pageshow'));
    await flushPromises();
    expect(watchIds()).toHaveLength(0);
  });
});
