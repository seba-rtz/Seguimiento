/* Sincronización con Supabase, sin librerías. Cada usuario solo puede leer y escribir sus propios datos (lo garantiza el servidor). */
(function (root) {
  'use strict';
  var URL = 'https://brclicidivpxqmzfxwsb.supabase.co';
  var KEY = 'sb_publishable_javfWi55UYm9z1f8pEYZMg_KSKgIlsa'; // clave pública: es seguro que esté en la web
  var SK = 'seguimiento.auth', MK = 'seguimiento.sync';
  var hooks = null, timer = null, running = false, again = false, text = '';

  function jget(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function jset(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function meta() { return jget(MK) || {}; }
  function note(t) { text = t; if (hooks && hooks.refresh) hooks.refresh(); }
  function hhmm(d) { return d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function hasData(d) { return !!(d && (d.tasks.length || d.goals.length || Object.keys(d.log).length)); }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(sync, ms); }

  function api(path, o) {
    o = o || {};
    var h = { apikey: KEY, 'Content-Type': 'application/json' };
    if (o.token) h.Authorization = 'Bearer ' + o.token;
    if (o.prefer) h.Prefer = o.prefer;
    return fetch(URL + path, { method: o.method || 'GET', headers: h, cache: 'no-store', body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          return { ok: r.ok, status: r.status, json: j };
        });
      });
  }

  function saveSession(j) {
    var s = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000, uid: j.user.id, email: j.user.email };
    jset(SK, s); return s;
  }
  function token() {
    var s = jget(SK);
    if (!s) return Promise.reject(new Error('expired'));
    if (Date.now() < s.exp) return Promise.resolve(s);
    return api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh } }).then(function (r) {
      if (r.ok && r.json && r.json.access_token) return saveSession(r.json);
      if (r.status >= 400 && r.status < 500) { localStorage.removeItem(SK); throw new Error('expired'); }
      throw new Error('http ' + r.status);
    });
  }

  function signIn(email, pass) {
    return api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email, password: pass } }).then(function (r) {
      if (r.ok && r.json && r.json.access_token) { saveSession(r.json); setTimeout(sync, 0); return true; }
      throw new Error(r.status === 400 ? 'Correo o contraseña incorrectos.' : 'No se pudo entrar (error ' + r.status + ').');
    }, function () { throw new Error('Sin conexión. Inténtalo de nuevo con internet.'); });
  }
  function signOut() { localStorage.removeItem(SK); localStorage.removeItem(MK); clearTimeout(timer); text = ''; }

  function adopt(remote) {
    var d = remote.contenido;
    if (!root.Core.validate(d)) throw new Error('datos de la nube no válidos');
    if (hasData(hooks.get())) localStorage.setItem('seguimiento.copia-local', JSON.stringify(hooks.get()));
    hooks.replace(d);
    jset(MK, { base: remote.actualizado, dirty: false, last: Date.now() });
  }

  function push(s, base, local) {
    var snap = JSON.stringify(local), now = new Date().toISOString(), req;
    if (base) req = api('/rest/v1/datos?user_id=eq.' + s.uid + '&actualizado=eq.' + encodeURIComponent(base),
      { method: 'PATCH', token: s.access, prefer: 'return=representation', body: { contenido: local, actualizado: now } });
    else req = api('/rest/v1/datos', { method: 'POST', token: s.access, prefer: 'return=representation', body: { user_id: s.uid, contenido: local, actualizado: now } });
    return req.then(function (r) {
      if (r.ok && r.json && r.json.length) {
        jset(MK, { base: r.json[0].actualizado, dirty: JSON.stringify(hooks.get()) !== snap, last: Date.now() });
        if (meta().dirty) again = true;
        return;
      }
      if (r.ok || r.status === 409) { again = true; return; } // alguien cambió la nube entre medias: se revisa de nuevo
      throw new Error('http ' + r.status);
    });
  }

  function askConflict(s, remote, local) {
    var cloud = confirm('Hay datos distintos en la nube y en este dispositivo.\n\nAceptar = quedarte con los de la NUBE (los de este dispositivo se guardan aparte como copia).\nCancelar = quedarte con los de ESTE dispositivo (se sustituyen los de la nube).');
    localStorage.setItem('seguimiento.copia-nube', JSON.stringify(remote.contenido));
    if (cloud) return adopt(remote);
    return push(s, remote.actualizado, local);
  }

  function step(s, remote) {
    var m = meta(), local = hooks.get();
    if (!remote) return push(s, null, local); // la nube está vacía: se suben los datos de este dispositivo
    var same = m.base && new Date(m.base).getTime() === new Date(remote.actualizado).getTime();
    if (same) return m.dirty ? push(s, remote.actualizado, local) : null;
    if (!m.dirty && (m.base || !hasData(local))) return adopt(remote);
    return askConflict(s, remote, local);
  }

  function sync() {
    if (!jget(SK) || !hooks) return Promise.resolve();
    if (running) { again = true; return Promise.resolve(); }
    if (!hooks.idle()) { schedule(3000); return Promise.resolve(); }
    running = true; note('Sincronizando…');
    return token().then(function (s) {
      return api('/rest/v1/datos?select=contenido,actualizado&limit=1', { token: s.access }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return step(s, r.json && r.json[0]);
      });
    }).then(function () {
      note('Sincronizado a las ' + hhmm(new Date()));
    }, function (e) {
      if (e.message === 'expired') note('La sesión caducó. Vuelve a iniciar sesión.');
      else if (e instanceof TypeError) note('Sin conexión; se sincronizará más tarde.');
      else note('No se pudo sincronizar (' + e.message + ').');
    }).then(function () { running = false; if (again) { again = false; schedule(300); } });
  }

  function changed() {
    if (!jget(SK)) return;
    var m = meta(); m.dirty = true; jset(MK, m);
    schedule(2000);
  }
  function info() {
    var s = jget(SK);
    if (!s) return { email: '', text: '' };
    var m = meta();
    return { email: s.email, text: text || (m.dirty ? 'Cambios pendientes de subir.' : (m.last ? 'Sincronizado a las ' + hhmm(new Date(m.last)) : 'Pendiente de sincronizar.')) };
  }
  function init(h) {
    hooks = h;
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    window.addEventListener('online', function () { sync(); });
    sync();
  }

  function calendar(from, to) {
    return token().then(function (s) {
      return fetch(URL + '/functions/v1/calendario', { method: 'POST', cache: 'no-store',
        headers: { apikey: KEY, Authorization: 'Bearer ' + s.access, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from, to: to }) });
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok) throw new Error(j && j.error ? (/ICAL_URL/.test(j.error) ? 'falta guardar la dirección secreta en Supabase.' : j.error) : 'error ' + r.status);
        var ev = j.events || []; ev.warn = j.errores || []; return ev;
      });
    });
  }

  root.Sync = { calendar: calendar, init: init, signIn: signIn, signOut: signOut, sync: sync, changed: changed, info: info };
})(window);
