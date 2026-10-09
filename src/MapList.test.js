import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { flushPromises, FakeImage } from '../tests/setup.js';
import MapList from './MapList.svelte';

const OriginalImage = globalThis.Image;

const dbMocks = vi.hoisted(() => ({
  getAllMaps: vi.fn(),
  getAllReferencePoints: vi.fn(),
  addMap: vi.fn(async () => 1),
  deleteMap: vi.fn(async () => {}),
}));

vi.mock('./lib/db.js', () => dbMocks);

const pdfMocks = vi.hoisted(() => ({
  isPdfFile: vi.fn(() => false),
  loadPdf: vi.fn(),
  renderPdfPageToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  // The real PdfPagePicker is rendered here, so the preview API must exist.
  renderPdfPageToCanvas: vi.fn(async () => ({ promise: Promise.resolve(), cancel: () => {} })),
  PREVIEW_DIMENSION: 1400,
}));

vi.mock('./lib/pdf.js', () => pdfMocks);

// Two reference points on an 800x600 image place the map around (8.005, 46.995).
const POINTS_NEAR = [
  { id: 1, mapId: 1, u: 0, v: 0, lon: 8.0, lat: 47.0, timestamp: 1 },
  { id: 2, mapId: 1, u: 1, v: 0, lon: 8.01, lat: 47.0, timestamp: 1 },
  { id: 3, mapId: 1, u: 0, v: 0.75, lon: 8.0, lat: 46.99, timestamp: 1 },
];

// A georeferenced map on the other side of the world: it stays in "Other maps".
const POINTS_FAR = [
  { id: 11, mapId: 2, u: 0, v: 0, lon: 20.0, lat: 10.0, timestamp: 1 },
  { id: 12, mapId: 2, u: 1, v: 0, lon: 20.01, lat: 10.0, timestamp: 1 },
  { id: 13, mapId: 2, u: 0, v: 0.75, lon: 20.0, lat: 9.99, timestamp: 1 },
];

const maps = [
  { id: 1, name: 'Downtown', thumbnail: 'data:image/jpeg;base64,AAA', timestamp: 1700000000000, imageWidth: 800, imageHeight: 600 },
  { id: 2, name: 'Harbor', thumbnail: 'data:image/jpeg;base64,BBB', timestamp: 1600000000000, imageWidth: 800, imageHeight: 600 },
  { id: 3, name: 'Unfinished', thumbnail: 'data:image/jpeg;base64,CCC', timestamp: 1500000000000, imageWidth: 800, imageHeight: 600 },
];

afterEach(() => {
  window.location.hash = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // clearAllMocks keeps mock implementations but not a plain `mockReturnValue`;
  // reset the PDF default so image tests are not treated as PDFs.
  pdfMocks.isPdfFile.mockReturnValue(false);
  globalThis.Image = OriginalImage;
});

function emitPosition(coords) {
  const ids = [...globalThis.__geolocationTestUtil.getWatchers().keys()];
  globalThis.__geolocationTestUtil.emitWatchPosition(ids[ids.length - 1], coords);
}

function renderList({ withPosition = true } = {}) {
  dbMocks.getAllMaps.mockResolvedValue(maps.map((m) => ({ ...m })));
  dbMocks.getAllReferencePoints.mockResolvedValue([
    ...POINTS_NEAR,
    ...POINTS_FAR,
    { id: 4, mapId: 3, u: 0.1, v: 0.1, lon: 8.0, lat: 47.0, timestamp: 1 },
  ]);
  const result = render(MapList);
  if (withPosition) {
    emitPosition({ latitude: 46.995, longitude: 8.005, accuracy: 10 });
  }
  return result;
}

describe('MapList sections', () => {
  it('shows empty state when there are no maps', async () => {
    dbMocks.getAllMaps.mockResolvedValue([]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText(/no maps yet/i);
    expect(screen.getByRole('button', { name: /add map/i })).toBeTruthy();
  });

  it('shows an alert when loading maps fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    dbMocks.getAllMaps.mockRejectedValue(new Error('boom'));
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Failed to load maps'));
    expect(screen.getByText(/no maps yet/i)).toBeTruthy();
  });

  it('renders the three sections with correct membership', async () => {
    renderList();
    await screen.findByText('Downtown');
    // Map 1 contains the fix; map 2 is georeferenced but far; map 3 has too few
    // points to georeference.
    expect(screen.getByRole('heading', { name: /maps here/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /incomplete/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /other maps/i })).toBeTruthy();
    expect(screen.getByText('Downtown')).toBeTruthy();
    expect(screen.getByText('Harbor')).toBeTruthy();
    expect(screen.getByText('Unfinished')).toBeTruthy();
  });

  it('shows a waiting message before any fix arrives', async () => {
    dbMocks.getAllMaps.mockResolvedValue([{ ...maps[0] }]);
    dbMocks.getAllReferencePoints.mockResolvedValue([...POINTS_NEAR]);
    render(MapList);
    await screen.findByText('Downtown');
    expect(screen.getByText(/waiting for your location/i)).toBeTruthy();
  });

  it('shows the distance to the map centre without an "On this map" claim', async () => {
    renderList();
    await screen.findByText('Downtown');
    // The near map's badge is a plain centre distance, not a containment claim.
    expect(screen.queryByText(/on this map/i)).toBeNull();
    expect(screen.getAllByText(/from map centre$/).length).toBeGreaterThan(0);
  });

  it('renders map cards with name, date and delete button', async () => {
    renderList();
    await screen.findByText('Downtown');
    const card = screen.getByRole('button', { name: /open map downtown/i });
    expect(card.hasAttribute('tabindex')).toBe(true);
    expect(
      screen.getAllByRole('button').some((b) => b.getAttribute('aria-label') === 'Delete map')
    ).toBe(true);
  });

  it('opens a map when the card is clicked or Enter is pressed', async () => {
    renderList();
    await screen.findByText('Downtown');
    const card = screen.getByRole('button', { name: /open map downtown/i });

    fireEvent.click(card);
    expect(window.location.hash).toBe('#map/1');

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(window.location.hash).toBe('#map/1');
  });

  it('renders the injected app version', async () => {
    renderList();
    await screen.findByText('Downtown');
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeTruthy();
  });

  it('updates the classification when a new position is emitted', async () => {
    dbMocks.getAllMaps.mockResolvedValue([{ ...maps[0] }]);
    dbMocks.getAllReferencePoints.mockResolvedValue([...POINTS_NEAR]);
    render(MapList);
    await screen.findByText('Downtown');
    // No fix yet: the map sits in "Other maps".
    expect(screen.getByRole('heading', { name: /other maps/i })).toBeTruthy();

    emitPosition({ latitude: 46.995, longitude: 8.005, accuracy: 10 });
    await flushPromises();

    expect(screen.getByRole('heading', { name: /maps here/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /other maps/i })).toBeNull();
  });

  it('ignores a position move under the 5 m threshold', async () => {
    dbMocks.getAllMaps.mockResolvedValue([{ ...maps[0] }]);
    dbMocks.getAllReferencePoints.mockResolvedValue([...POINTS_NEAR]);
    render(MapList);
    await screen.findByText('Downtown');

    emitPosition({ latitude: 46.995, longitude: 8.005, accuracy: 10 });
    await flushPromises();
    expect(screen.getByRole('heading', { name: /maps here/i })).toBeTruthy();

    // ~1 m away: no recompute, so the section membership is unchanged.
    emitPosition({ latitude: 46.99501, longitude: 8.005, accuracy: 10 });
    await flushPromises();
    expect(screen.getByRole('heading', { name: /maps here/i })).toBeTruthy();
  });
});

describe('MapList sorting', () => {
  it('exposes the documented default sort options and direction', async () => {
    renderList();
    await screen.findByText('Downtown');

    const nearSort = screen.getByLabelText(/sort maps here/i);
    expect(nearSort.value).toBe('size');
    // Every section offers every key, in the same order.
    expect([...nearSort.options].map((o) => o.value)).toEqual([
      'distance', 'size', 'lastModified', 'name',
    ]);
    // The near section is georeferenced, so nothing is disabled.
    expect([...nearSort.options].every((o) => !o.disabled)).toBe(true);

    const incompleteSort = screen.getByLabelText(/sort incomplete maps/i);
    expect(incompleteSort.value).toBe('lastModified');
    expect([...incompleteSort.options].map((o) => o.value)).toEqual([
      'distance', 'size', 'lastModified', 'name',
    ]);
    // Ungeoreferenced maps have no footprint, so size and distance are disabled.
    expect(
      Object.fromEntries([...incompleteSort.options].map((o) => [o.value, o.disabled])),
    ).toEqual({ distance: true, size: true, lastModified: false, name: false });

    const otherSort = screen.getByLabelText(/sort other maps/i);
    expect(otherSort.value).toBe('distance');

    // The controls are labelled "Sort by".
    expect(screen.getAllByText('Sort by')).toHaveLength(3);

    // Default direction follows the key: last-modified is newest-first (↓).
    const incompleteDirection = screen.getByLabelText(/sort direction for incomplete maps/i);
    expect(incompleteDirection.textContent.trim()).toBe('↓');
    const otherDirection = screen.getByLabelText(/sort direction for other maps/i);
    expect(otherDirection.textContent.trim()).toBe('↑');
  });

  it('reorders a section when the sort control changes', async () => {
    // Two incomplete maps with distinct names, so a name sort is observable.
    dbMocks.getAllMaps.mockResolvedValue([
      { id: 1, name: 'Zulu', thumbnail: 'a', timestamp: 2, imageWidth: 800, imageHeight: 600 },
      { id: 2, name: 'Alpha', thumbnail: 'b', timestamp: 1, imageWidth: 800, imageHeight: 600 },
    ]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText('Zulu');

    const section = screen.getByRole('heading', { name: /incomplete/i })
      .closest('section');
    const names = () => [...section.querySelectorAll('.map-name')].map((n) => n.textContent);
    // Default last-modified desc: Zulu (t=2) before Alpha (t=1).
    expect(names()).toEqual(['Zulu', 'Alpha']);

    const sort = screen.getByLabelText(/sort incomplete maps/i);
    await fireEvent.change(sort, { target: { value: 'name' } });
    expect(names()).toEqual(['Alpha', 'Zulu']);
  });

  it('flips the order when the direction toggle is clicked', async () => {
    dbMocks.getAllMaps.mockResolvedValue([
      { id: 1, name: 'Zulu', thumbnail: 'a', timestamp: 2, imageWidth: 800, imageHeight: 600 },
      { id: 2, name: 'Alpha', thumbnail: 'b', timestamp: 1, imageWidth: 800, imageHeight: 600 },
    ]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText('Zulu');

    const section = screen.getByRole('heading', { name: /incomplete/i })
      .closest('section');
    const names = () => [...section.querySelectorAll('.map-name')].map((n) => n.textContent);
    expect(names()).toEqual(['Zulu', 'Alpha']);

    const direction = screen.getByLabelText(/sort direction for incomplete maps/i);
    await fireEvent.click(direction);
    // Now ascending by last-modified: the older map first.
    expect(names()).toEqual(['Alpha', 'Zulu']);
    expect(direction.textContent.trim()).toBe('↑');
  });

  it('sorts maps here by distance when chosen', async () => {
    // Two maps both containing the fix, with different centres.
    dbMocks.getAllMaps.mockResolvedValue([
      { id: 1, name: 'Wide', thumbnail: 'a', timestamp: 1, imageWidth: 800, imageHeight: 600 },
      { id: 2, name: 'Tight', thumbnail: 'b', timestamp: 2, imageWidth: 800, imageHeight: 600 },
    ]);
    const wide = [
      { mapId: 1, u: 0, v: 0, lon: 7.99, lat: 47.0, timestamp: 1 },
      { mapId: 1, u: 1, v: 0, lon: 8.01, lat: 47.0, timestamp: 1 },
      { mapId: 1, u: 0, v: 0.75, lon: 7.99, lat: 46.98, timestamp: 1 },
    ];
    const tight = [
      { mapId: 2, u: 0, v: 0, lon: 7.999, lat: 46.996, timestamp: 1 },
      { mapId: 2, u: 1, v: 0, lon: 8.001, lat: 46.996, timestamp: 1 },
      { mapId: 2, u: 0, v: 0.75, lon: 7.999, lat: 46.994, timestamp: 1 },
    ];
    dbMocks.getAllReferencePoints.mockResolvedValue([...wide, ...tight]);
    render(MapList);
    emitPosition({ latitude: 46.995, longitude: 8.0, accuracy: 10 });
    await screen.findByText('Wide');

    const section = screen.getByRole('heading', { name: /maps here/i }).closest('section');
    const names = () => [...section.querySelectorAll('.map-name')].map((n) => n.textContent);
    // Default "size" puts the smaller (Tight) map first.
    expect(names()).toEqual(['Tight', 'Wide']);

    const sort = screen.getByLabelText(/sort maps here/i);
    await fireEvent.change(sort, { target: { value: 'distance' } });
    // The fix is at the tight map's centre, so Tight stays first by distance too.
    expect(names()).toEqual(['Tight', 'Wide']);
  });
});

describe('MapList uploads', () => {
  it('passes the image dimensions to addMap', async () => {
    dbMocks.getAllMaps.mockResolvedValue([]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText(/no maps yet/i);

    // Drive a file through the hidden input. FakeImage fires onload on a
    // microtask and reports the dimensions the test sets.
    class SizedImage extends FakeImage {
      constructor() {
        super();
        this.width = 1234;
        this.height = 567;
      }
    }
    const OriginalImage = globalThis.Image;
    globalThis.Image = SizedImage;

    const file = new File(['data'], 'map.png', { type: 'image/png' });
    const input = document.getElementById('file-upload');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    fireEvent.change(input);
    await waitFor(() => expect(dbMocks.addMap).toHaveBeenCalled());
    expect(dbMocks.addMap).toHaveBeenCalledWith(
      expect.objectContaining({ imageWidth: 1234, imageHeight: 567 })
    );

    globalThis.Image = OriginalImage;
  });
});

describe('MapList PDF uploads', () => {
  function selectFiles(files) {
    const input = document.getElementById('file-upload');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fireEvent.change(input);
    return input;
  }

  it('imports a single-page PDF without asking for a page', async () => {
    dbMocks.getAllMaps.mockResolvedValue([]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText(/no maps yet/i);

    pdfMocks.isPdfFile.mockReturnValue(true);
    pdfMocks.loadPdf.mockResolvedValue({ numPages: 1 });
    globalThis.Image = FakeImage;

    selectFiles([new File(['pdf'], 'plans.pdf', { type: 'application/pdf' })]);

    await waitFor(() => expect(dbMocks.addMap).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dbMocks.addMap).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'plans.pdf' })
    );
  });

  it('asks which page of a multi-page PDF and imports the chosen one', async () => {
    dbMocks.getAllMaps.mockResolvedValue([]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText(/no maps yet/i);

    pdfMocks.isPdfFile.mockReturnValue(true);
    pdfMocks.loadPdf.mockResolvedValue({ numPages: 5 });
    globalThis.Image = FakeImage;

    selectFiles([new File(['pdf'], 'atlas.pdf', { type: 'application/pdf' })]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('5');

    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await fireEvent.click(screen.getByRole('button', { name: /import page/i }));

    await waitFor(() => expect(dbMocks.addMap).toHaveBeenCalled());
    expect(pdfMocks.renderPdfPageToBlob).toHaveBeenCalledWith(expect.anything(), 3);
    expect(dbMocks.addMap).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'atlas.pdf (page 3/5)' })
    );
  });

  it('imports nothing when the page choice is cancelled', async () => {
    dbMocks.getAllMaps.mockResolvedValue([]);
    dbMocks.getAllReferencePoints.mockResolvedValue([]);
    render(MapList);
    await screen.findByText(/no maps yet/i);

    pdfMocks.isPdfFile.mockReturnValue(true);
    pdfMocks.loadPdf.mockResolvedValue({ numPages: 5 });
    globalThis.Image = FakeImage;

    selectFiles([new File(['pdf'], 'atlas.pdf', { type: 'application/pdf' })]);

    await screen.findByRole('dialog');
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dbMocks.addMap).not.toHaveBeenCalled();
  });
});

describe('MapList delete', () => {
  it('deletes a map from the delete button without opening it', async () => {
    renderList();
    await screen.findByText('Downtown');
    const deleteBtn = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-label') === 'Delete map');
    window.confirm = vi.fn(() => true);

    fireEvent.click(deleteBtn);
    await waitFor(() => expect(dbMocks.deleteMap).toHaveBeenCalledWith(1));
    expect(window.location.hash).toBe('');
  });

  it('does not delete when confirm is cancelled', async () => {
    renderList();
    await screen.findByText('Downtown');
    const deleteBtn = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === 'Delete map');
    window.confirm = vi.fn(() => false);
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(dbMocks.deleteMap).not.toHaveBeenCalled();
  });

  it('alerts when deleting fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderList();
    await screen.findByText('Downtown');
    const deleteBtn = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === 'Delete map');
    window.confirm = vi.fn(() => true);
    dbMocks.deleteMap.mockRejectedValue(new Error('nope'));
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(dbMocks.deleteMap).toHaveBeenCalledWith(1));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Failed to delete map'));
  });
});

describe('MapList add map', () => {
  it('opens the file picker directly without a second chooser', async () => {
    const inputSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderList();
    await screen.findByText('Downtown');

    const addBtn = screen.getByRole('button', { name: /add map/i });
    fireEvent.click(addBtn);

    // The native chooser already offers camera and files, so the app must not
    // intercept the tap with its own duplicate menu.
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /choose file/i })).toBeNull();
  });
});
