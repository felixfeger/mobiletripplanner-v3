// The only place the API address lives. Same Worker URL as the old site.
export const API_BASE = 'https://city-metro-bus-api.felixfeger46.workers.dev';

export const MODES = [
  { id: 'fastest', label: 'Fastest', short: 'Fastest' },
  { id: 'fewest_transfers', label: 'Fewest transfers', short: 'Transfers' },
  { id: 'fewest_walking', label: 'Least walking', short: 'Walking' }
];

// Live arrival times appear only inside the trip guide (planner.html).
// Set to true to also show them on the map page (nearby list + station slider).
export const SHOW_LIVE_ON_MAP = false;
