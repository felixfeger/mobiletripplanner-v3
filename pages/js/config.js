// The only place the API address lives. Same Worker URL as the old site.
export const API_BASE = 'https://api.trip-planner.citymetro.xyz';

// Live-vehicle icons (white, transparent PNGs — drawn on a black chip). Every live vehicle uses these.
// Rail uses train.png (trains.png is still tried as a fallback); buses use bus.png.
export const VEHICLE_ICONS = { rail: ['img/train.png', 'img/trains.png'], bus: ['img/bus.png'] };

export const MODES = [
  { id: 'fastest', label: 'Fastest', short: 'Fastest' },
  { id: 'fewest_transfers', label: 'Fewest transfers', short: 'Transfers' },
  { id: 'fewest_walking', label: 'Least walking', short: 'Walking' }
];

// The map page shows only the NEXT vehicle per nearby service / station (with the live icon).
// The full live board, vehicle sheet, alerts and walking connections live on the line screen and trip guide.
export const SHOW_LIVE_ON_MAP = true;

// Where people sign in (Authentik). Used for the "Manage account" link.
export const AUTH_ORIGIN = 'https://auth.citymetro.xyz';
