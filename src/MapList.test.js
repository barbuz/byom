import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import MapList from './MapList.svelte';

const dbMocks = vi.hoisted(() => ({
  getAllMaps: vi.fn(),
  deleteMap: vi.fn(async () => {}),
}));

vi.mock('./lib/db.js', () => dbMocks);

const maps = [
  {
    id:  1,
    name: 'Downtown',
    thumbnail: 'data:image/jpeg;base64,AAA',
    timestamp: 1700000000000,
  },
  {
    id:  2,
    name: 'Harbor',
    thumbnail: 'data:image/jpeg;base64,BBB',
    timestamp: 1600000000000,
  },
];

afterEach(() => {
  window.location.hash = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();

});

function renderList() {
  dbMocks.getAllMaps.mockResolvedValue([...maps]);
  return render(MapList);
}

describe('MapList', () => {
  it('shows empty state when there are no maps', async () => {
    dbMocks.getAllMaps.mockResolvedValue([]);
    render(MapList);
    await screen.findByText(/no maps yet/i);
    expect(screen.getByRole('button', { name: /add map/i })).toBeTruthy();
  });

  it('shows an alert when loading maps fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    dbMocks.getAllMaps.mockRejectedValue(new Error('boom'));
    render(MapList);
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Failed to load maps'));
    expect(screen.getByText(/no maps yet/i)).toBeTruthy();
  });

  it('renders map cards with name, date and delete button', async () => {
    renderList();
    await screen.findByText('Downtown');
    expect(screen.getByText('Harbor')).toBeTruthy();
    expect(
      screen.getAllByRole('button').some((b) => b.getAttribute('aria-label') === 'Delete map')
    ).toBe(true);
    const card = screen.getByRole('button', { name: /open map downtown/i });
    expect(card.hasAttribute('tabindex')).toBe(true);
  });

  it('opens a map when the card is clicked or Enter is pressed', async () => {
    renderList();
    await screen.findByText('Downtown');
    const card = screen.getByRole('button', { name: /open map downtown/i });

    fireEvent.click(card);
    expect(window.location.hash).toBe('#map/1');

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(window.location.hash).toBe('#map/1');

    fireEvent.keyDown(card, { key: ' ' });
    expect(window.location.hash).toBe('#map/1');
  });

  it('deletes a map fromthe delete button without opening it', async () => {
    renderList();
    await screen.findByText('Downtown');
    const card = screen.getByRole('button', { name: /open map downtown/i });
    const deleteBtn = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-label') === 'Delete map');
    window.confirm = vi.fn(() => true);

    fireEvent.click(deleteBtn);
    await waitFor(() => expect(dbMocks.deleteMap).toHaveBeenCalledWith(1));
    expect(window.location.hash).toBe('');
  });
  it('toggles the upload menu and triggers camera and file uploads', async () => {
    const inputSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderList();
    await screen.findByText('Downtown');
    const addBtn = screen.getByRole('button', { name: /add map/i });
    fireEvent.click(addBtn);
    const cameraBtn = screen.getByRole('button', { name: /take photo/i });
    const fileBtn = screen.getByRole('button', { name: /choose file/i });
    expect(cameraBtn).toBeTruthy();

    fireEvent.click(cameraBtn);
    expect(inputSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(addBtn);
    fireEvent.click(fileBtn);
    expect(inputSpy).toHaveBeenCalledTimes(2);
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