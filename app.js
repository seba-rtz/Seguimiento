(function () {
  'use strict';
  var C = Core;
  var D = C.load(localStorage);
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var DIAS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  var DL = ['L','M','X','J','V','S','D'];
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    view: 'hoy', scope: 'salud', calOpen: false, calSel: C.today(), calMonth: C.today().slice(0, 7),
    weekOff: 0, quarter: C.quarterOf(C.today()), lastScope: 'tareas'
  };
  var form = null; // estado del formulario abierto

  /* ---------- Google Calendar (solo lectura, vía función de Supabase) ---------- */
  var GK = 'seguimiento.gcal', GPAL = ['#6f7c99', '#c46fa8', '#3fa7b5', '#a9805a', '#8c9f4f', '#d0796a'];
  // Regla fija por NOMBRE del calendario de Google (vale para cualquier evento nuevo, sin tocar nada):
  // si el nombre contiene el de un ámbito, se usa el color de ese ámbito (Tareas amarillo, Proyectos rojo…).
  var GDEF = [['proyecto', 'proyectos'], ['tarea', 'tareas'], ['salud', 'salud'], ['formaci', 'formacion'], ['descanso', 'descanso'],
    ['trabajo', '#ff7b7b'], ['obligaci', '#dcd75a'], ['universidad', '#4f9dff'], ['horario', '#4f9dff']];
  function gDef(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < GDEF.length; i++) if (n.indexOf(GDEF[i][0]) >= 0) { var v = GDEF[i][1]; return v.charAt(0) === '#' ? v : C.scopeById(v).color; }
    return '';
  }
  function gBase(ev) { var c = D.meta.gColors && D.meta.gColors[ev.calName]; return c || gDef(ev.calName) || GPAL[(ev.cal || 0) % GPAL.length]; }
  function gMute(h) { // apaga el color: lo mezcla con un tono sepia
    var n = parseInt(h.slice(1), 16), k = 0.38, S = [139, 125, 107], ch = [n >> 16, (n >> 8) & 255, n & 255];
    var v = ch.map(function (a, i) { return Math.round(a * (1 - k) + S[i] * k); });
    return '#' + ((1 << 24) | (v[0] << 16) | (v[1] << 8) | v[2]).toString(16).slice(1);
  }
  function gcol(ev) { return gMute(gBase(ev)); }
  function gColorRows() {
    var seen = {}, rows = '';
    G.events.forEach(function (ev) {
      if (seen[ev.calName]) return; seen[ev.calName] = 1;
      rows += '<label style="display:flex;align-items:center;justify-content:space-between;padding:5px 0"><span>' + esc(ev.calName) +
        '</span><input type="color" data-gcal="' + esc(ev.calName) + '" value="' + esc(gBase(ev)) + '" style="width:48px;height:32px;padding:0;border:0;background:none"></label>';
    });
    var reset = D.meta.gColors && Object.keys(D.meta.gColors).length ? '<button class="btn block" data-a="gcolreset" style="margin:6px 0 4px">Volver a los colores automáticos</button>' : '';
    return rows ? '<div class="note" style="margin:0 0 4px">Color de cada calendario (se muestra apagado). Automático: si el nombre del calendario es el de un ámbito (Tareas, Proyectos, Salud, Formación, Descanso), sus eventos toman el color de ese ámbito.</div>' + rows + reset + '<div style="height:8px"></div>' : '';
  }
  var G = { events: [], from: '', to: '', at: 0, loading: false, fail: 0, err: '', by: {} };
  try { var gc = JSON.parse(localStorage.getItem(GK)); if (gc && gc.events) { G.events = gc.events; G.from = gc.from; G.to = gc.to; G.at = gc.at; } } catch (e) {}
  function indexG() {
    G.by = {};
    G.events.forEach(function (ev) {
      var a, b;
      if (ev.allDay) { a = ev.start; b = C.addDays(ev.end, -1); if (b < a) b = a; }
      else { var s = new Date(ev.start), e = new Date(ev.end); a = C.fmt(s); b = C.fmt(new Date(Math.max(s.getTime(), e.getTime() - 1))); }
      var d = a, n = 0;
      while (d <= b && n < 31) { (G.by[d] = G.by[d] || []).push(ev); d = C.addDays(d, 1); n++; }
    });
  }
  indexG();
  function gOn(d) {
    return (G.by[d] || []).slice().sort(function (x, y) { return (y.allDay ? 1 : 0) - (x.allDay ? 1 : 0) || (x.start < y.start ? -1 : x.start > y.start ? 1 : 0); });
  }
  function gMins(ev, d) {
    var ds = C.parse(d).getTime();
    var s = Math.max(0, Math.round((new Date(ev.start).getTime() - ds) / 60000));
    var e = Math.min(1440, Math.round((new Date(ev.end).getTime() - ds) / 60000));
    if (e <= s) e = Math.min(1440, s + 30);
    return [s, e];
  }
  function hm(m) { return C.pad(Math.floor(m / 60)) + ':' + C.pad(m % 60); }
  function gTime(ev, d) { if (ev.allDay) return 'Todo el día'; var m = gMins(ev, d); return hm(m[0]) + '–' + hm(m[1]); }
  function gRow(ev, d) {
    var m = [gTime(ev, d)]; if (ev.location) m.push(ev.location); m.push(ev.calName || 'Google Calendar');
    return '<div class="gev" style="--c:' + gcol(ev) + '"><span class="bar"></span><div class="body"><div class="t">' + esc(ev.title) + '</div><div class="m">' + esc(m.join(' · ')) + '</div></div></div>';
  }
  function gSession() { return !!(window.Sync && Sync.info().email); }
  function ensureG(force) {
    if (!gSession() || G.loading) return;
    var td = C.today(), lo = ui.calSel < td ? ui.calSel : td, hi = ui.calSel > td ? ui.calSel : td;
    var covers = G.from && G.from <= C.addDays(lo, -7) && G.to >= C.addDays(hi, 14);
    if (!force && covers && Date.now() - G.at < 600000) return;
    if (!force && Date.now() - G.fail < 60000) return;
    var from = C.addDays(lo, -40), to = C.addDays(hi, 120);
    G.loading = true;
    Sync.calendar(C.parse(from).toISOString(), C.parse(to).toISOString(), D.meta.uniUrl || '', D.meta.gUrls || '').then(function (evs) {
      var changed = JSON.stringify(evs) !== JSON.stringify(G.events);
      G.warn = evs.warn || []; G.events = evs; G.from = from; G.to = to; G.at = Date.now(); G.err = ''; G.fail = 0;
      try { localStorage.setItem(GK, JSON.stringify({ events: evs, from: from, to: to, at: G.at })); } catch (e) {}
      indexG(); G.loading = false;
      if ((changed || force) && !drag && $('sheet').classList.contains('hidden')) render();
    }, function (e) {
      G.loading = false; G.fail = Date.now();
      G.err = e instanceof TypeError ? 'Sin conexión; se muestran los últimos eventos guardados.' : String(e.message || e);
      if (ui.view === 'mas' && $('sheet').classList.contains('hidden')) render();
    });
  }

  /* ---------- Avisos (notificaciones a la hora de las tareas con hora) ---------- */
  var planT = null;
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function b64(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i);
    return o;
  }
  function planAvisos(force) {
    if (!D.meta.avisosOn || !window.Sync || !Sync.info().email) return;
    clearTimeout(planT);
    planT = setTimeout(function () { doPlan(force); }, force ? 100 : 4000);
  }
  // Avisos de cada tarea: t.rem = lista de minutos de antelación (0 = a la hora). Sin t.rem: a la hora si tiene hora, ninguno si no.
  // Las tareas sin hora avisan a la hora de «D.meta.remHour» (09:00 por defecto) del día que toque.
  var REM_T = [[0, 'A la hora'], [10, '10 min antes'], [30, '30 min antes'], [60, '1 h antes'], [1440, '1 día antes'], [2880, '2 días antes'], [4320, '3 días antes'], [10080, '1 semana antes']];
  var REM_D = [[0, 'El mismo día'], [1440, '1 día antes'], [2880, '2 días antes'], [4320, '3 días antes'], [10080, '1 semana antes']];
  function remsOf(rem, timed) {
    var r = rem ? rem.slice() : (timed ? [0] : []);
    if (!timed) r = r.filter(function (m) { return m === 0 || m >= 1440; });
    return r.sort(function (a, b) { return a - b; });
  }
  function remHour() { return D.meta.remHour || '09:00'; }
  function remRel(m) {
    if (m < 60) return 'en ' + m + ' min';
    if (m < 1440) return 'en ' + (m / 60) + ' h';
    if (m === 1440) return 'mañana';
    if (m === 10080) return 'en 1 semana';
    return 'en ' + (m / 1440) + ' días';
  }
  function remLabel(rem, timed) {
    var r = remsOf(rem, timed), L = timed ? REM_T : REM_D;
    if (!r.length) return 'Ninguno';
    return r.map(function (m) { var o = L.filter(function (x) { return x[0] === m; })[0]; return o ? o[1] : m + ' min antes'; }).join(', ');
  }
  function doPlan(force) {
    var list = [], now = Date.now(), td = C.today(), lim = now + 15 * 864e5, rh = remHour().split(':');
    for (var i = 0; i <= 22; i++) {
      var d = C.addDays(td, i);
      C.tasksOn(D, d).forEach(function (x) {
        var t = x.t;
        if (C.getState(t, x.d)) return;
        var w = C.parse(x.d), timed = !!t.time, p = timed ? t.time.split(':') : rh;
        w.setHours(+p[0], +p[1], 0, 0);
        var sc = C.scopeById(t.scope), cuando = timed ? t.time + (t.end ? '–' + t.end : '') : '';
        remsOf(t.rem, timed).forEach(function (m) {
          var at = timed ? w.getTime() - m * 60000 : w.getTime() - Math.floor(m / 1440) * 864e5;
          if (at <= now || at > lim) return;
          var cuerpo = sc.name + ' · ' + (m === 0 ? (timed ? cuando : 'hoy') : remRel(m) + ', ' + dayWordAbs(x.d) + (timed ? ' a las ' + t.time : ''));
          list.push({ enviar_en: new Date(at).toISOString(), titulo: t.title, cuerpo: cuerpo });
        });
      });
    }
    // Fin del pomodoro o del descanso en curso (llega aunque la app esté cerrada)
    var run = D.focus && D.focus.run;
    if (run && !run.pz && run.mode !== 'crono') {
      var fin = run.st + run.pt + run.dur * 60000;
      if (fin > now) {
        var ft = run.task && findTask(run.task);
        list.push(run.mode === 'break' ? { enviar_en: new Date(fin).toISOString(), titulo: 'Fin del descanso', cuerpo: 'Cuando quieras, empieza otro enfoque.' }
          : { enviar_en: new Date(fin).toISOString(), titulo: 'Enfoque terminado', cuerpo: (ft ? ft.title + ' · ' : '') + run.dur + ' min. Toca para tomarte un descanso.' });
      }
    }
    list.sort(function (a, b) { return a.enviar_en < b.enviar_en ? -1 : 1; });
    list = list.slice(0, 200);
    var sig = JSON.stringify(list);
    if (!force && localStorage.getItem('seguimiento.avisos-plan') === sig) return;
    Sync.rest('/rest/v1/avisos?enviado=eq.false&enviar_en=gt.' + encodeURIComponent(new Date(now).toISOString()), { method: 'DELETE', prefer: 'return=minimal' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      if (!list.length) return { ok: true };
      return Sync.rest('/rest/v1/avisos', { method: 'POST', prefer: 'return=minimal', body: list });
    }).then(function (r) { if (r && r.ok) localStorage.setItem('seguimiento.avisos-plan', sig); }, function () {});
  }
  function enableAvisos() {
    if (!pushSupported()) { alert('Este navegador no permite avisos. En el iPhone hay que abrir la app desde el icono de la pantalla de inicio (iOS 16.4 o superior).'); return; }
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { alert('No has dado permiso. Puedes cambiarlo en Ajustes > Notificaciones > Seguimiento.'); return; }
      return Promise.all([navigator.serviceWorker.ready, Sync.pushKey()]).then(function (a) {
        var reg = a[0];
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(a[1]) });
        });
      }).then(function (sub) {
        return Sync.rest('/rest/v1/suscripciones?on_conflict=endpoint', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { endpoint: sub.endpoint, datos: sub.toJSON() } });
      }).then(function (r) {
        if (!r.ok) throw new Error('error ' + r.status);
        D.meta.avisosOn = true; save(); planAvisos(true); render();
        alert('Avisos activados en este dispositivo.');
      });
    }).catch(function (e) { alert('No se pudieron activar los avisos: ' + (e.message || e)); });
  }
  function disableAvisos() {
    D.meta.avisosOn = false; save(); localStorage.removeItem('seguimiento.avisos-plan');
    Sync.rest('/rest/v1/avisos?enviado=eq.false', { method: 'DELETE', prefer: 'return=minimal' }).catch(function () {});
    if (pushSupported()) navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint; sub.unsubscribe();
      return Sync.rest('/rest/v1/suscripciones?endpoint=eq.' + encodeURIComponent(ep), { method: 'DELETE', prefer: 'return=minimal' });
    }).catch(function () {});
    render();
  }
  // Al cerrar sesión se retiran antes los avisos de este dispositivo (si no, seguirían llegando) y se borran cachés de la cuenta.
  function logout() {
    var done = function () {
      Sync.signOut(); D.meta.avisosOn = false; C.save(localStorage, D);
      localStorage.removeItem('seguimiento.avisos-plan'); localStorage.removeItem(GK);
      G.events = []; G.at = 0; indexG(); render();
    };
    if (!D.meta.avisosOn) return done();
    Sync.rest('/rest/v1/avisos?enviado=eq.false', { method: 'DELETE', prefer: 'return=minimal' }).then(function () {
      return pushSupported() ? Promise.race([navigator.serviceWorker.ready, new Promise(function (r) { setTimeout(r, 3000); })]).then(function (reg) { return reg && reg.pushManager.getSubscription(); }) : null;
    }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint; sub.unsubscribe();
      return Sync.rest('/rest/v1/suscripciones?endpoint=eq.' + encodeURIComponent(ep), { method: 'DELETE', prefer: 'return=minimal' });
    }).then(done, done);
  }
  var saveWarned = false;
  function save() {
    if (!C.save(localStorage, D) && !saveWarned) {
      saveWarned = true;
      alert('No se han podido guardar los cambios en este dispositivo (almacenamiento lleno o bloqueado). Haz una copia de seguridad desde «Más» y libera espacio.');
    }
    if (window.Sync) Sync.changed();
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function dayWordAbs(s) { var d = C.parse(s); return DIAS[C.weekday(d)].slice(0, 3) + ' ' + d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); }
  function longDate(s) { var d = C.parse(s); return DIAS[C.weekday(d)] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function findTask(id) { return D.tasks.filter(function (t) { return t.id === id; })[0]; }

  /* ---------- Subcategorías (dentro de cada ámbito; las crea el usuario; D.meta.subs) ---------- */
  function subsOf(scope) { return (D.meta.subs || []).filter(function (x) { return x.scope === scope; }); }
  function subById(id) { return id ? (D.meta.subs || []).filter(function (x) { return x.id === id; })[0] || null : null; }
  function addSub(scope, name) {
    name = String(name || '').trim().slice(0, 40);
    if (!name) return null;
    var ex = subsOf(scope).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
    if (ex) { if (ex.archived) { ex.archived = false; save(); } return ex; }
    D.meta.subs = D.meta.subs || [];
    var n = { id: C.uid(), scope: scope, name: name };
    D.meta.subs.push(n); save();
    return n;
  }
  /* ---------- Filas ---------- */
  function recLabel(r) {
    if (!r) return '';
    if (r.type === 'daily') return 'Cada día';
    if (r.type === 'weekly') return 'Cada semana' + (r.days && r.days.length ? ' (' + r.days.map(function (i) { return DL[i]; }).join(' ') + ')' : '');
    if (r.type === 'monthly') return 'Cada mes';
    if (r.type === 'yearly') return 'Cada año';
    return 'Cada ' + (+r.n || 1) + ' ' + ({ d: 'días', w: 'semanas', m: 'meses' }[r.unit] || 'días');
  }

  function taskRow(t, d, showDate, inbox, noSub, noScope) {
    var sc = C.scopeById(t.scope), st = C.getState(t, d || t.date);
    var dots = '';
    for (var i = 0; i < (t.priority || 0); i++) dots += '<i></i>';
    var meta = [];
    if (showDate && d) meta.push(shortDate(d));
    if (t.time) meta.push(t.end ? t.time + '–' + t.end : t.time);
    if (!inbox) { var sb = noSub ? null : subById(t.sub); if (!noScope) meta.push(sc.name + (sb ? ' › ' + sb.name : '')); else if (sb) meta.push(sb.name); }
    if (t.rec) meta.push('↻ ' + recLabel(t.rec));
    if (t.rec && t.mv && d) { var og = C.origOf(t, d); if (og && og !== d) meta.push('movida del ' + shortDate(og)); }
    var mark = st === 'done' ? '✓' : st === 'wontdo' ? '✕' : '';
    return '<div class="task ' + esc(st || '') + (!st && d && d < C.today() ? ' late' : '') + '" style="--c:' + sc.color + '" data-group="' + esc(d || '') + '">' +
      '<span class="bar"></span><span class="dots">' + dots + '</span>' +
      '<button class="chk" data-a="toggle" data-id="' + esc(t.id) + '" data-date="' + esc(d || '') + '" aria-label="Completar">' + mark + '</button>' +
      '<div class="body" data-a="edit" data-id="' + esc(t.id) + '" data-date="' + esc(d || '') + '"><div class="t">' + esc(t.title) + '</div>' +
      (meta.length ? '<div class="m">' + esc(meta.join(' · ')) + '</div>' : '') + '</div>' + (inbox ? '<button class="qs" data-a="qsched" data-id="' + esc(t.id) + '" aria-label="Ponerle día">' + IC_QS + '</button>' : '') + '</div>';
  }
  // Hechas y descartadas siempre al final (así la primera tarea es la que toca hacer)
  function doneLast(items) {
    var a = [], b = [];
    items.forEach(function (x) { (C.getState(x.t, x.d || x.t.date) ? b : a).push(x); });
    return a.concat(b);
  }
  var IC_QS = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>';
  function list(items, showDate, empty) {
    if (!items.length) return empty ? '<div class="empty">' + empty + '</div>' : '';
    return doneLast(items).map(function (x) { return taskRow(x.t, x.d, showDate); }).join('');
  }

  /* ---------- Agrupar y ordenar (cada lista recuerda el suyo; lo que arrastras manda) ---------- */
  var VS_DEF = { hoy: { g: 'none', o: 'auto' }, proximos: { g: 'fecha', o: 'auto' }, todo: { g: 'fecha', o: 'auto' }, buzon: { o: 'auto' }, ambito: { o: 'auto' } };
  var VS_G = { hoy: ['none', 'ambito', 'prioridad'], proximos: ['fecha', 'ambito', 'prioridad', 'none'], todo: ['fecha', 'ambito', 'prioridad', 'none'] };
  var G_NAME = { none: 'Ninguno', fecha: 'Fecha', ambito: 'Ámbito', prioridad: 'Prioridad' };
  var O_LIST = [['auto', 'Automático'], ['prioridad', 'Prioridad'], ['hora', 'Fecha y hora'], ['titulo', 'Título'], ['creacion', 'Más nuevas']];
  function vs(k) {
    D.meta.vs = D.meta.vs || {};
    var v = D.meta.vs[k] || {}, d = VS_DEF[k] || { g: 'none', o: 'auto' };
    return { g: v.g || d.g, o: v.o || d.o, hd: !!v.hd };
  }
  function sortWith(o) {
    return function (a, b) {
      var ma = a.t.order != null, mb = b.t.order != null; // 1.º lo que has movido a mano
      if (ma && mb && a.t.order !== b.t.order) return a.t.order - b.t.order;
      if (ma !== mb) return ma ? -1 : 1;
      var r = 0;
      if (o === 'prioridad') r = (b.t.priority || 0) - (a.t.priority || 0);
      else if (o === 'hora') {
        var da = a.d || '9999', db = b.d || '9999';
        r = da < db ? -1 : da > db ? 1 : 0;
        if (!r) { var ta = a.t.time || '99', tb = b.t.time || '99'; r = ta < tb ? -1 : ta > tb ? 1 : 0; }
      } else if (o === 'titulo') r = a.t.title.localeCompare(b.t.title, 'es', { sensitivity: 'base' });
      else if (o === 'creacion') r = (b.t.created || 0) - (a.t.created || 0);
      return r || C.cmp(a, b);
    };
  }
  function sortList(items, o) { return items.slice().sort(sortWith(o)); }
  var PRIO_NAME = { 3: 'Prioridad alta', 2: 'Prioridad media', 1: 'Prioridad baja', 0: 'Sin prioridad' };
  // Pinta una lista según su forma de agrupar y ordenar. Cada grupo va en su caja (arrastrar no mezcla grupos).
  function renderList(k, items, showDate, empty, dateTitle) {
    var v = vs(k), td = C.today();
    if (v.hd) items = items.filter(function (x) { return !C.getState(x.t, x.d || x.t.date); });
    if (!items.length) return empty ? '<div class="empty">' + empty + '</div>' : '';
    items = sortList(items, v.o);
    var groups = [], by = {};
    function put(key, title, x, c) { if (!by[key]) { by[key] = { key: key, title: title, c: c, items: [] }; groups.push(by[key]); } by[key].items.push(x); }
    if (v.g === 'ambito') {
      C.SCOPES.forEach(function (s) { items.forEach(function (x) { if (x.t.scope === s.id) put(s.id, s.name, x, s.color); }); });
      items.forEach(function (x) { if (!C.SCOPES.some(function (s) { return s.id === x.t.scope; })) put('?', 'Otros', x); });
    } else if (v.g === 'prioridad') {
      [3, 2, 1, 0].forEach(function (pr) { items.forEach(function (x) { if ((x.t.priority || 0) === pr) put('p' + pr, PRIO_NAME[pr], x); }); });
    } else if (v.g === 'fecha') {
      var keys = [];
      items.forEach(function (x) { var kk = x.d || ''; if (keys.indexOf(kk) < 0) keys.push(kk); });
      keys.sort(function (a, b) { if (!a) return 1; if (!b) return -1; return a < b ? -1 : 1; });
      keys.forEach(function (kk) { items.forEach(function (x) { if ((x.d || '') === kk) put('d' + kk, dateTitle ? dateTitle(kk) : (kk ? longDate(kk) : 'Sin fecha'), x); }); });
    } else groups.push({ key: 'all', title: '', items: items });
    var showD = showDate && v.g !== 'fecha';
    return groups.map(function (g) {
      var rows = doneLast(g.items).map(function (x) { return taskRow(x.t, x.d, showD).replace(/data-group="[^"]*"/, 'data-group="' + esc(g.key) + '"'); }).join('');
      return (g.title ? '<div class="sec">' + (g.c ? '<span class="gsec"><i style="background:' + g.c + '"></i>' + esc(g.title) + '</span>' : '<span>' + esc(g.title) + '</span>') + '<span class="sn">' + g.items.length + '</span></div>' : '') +
        '<div class="sg">' + rows + '</div>';
    }).join('');
  }
  function openVs(k) {
    var v = vs(k), gs = VS_G[k], h = '<h2>Agrupar y ordenar</h2>';
    if (gs) h += '<div class="lbl">Agrupar por</div><div class="chips">' + gs.map(function (g) { return '<button class="chip ' + (v.g === g ? 'on' : '') + '" data-a="vsset" data-k="g" data-v="' + g + '">' + G_NAME[g] + '</button>'; }).join('') + '</div>';
    h += '<div class="lbl">Ordenar por</div><div class="chips">' + O_LIST.map(function (o) { return '<button class="chip ' + (v.o === o[0] ? 'on' : '') + '" data-a="vsset" data-k="o" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
    if (k !== 'buzon' && k !== 'todo') h += '<button class="mr" data-a="vsset" data-k="hd" data-v="' + (v.hd ? '' : '1') + '" role="switch" aria-checked="' + v.hd + '" style="margin-top:14px"><span class="mt"><b>Ocultar completadas</b><small>Si no, salen al final de la lista</small></span><span class="tog' + (v.hd ? ' on' : '') + '"><i></i></span></button>';
    h += '<div class="note" style="margin-top:12px">Lo que muevas a mano (mantén pulsada una tarea y arrástrala) va siempre por delante de este orden.</div>' +
      '<div class="actions"><button class="btn" data-a="vsreset">Quitar mi orden manual de esta lista</button><button class="btn primary" data-a="close">Listo</button></div>';
    ui.vsk = k; openSheet(h);
  }
  // Tareas que se ven ahora en una lista (para «Quitar mi orden manual»)
  function listTasks(k) {
    var td = C.today(), arr = [];
    if (k === 'hoy') arr = C.tasksOn(D, td);
    else if (k === 'proximos') for (var i = 1; i <= 7; i++) arr = arr.concat(C.tasksOn(D, C.addDays(td, i)));
    else if (k === 'todo') arr = allPending();
    else if (k === 'buzon') arr = D.tasks.filter(function (t) { return !t.deleted && !t.date; }).map(function (t) { return { t: t }; });
    else if (k === 'ambito') arr = D.tasks.filter(function (t) { return t.scope === ui.scope; }).map(function (t) { return { t: t }; });
    return arr.map(function (x) { return x.t; });
  }

  /* ---------- Consultas ---------- */
  // Atrasadas: tareas sin repetir con fecha pasada y, de las repetidas, cada vez que pasó sin hacerse ni descartarse.
  function overdue() {
    var td = C.today(), items = [];
    D.tasks.forEach(function (t) {
      if (t.deleted) return;
      if (t.rec) C.missed(t, td).forEach(function (d) { items.push({ t: t, d: d }); });
      else if (t.date && t.date < td && !C.getState(t)) items.push({ t: t, d: t.date });
    });
    return C.sortItems(items).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  }
  function allPending(scope) {
    var td = C.today(), out = [];
    D.tasks.forEach(function (t) {
      if (t.deleted || (scope && t.scope !== scope)) return;
      if (t.rec) { var n = C.nextOccurrence(t, td); if (n) out.push({ t: t, d: n }); }
      else if (!C.getState(t)) out.push({ t: t, d: t.date });
    });
    return out.sort(function (a, b) {
      if (a.d !== b.d) { if (!a.d) return 1; if (!b.d) return -1; return a.d < b.d ? -1 : 1; }
      return C.cmp(a, b);
    });
  }

  /* ---------- Vistas ---------- */
  function weekGrid() {
    var monday = C.addDays(C.mondayOf(C.today()), ui.weekOff * 7), td = C.today();
    var h = '<div class="card"><div class="wkhead"><button data-a="wk" data-n="-1" aria-label="Semana anterior">‹</button><span>' +
      (ui.weekOff === 0 ? 'Esta semana' : shortDate(monday) + ' – ' + shortDate(C.addDays(monday, 6))) +
      '</span><button data-a="wk" data-n="1" aria-label="Semana siguiente">›</button></div><div class="grid"><span></span>';
    for (var i = 0; i < 7; i++) {
      var day = C.addDays(monday, i);
      h += '<span class="h ' + (day === td ? 'today' : '') + '">' + DL[i] + '<br>' + C.parse(day).getDate() + '</span>';
    }
    h += '<span></span>';
    C.SCOPES.forEach(function (s) {
      h += '<span class="name" style="--c:' + s.color + '"><i></i>' + s.name + '</span>';
      for (var j = 0; j < 7; j++) {
        var dd = C.addDays(monday, j), on = D.log[dd] && D.log[dd][s.id];
        h += '<button class="cell ' + (on ? 'on' : '') + (dd === td ? ' today' : '') + '" style="--c:' + s.color +
          '" data-a="cell" data-date="' + dd + '" data-scope="' + s.id + '" aria-label="' + s.name + ' ' + dd + '">' + (on ? '✓' : '') + '</button>';
      }
      var rk = C.streak(D, s.id, td);
      h += '<span class="tot' + (rk ? '' : ' z') + '" style="--c:' + s.color + '" title="Racha: ' + rk + ' días seguidos">' + rk + '</span>';
    });
    return h + '</div></div>';
  }

  function viewHoy() {
    var td = C.today(), items = C.tasksOn(D, td), od = overdue();
    var pend = items.filter(function (x) { return !C.getState(x.t, x.d); }).length;
    setTop('Hoy', longDate(td) + (items.length ? ' · ' + pend + ' pendientes' : ''));
    var h = '';
    if (od.length) h += '<div class="sec">Atrasadas</div><div class="sg">' + list(od, true) + '</div>';
    var hv = vs('hoy');
    if (hv.g === 'none') h += '<div class="sec"><span>Tareas de hoy</span></div>';
    h += renderList('hoy', items, false, hv.hd && items.length ? 'No te quedan tareas pendientes hoy.' : 'No hay tareas para hoy.');
    h += '<div class="sec">Registro de cumplimiento</div>' + weekGrid();
    h += '<div class="note">Toca una casilla para marcar si cumpliste el objetivo del día en ese ámbito. Es independiente de las tareas.</div>' +
      '<div class="note">Mantén pulsada una tarea y arrástrala para ordenarla dentro de su día. Lo que muevas manda; lo que no muevas se ordena solo (prioridad y ámbito).</div>';
    return h;
  }

  function tabsBuzon() {
    var ni = (D.ideas || []).length, nt = D.tasks.filter(function (t) { return !t.deleted && !t.date && !C.getState(t); }).length;
    return '<div class="seg"><button class="' + (ui.inbTab !== 'obj' ? 'on' : '') + '" data-a="inbtab" data-v="tareas">Tareas · ' + nt + '</button>' +
      '<button class="' + (ui.inbTab === 'obj' ? 'on' : '') + '" data-a="inbtab" data-v="obj">Objetivos · ' + ni + '</button></div>';
  }
  // Carpetas y subcategorías plegables; lo que abres o cierras se recuerda en este dispositivo
  var INBK = 'seguimiento.buzon';
  var inbOpen = (function () { try { return JSON.parse(localStorage.getItem(INBK)) || {}; } catch (e) { return {}; } })();
  function isOpen(key, def) { return inbOpen[key] == null ? def : !!inbOpen[key]; }
  function setOpen(key, on) { inbOpen[key] = on; try { localStorage.setItem(INBK, JSON.stringify(inbOpen)); } catch (e) {} }
  var IC_FOLDER = '<svg class="gico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  function folder(s, n, key, body, addAttrs) {
    var open = isOpen(key, n > 0);
    return '<div class="grp' + (open ? '' : ' shut') + '" style="--c:' + s.color + '"><div class="gh" data-a="grp" data-s="' + key + '" data-def="' + (n > 0 ? 1 : 0) + '">' + IC_FOLDER + '<b>' + esc(s.name) + '</b><span class="gn">' + n + '</span>' +
      (addAttrs ? '<button class="gadd" data-a="sbadd" ' + addAttrs + ' aria-label="Añadir aquí">＋</button>' : '') +
      '<span class="gch">⌄</span></div>' + (open ? '<div class="gbody">' + body + '</div>' : '') + '</div>';
  }
  function subBlock(scope, sub, items, row) {
    var key = 's:' + (sub ? sub.id : scope + ':none'), open = isOpen(key, items.length > 0);
    return '<div class="sbk' + (open ? '' : ' shut') + '"><div class="sbh" data-a="grp" data-s="' + key + '" data-def="' + (items.length ? 1 : 0) + '"><span class="gch">⌄</span>' +
      '<span class="sbn">' + esc(sub ? sub.name : 'Sin subcategoría') + (sub && sub.archived ? ' (archivada)' : '') + '</span><span class="sbc">' + items.length + '</span>' +
      '<button class="sbadd" data-a="sbadd" data-scope="' + scope + '" data-sub="' + (sub ? esc(sub.id) : '') + '" aria-label="Añadir tarea aquí">＋</button></div>' +
      (open ? '<div class="sbb">' + (items.length ? '<div class="sg">' + items.map(row).join('') + '</div>' : '<div class="sbe">Sin tareas. Pulsa ＋ para añadir una.</div>') + '</div>' : '') + '</div>';
  }
  // Buzón de objetivos: ideas sin fecha ni estado, agrupadas por ámbito, para convertirlas después en objetivos.
  function viewIdeas() {
    var ideas = D.ideas || [];
    setTop('Buzón', ideas.length === 1 ? '1 idea de objetivo' : ideas.length + ' ideas de objetivos');
    var h = tabsBuzon();
    if (!ideas.length) return h + '<div class="empty">Apunta aquí los objetivos que se te ocurran (pulsa +). Luego los conviertes en objetivo con sus fechas.</div>';
    C.SCOPES.forEach(function (s) {
      var arr = ideas.filter(function (x) { return x.scope === s.id; });
      if (!arr.length) return;
      h += folder(s, arr.length, 'i:' + s.id, arr.map(function (x) {
        return '<div class="idea" data-a="ideaedit" data-id="' + esc(x.id) + '"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg><span>' + esc(x.title) + '</span><span class="chev">›</span></div>';
      }).join(''));
    });
    return h;
  }
  function viewBuzon() {
    if (ui.inbTab === 'obj') return viewIdeas();
    var items = D.tasks.filter(function (t) { return !t.deleted && !t.date && !C.getState(t); })
      .map(function (t) { return { t: t, d: null }; });
    setTop('Buzón', items.length === 1 ? '1 tarea sin fecha' : items.length + ' tareas sin fecha');
    var h = tabsBuzon() + '<div class="note" style="margin:2px 4px 10px">Toca el calendario de una tarea para ponerla en un día.</div>';
    var sorted = sortList(items, vs('buzon').o), row = function (x) { return taskRow(x.t, null, false, true); };
    C.SCOPES.forEach(function (s) {
      var arr = sorted.filter(function (x) { return x.t.scope === s.id; }), subs = subsOf(s.id), body = '';
      var loose = arr.filter(function (x) { return !subById(x.t.sub) || subById(x.t.sub).scope !== s.id; });
      if (!subs.length) body = loose.length ? '<div class="sg">' + loose.map(row).join('') + '</div>' : '<div class="sbe">Sin tareas. Pulsa ＋ para añadir una.</div>';
      else {
        subs.forEach(function (sb) {
          var its = arr.filter(function (x) { return x.t.sub === sb.id; });
          if (sb.archived && !its.length) return;
          body += subBlock(s.id, sb, its, row);
        });
        if (loose.length) body += subBlock(s.id, null, loose, row);
      }
      h += folder(s, arr.length, 'a:' + s.id, body, 'data-scope="' + s.id + '" data-sub=""');
    });
    return h;
  }

  function viewProximos() {
    var td = C.today(), h = '';
    setTop('Próximos 7 días', 'Desde mañana');
    var v = vs('proximos'), all = [];
    for (var i = 1; i <= 7; i++) {
      var d = C.addDays(td, i), items = C.tasksOn(D, d);
      if (v.g === 'fecha') {
        var body = renderList('proximos', items, false, '', function () { return ''; });
        h += '<div class="sec"><span>' + longDate(d) + '</span>' + (items.length ? '<span class="sn">' + items.length + '</span>' : '') + '</div>' + (body || '<div class="note" style="margin:0 4px 6px">Sin tareas</div>');
      } else all = all.concat(items);
    }
    if (v.g !== 'fecha') h = renderList('proximos', all, true, 'No hay tareas en los próximos 7 días.');
    return h;
  }

  function viewTodo() {
    var items = allPending();
    setTop('Todo', items.length + ' pendientes');
    return renderList('todo', items, true, 'No hay tareas pendientes.', function (kk) { return kk ? (kk < C.today() ? 'Atrasada · ' : '') + longDate(kk) : 'Sin fecha'; });
  }

  /* Vista de un ámbito: TODAS sus tareas (con fecha, sin fecha, hechas…) con buscador y filtros. */
  function ambF() { ui.af = ui.af || { q: '', st: 'pend', fd: 'all', sub: '' }; return ui.af; }
  function plain(h) { var x = document.createElement('div'); x.innerHTML = h || ''; return x.textContent || ''; }
  function ambItems() {
    var f = ambF(), td = C.today(), q = f.q.trim().toLowerCase(), out = [];
    D.tasks.forEach(function (t) {
      if (t.deleted || t.scope !== ui.scope) return;
      if (f.sub && (f.sub === '-' ? subById(t.sub) : t.sub !== f.sub)) return;
      if (q && (t.title + ' ' + plain(t.notes)).toLowerCase().indexOf(q) < 0) return;
      var d = t.date || null, st = '';
      if (t.rec) { d = C.nextOccurrence(t, td) || t.date; }
      else st = C.getState(t) || '';
      if (f.fd === 'dated' && !d) return;
      if (f.fd === 'undated' && d) return;
      var done = !!st;
      if (f.st === 'pend' && done) return;
      if (f.st === 'done' && !done) return;
      out.push({ t: t, d: d, done: done });
    });
    return out;
  }
  function ambResults() {
    var items = ambItems(), td = C.today(), h = '';
    var late = [], next = [], none = [], done = [];
    items.forEach(function (x) { (x.done ? done : !x.d ? none : x.d < td ? late : next).push(x); });
    var byDate = function (a, b) { return a.d === b.d ? C.cmp(a, b) : a.d < b.d ? -1 : 1; };
    late.sort(byDate); next.sort(byDate); none = C.sortItems(none);
    var ao = vs('ambito').o;
    if (ao !== 'auto') { late = sortList(late, ao); next = sortList(next, ao); none = sortList(none, ao); }
    done.sort(function (a, b) { return (b.d || '') < (a.d || '') ? -1 : (b.d || '') > (a.d || '') ? 1 : 0; });
    var row = function (x) { return taskRow(x.t, x.d, true, false, false, true); };
    if (late.length) h += '<div class="sec">Atrasadas · ' + late.length + '</div>' + late.map(row).join('');
    if (next.length) h += '<div class="sec">Con fecha · ' + next.length + '</div>' + next.map(row).join('');
    if (none.length) h += '<div class="sec">Sin fecha · ' + none.length + '</div>' + none.map(row).join('');
    if (done.length) h += '<div class="sec">Hechas o descartadas · ' + done.length + '</div>' + done.map(row).join('');
    return h || '<div class="empty">' + (ambF().q ? 'No hay tareas que coincidan con «' + esc(ambF().q) + '».' : 'No hay tareas con estos filtros.') + '</div>';
  }
  function fchip(k, v, label, cur) { return '<button class="chip' + (cur === v ? ' on' : '') + '" data-a="af" data-k="' + k + '" data-v="' + esc(v) + '">' + label + '</button>'; }
  function viewAmbito() {
    var sc = C.scopeById(ui.scope), f = ambF(), subs = subsOf(ui.scope);
    var n = D.tasks.filter(function (t) { return !t.deleted && t.scope === ui.scope; }).length;
    setTop(sc.name, n === 1 ? '1 tarea en total' : n + ' tareas en total');
    var h = '<div class="chips" style="margin:4px 2px 10px">';
    C.SCOPES.forEach(function (s) {
      h += '<button class="chip sc ' + (s.id === ui.scope ? 'on' : '') + '" style="--c:' + s.color + '" data-a="scope" data-scope="' + s.id + '"><span class="sw"></span>' + s.name + '</button>';
    });
    h += '</div><input id="af-q" type="search" class="search" placeholder="Buscar en ' + esc(sc.name) + ' (título y notas)…" value="' + esc(f.q) + '" autocomplete="off">';
    h += '<div class="seg sm">' + [['pend', 'Pendientes'], ['done', 'Hechas'], ['all', 'Todas']].map(function (o) {
      return '<button class="' + (f.st === o[0] ? 'on' : '') + '" data-a="af" data-k="st" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="chips fl">' + fchip('fd', 'all', 'Con y sin fecha', f.fd) + fchip('fd', 'dated', 'Con fecha', f.fd) + fchip('fd', 'undated', 'Sin fecha', f.fd) + '</div>';
    h += '<div class="chips fl">' + fchip('sub', '', 'Todas las subcategorías', f.sub) + subs.map(function (x) { return fchip('sub', x.id, esc(x.name), f.sub); }).join('') +
      (subs.length ? fchip('sub', '-', 'Sin subcategoría', f.sub) : '') + '<button class="chip" data-a="subman">✎ Editar subcategorías</button></div>';
    return h + '<div id="amb-res">' + ambResults() + '</div>';
  }

  function hasTasks(d) { return D.tasks.some(function (t) { return !t.deleted && !t.rec && C.occursOn(t, d); }); }
  function dayCell(d, month) {
    var cls = 'day' + (d === C.today() ? ' today' : '') + (d === ui.calSel ? ' sel' : '') + (hasTasks(d) ? ' has' : '') +
      (month && d.slice(0, 7) !== month ? ' out' : '');
    return '<button class="' + cls + '" data-a="calsel" data-date="' + d + '">' + C.parse(d).getDate() + '<span class="dot"></span></button>';
  }
  function calMove(n) {
    if (ui.calOpen) {
      var p = ui.calMonth.split('-'), m = new Date(+p[0], +p[1] - 1 + n, 1);
      ui.calMonth = C.fmt(m).slice(0, 7);
      var day = Math.min(C.parse(ui.calSel).getDate(), C.dim(m.getFullYear(), m.getMonth() + 1));
      ui.calSel = ui.calMonth + '-' + C.pad(day);
    } else { ui.calSel = C.addDays(ui.calSel, 7 * n); ui.calMonth = ui.calSel.slice(0, 7); }
    render();
  }
  function viewCal() {
    var sel = ui.calSel, h = '', dh = '';
    DL.forEach(function (l) { dh += '<div class="wd">' + l + '</div>'; });
    if (ui.calOpen) {
      var first = ui.calMonth + '-01', p = first.split('-');
      var start = C.mondayOf(first), cells = '';
      for (var i = 0; i < 42; i++) { var d = C.addDays(start, i); if (i >= 35 && d.slice(0, 7) !== ui.calMonth) break; cells += dayCell(d, ui.calMonth); }
      h += '<div class="calswipe"><div class="calhead"><button class="ar" data-a="calmove" data-n="-1" aria-label="Anterior">‹</button><button class="name" data-a="caltoggle">' +
        MESES[+p[1] - 1] + ' ' + p[0] + ' ▴</button><button class="ar" data-a="calmove" data-n="1" aria-label="Siguiente">›</button></div>' +
        '<div class="calgrid">' + dh + cells + '</div></div>';
    } else {
      var mon = C.mondayOf(sel), cs = '';
      for (var j = 0; j < 7; j++) cs += dayCell(C.addDays(mon, j), null);
      var sd = C.parse(sel);
      h += '<div class="calswipe"><div class="calhead"><button class="ar" data-a="calmove" data-n="-1" aria-label="Anterior">‹</button><button class="name" data-a="caltoggle">' +
        MESES[sd.getMonth()] + ' ' + sd.getFullYear() + ' ▾</button><button class="ar" data-a="calmove" data-n="1" aria-label="Siguiente">›</button></div>' +
        '<div class="calgrid">' + dh + cs + '</div></div>';
    }
    setTop('Calendario', longDate(sel));
    var mode = D.meta.calMode === 'dia' ? 'dia' : 'lista';
    h += '<div class="seg"><button class="' + (mode === 'lista' ? 'on' : '') + '" data-a="calmode" data-v="lista">Lista</button>' +
      '<button class="' + (mode === 'dia' ? 'on' : '') + '" data-a="calmode" data-v="dia">Día por horas</button></div>';
    if (mode === 'lista') {
      var all = C.tasksOn(D, sel), once = all.filter(function (x) { return !x.t.rec; }), nrec = all.length - once.length;
      return h + '<div class="sec">' + longDate(sel) + '</div><div class="sg">' + list(once, false, 'Nada apuntado este día.') + '</div>' +
        (nrec ? '<div class="note" style="text-align:center;margin-top:8px">' + (nrec === 1 ? '1 tarea que se repite' : nrec + ' tareas que se repiten') + ' no se muestra' + (nrec === 1 ? '' : 'n') + ' aquí (sí en «Día por horas» y en «Hoy»).</div>' : '');
    }
    return h + timeline(sel);
  }

  /* Vista de día por horas */
  var HH = 56; // altura de una hora en píxeles
  function fgFor(hex) { // texto oscuro sobre colores claros (amarillo, verde), blanco sobre el resto
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111114' : '#ffffff';
  }
  function mins(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function timeline(sel) {
    var items = C.tasksOn(D, sel);
    var untimed = items.filter(function (x) { return !x.t.time; });
    var gAll = gOn(sel).filter(function (ev) { return ev.allDay; });
    var gTimed = gOn(sel).filter(function (ev) { return !ev.allDay; });
    var evs = items.filter(function (x) { return x.t.time; }).map(function (x) {
      var s = mins(x.t.time), e = x.t.end ? mins(x.t.end) : s + 30;
      if (e <= s) e = s + 30;
      return { x: x, s: s, e: Math.min(e, 1440) };
    });
    gTimed.forEach(function (ev) { var m = gMins(ev, sel); evs.push({ g: ev, s: m[0], e: m[1] }); });
    evs.sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    // reparto en columnas para lo que se solapa: los eventos del calendario (bloques grandes) a la izquierda,
    // por orden de calendario y la universidad la última de ellos; las tareas SIEMPRE a la derecha
    function lanes(list) {
      var ends = [];
      list.forEach(function (ev) {
        var c = 0; while (c < ends.length && ends[c] > ev.s) c++;
        ends[c] = ev.e; ev.c = c;
      });
      return ends.length;
    }
    var cluster = [], clEnd = 0;
    function flush() {
      if (!cluster.length) return;
      var gs = cluster.filter(function (ev) { return ev.g; }), ts = cluster.filter(function (ev) { return !ev.g; });
      var ng = lanes(gs), nt = lanes(ts);
      if (ng) { // columnas de Google en orden fijo por calendario
        var cr = [];
        for (var q = 0; q < ng; q++) cr.push({ c: q, r: 99999 });
        gs.forEach(function (ev) { var r = ev.g.calName === 'Universidad' ? 1000 : ev.g.cal; if (r < cr[ev.c].r) cr[ev.c].r = r; });
        var map = {};
        cr.slice().sort(function (p, o) { return p.r - o.r || p.c - o.c; }).forEach(function (o, i) { map[o.c] = i; });
        gs.forEach(function (ev) { ev.c = map[ev.c]; });
      }
      ts.forEach(function (ev) { ev.c += ng; });
      cluster.forEach(function (ev) { ev.n = ng + nt; });
      cluster = [];
    }
    evs.forEach(function (ev) {
      if (cluster.length && ev.s >= clEnd) flush();
      clEnd = cluster.length ? Math.max(clEnd, ev.e) : ev.e;
      cluster.push(ev);
    });
    flush();
    var h = '';
    if (gAll.length) h += '<div class="sec">Todo el día</div>' + gAll.map(function (ev) { return gRow(ev, sel); }).join('');
    if (untimed.length) h += '<div class="sec">Sin hora</div>' + list(untimed, false);
    h += '<div class="sec">' + longDate(sel) + '</div><div class="tl" id="tl" style="height:' + (24 * HH) + 'px">';
    for (var i = 0; i < 24; i++) {
      h += '<div class="hl" style="top:' + (i * HH) + 'px;height:' + HH + 'px" data-a="slot" data-h="' + i + '"><span>' + C.pad(i) + ':00</span></div>';
    }
    evs.forEach(function (ev) {
      if (ev.g) {
        var gtop = ev.s / 60 * HH, ght = Math.max((ev.e - ev.s) / 60 * HH - 2, 28);
        h += '<div class="ev gcal" style="--c:' + gcol(ev.g) + ';--fg:#ffffff;text-shadow:0 1px 2px rgba(0,0,0,.55);top:' + gtop + 'px;height:' + ght + 'px;left:calc(54px + (100% - 58px) * ' + ev.c + ' / ' + ev.n +
          ');width:calc((100% - 58px) / ' + ev.n + ' - 3px)"><div class="evb"><div class="evt">' + esc(ev.g.title) + '</div><div class="evm">' + hm(ev.s) + '–' + hm(ev.e) + (ev.g.location ? ' · ' + esc(ev.g.location) : '') + '</div></div></div>';
        return;
      }
      var t = ev.x.t, sc = C.scopeById(t.scope), st = C.getState(t, sel);
      var top = ev.s / 60 * HH, ht = Math.max((ev.e - ev.s) / 60 * HH - 2, 28);
      h += '<div class="ev ' + esc(st || '') + (ev.e - ev.s <= 30 ? ' short' : '') + '" data-tl="' + esc(t.id) + '" style="--c:' + sc.color + ';--fg:' + fgFor(sc.color) + ';top:' + top + 'px;height:' + ht + 'px;left:calc(54px + (100% - 58px) * ' + ev.c + ' / ' + ev.n +
        ');width:calc((100% - 58px) / ' + ev.n + ' - 3px)"><button class="evchk" data-a="toggle" data-id="' + esc(t.id) + '" data-date="' + sel + '" aria-label="Completar">' +
        (st === 'done' ? '✓' : st === 'wontdo' ? '✕' : '') + '</button><div class="evb" data-a="edit" data-id="' + esc(t.id) + '" data-date="' + sel + '"><div class="evt">' + esc(t.title) +
        '</div><div class="evm">' + esc(t.time + (t.end ? '–' + t.end : '')) + '</div></div></div>';
    });
    if (sel === C.today()) {
      var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
      h += '<div class="now" style="top:' + (nm / 60 * HH) + 'px"></div>';
    }
    ui.tlFocus = evs.length ? evs[0].s : (sel === C.today() ? new Date().getHours() * 60 : 7 * 60);
    return h + '</div>';
  }

  function qName(q) { return q.slice(6) + 'º trimestre ' + q.slice(0, 4); }
  function shortDate(s) {
    var d = C.parse(s);
    return d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }
  function goalCount(end, td) {
    if (!end) return '';
    var n = C.diffDays(td, end);
    if (n < 0) return '<span class="cd late">Venció hace ' + (-n) + (n === -1 ? ' día' : ' días') + '</span>';
    if (n === 0) return '<span class="cd soon">Hoy</span>';
    if (n === 1) return '<span class="cd soon">Mañana</span>';
    return '<span class="cd' + (n <= 7 ? ' soon' : '') + '">' + n + ' días</span>';
  }
  function goalRow(g, td) {
    var s = C.scopeById(g.scope), end = C.goalEnd(g), start = C.goalStart(g);
    var st = C.GOAL_STATES.filter(function (x) { return x.id === g.status; })[0] || C.GOAL_STATES[0];
    var meta = s.name + (end ? ' · hasta el ' + shortDate(end) : ' · sin fecha límite') + (start && start > td ? ' · empieza el ' + shortDate(start) : '');
    return '<div class="goal ' + esc(g.status) + '" style="--c:' + s.color + '"><span class="bar"></span><div class="t" data-a="goaledit" data-id="' + esc(g.id) + '"><span class="tt">' +
      esc(g.title) + '</span><div class="m">' + esc(meta) + '</div></div>' + (g.status === 'cumplido' ? '' : goalCount(end, td)) +
      '<button class="pill ' + esc(g.status) + '" data-a="goalcycle" data-id="' + esc(g.id) + '">' + st.name + '</button></div>';
  }
  function quarterCard(td) {
    var q = ui.quarter, st = C.quarterStats(D, q, td);
    var h = '<div class="card"><div class="calhead" style="margin:0 0 6px"><button class="ar" data-a="qmove" data-n="-1" aria-label="Trimestre anterior">‹</button><span class="name">' + qName(q) +
      (q === C.quarterOf(td) ? ' (actual)' : '') + '</span><button class="ar" data-a="qmove" data-n="1" aria-label="Trimestre siguiente">›</button></div>';
    if (!st.days) return h + '<div class="note" style="text-align:center;margin:4px 0 10px">Aún no hay días registrados en este trimestre.</div></div>';
    C.SCOPES.forEach(function (s) {
      var n = st.scopes[s.id], p = Math.round(100 * n / st.days);
      h += '<div class="qrow" style="--c:' + s.color + '"><span class="qn"><i></i>' + s.name + '</span><span class="qbar"><b style="width:' + p + '%"></b></span><span class="qp">' + p + ' %<small>' + n + '/' + st.days + '</small></span></div>';
    });
    var hasta = st.to === td ? 'hoy' : 'el ' + shortDate(st.to);
    return h + '<div class="note">' + (st.from > st.qs ? 'Cuenta desde tu primer día registrado, el ' + shortDate(st.from) + ', hasta ' + hasta : 'Del ' + shortDate(st.from) + ' hasta ' + hasta) +
      '. Sale del registro diario de «Hoy».</div></div>';
  }
  function viewObj() {
    var td = C.today();
    var act = D.goals.filter(function (g) { return g.status !== 'cumplido'; });
    var done = D.goals.filter(function (g) { return g.status === 'cumplido'; });
    var k1 = function (g) { return C.goalEnd(g) || '9999-99-99'; }, k2 = function (g) { return C.goalEnd(g) || '0000-00-00'; };
    act.sort(function (a, b) { return k1(a) < k1(b) ? -1 : k1(a) > k1(b) ? 1 : a.title.localeCompare(b.title, 'es'); });
    done.sort(function (a, b) { return k2(a) < k2(b) ? 1 : k2(a) > k2(b) ? -1 : 0; });
    setTop('Objetivos', act.length === 1 ? '1 objetivo activo' : act.length + ' objetivos activos');
    var ni = (D.ideas || []).length;
    var h = '<button class="linkrow" data-a="dnav" data-view="buzon" data-tab="obj"><span>Buzón de objetivos</span><span class="mv">' + (ni === 1 ? '1 idea' : ni + ' ideas') + ' ›</span></button>';
    h += '<div class="sec">Activos</div>';
    h += act.length ? act.map(function (g) { return goalRow(g, td); }).join('') : '<div class="empty">No hay objetivos activos. Pulsa + para añadir uno.</div>';
    if (done.length) h += '<div class="sec">Cumplidos</div>' + done.map(function (g) { return goalRow(g, td); }).join('');
    return h + '<div class="sec">Cumplimiento del trimestre</div>' + quarterCard(td);
  }

  function viewPapelera() {
    var items = D.tasks.filter(function (t) { return t.deleted; });
    setTop('Papelera', items.length + ' tareas');
    if (!items.length) return '<div class="empty">La papelera está vacía.</div>';
    var h = '';
    items.forEach(function (t) {
      var sc = C.scopeById(t.scope);
      h += '<div class="card" style="border-left:5px solid ' + sc.color + '"><div>' + esc(t.title) + '</div><div class="note" style="margin:2px 0 10px">' +
        sc.name + (t.date ? ' · ' + shortDate(t.date) : '') + '</div><div class="row"><button class="btn" data-a="restore" data-id="' + esc(t.id) +
        '">Recuperar</button><button class="btn danger" data-a="purge" data-id="' + esc(t.id) + '">Borrar para siempre</button></div></div>';
    });
    return h + '<button class="btn danger block" data-a="emptytrash">Vaciar papelera</button>';
  }

  /* ---------- Más: listas, cuenta, calendarios y avisos, copia de seguridad ---------- */
  var MI = {
    next: 'M5 12h14M13 6l6 6-6 6', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    cal: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5', sync: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5', bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
    down: 'M12 4v11M7 10l5 5 5-5M5 20h14', up: 'M12 15V4M7 9l5-5 5 5M5 20h14', out: 'M10 5H5v14h5M15 8l4 4-4 4M19 12H9', cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z'
  };
  // Una fila de «Más»: icono de color, título, texto pequeño opcional, valor y flecha (o interruptor).
  function mrow(o) {
    var d = o.view ? ' data-view="' + o.view + '"' : '', sw = o.tog != null ? ' role="switch" aria-checked="' + !!o.tog + '"' : '';
    return '<button class="mr' + (o.danger ? ' danger' : '') + '" data-a="' + o.a + '"' + d + sw + '><span class="mic" style="--c:' + (o.c || '#8d8d96') + '"><svg class="i" viewBox="0 0 24 24"><path d="' + MI[o.i] + '"/></svg></span>' +
      '<span class="mt"><b>' + o.t + '</b>' + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</span>' + (o.val != null ? '<span class="mv">' + o.val + '</span>' : '') +
      (o.tog != null ? '<span class="tog' + (o.tog ? ' on' : '') + '"><i></i></span>' : o.danger || o.act ? '' : '<span class="chev">›</span>') + '</button>';
  }
  function syncTone(t) { return /No se pudo|caducó/.test(t) ? 'err' : /Sin conexión|pendientes|Pendiente|Sincronizando/.test(t) ? 'wait' : 'ok'; }
  function profileCard() {
    var s = Sync.info();
    if (!s.email) {
      return '<div class="card prof col"><div class="prof"><span class="av">' + '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="' + MI.cloud + '"/></svg></span><div class="who"><b>Sin cuenta</b>' +
        '<div class="stt wait"><i></i>Solo en este dispositivo</div></div></div><div class="note" style="margin:12px 0">Inicia sesión para guardar tus datos en la nube y verlos igual en el móvil y en el ordenador.</div>' +
        '<button class="btn primary block" data-a="login" style="margin:0">Iniciar sesión</button></div>';
    }
    return '<div class="card prof"><span class="av">' + esc(s.email.charAt(0)) + '</span><div class="who"><b>' + esc(s.email) + '</b><div class="stt ' + syncTone(s.text) + '"><i></i>' + esc(s.text) + '</div></div>' +
      '<button class="ibtn" data-a="syncnow" aria-label="Sincronizar ahora"><svg class="i" viewBox="0 0 24 24"><path d="' + MI.sync + '"/></svg></button></div>';
  }
  function viewMas() {
    setTop('Ajustes', '');
    var email = !!(window.Sync && Sync.info().email);
    var h = (window.Sync ? profileCard() : '');
    if (email) {
      var gev = G.err ? esc(G.err) : G.at ? G.events.length + ' eventos · ' + hm(new Date(G.at).getHours() * 60 + new Date(G.at).getMinutes()) : 'Pendiente de cargar';
      h += '<div class="sec">Calendarios y avisos</div><div class="card set">' +
        mrow({ a: 'cals', i: 'cal', c: '#a56bff', t: 'Calendarios', sub: 'Solo lectura, en «Día por horas»', val: calUrls().length + (D.meta.uniUrl ? 1 : 0) }) +
        mrow({ a: 'gcalnow', act: 1, i: 'sync', c: '#4a9bff', t: 'Actualizar eventos', sub: gev + (G.warn && G.warn.length ? ' · ' + esc(G.warn.join(' · ')) : '') }) +
        mrow({ a: D.meta.avisosOn ? 'avisosoff' : 'avisoson', i: 'bell', c: '#ff7a21', t: 'Avisos', sub: 'Los que elijas en cada tarea', tog: !!D.meta.avisosOn }) +
        (D.meta.avisosOn ? '<label class="mr"><span class="mic" style="--c:#ff7a21"><svg class="i" viewBox="0 0 24 24"><path d="' + MI.bell + '"/></svg></span><span class="mt"><b>Hora para tareas sin hora</b><small>A qué hora llegan sus avisos</small></span>' +
          '<input type="time" id="s-remhour" class="mtime" value="' + remHour() + '"></label>' : '') + '</div>';
    }
    h += '<div class="sec">Copia de seguridad</div><div class="card set">' +
      mrow({ a: 'export', act: 1, i: 'down', c: '#34c759', t: 'Exportar copia', sub: D.meta.lastBackup ? 'Última copia: ' + longDate(D.meta.lastBackup) : 'Aún no has hecho ninguna copia' }) +
      mrow({ a: 'import', act: 1, i: 'up', c: '#4a9bff', t: 'Importar copia', sub: 'Sustituye los datos actuales' }) + '</div>' +
      '<div class="mnote">Tus datos se guardan en este dispositivo y, si has iniciado sesión, también en la nube. Aun así, haz copias de vez en cuando y guárdalas en Archivos o iCloud.</div>';
    if (email) h += '<div class="card set" style="margin-top:16px">' + mrow({ a: 'logout', i: 'out', c: '#ff6b6b', t: 'Cerrar sesión', danger: true }) + '</div>';
    return h + '<div class="ver">Versión 28</div>';
  }

  /* ---------- Calendarios: nuevo, cambiar enlace, quitar y colores, todo en un sitio ---------- */
  function calUrls() { return String(D.meta.gUrls || '').split(' ').filter(Boolean); }
  function calLabel(u) {
    var m = u.match(/ical\/([^/]+)\//);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    var h = u.match(/^https:\/\/([^/]+)/i); return h ? h[1] : u;
  }
  function openCals() {
    var us = calUrls();
    var h = '<h2>Calendarios</h2>' +
      '<button class="btn primary block" data-a="calnew" style="margin-bottom:12px">＋ Nuevo calendario</button>' +
      '<div class="note" style="margin:0 0 10px">Los calendarios son solo de lectura: se ven en Calendario > «Día por horas». Cada enlace es el «enlace secreto en formato iCal» de Google Calendar (o el del horario de la universidad).</div>';
    us.forEach(function (u, i) {
      h += '<div class="card"><div>Calendario de Google ' + (i + 1) + '</div><div class="note" style="margin:2px 0 10px">' + esc(calLabel(u)) + '</div>' +
        '<div class="row"><button class="btn" data-a="calchg" data-id="' + i + '">Cambiar enlace</button><button class="btn danger" data-a="caldel" data-id="' + i + '">Quitar</button></div></div>';
    });
    if (D.meta.uniUrl) {
      h += '<div class="card"><div>Horario de la universidad</div><div class="note" style="margin:2px 0 10px">' + esc(calLabel(D.meta.uniUrl)) + '</div>' +
        '<div class="row"><button class="btn" data-a="calchg" data-id="uni">Cambiar enlace</button><button class="btn danger" data-a="caldel" data-id="uni">Quitar</button></div></div>';
    }
    if (!us.length && !D.meta.uniUrl) h += '<div class="empty" style="padding:14px 10px">Aún no hay calendarios. Pulsa «Nuevo calendario».</div>';
    h += '<div class="card">' + (gColorRows() || '<div class="note" style="margin:0">Cuando se carguen los eventos, aquí podrás elegir el color de cada calendario.</div>') + '</div>';
    h += '<div class="actions"><button class="btn" data-a="gcalnow">Actualizar ahora</button><button class="btn" data-a="close">Cerrar</button></div>';
    openSheet(h);
  }
  function calSave() { save(); G.fail = 0; ensureG(true); render(); openCals(); }
  function calAction(a, id) {
    var us = calUrls();
    if (a === 'calnew') {
      var nv = prompt('Pega el enlace secreto iCal del calendario nuevo (si es el horario de la universidad, también vale):', '');
      if (nv === null) return;
      nv = nv.trim();
      if (!nv) return;
      if (!/^https:\/\/\S+$/i.test(nv)) { alert('El enlace debe empezar por https:// y no llevar espacios'); return; }
      if (/^https:\/\/app\.ual\.es\//i.test(nv)) {
        if (D.meta.uniUrl && !confirm('Ya hay un horario de la universidad. ¿Lo cambias por este?')) return;
        D.meta.uniUrl = nv;
      } else if (us.indexOf(nv) < 0) { us.push(nv); D.meta.gUrls = us.join(' '); }
      calSave();
    } else if (a === 'calchg') {
      var cur = id === 'uni' ? D.meta.uniUrl : us[+id];
      var cv = prompt('Pega el enlace nuevo de este calendario:', cur || '');
      if (cv === null) return;
      cv = cv.trim();
      if (!/^https:\/\/\S+$/i.test(cv)) { alert('El enlace debe empezar por https:// y no llevar espacios'); return; }
      if (id === 'uni') D.meta.uniUrl = cv; else { us[+id] = cv; D.meta.gUrls = us.join(' '); }
      calSave();
    } else if (a === 'caldel') {
      if (!confirm('¿Quitar este calendario de la app? (No se borra nada en Google.)')) return;
      if (id === 'uni') D.meta.uniUrl = ''; else { us.splice(+id, 1); D.meta.gUrls = us.join(' '); }
      calSave();
    }
  }
  function openLogin() {
    openSheet('<h2>Iniciar sesión</h2>' +
      '<input id="l-mail" type="email" placeholder="Correo" autocomplete="username" autocapitalize="none" autocorrect="off">' +
      '<input id="l-pass" type="password" placeholder="Contraseña" autocomplete="current-password" style="margin-top:10px">' +
      '<div class="note" id="l-msg"></div>' +
      '<div class="actions"><button class="btn primary" data-a="dologin">Entrar</button><button class="btn" data-a="close">Cancelar</button></div>');
  }

  /* ---------- Menú lateral (botón arriba a la izquierda) ---------- */
  function drow(o) {
    var on = o.on ? ' on' : '';
    return '<button class="dr' + on + '" data-a="dnav" data-view="' + o.v + '"' + (o.s ? ' data-scope="' + o.s + '"' : '') + (o.tab ? ' data-tab="' + o.tab + '"' : '') + '>' +
      (o.c ? '<i class="ddot" style="background:' + o.c + '"></i>' : '<svg class="i" viewBox="0 0 24 24"><path d="' + o.i + '"/></svg>') +
      '<span>' + o.t + '</span>' + (o.n ? '<span class="dn">' + o.n + '</span>' : '') + '</button>';
  }
  function openDrawer() {
    var td = C.today(), v = ui.view;
    var pendHoy = C.tasksOn(D, td).filter(function (x) { return !C.getState(x.t, x.d); }).length;
    var inb = D.tasks.filter(function (t) { return !t.deleted && !t.date && !C.getState(t); }).length, ideas = (D.ideas || []).length;
    var bin = D.tasks.filter(function (t) { return t.deleted; }).length;
    var h = '<div class="dov" data-a="dclose"></div><div class="dpanel"><div class="dtitle">Seguimiento</div>' +
      drow({ v: 'hoy', i: 'M5 12l5 5 9-10', t: 'Hoy', n: pendHoy, on: v === 'hoy' }) +
      drow({ v: 'calendario', i: MI.cal, t: 'Calendario', on: v === 'calendario' }) +
      drow({ v: 'enfoque', i: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M10 2h4', t: 'Enfoque', on: v === 'enfoque' }) +
      drow({ v: 'objetivos', i: 'M12 4a8 8 0 1 0 .01 0M12 9a3 3 0 1 0 .01 0', t: 'Objetivos', on: v === 'objetivos' }) +
      drow({ v: 'buzon', i: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5', t: 'Buzón', n: inb + ideas, on: v === 'buzon' }) +
      '<div class="dsec">Ámbitos</div>';
    C.SCOPES.forEach(function (s) {
      var n = D.tasks.filter(function (t) { return !t.deleted && t.scope === s.id && (t.rec || !C.getState(t)); }).length;
      h += drow({ v: 'ambito', s: s.id, c: s.color, t: s.name, n: n, on: v === 'ambito' && ui.scope === s.id });
    });
    h += '<div class="dsec">Listas</div>' +
      drow({ v: 'proximos', i: MI.next, t: 'Próximos 7 días', on: v === 'proximos' }) +
      drow({ v: 'todo', i: MI.list, t: 'Todo lo pendiente', n: allPending().length, on: v === 'todo' }) +
      drow({ v: 'papelera', i: MI.trash, t: 'Papelera', n: bin, on: v === 'papelera' }) +
      '<div class="dsep"></div>' +
      drow({ v: 'mas', i: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4', t: 'Ajustes', on: v === 'mas' }) +
      '<div class="dhint">Cuenta, calendarios, avisos y copia de seguridad</div></div>';
    var el = $('drawer'); el.innerHTML = h; el.classList.remove('hidden');
    requestAnimationFrame(function () { el.classList.add('open'); });
  }
  function closeDrawer() { var el = $('drawer'); el.classList.remove('open'); el.classList.add('hidden'); el.innerHTML = ''; }

  /* ---------- Enfoque: Pomodoro y cronómetro, con registro de tiempo ---------- */
  // D.focus = { s: [sesiones], run: temporizador en marcha, pomo: min, brk: min }
  // sesión: { id, st, en (ms), m (minutos de enfoque), task (id o null), scope (ámbito o null), mode: 'pomo'|'crono'|'manual' }
  // run: { mode: 'pomo'|'crono'|'break', st, pz (ms en que se pausó, 0 si corre), pt (ms en pausa), dur (min), task, scope }
  function FD() {
    if (!D.focus || typeof D.focus !== 'object') D.focus = {};
    var f = D.focus;
    if (!Array.isArray(f.s)) f.s = [];
    if (!f.pomo) f.pomo = 25;
    if (!f.brk) f.brk = 5;
    return f;
  }
  function fmtDur(m) {
    m = Math.round(m);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function fmtShort(m) { m = Math.round(m); if (m < 60) return m + "'"; var h = Math.floor(m / 60), r = m % 60; return h + 'h' + (r ? ' ' + C.pad(r) : ''); }
  function clock(ms) { var t = Math.max(0, Math.round(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + C.pad(m) : C.pad(m)) + ':' + C.pad(s); }
  function runElapsed(r) { return (r.pz || Date.now()) - r.st - r.pt; }
  function sessDay(x) { return C.fmt(new Date(x.st)); }
  function focusSel() { var f = FD(); return f.run ? { task: f.run.task, scope: f.run.scope } : (ui.fsel || { task: null, scope: null }); }
  function selLabel(sel) {
    var t = sel.task && findTask(sel.task);
    if (t) return { t: t.title, c: C.scopeById(t.scope).color };
    if (sel.scope) return { t: 'Sin tarea · ' + C.scopeById(sel.scope).name, c: C.scopeById(sel.scope).color };
    return { t: 'Sin tarea', c: '' };
  }
  function scopeOfSel(sel) { var t = sel.task && findTask(sel.task); return t ? t.scope : (sel.scope || null); }

  // Mantener la pantalla encendida mientras corre el temporizador (si el iPhone lo permite)
  var wakeLock = null;
  function wake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; w.addEventListener('release', function () { wakeLock = null; }); }, function () {});
      if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }
  function beep() {
    try {
      var A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      var ac = beep.ac || (beep.ac = new A());
      [0, 0.35, 0.7].forEach(function (d) {
        var o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.3);
        o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.32);
      });
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  }
  function addSession(st, en, m, task, scope, mode) {
    if (m < 1) return false;
    FD().s.push({ id: C.uid(), st: st, en: en, m: Math.round(m), task: task || null, scope: scope || null, mode: mode });
    return true;
  }
  function focusStart(mode) {
    var f = FD(), sel = focusSel();
    try { var A = window.AudioContext || window.webkitAudioContext; if (A && !beep.ac) beep.ac = new A(); } catch (e) {} // iOS: el sonido se desbloquea con un toque
    f.run = { mode: mode, st: Date.now(), pz: 0, pt: 0, dur: mode === 'break' ? f.brk : mode === 'pomo' ? f.pomo : 0, task: sel.task, scope: scopeOfSel(sel) };
    ui.fdone = null; save(); planAvisos(true); wake(true); render();
  }
  function focusPause() { var r = FD().run; if (!r || r.pz) return; r.pz = Date.now(); save(); planAvisos(true); render(); }
  function focusResume() { var r = FD().run; if (!r || !r.pz) return; r.pt += Date.now() - r.pz; r.pz = 0; save(); planAvisos(true); wake(true); render(); }
  // Terminar a mano: se guarda lo enfocado (si es al menos 1 minuto)
  function focusStop(discard) {
    var f = FD(), r = f.run; if (!r) return;
    var el = runElapsed(r), msg = '';
    if (r.mode !== 'break' && !discard) {
      if (addSession(r.st, r.st + r.pt + el, el / 60000, r.task, r.scope, r.mode)) msg = 'Guardado: ' + fmtDur(el / 60000) + ' de enfoque.';
      else msg = 'Menos de 1 minuto: no se ha guardado.';
    }
    ui.fsel = { task: r.task, scope: r.task ? null : r.scope };
    f.run = null; ui.fdone = msg ? { kind: 'msg', msg: msg } : null;
    save(); planAvisos(true); wake(false); render();
  }
  // Comprueba si el pomodoro o el descanso ya terminó (también al volver a la app después de un rato)
  function focusCheck(live) {
    var f = FD(), r = f.run;
    if (!r || r.pz || r.mode === 'crono') return false;
    var total = r.dur * 60000;
    if (runElapsed(r) < total) return false;
    if (r.mode === 'pomo') { addSession(r.st, r.st + r.pt + total, r.dur, r.task, r.scope, 'pomo'); ui.fdone = { kind: 'pomo', min: r.dur }; }
    else ui.fdone = { kind: 'break' };
    ui.fsel = { task: r.task, scope: r.task ? null : r.scope };
    f.run = null; save(); planAvisos(true); wake(false);
    if (live) beep();
    return true;
  }
  // Barra pequeña con el temporizador cuando estás en otra pantalla
  function drawFbar() {
    var r = D.focus && D.focus.run, el = $('fbar');
    document.body.classList.toggle('hasfbar', !!(r && ui.view !== 'enfoque'));
    if (!r || ui.view === 'enfoque') { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'fbar'; el.dataset.a = 'nav'; el.dataset.view = 'enfoque'; document.body.appendChild(el); }
    var sl = selLabel(r), left = r.mode === 'crono' ? runElapsed(r) : r.dur * 60000 - runElapsed(r);
    el.className = r.pz ? 'paused' : '';
    el.innerHTML = '<span class="fdot' + (r.mode === 'break' ? ' brk' : '') + '"></span><b data-ft>' + clock(left) + '</b><span class="fl">' + esc(r.mode === 'break' ? 'Descanso' : sl.t) + '</span><span class="chev">›</span>';
  }
  setInterval(function () {
    if (document.visibilityState !== 'visible' || !D.focus || !D.focus.run) return;
    if (focusCheck(true)) { render(); return; }
    var r = D.focus.run, left = r.mode === 'crono' ? runElapsed(r) : r.dur * 60000 - runElapsed(r);
    [].forEach.call(document.querySelectorAll('[data-ft]'), function (e) { e.textContent = clock(left); });
    var ring = $('fring');
    if (ring) ring.style.strokeDashoffset = ringOff(r);
  }, 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (focusCheck(false)) render();
    if (D.focus && D.focus.run && !D.focus.run.pz && ui.view === 'enfoque') wake(true);
  });
  var RING = 2 * Math.PI * 108;
  function ringOff(r) {
    if (!r) return 0;
    var p = r.mode === 'crono' ? (runElapsed(r) % 3600000) / 3600000 : Math.min(1, runElapsed(r) / (r.dur * 60000));
    return (RING * (1 - p)).toFixed(1);
  }

  function weekMins(mon) {
    var out = [0, 0, 0, 0, 0, 0, 0], end = C.addDays(mon, 7);
    FD().s.forEach(function (x) { var d = sessDay(x); if (d >= mon && d < end) out[C.diffDays(mon, d)] += x.m; });
    return out;
  }
  function sumBetween(a, b) { var n = 0; FD().s.forEach(function (x) { var d = sessDay(x); if (d >= a && d <= b) n += x.m; }); return n; }

  function viewFocus() {
    var f = FD(), r = f.run, td = C.today();
    focusCheck(false);
    r = f.run;
    var hoyM = sumBetween(td, td);
    setTop('Enfoque', hoyM ? 'Hoy llevas ' + fmtDur(hoyM) : 'Cronómetro y pomodoro');
    var mode = r ? (r.mode === 'break' ? 'pomo' : r.mode) : (ui.fmode || 'pomo');
    var sel = focusSel(), sl = selLabel(sel);
    var h = '<div class="card fcard">';
    // aviso de fin
    if (!r && ui.fdone) {
      var fd = ui.fdone;
      if (fd.kind === 'pomo') h += '<div class="fdone"><b>¡Pomodoro terminado!</b><span>' + fmtDur(fd.min) + ' guardados' + (sel.task ? ' en «' + esc(sl.t) + '»' : '') + '.</span>' +
        '<div class="row"><button class="btn primary" data-a="fstart" data-v="break">Descansar ' + f.brk + ' min</button><button class="btn" data-a="fstart" data-v="pomo">Otro pomodoro</button></div></div>';
      else if (fd.kind === 'break') h += '<div class="fdone"><b>Fin del descanso</b><span>¿Seguimos?</span><div class="row"><button class="btn primary" data-a="fstart" data-v="pomo">Empezar pomodoro</button><button class="btn" data-a="fdoneok">Ahora no</button></div></div>';
      else h += '<div class="fdone small"><span>' + esc(fd.msg) + '</span><button class="ibtn x" data-a="fdoneok" aria-label="Cerrar">✕</button></div>';
    }
    h += '<div class="seg fseg"><button class="' + (mode === 'pomo' ? 'on' : '') + '" data-a="fmode" data-v="pomo"' + (r ? ' disabled' : '') + '>Pomodoro</button>' +
      '<button class="' + (mode === 'crono' ? 'on' : '') + '" data-a="fmode" data-v="crono"' + (r ? ' disabled' : '') + '>Cronómetro</button></div>';
    // tarea elegida
    h += '<button class="fsel" data-a="fpick"><i class="sw" style="background:' + (sl.c || 'var(--muted)') + '"></i><span>' + esc(sl.t) + '</span><span class="ch">Cambiar ▾</span></button>';
    // anillo y tiempo
    var big = r ? (r.mode === 'crono' ? runElapsed(r) : r.dur * 60000 - runElapsed(r)) : (mode === 'pomo' ? f.pomo * 60000 : 0);
    var col = r && r.mode === 'break' ? '#34c759' : 'var(--accent)';
    h += '<div class="fring"><svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="108" class="rbg"/>' +
      '<circle id="fring" cx="120" cy="120" r="108" class="rfg" style="stroke:' + col + ';stroke-dasharray:' + RING.toFixed(1) + ';stroke-dashoffset:' + (r ? ringOff(r) : RING.toFixed(1)) + '"/></svg>' +
      '<div class="fin"><b data-ft>' + clock(big) + '</b><span>' + (r ? (r.pz ? 'En pausa' : r.mode === 'break' ? 'Descanso' : r.mode === 'pomo' ? 'Enfocado' : 'Cronómetro') : mode === 'pomo' ? 'Pomodoro' : 'Listo para empezar') + '</span></div></div>';
    if (!r && mode === 'pomo') {
      h += '<div class="chips fdur">' + [15, 25, 30, 45, 50, 60, 90].map(function (m) { return '<button class="chip ' + (f.pomo === m ? 'on' : '') + '" data-a="fpomo" data-v="' + m + '">' + m + ' min</button>'; }).join('') + '</div>' +
        '<div class="fbrk">Descanso: ' + [5, 10, 15].map(function (m) { return '<button class="' + (f.brk === m ? 'on' : '') + '" data-a="fbrk" data-v="' + m + '">' + m + ' min</button>'; }).join('') + '</div>';
    }
    if (!r) h += '<button class="btn primary block fgo" data-a="fstart" data-v="' + mode + '">▶ Empezar</button>';
    else h += '<div class="row fctl">' + (r.pz ? '<button class="btn primary" data-a="fresume">▶ Seguir</button>' : '<button class="btn" data-a="fpause">❚❚ Pausa</button>') +
      '<button class="btn ' + (r.mode === 'break' ? '' : 'primary') + '" data-a="fstop">' + (r.mode === 'break' ? 'Saltar descanso' : '■ Terminar y guardar') + '</button></div>' +
      (r.mode !== 'break' ? '<button class="fdisc" data-a="fdiscard">Descartar este tiempo</button>' : '');
    h += '</div>';
    return h + focusStats();
  }

  function focusStats() {
    var f = FD(), td = C.today(), mon = C.addDays(C.mondayOf(td), 7 * (ui.fWeek || 0)), day = ui.fDay || td;
    var hoy = sumBetween(td, td), sem = sumBetween(C.mondayOf(td), C.addDays(C.mondayOf(td), 6)), mes = sumBetween(td.slice(0, 7) + '-01', td.slice(0, 7) + '-31');
    var h = '<div class="sec">Tu registro</div><div class="ftiles">' +
      '<div><small>Hoy</small><b>' + fmtDur(hoy) + '</b></div><div><small>Esta semana</small><b>' + fmtDur(sem) + '</b></div><div><small>Este mes</small><b>' + fmtDur(mes) + '</b></div></div>';
    // barras de la semana
    var wm = weekMins(mon), max = Math.max.apply(null, wm.concat([60])), tot = wm.reduce(function (a, b) { return a + b; }, 0);
    var md = C.parse(mon), sd = C.parse(C.addDays(mon, 6));
    h += '<div class="card"><div class="calhead" style="margin:0 0 4px"><button class="ar" data-a="fweek" data-n="-1" aria-label="Semana anterior">‹</button><span class="name" style="font-size:15px;text-transform:none">' +
      (ui.fWeek ? md.getDate() + ' ' + MESES[md.getMonth()].slice(0, 3) + ' – ' + sd.getDate() + ' ' + MESES[sd.getMonth()].slice(0, 3) : 'Esta semana') + ' · ' + fmtDur(tot) + '</span>' +
      '<button class="ar" data-a="fweek" data-n="1" aria-label="Semana siguiente"' + ((ui.fWeek || 0) >= 0 ? ' disabled style="opacity:.3"' : '') + '>›</button></div><div class="fbars">';
    wm.forEach(function (m, i) {
      var d = C.addDays(mon, i);
      h += '<button class="fb' + (d === day ? ' sel' : '') + (d === td ? ' today' : '') + '" data-a="fday" data-date="' + d + '"><span class="fv">' + (m ? fmtShort(m) : '') + '</span>' +
        '<span class="fcol"><i style="height:' + (m ? Math.max(4, Math.round(100 * m / max)) : 0) + '%"></i></span><span class="fd">' + DL[i] + '</span></button>';
    });
    h += '</div><div class="note" style="text-align:center;margin:6px 0 2px">Toca un día para ver sus sesiones.</div></div>';
    // en qué se ha ido el tiempo
    var per = ui.fPer || 'semana', by = ui.fBy || 'tarea', a, b;
    if (per === 'semana') { a = mon; b = C.addDays(mon, 6); } else if (per === 'mes') { a = day.slice(0, 7) + '-01'; b = day.slice(0, 7) + '-31'; } else { a = '0000'; b = '9999'; }
    var groups = {}, all = 0;
    f.s.forEach(function (x) {
      var d = sessDay(x); if (d < a || d > b) return;
      var t = x.task && findTask(x.task), k, name, c;
      if (by === 'tarea') { k = t ? 't' + t.id : 'n' + (x.scope || ''); name = t ? t.title : 'Sin tarea' + (x.scope ? ' · ' + C.scopeById(x.scope).name : ''); c = t ? C.scopeById(t.scope).color : x.scope ? C.scopeById(x.scope).color : '#8d8d96'; }
      else { var sc = t ? t.scope : x.scope; k = sc || 'none'; name = sc ? C.scopeById(sc).name : 'Sin ámbito'; c = sc ? C.scopeById(sc).color : '#8d8d96'; }
      if (!groups[k]) groups[k] = { name: name, c: c, m: 0, n: 0 };
      groups[k].m += x.m; groups[k].n++; all += x.m;
    });
    var gl = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (p, q) { return q.m - p.m; });
    h += '<div class="sec">¿En qué lo has dedicado?</div><div class="card"><div class="seg sm"><button class="' + (per === 'semana' ? 'on' : '') + '" data-a="fper" data-v="semana">' + (ui.fWeek ? 'Esa semana' : 'Esta semana') + '</button>' +
      '<button class="' + (per === 'mes' ? 'on' : '') + '" data-a="fper" data-v="mes">' + MESES[+day.slice(5, 7) - 1].charAt(0).toUpperCase() + MESES[+day.slice(5, 7) - 1].slice(1) + '</button>' +
      '<button class="' + (per === 'todo' ? 'on' : '') + '" data-a="fper" data-v="todo">Siempre</button></div>' +
      '<div class="seg sm"><button class="' + (by === 'tarea' ? 'on' : '') + '" data-a="fby" data-v="tarea">Por tarea</button><button class="' + (by === 'ambito' ? 'on' : '') + '" data-a="fby" data-v="ambito">Por ámbito</button></div>';
    if (!gl.length) h += '<div class="note" style="text-align:center;margin:10px 0">Aún no hay tiempo de enfoque en este periodo.</div>';
    gl.forEach(function (g) {
      var p = Math.round(100 * g.m / all);
      h += '<div class="frow" style="--c:' + g.c + '"><div class="ft"><i></i><span>' + esc(g.name) + '</span><b>' + fmtDur(g.m) + '</b></div>' +
        '<div class="fl2"><span class="qbar"><b style="width:' + Math.max(p, 2) + '%"></b></span><small>' + p + ' % · ' + (g.n === 1 ? '1 sesión' : g.n + ' sesiones') + '</small></div></div>';
    });
    h += '</div>';
    // sesiones del día elegido
    var ses = f.s.filter(function (x) { return sessDay(x) === day; }).sort(function (p, q) { return p.st - q.st; });
    h += '<div class="sec">Sesiones · ' + (day === td ? 'hoy' : longDate(day)) + '</div><div class="card fses">';
    if (!ses.length) h += '<div class="note" style="margin:6px 0">Ninguna sesión este día.</div>';
    ses.forEach(function (x) {
      var t = x.task && findTask(x.task), s0 = new Date(x.st), s1 = new Date(x.en), c = t ? C.scopeById(t.scope).color : x.scope ? C.scopeById(x.scope).color : '#8d8d96';
      h += '<div class="fsr" style="--c:' + c + '"><i></i><div class="fst"><b>' + esc(t ? t.title : 'Sin tarea' + (x.scope ? ' · ' + C.scopeById(x.scope).name : '')) + '</b><small>' +
        hm(s0.getHours() * 60 + s0.getMinutes()) + '–' + hm(s1.getHours() * 60 + s1.getMinutes()) + (x.mode === 'manual' ? ' · añadida a mano' : x.mode === 'pomo' ? ' · pomodoro' : ' · cronómetro') + '</small></div>' +
        '<span class="fm">' + fmtDur(x.m) + '</span><button class="ibtn x" data-a="fdel" data-id="' + esc(x.id) + '" aria-label="Borrar sesión">✕</button></div>';
    });
    h += '<button class="btn block" data-a="fadd" style="margin:10px 0 2px">＋ Añadir tiempo a mano</button></div>';
    return h;
  }

  // Elegir la tarea (o solo un ámbito) para el enfoque
  function openFocusPick() {
    var td = C.today(), q = (ui.fq || '').toLowerCase(), sel = focusSel();
    var seen = {}, rows = [];
    function add(t, why) { if (seen[t.id] || t.deleted) return; seen[t.id] = 1; if (q && t.title.toLowerCase().indexOf(q) < 0) return; rows.push({ t: t, why: why }); }
    C.tasksOn(D, td).forEach(function (x) { if (!C.getState(x.t, x.d)) add(x.t, 'Hoy'); });
    for (var i = 1; i <= 7; i++) C.tasksOn(D, C.addDays(td, i)).forEach(function (x) { if (!C.getState(x.t, x.d)) add(x.t, 'Próximos días'); });
    D.tasks.forEach(function (t) { if (!t.date && !C.getState(t)) add(t, 'Sin fecha'); });
    if (q) D.tasks.forEach(function (t) { add(t, 'Otras'); });
    var h = '<h2>¿En qué te vas a enfocar?</h2><input id="fp-q" placeholder="Buscar tarea…" value="' + esc(ui.fq || '') + '" autocomplete="off">' +
      '<div class="lbl" style="margin-top:12px">Sin tarea (opcional: elige un ámbito)</div><div class="chips">' +
      '<button class="chip ' + (!sel.task && !sel.scope ? 'on' : '') + '" data-a="fpset" data-v="">Nada</button>' +
      C.SCOPES.map(function (s) { return '<button class="chip ' + (!sel.task && sel.scope === s.id ? 'on' : '') + '" data-a="fpset" data-v="s:' + s.id + '"><i class="sw" style="background:' + s.color + '"></i> ' + s.name + '</button>'; }).join('') + '</div>';
    var last = '';
    rows.slice(0, 80).forEach(function (o) {
      if (o.why !== last) { h += '<div class="lbl" style="margin-top:12px">' + o.why + '</div>'; last = o.why; }
      var sc = C.scopeById(o.t.scope);
      h += '<button class="fpick' + (sel.task === o.t.id ? ' on' : '') + '" data-a="fpset" data-v="t:' + esc(o.t.id) + '"><i class="sw" style="background:' + sc.color + '"></i><span>' + esc(o.t.title) + '</span><small>' + sc.name + '</small></button>';
    });
    if (!rows.length) h += '<div class="note" style="margin-top:12px">No hay tareas' + (q ? ' con ese nombre' : ' pendientes') + '.</div>';
    h += '<div class="actions"><button class="btn" data-a="close">Cerrar</button></div>';
    openSheet(h, 'tall');
  }
  function setFocusSel(v) {
    var f = FD(), sel = !v ? { task: null, scope: null } : v.slice(0, 2) === 't:' ? { task: v.slice(2), scope: null } : { task: null, scope: v.slice(2) };
    ui.fsel = sel;
    if (f.run) { f.run.task = sel.task; f.run.scope = scopeOfSel(sel); save(); planAvisos(true); }
    closeSheet(); ui.fq = ''; render();
  }
  function focusOfTask(id) { var n = 0; (D.focus && D.focus.s || []).forEach(function (x) { if (x.task === id) n += x.m; }); return n; }

  // Añadir tiempo a mano (por ejemplo, si estudiaste sin poner el cronómetro)
  function openFocusAdd() {
    var day = ui.fDay || C.today(), sel = focusSel();
    var opts = '<option value="">Sin tarea</option>', seen = {};
    function opt(t) { if (seen[t.id] || t.deleted) return; seen[t.id] = 1; opts += '<option value="t:' + esc(t.id) + '"' + (sel.task === t.id ? ' selected' : '') + '>' + esc(t.title) + '</option>'; }
    if (sel.task && findTask(sel.task)) opt(findTask(sel.task));
    C.tasksOn(D, day).forEach(function (x) { opt(x.t); });
    FD().s.slice(-40).reverse().forEach(function (x) { var t = x.task && findTask(x.task); if (t) opt(t); });
    D.tasks.forEach(function (t) { if (!C.getState(t) && !t.rec) opt(t); });
    openSheet('<h2>Añadir tiempo a mano</h2>' +
      '<div class="row"><div style="flex:1"><div class="lbl">Día</div><input type="date" id="fa-d" value="' + day + '"></div><div style="flex:1"><div class="lbl">Empezó a las</div><input type="time" id="fa-t" value="' + (new Date().getHours() < 1 ? '00:00' : C.pad(new Date().getHours() - 1) + ':00') + '"></div></div>' +
      '<div class="lbl" style="margin-top:10px">Duración (minutos)</div><input type="number" id="fa-m" min="1" max="720" value="30" inputmode="numeric">' +
      '<div class="lbl" style="margin-top:10px">Tarea</div><select id="fa-task">' + opts + '</select>' +
      '<div class="lbl" style="margin-top:10px">Ámbito (si no eliges tarea)</div><select id="fa-sc"><option value="">Ninguno</option>' + C.SCOPES.map(function (s) { return '<option value="' + s.id + '"' + (!sel.task && sel.scope === s.id ? ' selected' : '') + '>' + s.name + '</option>'; }).join('') + '</select>' +
      '<div class="note" id="fa-msg" style="color:#ff6b6b"></div>' +
      '<div class="actions"><button class="btn primary" data-a="faddgo">Añadir</button><button class="btn" data-a="close">Cancelar</button></div>');
  }
  function saveFocusAdd() {
    var d = $('fa-d').value, tm = $('fa-t').value || '00:00', m = parseInt($('fa-m').value, 10), tv = $('fa-task').value;
    if (!d) { $('fa-msg').textContent = 'Elige el día.'; return; }
    if (!(m >= 1 && m <= 720)) { $('fa-msg').textContent = 'La duración debe ser de 1 a 720 minutos.'; return; }
    var st = C.parse(d), p = tm.split(':'); st.setHours(+p[0], +p[1], 0, 0);
    var task = tv ? tv.slice(2) : null, t = task && findTask(task), scope = t ? t.scope : ($('fa-sc').value || null);
    addSession(st.getTime(), st.getTime() + m * 60000, m, task, scope, 'manual');
    ui.fDay = d; save(); closeSheet(); render();
  }

  var VIEWS = { enfoque: viewFocus, hoy: viewHoy, buzon: viewBuzon, proximos: viewProximos, todo: viewTodo, ambito: viewAmbito,
    calendario: viewCal, objetivos: viewObj, papelera: viewPapelera, mas: viewMas };
  var NAVMAP = {};

  function setTop(t, s) { $('title').textContent = t; $('subtitle').textContent = s || ''; }
  // Botones de arriba a la derecha: Agrupar y ordenar (en las listas) y acceso directo al Buzón
  var VS_VIEW = { hoy: 'hoy', proximos: 'proximos', todo: 'todo', buzon: 'buzon', ambito: 'ambito' };
  var IC_INBOX = '<svg viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/></svg>';
  var IC_SORT = '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
  function topActions() {
    var v = ui.view, h = '', k = VS_VIEW[v];
    if (k && !(v === 'buzon' && ui.inbTab === 'obj')) h += '<button class="tb" data-a="vsopen" data-v="' + k + '" aria-label="Agrupar y ordenar">' + IC_SORT + '</button>';
    if (v !== 'buzon' && v !== 'mas' && v !== 'papelera') {
      var n = D.tasks.filter(function (t) { return !t.deleted && !t.date && !C.getState(t); }).length;
      h += '<button class="tb" data-a="dnav" data-view="buzon" data-tab="tareas" aria-label="Ir al buzón">' + IC_INBOX + (n ? '<span class="bdg">' + (n > 99 ? '99+' : n) + '</span>' : '') + '</button>';
    }
    return h;
  }
  var lastHtml = '', lastView = '';
  function render(force) {
    if (force) lastHtml = '';
    var html = VIEWS[ui.view]();
    // Si nada ha cambiado no se vuelve a pintar (más fluido y no se pierde la posición)
    if (html !== lastHtml || ui.view !== lastView || !$('main').firstChild) { $('main').innerHTML = html; lastHtml = html; lastView = ui.view; }
    var ta = topActions(), tr = $('topR');
    if (tr && tr.innerHTML !== ta) tr.innerHTML = ta;
    var on = NAVMAP[ui.view] || ui.view;
    [].forEach.call(document.querySelectorAll('#nav button'), function (b) { b.classList.toggle('on', b.dataset.view === on); });
    $('fab').classList.toggle('hidden', ui.view === 'mas' || ui.view === 'papelera' || ui.view === 'enfoque');
    drawFbar();
    if (ui.view !== 'enfoque' || !(D.focus && D.focus.run) || D.focus.run.pz) wake(false); else wake(true);
    ensureG();
    planAvisos();
    var tl = $('tl');
    if (tl && ui.tlScroll) { ui.tlScroll = false; window.scrollTo(0, Math.max(0, tl.getBoundingClientRect().top + window.scrollY + ui.tlFocus / 60 * HH - 430)); }
  }
  function go(v) { ui.view = v; ui.tlScroll = true; render(); window.scrollTo(0, 0); }

  /* ---------- Hoja inferior ---------- */
  // La hoja se ajusta a la parte visible de la pantalla (si sale el teclado del iPhone, queda encima de él).
  function positionSheet() {
    var s = $('sheet'), vv = window.visualViewport;
    if (!s || s.classList.contains('hidden') || !vv) return;
    s.style.top = vv.offsetTop + 'px'; s.style.height = vv.height + 'px'; s.style.bottom = 'auto';
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', positionSheet); window.visualViewport.addEventListener('scroll', positionSheet); }
  function openSheet(html, cls) {
    var s = $('sheet');
    s.classList.toggle('keep', !s.classList.contains('hidden')); // si ya estaba abierta, sin animación
    s.innerHTML = '<div class="ov" data-a="close"></div><div class="panel' + (cls ? ' ' + cls : '') + '">' + html + '</div>';
    s.classList.remove('hidden');
    positionSheet();
  }
  function closeSheet() { closeNotes(true); var s = $('sheet'); s.classList.add('hidden'); s.innerHTML = ''; s.style.top = s.style.height = s.style.bottom = ''; form = null; }

  // Marcar / desmarcar una casilla de las notas desde la vista previa del formulario, sin abrir el editor.
  function togglePreviewCheck(li) {
    var all = [].slice.call($('tk-notesbtn').querySelectorAll('ul.cl > li')), i = all.indexOf(li);
    if (i < 0) return;
    var box = document.createElement('div'); box.innerHTML = notesHtml(form.notes);
    var tgt = box.querySelectorAll('ul.cl > li')[i]; if (!tgt) return;
    tgt.classList.toggle('done'); li.classList.toggle('done');
    form.notes = notesHtml(box.innerHTML);
    var t = form.id ? findTask(form.id) : null;
    if (t) { if (form.notes) t.notes = form.notes; else delete t.notes; save(); }
  }

  function chipsScope(sel) {
    return C.SCOPES.map(function (s) {
      return '<button class="chip sc ' + (s.id === sel ? 'on' : '') + '" style="--c:' + s.color + '" data-a="gscope" data-v="' + s.id + '"><span class="sw"></span>' + s.name + '</button>';
    }).join('');
  }

  function openSubs() {
    var sc = C.scopeById(ui.scope), subs = subsOf(ui.scope);
    var h = '<h2>Subcategorías · ' + esc(sc.name) + '</h2>' +
      '<div class="note" style="margin:0 0 10px">Archivar una subcategoría la oculta al crear tareas nuevas, pero conserva las tareas que ya la tienen. Borrarla no borra sus tareas: pasan a «Sin subcategoría».</div>';
    if (!subs.length) h += '<div class="empty" style="padding:14px 10px">Aún no hay subcategorías en este ámbito.</div>';
    subs.forEach(function (x) {
      var n = D.tasks.filter(function (t) { return !t.deleted && t.sub === x.id; }).length;
      h += '<div class="card" style="border-left:5px solid ' + sc.color + '"><div>' + esc(x.name) + (x.archived ? ' (archivada)' : '') + '</div><div class="note" style="margin:2px 0 10px">' + n + ' tareas</div>' +
        '<div class="row"><button class="btn" data-a="subren" data-id="' + esc(x.id) + '">Renombrar</button><button class="btn" data-a="subarch" data-id="' + esc(x.id) + '">' + (x.archived ? 'Reactivar' : 'Archivar') +
        '</button><button class="btn danger" data-a="subdel" data-id="' + esc(x.id) + '">Borrar</button></div></div>';
    });
    h += '<div class="actions"><button class="btn primary" data-a="subadd">＋ Nueva subcategoría</button><button class="btn" data-a="close">Cerrar</button></div>';
    openSheet(h);
  }
  function subAction(a, id) {
    var x = subById(id);
    if (a === 'subadd') { addSub(ui.scope, prompt('Nombre de la nueva subcategoría')); }
    else if (a === 'subren' && x) { var nn = String(prompt('Nuevo nombre', x.name) || '').trim().slice(0, 40); if (nn) { x.name = nn; save(); } }
    else if (a === 'subarch' && x) { x.archived = !x.archived; save(); }
    else if (a === 'subdel' && x) {
      var n = D.tasks.filter(function (t) { return t.sub === x.id; }).length;
      if (!confirm('¿Borrar la subcategoría «' + x.name + '»? ' + (n ? 'Sus ' + n + ' tareas no se borran: pasan a «Sin subcategoría».' : ''))) return;
      D.tasks.forEach(function (t) { if (t.sub === x.id) t.sub = null; });
      D.meta.subs = D.meta.subs.filter(function (y) { return y.id !== x.id; }); save();
    }
    render(); openSubs();
  }

  // Editar subcategorías desde el propio formulario de tarea (sin cerrarlo).
  function formSubAction(a, id) {
    var x = subById(id); if (!x || !form) return;
    if (a === 'fsubren') { var nn = String(prompt('Nuevo nombre', x.name) || '').trim().slice(0, 40); if (nn) { x.name = nn; save(); } }
    else if (a === 'fsubarch') { x.archived = !x.archived; save(); }
    else if (a === 'fsubdel') {
      var n = D.tasks.filter(function (t) { return t.sub === x.id; }).length;
      if (!confirm('¿Borrar la subcategoría «' + x.name + '»? ' + (n ? 'Sus ' + n + ' tareas no se borran: pasan a «Sin subcategoría».' : ''))) return;
      D.tasks.forEach(function (t) { if (t.sub === x.id) t.sub = null; });
      D.meta.subs = D.meta.subs.filter(function (y) { return y.id !== x.id; });
      if (form.sub === x.id) form.sub = null;
      save();
    }
    if (!subsOf(form.scope).length) form.menu = 'sub';
    drawMenu(); refreshTop();
  }

  // Poner en un día una tarea del buzón, sin abrirla
  var qsId = null;
  function openQS(id) {
    var t = findTask(id), td = C.today(); qsId = id;
    var opts = [['Hoy', td], ['Mañana', C.addDays(td, 1)], ['Pasado', C.addDays(td, 2)], ['Sig. lunes', nextMonday(td)]];
    openSheet('<h2>¿Para cuándo?</h2><div class="note" style="margin:-6px 0 12px">' + esc(t.title) + '</div><div class="qd">' +
      opts.map(function (o) { return '<button data-a="qsday" data-date="' + o[1] + '">' + o[0] + '<small>' + esc(dayWordAbs(o[1])) + '</small></button>'; }).join('') + '</div>' +
      '<div class="row" style="margin-top:6px"><div style="flex:1.4"><div class="lbl">Otro día</div><input type="date" id="qs-d" min="' + td + '"></div><div style="flex:1"><div class="lbl">Hora (opcional)</div><input type="time" id="qs-t"></div></div>' +
      '<div class="actions"><button class="btn primary" data-a="qsgo">Poner en ese día</button><button class="btn" data-a="close">Cancelar</button></div>');
  }
  function setQS(d, time) {
    var t = findTask(qsId); if (!t || !d) return;
    t.date = d; if (time) t.time = time;
    delete t.order; ui.lastScope = t.scope;
    save(); closeSheet(); render();
  }
  function defaultDate() {
    if (ui.view === 'hoy') return C.today();
    if (ui.view === 'calendario') return ui.calSel;
    return null;
  }

  /* ---------- Formulario de tarea (compacto, con desplegables) ---------- */
  var IC = {
    cal: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  function dayWord(d) {
    var td = C.today();
    if (d === td) return 'Hoy';
    if (d === C.addDays(td, 1)) return 'Mañana';
    if (d === C.addDays(td, -1)) return 'Ayer';
    var x = C.parse(d);
    return DIAS[C.weekday(x)].slice(0, 3) + ', ' + x.getDate() + ' ' + MESES[x.getMonth()].slice(0, 3);
  }
  function formRec() { return form.recType ? { type: form.recType, days: form.days, n: form.n, unit: form.unit } : null; }
  function timeText() { return form.time ? (form.end ? form.time + '–' + form.end : form.time) : ''; }
  function nextMonday(from) { var d = C.addDays(from, 1); while (C.weekday(C.parse(d)) !== 0) d = C.addDays(d, 1); return d; }

  // Hora de inicio y fin junto a la fecha: al tocar se abre directamente el selector de hora del iPhone
  function drawTimeBox() {
    var el = $('tk-timebox'); if (!el) return;
    if (!el.firstChild) {
      el.innerHTML = '<label class="tchip" id="tc-s">' + IC.clock + '<span class="tv"></span><input type="time" id="q-time" aria-label="Hora de inicio"></label>' +
        '<label class="tchip" id="tc-e"><span class="tv"></span><input type="time" id="q-end" aria-label="Hora de fin"></label>' +
        '<button class="tclr" id="tc-x" data-a="ftimeclear" aria-label="Quitar hora">✕</button>';
    }
    var qs = $('q-time'), qe = $('q-end');
    if (document.activeElement !== qs) qs.value = form.time || '';
    if (document.activeElement !== qe) qe.value = form.end || '';
    $('tc-s').querySelector('.tv').textContent = form.time || 'Hora';
    $('tc-s').classList.toggle('dim', !form.time);
    $('tc-e').querySelector('.tv').textContent = form.end ? '– ' + form.end : '– Fin';
    $('tc-e').classList.toggle('dim', !form.end);
    $('tc-e').classList.toggle('bad', !!(form.end && form.time && form.end <= form.time));
    $('tc-e').classList.toggle('hidden', !form.time);
    $('tc-x').classList.toggle('hidden', !form.time);
  }

  function refreshTop() {
    var sc = C.scopeById(form.scope), sb = subById(form.sub);
    $('tp-scope').innerHTML = '<i class="sw" style="background:' + sc.color + '"></i>' + esc(sc.name) + '<span class="ch">▾</span>';
    $('tp-sub').innerHTML = (sb ? esc(sb.name) : 'Subcategoría') + '<span class="ch">▾</span>';
    $('tp-sub').classList.toggle('dim', !sb);
    $('tp-prio').innerHTML = IC.flag + (form.priority ? '<b>' + '•'.repeat(form.priority) + '</b>' : '') + '<span class="ch">▾</span>';
    $('tp-prio').classList.toggle('dim', !form.priority);
    var parts = [form.date ? dayWord(form.date) : 'Sin fecha'];
    var rl = recLabel(formRec());
    if (rl) parts.push('↻ ' + rl);
    var nr = remsOf(form.rem, !!form.time).length;
    if (nr && (form.date || form.recType)) parts.push('🔔' + (nr > 1 ? ' ' + nr : ''));
    var b = $('tk-datebtn');
    b.innerHTML = IC.cal + '<span>' + esc(parts.join(' · ')) + '</span><span class="ch">' + (form.dateOpen ? '▴' : '▾') + '</span>';
    b.classList.toggle('late', !!(form.date && form.date < C.today() && !form.recType));
    drawTimeBox();
    var nb = $('tk-notesbtn'), nh = notesHtml(form.notes);
    nb.classList.toggle('has', !!nh);
    var keep = nb.querySelector('.npv'), sc0 = keep ? keep.scrollTop : 0;
    nb.innerHTML = IC.note + (nh ? '<div class="np"><div class="npl">Notas · toca el texto para editar</div><div class="nrich npv">' + nh + '</div></div>' : '<span class="nt">Notas</span>');
    if (nb.querySelector('.npv')) nb.querySelector('.npv').scrollTop = sc0;
  }

  function menuItem(a, v, label, on, cls, pre) {
    return '<button class="mi ' + (on ? 'on ' : '') + (cls || '') + '" data-a="' + a + '" data-v="' + esc(v) + '">' + (pre || '') + '<span>' + label + '</span>' + (on ? '<span class="ck">✓</span>' : '') + '</button>';
  }
  function drawMenu() {
    var el = $('tk-menu'), m = form.menu, h = '';
    if (!m) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    if (m === 'scope') {
      C.SCOPES.forEach(function (s) { h += menuItem('fscope', s.id, esc(s.name), s.id === form.scope, '', '<i class="sw" style="background:' + s.color + '"></i>'); });
    } else if (m === 'sub') {
      h += menuItem('fsub', '', 'Ninguna', !form.sub);
      subsOf(form.scope).filter(function (x) { return !x.archived || x.id === form.sub; }).forEach(function (x) { h += menuItem('fsub', x.id, esc(x.name), x.id === form.sub); });
      h += menuItem('fsubnew', '', '＋ Nueva subcategoría', false);
      if (subsOf(form.scope).length) h += menuItem('tkmenu', 'subedit', 'Editar o borrar subcategorías…', false);
    } else if (m === 'subedit') {
      subsOf(form.scope).forEach(function (x) {
        h += '<div class="mi se"><span>' + esc(x.name) + (x.archived ? ' (archivada)' : '') + '</span><button class="mini-b" data-a="fsubren" data-id="' + esc(x.id) + '">Renombrar</button><button class="mini-b" data-a="fsubarch" data-id="' + esc(x.id) + '">' + (x.archived ? 'Reactivar' : 'Archivar') + '</button><button class="mini-b danger" data-a="fsubdel" data-id="' + esc(x.id) + '">Borrar</button></div>';
      });
      h += menuItem('tkmenu', 'sub', '‹ Volver', false);
    } else if (m === 'prio') {
      [[3, '••• Importante'], [2, '•• Menos importante'], [1, '• Poco importante'], [0, 'Sin prioridad']].forEach(function (o) { h += menuItem('fprio', String(o[0]), o[1], form.priority === o[0]); });
    } else if (m === 'more') {
      var t = findTask(form.id), st = C.getState(t, form.ctx || t.date);
      h += menuItem('wontdo', '', st === 'wontdo' ? 'Quitar «No lo haré»' : 'No lo haré', false);
      if (t.rec && form.ctx && !st) h += menuItem('mvopen', '', 'Mover solo esta vez…', false);
      if (t.rec && form.ctx) h += menuItem('delone', '', 'Eliminar solo el ' + shortDate(form.ctx), false, 'danger');
      h += menuItem('deltask', '', t.rec ? 'Eliminar toda la serie' : 'Eliminar', false, 'danger');
    }
    el.innerHTML = h; el.classList.remove('hidden');
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }

  function drawDatePanel() {
    var el = $('tk-datepanel');
    if (!form.dateOpen) { el.classList.add('hidden'); return; }
    var td = C.today(), mon = nextMonday(td);
    var month = form.calMonth || (form.date || td).slice(0, 7), p = month.split('-');
    var h = '<div class="qd">' + [['today', 'Hoy', td], ['tomorrow', 'Mañana', C.addDays(td, 1)], ['monday', 'Sig. lunes', mon], ['none', 'Sin fecha', null]].map(function (o) {
      return '<button class="' + ((o[2] ? form.date === o[2] : !form.date) ? 'on' : '') + '" data-a="fdate" data-v="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
    var start = C.mondayOf(month + '-01'), cells = '';
    for (var i = 0; i < 42; i++) {
      var d = C.addDays(start, i); if (i >= 35 && d.slice(0, 7) !== month) break;
      cells += '<button class="day' + (d === td ? ' today' : '') + (d === form.date ? ' sel' : '') + (d.slice(0, 7) !== month ? ' out' : '') + '" data-a="fpick" data-date="' + d + '">' + C.parse(d).getDate() + '</button>';
    }
    h += '<div class="mini"><div class="calhead"><button class="ar" data-a="fcalmove" data-n="-1">‹</button><span class="name">' + MESES[+p[1] - 1] + ' ' + p[0] +
      '</span><button class="ar" data-a="fcalmove" data-n="1">›</button></div><div class="calgrid">' + DL.map(function (l) { return '<span class="wd">' + l + '</span>'; }).join('') + cells + '</div></div>';
    h += '<button class="acr" data-a="tkrec"><span>Repetir</span><span class="v">' + esc(recLabel(formRec()) || 'Ninguno') + ' ' + (form.recOpen ? '▴' : '▾') + '</span></button>';
    if (form.recOpen) {
      h += '<div style="padding:2px 0 8px"><select id="f-rec">' +
        [['', 'No se repite'], ['daily', 'Cada día'], ['weekly', 'Cada semana'], ['monthly', 'Cada mes'], ['yearly', 'Cada año'], ['every', 'Cada X días, semanas o meses']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === form.recType ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select><div id="f-rec-extra"></div></div>';
    }
    var timed = !!form.time, cur = remsOf(form.rem, timed);
    h += '<button class="acr" data-a="tkrem"><span>Avisos</span><span class="v">' + esc(remLabel(form.rem, timed)) + ' ' + (form.remOpen ? '▴' : '▾') + '</span></button>';
    if (form.remOpen) {
      h += '<div class="chips rems">' + (timed ? REM_T : REM_D).map(function (o) {
        return '<button class="chip ' + (cur.indexOf(o[0]) >= 0 ? 'on' : '') + '" data-a="frem" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div><div class="note" style="margin:6px 2px 8px">' +
        (!form.date && !form.recType ? 'Pon una fecha para que pueda avisarte. ' : '') +
        (timed ? 'Se cuentan desde la hora de inicio.' : 'Sin hora, el aviso llega a las ' + remHour() + ' de ese día.') +
        (D.meta.avisosOn ? '' : ' Los avisos están apagados en este dispositivo: actívalos en Ajustes.') + '</div>';
    }
    el.innerHTML = h; el.classList.remove('hidden');
    drawRecExtra();
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }

  function openTask(id, ctxDate, preset) {
    var t = id ? findTask(id) : null;
    var date = t ? t.date : (preset && preset.nodate ? null : defaultDate());
    form = {
      id: id, ctx: ctxDate || (t && t.date) || null,
      scope: t ? t.scope : (preset && preset.scope) || (ui.view === 'ambito' ? ui.scope : ui.lastScope),
      sub: t ? (subById(t.sub) ? t.sub : '') : (preset && preset.sub) || '',
      priority: t ? (t.priority || 0) : 0,
      date: date || null, time: t && t.time ? t.time : ((preset && preset.time) || null), end: t && t.end ? t.end : null,
      notes: t && t.notes ? t.notes : '',
      recType: t && t.rec ? t.rec.type : '',
      days: t && t.rec && t.rec.days ? t.rec.days.slice() : [],
      n: t && t.rec && t.rec.n ? t.rec.n : 2, unit: t && t.rec && t.rec.unit ? t.rec.unit : 'd',
      rem: t && t.rem ? t.rem.slice() : null,
      menu: null, dateOpen: false, timeOpen: false, recOpen: false, remOpen: false, calMonth: null
    };
    if (form.time && !form.date) form.date = C.today();
    var h = '<div id="tk-main">' +
      '<input id="f-title" placeholder="¿Qué necesitas hacer?" value="' + (t ? esc(t.title) : '') + '" autocomplete="off">' +
      '<div class="tk-notesbtn" id="tk-notesbtn" data-a="tknotes" role="button" tabindex="0"></div>' +
      '<div class="tk-menu hidden" id="tk-menu"></div><div class="tk-datepanel hidden" id="tk-datepanel"></div>' +
      '<div class="tk-bottom"><div class="tk-top"><button class="pill" id="tp-scope" data-a="tkmenu" data-v="scope"></button>' +
      '<button class="pill" id="tp-sub" data-a="tkmenu" data-v="sub"></button><button class="pill" id="tp-prio" data-a="tkmenu" data-v="prio"></button>' +
      (t ? '<button class="pill fpl" data-a="tkfocus" aria-label="Enfocarme en esta tarea">▶' + (focusOfTask(t.id) ? ' ' + fmtShort(focusOfTask(t.id)) : '') + '</button>' +
        '<button class="pill sq" data-a="tkmenu" data-v="more" aria-label="Más opciones">⋯</button>' : '') + '</div>' +
      '<div class="tk-daterow"><button class="tk-date" id="tk-datebtn" data-a="tkdate"></button><div class="tk-timebox" id="tk-timebox"></div></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn" data-a="close" style="flex:1">Cancelar</button><button class="btn primary" data-a="savetask" style="flex:2">' + (t ? 'Guardar' : 'Añadir') + '</button></div></div></div>';
    openSheet(h, 'tall');
    refreshTop();
    if (!t) setTimeout(function () { var el = $('f-title'); if (el) el.focus(); }, 250);
  }

  function drawRecExtra() {
    var el = $('f-rec-extra'); if (!el) return;
    var ty = form.recType, h = '';
    if (ty === 'weekly') {
      h = '<div class="lbl">Días (si no eliges, se usa el día de la fecha)</div><div class="chips">' + DL.map(function (l, i) {
        return '<button class="chip ' + (form.days.indexOf(i) >= 0 ? 'on' : '') + '" data-a="fday" data-v="' + i + '">' + l + '</button>';
      }).join('') + '</div>';
    } else if (ty === 'every') {
      h = '<div class="row" style="margin-top:8px"><span>Cada</span><input type="number" id="f-n" min="1" max="999" value="' + (+form.n || 1) + '" style="width:80px">' +
        '<select id="f-unit"><option value="d"' + (form.unit === 'd' ? ' selected' : '') + '>días</option><option value="w"' + (form.unit === 'w' ? ' selected' : '') +
        '>semanas</option><option value="m"' + (form.unit === 'm' ? ' selected' : '') + '>meses</option></select></div>';
    }
    el.innerHTML = h;
  }

  /* ---------- Mover solo esta vez una tarea repetida (y empujar el resto si choca) ---------- */
  var mvs = null; // { id, from, plan }
  function openMove() {
    var t = findTask(mvs.id), td = C.today();
    openSheet('<h2>Mover solo esta vez</h2><div class="note" style="margin:0 0 10px">«' + esc(t.title) + '» · ahora el ' + esc(longDate(mvs.from)) + '. El resto de la serie no cambia.</div>' +
      '<div class="lbl">Nuevo día</div><input id="m-date" type="date" value="' + (mvs.from < td ? td : C.addDays(mvs.from, 1)) + '">' +
      '<div class="chips" style="margin-top:8px"><button class="chip" data-a="mvquick" data-v="0">Hoy</button><button class="chip" data-a="mvquick" data-v="1">Mañana</button></div>' +
      '<div class="note" id="m-msg" style="color:#ff6b6b"></div>' +
      '<div class="actions"><button class="btn primary" data-a="mvgo">Mover</button><button class="btn" data-a="close">Cancelar</button></div>');
  }
  function openMovePreview(t) {
    var mv = mvs.plan;
    openSheet('<h2>Ese día ya hay otra</h2><div class="note" style="margin:0 0 10px">«' + esc(t.title) + '» ya está el ' + esc(longDate(mv[0].to)) +
      '. Para no juntarlas, se empujan las siguientes un día hasta encontrar un día libre:</div><div class="card">' +
      mv.map(function (m) { return '<div class="mvrow"><span>' + esc(longDate(m.from)) + '</span><b>→</b><span>' + esc(longDate(m.to)) + '</span></div>'; }).join('') + '</div>' +
      '<div class="note">Las demás veces de la serie no se tocan. Si prefieres no empujar, las dos se verán como una sola tarea ese día.</div>' +
      '<div class="actions"><button class="btn primary" data-a="mvpush">Empujar el resto</button><button class="btn" data-a="mvmerge">Mover y juntarlas ese día</button><button class="btn" data-a="close">Cancelar</button></div>');
  }
  function doMove(moves) {
    C.applyMoves(findTask(mvs.id), moves);
    save(); closeSheet(); render();
  }

  function saveTask() {
    var title = $('f-title').value.trim();
    if (!title) { $('f-title').focus(); return; }
    // Si los campos desplegables están abiertos, se toma lo que muestran.
    if ($('q-time')) { form.time = $('q-time').value || null; form.end = form.time ? ($('q-end').value || null) : null; }
    if ($('f-n')) form.n = Math.max(1, parseInt($('f-n').value, 10) || 1);
    if ($('f-unit')) form.unit = $('f-unit').value;
    var date = form.date || null, time = form.time || null, end = form.end || null;
    if (end && !time) { alert('Pon también la hora de inicio, o quita la de fin.'); return; }
    if (end && end <= time) { alert('La hora de fin debe ser posterior a la de inicio.'); return; }
    var ty = form.recType, rec = null;
    if ((ty || time) && !date) date = C.today();
    if (ty === 'weekly') rec = { type: 'weekly', days: form.days.slice().sort() };
    else if (ty === 'every') rec = { type: 'every', n: Math.max(1, +form.n || 1), unit: form.unit };
    else if (ty) rec = { type: ty };
    var t = form.id ? findTask(form.id) : null;
    if (!t) { t = { id: C.uid(), created: Date.now() }; D.tasks.push(t); }
    var wasRec = !!t.rec;
    t.title = title; t.scope = form.scope; t.sub = (subById(form.sub) && subById(form.sub).scope === form.scope) ? form.sub : null; t.priority = form.priority; t.date = date; t.time = time; t.end = end; t.rec = rec;
    if (form.rem) t.rem = remsOf(form.rem, !!time); else delete t.rem;
    if (form.notes && form.notes.trim()) t.notes = form.notes; else delete t.notes;
    // Al cambiar entre repetitiva y única, los estados anteriores ya no valen.
    if (wasRec !== !!rec) { t.states = {}; t.state = null; t.ex = []; }
    ui.lastScope = form.scope;
    save(); closeSheet(); render();
  }

  function openIdea(id) {
    var x = id ? (D.ideas || []).filter(function (i) { return i.id === id; })[0] : null;
    form = { ideaId: id, scope: x ? x.scope : (ui.view === 'ambito' ? ui.scope : ui.lastScope) };
    openSheet('<h2>' + (x ? 'Idea de objetivo' : 'Nueva idea de objetivo') + '</h2>' +
      '<input id="i-title" placeholder="¿Qué objetivo se te ha ocurrido?" value="' + (x ? esc(x.title) : '') + '" autocomplete="off">' +
      '<div class="lbl">Ámbito</div><div class="chips" id="f-scope">' + chipsScope(form.scope) + '</div>' +
      '<div class="note">Se queda en el buzón sin fechas. Cuando lo tengas claro, conviértelo en objetivo.</div>' +
      '<div class="actions">' + (x ? '<button class="btn primary" data-a="ideaconv">Convertir en objetivo</button><button class="btn" data-a="ideasave">Guardar</button>' : '<button class="btn primary" data-a="ideasave">Añadir al buzón</button>') +
      (x ? '<button class="btn danger" data-a="ideadel">Eliminar idea</button>' : '') + '<button class="btn" data-a="close">Cancelar</button></div>');
    if (!x) setTimeout(function () { var el = $('i-title'); if (el) el.focus(); }, 250);
  }
  function saveIdea() {
    var title = $('i-title').value.trim();
    if (!title) { $('i-title').focus(); return null; }
    D.ideas = D.ideas || [];
    var x = form.ideaId ? D.ideas.filter(function (i) { return i.id === form.ideaId; })[0] : null;
    if (!x) { x = { id: C.uid(), created: Date.now() }; D.ideas.push(x); }
    x.title = title; x.scope = form.scope; ui.lastScope = form.scope;
    save(); return x;
  }

  function openGoal(id, preset) {
    var g = id ? D.goals.filter(function (x) { return x.id === id; })[0] : null;
    form = { goalId: id, scope: g ? g.scope : preset ? preset.scope : (ui.view === 'ambito' ? ui.scope : ui.lastScope), status: g ? g.status : 'pendiente', ideaId: preset ? preset.ideaId : null };
    var start = g ? (C.goalStart(g) || C.today()) : C.today(), end = g ? (C.goalEnd(g) || '') : '';
    var h = '<h2>' + (g ? 'Editar objetivo' : 'Nuevo objetivo') + '</h2>' +
      '<input id="g-title" placeholder="¿Qué quieres lograr?" value="' + (g ? esc(g.title) : preset ? esc(preset.title) : '') + '" autocomplete="off">' +
      '<div class="lbl">Ámbito</div><div class="chips" id="f-scope">' + chipsScope(form.scope) + '</div>' +
      '<div class="lbl">Empieza</div><input id="g-start" type="date" value="' + esc(start) + '">' +
      '<div class="lbl">Fecha límite (opcional)</div><input id="g-end" type="date" value="' + esc(end) + '">' +
      '<div class="chips" style="margin-top:8px"><button class="chip" data-a="gend" data-v="q">Fin de este trimestre</button><button class="chip" data-a="gend" data-v="">Sin fecha límite</button></div>' +
      '<div class="note" id="g-msg" style="color:#ff6b6b"></div>' +
      '<div class="lbl">Estado</div><div class="chips" id="g-st">' + C.GOAL_STATES.map(function (s) {
        return '<button class="chip ' + (s.id === form.status ? 'on' : '') + '" data-a="gstate" data-v="' + s.id + '">' + s.name + '</button>';
      }).join('') + '</div><div class="actions"><button class="btn primary" data-a="savegoal">' + (g ? 'Guardar' : 'Añadir') + '</button>' +
      (g ? '<button class="btn danger" data-a="delgoal">Eliminar objetivo</button>' : '') + '<button class="btn" data-a="close">Cancelar</button></div>';
    openSheet(h);
    if (!g && !preset) setTimeout(function () { var el = $('g-title'); if (el) el.focus(); }, 250);
  }
  function saveGoal() {
    var title = $('g-title').value.trim();
    if (!title) { $('g-title').focus(); return; }
    var start = $('g-start').value || C.today(), end = $('g-end').value || '';
    if (end && end < start) { $('g-msg').textContent = 'La fecha límite no puede ser anterior al inicio.'; return; }
    var g = form.goalId ? D.goals.filter(function (x) { return x.id === form.goalId; })[0] : null;
    if (!g) { g = { id: C.uid() }; D.goals.push(g); }
    g.title = title; g.scope = form.scope; g.start = start; g.end = end; g.quarter = C.quarterOf(start); g.status = form.status;
    ui.lastScope = form.scope;
    if (form.ideaId) { D.ideas = (D.ideas || []).filter(function (i) { return i.id !== form.ideaId; }); ui.view = 'objetivos'; }
    save(); closeSheet(); render();
  }

  /* ---------- Copia de seguridad ---------- */
  function exportData() {
    D.meta.lastBackup = C.today(); save();
    var blob = new Blob([JSON.stringify(D, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'seguimiento-' + C.today() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    render();
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!C.validate(d)) throw new Error('formato');
        if (!confirm('Esto reemplazará todos los datos actuales (' + D.tasks.length + ' tareas) por los de la copia (' + d.tasks.length + ' tareas). ¿Continuar?')) return;
        // Antes de sustituir, se guarda una copia de lo actual por si fue un error.
        if (D.tasks.length || D.goals.length || Object.keys(D.log).length) { try { localStorage.setItem('seguimiento.copia-antes-de-importar', JSON.stringify(D)); } catch (e) {} }
        d.meta = d.meta || {}; D = d; save(); render();
        alert('Copia importada.');
      } catch (e) { alert('Ese archivo no parece una copia válida de esta app.'); }
    };
    r.readAsText(file);
  }

  /* ---------- Eventos ---------- */
  function toggleState(t, d) {
    var cur = C.getState(t, d);
    C.setState(t, d, cur ? null : 'done');
    save(); render();
  }


  /* ---------- Arrastrar para ordenar (mantener pulsado) ---------- */
  var drag = null, pressT = null, press = null, noClickUntil = 0;
  function pt(e) { var p = e.touches && e.touches[0] ? e.touches[0] : e; return { x: p.clientX, y: p.clientY }; }
  function pressStart(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (drag || !$('sheet').classList.contains('hidden')) return;
    var row = e.target.closest ? e.target.closest('.task') : null;
    var blk = !row && e.target.closest ? e.target.closest('.ev[data-tl]') : null;
    if (blk) {
      if (e.target.closest('.evchk')) return;
      var pb = pt(e); press = pb;
      pressT = setTimeout(function () { pressT = null; startTlDrag(blk, pb); }, 350);
      return;
    }
    if (!row || e.target.closest('.chk')) return;
    var p = pt(e); press = p;
    pressT = setTimeout(function () { pressT = null; startDrag(row, p); }, 350);
  }
  function startDrag(row, p) {
    drag = { row: row, group: row.dataset.group, box: row.parentNode };
    row.classList.add('drag'); document.body.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(15);
  }
  /* Mover una tarea en la vista «Día por horas»: mantener pulsada y arrastrar; cambia la hora (no la duración) en tramos de 15 min */
  function startTlDrag(blk, p) {
    var t = findTask(blk.dataset.tl);
    if (!t || !t.time) return;
    var s0 = mins(t.time), dur = t.end ? Math.max(15, mins(t.end) - s0) : 30;
    drag = { tl: true, blk: blk, task: t, dur: dur, hasEnd: !!t.end, off: p.y - blk.getBoundingClientRect().top, s0: s0, s: s0 };
    blk.classList.add('drag'); document.body.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(15);
  }
  function moveTlDrag(p) {
    var tr = $('tl').getBoundingClientRect();
    var m = Math.round((p.y - drag.off - tr.top) / HH * 60 / 15) * 15;
    m = Math.min(m, (drag.hasEnd ? 1439 : 1440) - drag.dur);
    m = Math.max(0, Math.floor(m / 15) * 15);
    drag.s = m;
    drag.blk.style.top = (m / 60 * HH) + 'px';
    var lab = drag.blk.querySelector('.evm');
    if (lab) lab.textContent = hm(m) + (drag.hasEnd ? '–' + hm(m + drag.dur) : '');
    if (p.y > window.innerHeight - 130) window.scrollBy(0, 10); else if (p.y < 110) window.scrollBy(0, -10);
  }
  function endTlDrag() {
    var d = drag;
    drag = null; noClickUntil = Date.now() + 400;
    d.blk.classList.remove('drag'); document.body.classList.remove('dragging');
    if (d.s !== d.s0) {
      d.task.time = hm(d.s);
      if (d.hasEnd) d.task.end = hm(d.s + d.dur);
      save();
    }
    render(true);
  }
  function moveDrag(p) {
    if (drag.tl) { moveTlDrag(p); return; }
    var row = drag.row;
    var sibs = [].filter.call(drag.box.querySelectorAll('.task'), function (r) { return r !== row && r.dataset.group === drag.group; });
    var target = null;
    for (var i = 0; i < sibs.length; i++) {
      var rc = sibs[i].getBoundingClientRect();
      if (p.y < rc.top + rc.height / 2) { target = sibs[i]; break; }
    }
    if (target) { if (row.nextElementSibling !== target) drag.box.insertBefore(row, target); }
    else if (sibs.length) { var last = sibs[sibs.length - 1]; if (last.nextElementSibling !== row) last.after(row); }
    if (p.y > window.innerHeight - 130) window.scrollBy(0, 10); else if (p.y < 110) window.scrollBy(0, -10);
  }
  function endDrag() {
    if (drag.tl) { endTlDrag(); return; }
    var rows = [].filter.call(drag.box.querySelectorAll('.task'), function (r) { return r.dataset.group === drag.group; });
    var tasks = rows.map(function (r) { return findTask(r.querySelector('[data-id]').dataset.id); });
    tasks.forEach(function (t, k) { t.order = k + 1; }); // la lista queda fijada como se ve
    drag.row.classList.remove('drag'); document.body.classList.remove('dragging');
    drag = null; noClickUntil = Date.now() + 400;
    save(); render(true);
  }
  function pressMove(e) {
    var p = pt(e);
    if (drag) { e.preventDefault(); moveDrag(p); return; }
    if (pressT && press && Math.abs(p.y - press.y) + Math.abs(p.x - press.x) > 10) { clearTimeout(pressT); pressT = null; }
  }
  function pressEnd() { if (pressT) { clearTimeout(pressT); pressT = null; } if (drag) endDrag(); }
  // Deslizar el calendario con el dedo: a la izquierda, semana/mes siguiente; a la derecha, anterior
  var sw = null;
  document.addEventListener('touchstart', function (e) {
    var box = e.target.closest && e.target.closest('.calswipe');
    sw = box && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, grid: box.querySelector('.calgrid'), on: false } : null;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!sw) return;
    var dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // es desplazamiento vertical
      if (Math.abs(dx) > 12) sw.on = true; else return;
    }
    e.preventDefault();
    sw.dx = dx; sw.grid.style.transition = 'none';
    sw.grid.style.transform = 'translateX(' + dx * 0.6 + 'px)'; sw.grid.style.opacity = 1 - Math.min(Math.abs(dx) / 500, 0.4);
  }, { passive: false });
  document.addEventListener('touchend', function () {
    if (!sw) return;
    var s0 = sw; sw = null;
    if (!s0.on) return;
    noClickUntil = Date.now() + 400;
    if (Math.abs(s0.dx || 0) > 50) { calMove(s0.dx < 0 ? 1 : -1); return; }
    s0.grid.style.transition = 'transform .15s, opacity .15s'; s0.grid.style.transform = ''; s0.grid.style.opacity = '';
  });
  document.addEventListener('touchstart', pressStart, { passive: true });
  document.addEventListener('touchmove', pressMove, { passive: false });
  document.addEventListener('touchend', pressEnd);
  document.addEventListener('touchcancel', pressEnd);
  document.addEventListener('mousedown', pressStart);
  document.addEventListener('mousemove', pressMove);
  document.addEventListener('mouseup', pressEnd);

  document.addEventListener('click', function (e) {
    if (Date.now() < noClickUntil && e.target.closest('.task, .ev, .calswipe')) return;
    var cli = e.target.closest && e.target.closest('#tk-notesbtn ul.cl > li');
    if (cli && form && e.clientX - cli.getBoundingClientRect().left <= 34) { togglePreviewCheck(cli); return; }
    var el = e.target.closest('[data-a]');
    if (!el) return;
    var a = el.dataset.a, id = el.dataset.id, d = el.dataset.date, v = el.dataset.v, t;
    switch (a) {
      case 'nav': closeSheet(); go(el.dataset.view); break;
      case 'fab': ui.view === 'objetivos' ? openGoal() : ui.view === 'buzon' && ui.inbTab === 'obj' ? openIdea() : openTask(); break;
      case 'menu': openDrawer(); break;
      case 'vsopen': openVs(v); break;
      case 'vsset':
        D.meta.vs = D.meta.vs || {}; var vk = ui.vsk, cur0 = D.meta.vs[vk] || {};
        cur0[el.dataset.k] = el.dataset.k === 'hd' ? !!v : v; D.meta.vs[vk] = cur0;
        save(); render(); openVs(vk); break;
      case 'vsreset':
        var lt = listTasks(ui.vsk), nr = lt.filter(function (x) { return x.order != null; }).length;
        if (!nr) { alert('En esta lista no hay nada ordenado a mano.'); break; }
        if (confirm('¿Quitar el orden que has puesto a mano en ' + nr + (nr === 1 ? ' tarea' : ' tareas') + '? Volverán a ordenarse según «Ordenar por».')) { lt.forEach(function (x) { delete x.order; }); save(); closeSheet(); render(); }
        break;
      case 'tkfocus':
        var fid = form.id; saveTask();
        if (!form) { ui.fsel = { task: fid, scope: null }; if (D.focus && D.focus.run) { D.focus.run.task = fid; D.focus.run.scope = findTask(fid).scope; save(); } ui.fdone = null; go('enfoque'); }
        break;
      case 'fmode': ui.fmode = v; render(); break;
      case 'fpick': ui.fq = ''; openFocusPick(); break;
      case 'fpset': setFocusSel(v); break;
      case 'fstart': focusStart(v); break;
      case 'fpause': focusPause(); break;
      case 'fresume': focusResume(); break;
      case 'fstop': focusStop(false); break;
      case 'fdiscard': if (confirm('¿Descartar este tiempo? No se guardará.')) focusStop(true); break;
      case 'fdoneok': ui.fdone = null; render(); break;
      case 'fpomo': FD().pomo = +v; save(); render(); break;
      case 'fbrk': FD().brk = +v; save(); render(); break;
      case 'fweek':
        var nw = Math.min(0, (ui.fWeek || 0) + (+el.dataset.n));
        if (nw !== (ui.fWeek || 0)) { ui.fWeek = nw; var fd0 = C.addDays(ui.fDay || C.today(), 7 * (+el.dataset.n)); ui.fDay = fd0 > C.today() ? C.today() : fd0; }
        render(); break;
      case 'fday': ui.fDay = d; render(); break;
      case 'fper': ui.fPer = v; render(); break;
      case 'fby': ui.fBy = v; render(); break;
      case 'fdel':
        if (confirm('¿Borrar esta sesión de enfoque?')) { FD().s = FD().s.filter(function (x) { return x.id !== id; }); save(); render(); }
        break;
      case 'fadd': openFocusAdd(); break;
      case 'faddgo': saveFocusAdd(); break;
      case 'dclose': closeDrawer(); break;
      case 'dnav':
        closeDrawer(); closeSheet();
        if (el.dataset.scope) { if (ui.scope !== el.dataset.scope) ui.af = null; ui.scope = el.dataset.scope; }
        if (el.dataset.tab) ui.inbTab = el.dataset.tab;
        go(el.dataset.view); break;
      case 'inbtab': ui.inbTab = v; render(); break;
      case 'af': ambF()[el.dataset.k] = v; render(); break;
      case 'ideaedit': openIdea(id); break;
      case 'ideasave': if (saveIdea()) { closeSheet(); render(); } break;
      case 'ideaconv': var ix = saveIdea(); if (ix) openGoal(null, { title: ix.title, scope: ix.scope, ideaId: ix.id }); break;
      case 'ideadel':
        if (confirm('¿Eliminar esta idea de objetivo?')) { D.ideas = (D.ideas || []).filter(function (i) { return i.id !== form.ideaId; }); save(); closeSheet(); render(); } break;
      case 'close': closeSheet(); break;
      case 'toggle': t = findTask(id); toggleState(t, d || t.date); break;
      case 'edit': openTask(id, d); break;
      case 'scope': if (ui.scope !== el.dataset.scope) ui.af = null; ui.scope = el.dataset.scope; render(); break;
      case 'grp': setOpen(el.dataset.s, !isOpen(el.dataset.s, el.dataset.def === '1')); render(); break;
      case 'sbadd': openTask(null, null, { scope: el.dataset.scope, sub: el.dataset.sub || '', nodate: true }); break;
      case 'qsched': openQS(id); break;
      case 'qsday': setQS(el.dataset.date); break;
      case 'qsgo':
        if (!$('qs-d').value) { $('qs-d').focus(); break; }
        setQS($('qs-d').value, $('qs-t').value); break;
      case 'wk': ui.weekOff += +el.dataset.n; render(); break;
      case 'cell':
        D.log[d] = D.log[d] || {};
        if (D.log[d][el.dataset.scope]) delete D.log[d][el.dataset.scope]; else D.log[d][el.dataset.scope] = true;
        if (!Object.keys(D.log[d]).length) delete D.log[d];
        save(); render(); break;
      case 'calmode': D.meta.calMode = v; ui.tlScroll = true; save(); render(); break;
      case 'slot': openTask(null, null, { time: C.pad(+el.dataset.h) + ':00' }); break;
      case 'caltoggle': ui.calOpen = !ui.calOpen; ui.calMonth = ui.calSel.slice(0, 7); render(); break;
      case 'calsel':
        ui.calSel = d; ui.calMonth = d.slice(0, 7); render(); break;
      case 'calmove':
        calMove(+el.dataset.n); break;
      case 'qmove': ui.quarter = C.shiftQuarter(ui.quarter, +el.dataset.n); render(); break;
      case 'goalcycle':
        var g = D.goals.filter(function (x) { return x.id === id; })[0];
        var order = C.GOAL_STATES.map(function (s) { return s.id; });
        g.status = order[(order.indexOf(g.status) + 1) % order.length]; save(); render(); break;
      case 'goaledit': openGoal(id); break;
      case 'restore': t = findTask(id); t.deleted = false; save(); render(); break;
      case 'purge':
        if (confirm('¿Borrar esta tarea para siempre? No se podrá recuperar.')) { D.tasks = D.tasks.filter(function (x) { return x.id !== id; }); save(); render(); } break;
      case 'emptytrash':
        if (confirm('¿Vaciar la papelera? Las tareas se borrarán para siempre.')) { D.tasks = D.tasks.filter(function (x) { return !x.deleted; }); save(); render(); } break;
      case 'export': exportData(); break;
      case 'import': $('importFile').click(); break;
      /* cuenta */
      case 'login': openLogin(); break;
      case 'dologin':
        var em = $('l-mail').value.trim(), pw = $('l-pass').value;
        if (!em || !pw) { $('l-msg').textContent = 'Escribe el correo y la contraseña.'; break; }
        $('l-msg').textContent = 'Entrando…';
        Sync.signIn(em, pw).then(function () { closeSheet(); render(); }, function (err) { $('l-msg').textContent = err.message; });
        break;
      case 'logout':
        if (confirm('¿Cerrar sesión? Los datos seguirán guardados en este dispositivo.')) { logout(); } break;
      case 'syncnow': Sync.sync(); ensureG(true); break;
      case 'gcalnow': ensureG(true); break;
      case 'avisoson': enableAvisos(); break;
      case 'avisosoff': disableAvisos(); break;
      case 'cals': openCals(); break;
      case 'calnew': case 'calchg': case 'caldel': calAction(a, id); break;
      case 'gcolreset': D.meta.gColors = {}; save(); render(); openCals(); break;
      /* formulario de tarea */
      case 'tkmenu': form.menu = form.menu === v ? null : v; drawMenu(); break;
      case 'fsub': form.sub = v; form.menu = null; drawMenu(); refreshTop(); break;
      case 'fsubnew':
        var ns = addSub(form.scope, prompt('Nombre de la nueva subcategoría'));
        if (ns) form.sub = ns.id;
        form.menu = null; drawMenu(); refreshTop(); break;
      case 'fsubren': case 'fsubarch': case 'fsubdel':
        formSubAction(a, id); break;
      case 'subman': openSubs(); break;
      case 'subadd': case 'subren': case 'subarch': case 'subdel': subAction(a, id); break;
      case 'fscope':
        form.scope = v;
        if (form.sub && (subById(form.sub) || {}).scope !== v) form.sub = '';
        form.menu = null; drawMenu(); refreshTop(); break;
      case 'fprio': form.priority = +v; form.menu = null; drawMenu(); refreshTop(); break;
      case 'tkdate': form.dateOpen = !form.dateOpen; form.menu = null; drawMenu(); drawDatePanel(); refreshTop(); break;
      case 'tkrec': form.recOpen = !form.recOpen; drawDatePanel(); break;
      case 'tkrem': form.remOpen = !form.remOpen; drawDatePanel(); break;
      case 'frem':
        var cur = remsOf(form.rem, !!form.time), mm = +v, ix = cur.indexOf(mm);
        if (ix >= 0) cur.splice(ix, 1); else cur.push(mm);
        form.rem = cur; drawDatePanel(); refreshTop(); break;
      case 'fdate':
        if (v === 'none') { form.date = null; form.time = null; form.end = null; form.recType = ''; }
        else form.date = v === 'today' ? C.today() : v === 'tomorrow' ? C.addDays(C.today(), 1) : nextMonday(C.today());
        form.calMonth = form.date ? form.date.slice(0, 7) : null; drawDatePanel(); refreshTop(); break;
      case 'fpick': form.date = d; form.calMonth = d.slice(0, 7); drawDatePanel(); refreshTop(); break;
      case 'fcalmove':
        var cm = (form.calMonth || (form.date || C.today()).slice(0, 7)).split('-'), cd = new Date(+cm[0], +cm[1] - 1 + (+el.dataset.n), 1);
        form.calMonth = C.fmt(cd).slice(0, 7); drawDatePanel(); break;
      case 'ftimeclear': form.time = null; form.end = null; refreshTop(); if (form.dateOpen) drawDatePanel(); break;
      case 'mvopen': mvs = { id: form.id, from: form.ctx }; closeSheet(); openMove(); break;
      case 'mvquick': $('m-date').value = C.addDays(C.today(), +v); break;
      case 'mvgo':
        var to = $('m-date').value, mt = findTask(mvs.id), pl = to ? C.planMove(mt, mvs.from, to) : { blocked: 'Elige un día.' };
        if (to === mvs.from) pl = { blocked: 'Elige un día distinto del actual.' };
        if (pl.blocked) { $('m-msg').textContent = pl.blocked; break; }
        if (pl.moves.length === 1) { doMove(pl.moves); break; }
        mvs.plan = pl.moves; openMovePreview(mt); break;
      case 'mvpush': doMove(mvs.plan); break;
      case 'mvmerge': doMove(mvs.plan.slice(0, 1)); break;
      case 'tknotes': openNotes(); break;
      case 'nback': closeNotes(); refreshTop(); break;
      case 'fday':
        var k = form.days.indexOf(+v); if (k >= 0) form.days.splice(k, 1); else form.days.push(+v);
        el.classList.toggle('on'); refreshTop(); break;
      case 'savetask': saveTask(); break;
      case 'wontdo':
        t = findTask(form.id); var dd = form.ctx || t.date;
        C.setState(t, dd, C.getState(t, dd) === 'wontdo' ? null : 'wontdo'); save(); closeSheet(); render(); break;
      case 'delone':
        t = findTask(form.id); C.removeOcc(t, form.ctx); save(); closeSheet(); render(); break;
      case 'deltask':
        t = findTask(form.id); t.deleted = true; t.deletedAt = Date.now(); save(); closeSheet(); render(); break;
      /* formulario de objetivo */
      case 'gscope':
        form.scope = v;
        [].forEach.call($('f-scope').children, function (c) { c.classList.toggle('on', c.dataset.v === v); }); break;
      case 'gstate':
        form.status = v;
        [].forEach.call($('g-st').children, function (c) { c.classList.toggle('on', c.dataset.v === v); }); break;
      case 'gend': $('g-end').value = el.dataset.v === 'q' ? C.quarterEnd(C.quarterOf(C.today())) : ''; break;
      case 'savegoal': saveGoal(); break;
      case 'delgoal':
        if (confirm('¿Eliminar este objetivo?')) { D.goals = D.goals.filter(function (x) { return x.id !== form.goalId; }); save(); closeSheet(); render(); } break;
    }
  });

  // En el ordenador, un campo de hora invisible no abre su selector solo: se abre a mano
  document.addEventListener('click', function (e) {
    var t = e.target;
    if ((t.id === 'q-time' || t.id === 'q-end') && t.showPicker) { try { t.showPicker(); } catch (x) {} }
  });

  document.addEventListener('change', function (e) {
    var t = e.target, id = t.id;
    if (id === 's-remhour') { if (t.value) { D.meta.remHour = t.value; save(); planAvisos(true); } return; }
    if (t.dataset && t.dataset.gcal) { D.meta.gColors = D.meta.gColors || {}; D.meta.gColors[t.dataset.gcal] = t.value; save(); render(); return; }
    if (!form || !id) return;
    if (id === 'f-rec') {
      form.recType = e.target.value;
      if (form.recType && !form.date) form.date = C.today();
      drawRecExtra(); refreshTop(); drawDatePanel();
    } else if (id === 'f-n') { form.n = Math.max(1, parseInt(e.target.value, 10) || 1); refreshTop(); }
    else if (id === 'f-unit') { form.unit = e.target.value; refreshTop(); }
    else if (id === 'q-time' || id === 'q-end') {
      form.time = $('q-time').value || null; form.end = form.time ? ($('q-end').value || null) : null;
      if (form.time && !form.date) form.date = C.today();
      refreshTop(); if (form.dateOpen && form.remOpen) drawDatePanel();
    }
  });
  /* ---------- Notas de la tarea (mini editor de texto) ---------- */
  // Guardado: HTML limpio (solo negrita, cursiva, subrayado, título, listas). Las notas antiguas en texto plano se convierten.
  function cleanNode(n) {
    var out = '';
    for (var c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out += esc(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      var tg = c.tagName.toLowerCase(), inner = cleanNode(c);
      if (tg === 'b' || tg === 'strong') out += '<b>' + inner + '</b>';
      else if (tg === 'i' || tg === 'em') out += '<i>' + inner + '</i>';
      else if (tg === 'u') out += '<u>' + inner + '</u>';
      else if (tg === 'ul') out += '<ul' + (c.classList.contains('cl') ? ' class="cl"' : '') + '>' + inner + '</ul>';
      else if (tg === 'li') out += '<li' + (c.classList.contains('done') ? ' class="done"' : '') + '>' + inner + '</li>';
      else if (tg === 'ol') out += '<ol>' + inner + '</ol>';
      else if (tg === 'h1' || tg === 'h2' || tg === 'h3') out += '<h3>' + inner + '</h3>';
      else if (tg === 'br') out += '<br>';
      else if (tg === 'div' || tg === 'p') out += '<div>' + inner + '</div>';
      else out += inner;
    }
    return out;
  }
  function notesHtml(raw) {
    if (!raw || !String(raw).trim()) return '';
    raw = String(raw);
    if (!/<[a-z][\s\S]*>/i.test(raw)) return esc(raw).replace(/\n/g, '<br>');
    var doc = new DOMParser().parseFromString('<body>' + raw + '</body>', 'text/html');
    var h = cleanNode(doc.body);
    var chk = document.createElement('div'); chk.innerHTML = h;
    return chk.textContent.trim() ? h : '';
  }

  var notesVV = null;
  function positionNotes() {
    var p = $('notespage'); if (!p) return;
    var vv = window.visualViewport;
    p.style.top = (vv ? vv.offsetTop : 0) + 'px';
    p.style.height = (vv ? vv.height : window.innerHeight) + 'px';
    if (window.scrollY) window.scrollTo(0, 0);
  }
  function openNotes() {
    if (!form || $('notespage')) return;
    var p = document.createElement('div'); p.id = 'notespage';
    p.innerHTML = '<div class="nhead"><button class="pill sq" data-a="nback">‹ Volver</button><span>Notas</span></div>' +
      '<div class="ntool">' +
      '<button data-cmd="bold" aria-label="Negrita"><b>B</b></button>' +
      '<button data-cmd="italic" aria-label="Cursiva"><i>I</i></button>' +
      '<button data-cmd="underline" aria-label="Subrayado"><u>U</u></button>' +
      '<button data-cmd="title" aria-label="Título">T</button>' +
      '<button data-cmd="insertUnorderedList" aria-label="Lista con viñetas">• Lista</button>' +
      '<button data-cmd="insertOrderedList" aria-label="Lista numerada">1. Lista</button>' +
      '<button data-cmd="check" aria-label="Lista de casillas">☐ Casillas</button></div>' +
      '<div id="f-notes" class="nrich" contenteditable="true" data-ph="Escribe aquí tus anotaciones…"></div>';
    document.body.appendChild(p);
    document.body.classList.add('noscroll');
    var ed = $('f-notes');
    ed.innerHTML = notesHtml(form.notes);
    positionNotes();
    notesVV = positionNotes;
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', notesVV); window.visualViewport.addEventListener('scroll', notesVV); }
    window.addEventListener('scroll', notesVV);
    p.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-cmd]'); if (!b) return;
      e.preventDefault();
      var cmd = b.getAttribute('data-cmd');
      ed.focus();
      if (cmd === 'title') document.execCommand('formatBlock', false, String(document.queryCommandValue('formatBlock')).toLowerCase() === 'h3' ? 'div' : 'h3');
      else if (cmd === 'check') toggleChecklist();
      else document.execCommand(cmd, false, null);
      notesChanged();
    });
    // Tocar el cuadrado de una casilla la marca / desmarca.
    ed.addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('li');
      if (!li || !li.parentNode.classList.contains('cl')) return;
      if (e.clientX - li.getBoundingClientRect().left > 32) return;
      li.classList.toggle('done'); notesChanged();
    });
    // Una casilla nueva (Enter) empieza sin marcar.
    ed.addEventListener('input', function (e) {
      if (e.inputType !== 'insertParagraph') return;
      var sel = window.getSelection(), n = sel && sel.anchorNode, li = n && (n.nodeType === 1 ? n : n.parentNode).closest('li');
      if (li) li.classList.remove('done');
    });
    setTimeout(function () { ed.focus(); }, 120);
  }
  function toggleChecklist() {
    function curUl() {
      var sel = window.getSelection(), n = sel && sel.anchorNode;
      if (!n) return null;
      if (n.nodeType === 1) { var ch = n.childNodes[sel.anchorOffset] || n.childNodes[sel.anchorOffset - 1]; if (ch && ch.nodeType === 1) n = ch; }
      else n = n.parentNode;
      return (n.closest && n.closest('ul')) || (n.querySelector ? n.querySelector('ul') : null);
    }
    var ul = curUl();
    if (!ul) { document.execCommand('insertUnorderedList'); ul = curUl(); if (ul) ul.classList.add('cl'); return; }
    if (ul.classList.contains('cl')) { ul.classList.remove('cl'); [].forEach.call(ul.querySelectorAll('li.done'), function (l) { l.classList.remove('done'); }); }
    else ul.classList.add('cl');
  }
  function closeNotes(silent) {
    var p = $('notespage'); if (!p) return;
    if (!silent) flushNotes();
    if (notesVV) {
      if (window.visualViewport) { window.visualViewport.removeEventListener('resize', notesVV); window.visualViewport.removeEventListener('scroll', notesVV); }
      window.removeEventListener('scroll', notesVV); notesVV = null;
    }
    p.remove(); document.body.classList.remove('noscroll');
  }
  // En una tarea que ya existe, las notas se guardan solas al escribir.
  var notesT = null;
  function flushNotes() {
    clearTimeout(notesT); notesT = null;
    var x = $('f-notes'); if (!x || !form) return;
    var h = notesHtml(x.innerHTML);
    form.notes = h;
    var t = form.id ? findTask(form.id) : null;
    if (t) { if (h) t.notes = h; else delete t.notes; save(); }
  }
  function notesChanged() {
    var x = $('f-notes'); if (!x || !form) return;
    clearTimeout(notesT); notesT = setTimeout(flushNotes, 600);
  }
  document.addEventListener('input', function (e) {
    if (e.target.id === 'af-q') { ambF().q = e.target.value; var r = $('amb-res'); if (r) r.innerHTML = ambResults(); return; }
    if (e.target.id === 'f-notes') notesChanged();
    if (e.target.id === 'fp-q') {
      var q = e.target.value.toLowerCase(); ui.fq = e.target.value;
      [].forEach.call(document.querySelectorAll('.fpick'), function (b) { b.style.display = b.querySelector('span').textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; });
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'f-title' && form) { e.preventDefault(); saveTask(); }
    if (e.key === 'Enter' && e.target.id === 'i-title' && form) { e.preventDefault(); if (saveIdea()) { closeSheet(); render(); } }
  });
  $('importFile').addEventListener('change', function (e) {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  // Al volver a abrir la app o cambiar de día, refrescar «Hoy».
  document.addEventListener('visibilitychange', function () { if (!document.hidden && $('sheet').classList.contains('hidden')) render(); });

  render();
  if (window.Sync) Sync.init({
    get: function () { return D; },
    replace: function (d) { d.meta = d.meta || {}; D = d; C.save(localStorage, D); render(); },
    refresh: function () { if (ui.view === 'mas' && $('sheet').classList.contains('hidden')) render(); },
    idle: function () { return !drag && $('sheet').classList.contains('hidden'); }
  });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
