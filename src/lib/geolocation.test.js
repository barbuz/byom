import { describe, it, expect, vi } from 'vitest';
import { createPositionWatch } from './geolocation.js';

function watchIds() {
  return [...globalThis.__geolocationTestUtil.getWatchers().keys()];
}

function firstWatcher() {
  return [...globalThis.__geolocationTestUtil.getWatchers().entries()][0];
}

function emit(id, coords) {
  globalThis.__geolocationTestUtil.emitWatchPosition(id, coords);
}

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

  it('reports a repeated fix too, with no watchdog to suppress it', () => {
    const onChange = vi.fn();
    const watch = createPositionWatch({ onChange });
    const id = watchIds()[0];
    emit(id, { latitude: 12.3, longitude: 45.6, accuracy: 7.8 });
    emit(id, { latitude: 12.3, longitude: 45.6, accuracy: 7.8 });
    expect(onChange).toHaveBeenCalledTimes(2);
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
    const watch = createPositionWatch({});
    globalThis.__geolocationTestUtil.emitWatchError(watchIds()[0], 'denied');
    expect(errorSpy).toHaveBeenCalledWith('GPS error:', expect.anything());
    watch.stop();
    errorSpy.mockRestore();
  });

  it('clears the watch on stop', () => {
    const watch = createPositionWatch({});
    expect(watchIds()).toHaveLength(1);
    watch.stop();
    expect(watchIds()).toHaveLength(0);
  });

  it('does not create any timers (no watchdog)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const watch = createPositionWatch({});
    emit(watchIds()[0], { latitude: 1, longitude: 2, accuracy: 5 });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    watch.stop();
    setIntervalSpy.mockRestore();
  });
});
