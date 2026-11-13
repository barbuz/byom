// File Handling API glue: when an *installed* BYOM is registered as the handler
// for `.byom` files (see `file_handlers` in public/manifest.json), the OS
// launches the app with the file and the browser delivers it through
// `window.launchQueue`. This is Chromium-only and, per Chrome's own docs,
// limited to desktop operating systems (ChromeOS, macOS, Windows, Linux); it
// does NOT work on Android. Where `launchQueue` is absent (Android, iOS,
// Firefox) the app falls back to the file input.
//
// The launch params are buffered until a consumer is set, so registering the
// consumer on mount still catches the launch that opened the app.

/**
 * Register a consumer for files the app was launched with. Returns whether a
 * consumer was registered (`false` when the File Handling API is unavailable).
 * @param {(files: File[]) => void} onFiles
 * @returns {boolean}
 */
export function consumeLaunchedFiles(onFiles) {
  if (typeof window === 'undefined' || typeof window.launchQueue?.setConsumer !== 'function') {
    return false;
  }

  window.launchQueue.setConsumer(async (params) => {
    const handles = params?.files ?? [];
    const files = [];
    for (const handle of handles) {
      try {
        files.push(await handle.getFile());
      } catch {
        // An unreadable handle is skipped rather than aborting the whole launch.
      }
    }
    if (files.length > 0) onFiles(files);
  });

  return true;
}
