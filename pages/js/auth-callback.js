// Landing page after Authentik. The Worker sends the browser here with a one-time ticket
// (/auth-callback.html?ticket=…&return=/planner.html…). We swap the ticket for a session token, then go back
// to where the person was. On any failure the Worker sends ?error=… instead.
import { api, Auth } from './api.js';

const q = new URLSearchParams(location.search);
const safeReturn = p => (typeof p === 'string' && /^\/(?![\/\\])/.test(p) && p !== '/' ? p : '/index.html');
const ret = safeReturn(q.get('return'));

history.replaceState(null, '', location.pathname);   // take the ticket out of the address bar straight away

const $ = id => document.getElementById(id);
function fail(message) {
  $('cbSpin').hidden = true;
  $('cbTitle').textContent = "Couldn't sign you in";
  $('cbMsg').textContent = message || 'Something went wrong. Please try again.';
  $('cbActions').hidden = false;
  $('cbRetry').onclick = () => Auth.login(ret);
}

(async () => {
  if (q.get('error')) return fail(q.get('error'));
  const ticket = q.get('ticket');
  if (!ticket) return fail('This page is only used when you sign in. Use the Sign in button instead.');
  try {
    const data = await api('/api/auth/exchange', { method: 'POST', body: JSON.stringify({ ticket }) });
    Auth.set(data.token, data.user);
    $('cbTitle').textContent = `Welcome, ${data.user.name}`;
    $('cbMsg').textContent = 'Taking you back…';
    location.replace(ret);
  } catch (e) { fail(e.message); }
})();
