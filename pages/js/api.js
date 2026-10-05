import { API_BASE } from './config.js';

export const Auth = {
  token: () => localStorage.getItem('cm_token'),
  user() { try { return JSON.parse(localStorage.getItem('cm_user')); } catch { return null; } },
  set(token, user) { localStorage.setItem('cm_token', token); localStorage.setItem('cm_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('cm_token'); localStorage.removeItem('cm_user'); },
  get loggedIn() { return !!this.token(); }
};

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (Auth.token()) headers.Authorization = `Bearer ${Auth.token()}`;
  let res;
  try { res = await fetch(API_BASE + path, { ...opts, headers }); }
  catch { throw new Error('Cannot reach the City Metro server'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && Auth.loggedIn && !path.startsWith('/api/auth')) Auth.clear(); // expired session
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// One request loads everything the map and planner need.
let pending = null;
export function loadNetwork(force = false) {
  if (!pending || force) pending = api('/api/network').then(indexNetwork).catch(e => { pending = null; throw e; });
  return pending;
}

function indexNetwork(raw) {
  const net = { ...raw };
  net.linesById = Object.fromEntries(raw.lines.map(l => [l.id, l]));
  net.stationsById = Object.fromEntries(raw.stations.map(s => [s.id, s]));
  net.segsByLine = {};
  for (const seg of raw.segments) {
    try { seg.pts = JSON.parse(seg.points_json); } catch { seg.pts = []; }
    (net.segsByLine[seg.line_id] ||= []).push(seg);
  }
  for (const st of raw.streets) { try { st.pts = JSON.parse(st.points_json); } catch { st.pts = []; } }
  for (const s of raw.stations) s.lineIds = (s.line_ids || '').split(',').filter(Boolean);
  // station id -> [{id (other station), seconds, miles}]
  net.walkFrom = {};
  for (const w of raw.walk_links) {
    (net.walkFrom[w.a] ||= []).push({ id: w.b, seconds: w.seconds, miles: w.miles });
    (net.walkFrom[w.b] ||= []).push({ id: w.a, seconds: w.seconds, miles: w.miles });
  }
  return net;
}

export async function refreshVehicles(net) {
  net.vehicles = await api('/api/live');
  return net.vehicles;
}
