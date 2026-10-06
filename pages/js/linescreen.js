// The menu every train / bus line gets when you tap it (map page and trip planner).
//  • Outbound / Inbound — tabs on desktop, swipeable panes on mobile
//  • each stop with its live "next in N min" for that direction
//  • vehicles in service, service alerts and walking connections live here, not on the map page
import { api } from './api.js';
import { esc, lineBadge, safeColor, Pager, ICON, liveIcon, fmtMin, fmtMiles } from './ui.js';
import { lineStops, departures, terminals } from './arrivals.js';
import { vehicleRows } from './vehiclesheet.js';

export function renderLineScreen(root, { net, lineId, stationId = null, onBack, onStation, onVehicle, onShowMap, backLabel = 'Back' }) {
  const line = net.linesById[lineId];
  if (!line) { root.innerHTML = '<p class="hint">Line not found.</p>'; return { refresh() {}, destroy() {} }; }
  const { first, last } = terminals(lineId, net);
  const station = stationId != null ? net.stationsById[stationId] : null;
  const color = safeColor(line.color, '#111827');
  let pager = null, alertsHtml = '', alive = true, activeDir = 'outbound';

  const items = () => {
    const keys = [['outbound', last], ...(first && last && first.id !== last.id ? [['inbound', first]] : [])];
    return keys.map(([key, toward]) => ({ id: key, label: key === 'outbound' ? 'Outbound' : 'Inbound', sub: toward ? `to ${toward.name}` : '', html: paneHtml(key, toward) }));
  };

  function paneHtml(key, toward) {
    const stops = lineStops(lineId, net);
    const ordered = key === 'outbound' ? stops : stops.slice().reverse();
    let h = `<p class="ls-toward">${ICON.arrow}<span>Toward <strong>${esc(toward ? toward.name : '')}</strong></span></p>`;
    if (station) {
      const d = departures(station.id, lineId, net).find(x => x.key === key);
      if (d) {
        h += `<h4 class="eyebrow">Next at ${esc(station.name)}</h4><div class="tiles">${d.etas.length
          ? d.etas.map((m, i) => `<div class="tile${i ? '' : ' first'}">${i ? '' : liveIcon(line.type)}<b>${m}</b><span class="u">minutes</span></div>`).join('')
          : '<span class="muted">No vehicles in service right now</span>'}</div>`;
      }
    }
    h += `<h4 class="eyebrow">Stops</h4><ol class="stoplist" style="--c:${color}">${ordered.map(s => {
      const d = departures(s.id, lineId, net).find(x => x.key === key);
      const m = d && d.etas[0];
      return `<li class="${station && s.id === station.id ? 'here' : ''}"><button class="ls-stop" data-open="${s.id}"><span>${esc(s.name)}</span>${m != null ? `<span class="ls-eta"><b>${m}</b> min</span>` : ''}</button></li>`;
    }).join('')}</ol>`;
    return h;
  }

  function extrasHtml() {
    const live = vehicleRows(net, lineId, station ? station.id : null);

    const seen = new Set(), walks = [];
    for (const s of lineStops(lineId, net)) {
      for (const w of net.walkFrom[s.id] || []) {
        const key = [s.id, w.id].sort().join('-');
        if (seen.has(key) || !net.stationsById[w.id]) continue;
        seen.add(key); walks.push({ a: s, b: net.stationsById[w.id], w });
      }
    }
    const walkHtml = walks.length ? walks.slice(0, 8).map(({ a, b, w }) => `
      <div class="walk-row"><div class="walk-main"><strong>${esc(a.name)} → ${esc(b.name)}</strong>
        <span class="chips">${b.lineIds.map(id => lineBadge(net.linesById[id])).join('')}</span>
        <small>${fmtMin(w.seconds)} walk · ${fmtMiles(w.miles)}</small></div></div>`).join('') : '<p class="muted pad">No walking connections from this line.</p>';

    return `<h3 class="eyebrow">Live vehicles on this line</h3><div class="ls-vehs">${live}</div>
      <h3 class="eyebrow">Walking connections</h3>${walkHtml}
      <h3 class="eyebrow">Service alerts</h3><div id="lsAlerts">${alertsHtml || '<p class="muted pad">No active alerts.</p>'}</div>`;
  }

  function bind() {
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => onStation && onStation(net.stationsById[b.dataset.open]));
    root.querySelectorAll('[data-vehicle]').forEach(b => b.onclick = () => { const v = (net.vehicles || []).find(x => String(x.id) === b.dataset.vehicle); if (v && onVehicle) onVehicle(v); });
  }

  root.innerHTML = `<div class="ls">
    <div class="ls-head" style="--c:${color}">
      <button class="ls-back" id="lsBack">${ICON.back}<span>${esc(backLabel)}</span></button>
      <div class="ls-id">${lineBadge(line, 'xxl')}<div><h2>${esc(line.name)}</h2><p>${line.type === 'rail' ? 'Rail' : 'Bus'}${line.frequency ? ' · ' + esc(line.frequency) : ''}${line.description ? ' · ' + esc(line.description) : ''}</p></div></div>
      <div class="head-actions">${onShowMap ? '<button id="lsMap">Show on map</button>' : ''}${station ? `<a href="planner.html?from=${station.id}">Plan trip from ${esc(station.name)}</a>` : ''}</div>
    </div>
    <div id="lsPager"></div><div id="lsExtras">${extrasHtml()}</div></div>`;
  pager = Pager({ items: items(), active: activeDir, label: 'Direction', onChange: id => { activeDir = id; } });
  root.querySelector('#lsPager').append(pager.el);
  root.querySelector('#lsBack').onclick = () => onBack && onBack();
  const mapBtn = root.querySelector('#lsMap'); if (mapBtn) mapBtn.onclick = () => onShowMap();
  bind();

  api(`/api/advisories?line_id=${encodeURIComponent(lineId)}`).then(list => {
    if (!alive) return;
    alertsHtml = list.length ? list.map(a => `<div class="adv ${esc(a.severity)}"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p></div>`).join('') : '';
    const el = root.querySelector('#lsAlerts'); if (el) el.innerHTML = alertsHtml || '<p class="muted pad">No active alerts.</p>';
  }).catch(() => {});

  return {
    refresh() { if (!alive) return; pager.update(items()); root.querySelector('#lsExtras').innerHTML = extrasHtml(); bind(); },
    destroy() { alive = false; }
  };
}
