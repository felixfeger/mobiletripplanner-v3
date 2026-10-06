// The only place the API address lives. Same Worker URL as the old site.
export const API_BASE = 'https://city-metro-bus-api.felixfeger46.workers.dev';

export const MODES = [
  { id: 'fastest', label: 'Fastest', short: 'Fastest' },
  { id: 'fewest_transfers', label: 'Fewest transfers', short: 'Transfers' },
  { id: 'fewest_walking', label: 'Least walking', short: 'Walking' }
];

// The map page shows only the NEXT vehicle per nearby service / station (with the live icon).
// The full live board, vehicle sheet, alerts and walking connections live on the line screen and trip guide.
export const SHOW_LIVE_ON_MAP = false;
