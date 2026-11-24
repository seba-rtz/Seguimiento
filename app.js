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
  var GDEF = [['trabajo', '#ff7b7b'], ['formaci', '#7aaed6'], ['obligaci', '#dcd75a'], ['salud', '#a2d964'], ['descanso', '#c9b0f9'], ['universidad', '#4f9dff'], ['horario', '#4f9dff']];
  function gDef(name) { var n = String(name || '').toLowerCase(); for (var i = 0; i < GDEF.length; i++) if (n.indexOf(GDEF[i][0]) >= 0) return GDEF[i][1]; return ''; }
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
        '</span><input type="color" data-gcal="' + esc(ev.calName) + '" value="' + gBase(ev) + '" style="width:48px;height:32px;padding:0;border:0;background:none"></label>';
    });
    return rows ? '<div class="note" style="margin:0 0 4px">Color de cada calendario (se muestra apagado):</div>' + rows + '<div style="height:8px"></div>' : '';
  }
  var G = { events: [], from: '', to: '', at: 0, loading: false, fail: 0, err: '', by: {} };
  try { var gc = JSON.parse(localStorage.getItem(GK)); if (gc && gc.events) { G.events = gc.events; G.from = gc.from; G.to = gc.to; G.at = gc.at; } } catch (e) {}
  function ldate(dt) { return dt.getFullYear() + '-' + C.pad(dt.getMonth() + 1) + '-' + C.pad(dt.getDate()); }
  function indexG() {
    G.by = {};
    G.events.forEach(function (ev) {
      var a, b;
      if (ev.allDay) { a = ev.start; b = C.addDays(ev.end, -1); if (b < a) b = a; }
      else { var s = new Date(ev.start), e = new Date(ev.end); a = ldate(s); b = ldate(new Date(Math.max(s.getTime(), e.getTime() - 1))); }
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
  function doPlan(force) {
    var list = [], now = Date.now(), td = C.today();
    for (var i = 0; i <= 14; i++) {
      var d = C.addDays(td, i);
      C.tasksOn(D, d).forEach(function (x) {
        var t = x.t;
        if (!t.time || C.getState(t, x.d)) return;
        var w = C.parse(x.d), p = t.time.split(':');
        w.setHours(+p[0], +p[1], 0, 0);
        if (w.getTime() <= now) return;
        var sc = C.scopeById(t.scope);
        list.push({ enviar_en: w.toISOString(), titulo: t.title, cuerpo: sc.name + ' · ' + t.time + (t.end ? '–' + t.end : '') });
      });
    }
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
    var fin = function () { done(); };
    Sync.rest('/rest/v1/avisos?enviado=eq.false', { method: 'DELETE', prefer: 'return=minimal' }).then(function () {
      return pushSupported() ? Promise.race([navigator.serviceWorker.ready, new Promise(function (r) { setTimeout(r, 3000); })]).then(function (reg) { return reg && reg.pushManager.getSubscription(); }) : null;
    }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint; sub.unsubscribe();
      return Sync.rest('/rest/v1/suscripciones?endpoint=eq.' + encodeURIComponent(ep), { method: 'DELETE', prefer: 'return=minimal' });
    }).then(fin, fin);
  }
  function testAviso() {
    Sync.rest('/rest/v1/avisos', { method: 'POST', prefer: 'return=minimal', body: [{ enviar_en: new Date(Date.now() - 1000).toISOString(), titulo: 'Aviso de prueba', cuerpo: 'Si lees esto, los avisos funcionan.' }] })
      .then(function (r) { alert(r.ok ? 'Listo. El aviso de prueba llegará en menos de un minuto.' : 'No se pudo crear el aviso (error ' + r.status + ').'); },
        function () { alert('No se pudo crear el aviso. Revisa la conexión y que has iniciado sesión.'); });
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
  function longDate(s) { var d = C.parse(s); return DIAS[C.weekday(d)] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function shortDate(s) { var d = C.parse(s); return d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); }
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
  function groupBySub(items, scope) {
    var out = [];
    subsOf(scope).forEach(function (x) {
      var arr = items.filter(function (i) { return i.t.sub === x.id; });
      if (arr.length) out.push({ sub: x, items: arr });
    });
    var rest = items.filter(function (i) { return !subById(i.t.sub); });
    if (rest.length) out.push({ sub: null, items: rest });
    return out;
  }

  /* ---------- Filas ---------- */
  function recLabel(r) {
    if (!r) return '';
    if (r.type === 'daily') return 'Cada día';
    if (r.type === 'weekly') return 'Cada semana' + (r.days && r.days.length ? ' (' + r.days.map(function (i) { return DL[i]; }).join(' ') + ')' : '');
    if (r.type === 'monthly') return 'Cada mes';
    if (r.type === 'yearly') return 'Cada año';
    var u = { d: 'días', w: 'semanas', m: 'meses' }[r.unit];
    return 'Cada ' + r.n + ' ' + u;
  }

  function taskRow(t, d, showDate, inbox, noSub) {
    var sc = C.scopeById(t.scope), st = C.getState(t, d || t.date);
    var dots = '';
    for (var i = 0; i < (t.priority || 0); i++) dots += '<i></i>';
    var meta = [];
    if (showDate && d) meta.push(shortDate(d));
    if (t.time) meta.push(t.end ? t.time + '–' + t.end : t.time);
    if (!inbox) { var sb = noSub ? null : subById(t.sub); meta.push(sc.name + (sb ? ' › ' + sb.name : '')); }
    if (t.rec) meta.push('↻ ' + recLabel(t.rec));
    var mark = st === 'done' ? '✓' : st === 'wontdo' ? '✕' : '';
    return '<div class="task ' + esc(st || '') + '" style="--c:' + sc.color + '" data-group="' + esc(d || '') + '">' +
      '<span class="bar"></span><span class="dots">' + dots + '</span>' +
      '<button class="chk" data-a="toggle" data-id="' + esc(t.id) + '" data-date="' + esc(d || '') + '" aria-label="Completar">' + mark + '</button>' +
      '<div class="body" data-a="edit" data-id="' + esc(t.id) + '" data-date="' + esc(d || '') + '"><div class="t">' + esc(t.title) + '</div>' +
      (meta.length ? '<div class="m">' + esc(meta.join(' · ')) + '</div>' : '') + '</div>' + (inbox ? '<span class="tag">' + esc(sc.name) + '</span>' : '') + '</div>';
  }
  function list(items, showDate, empty) {
    if (!items.length) return empty ? '<div class="empty">' + empty + '</div>' : '';
    return items.map(function (x) { return taskRow(x.t, x.d, showDate); }).join('');
  }

  /* ---------- Consultas ---------- */
  function pendingNonRec() { return D.tasks.filter(function (t) { return !t.deleted && !t.rec && !C.getState(t); }); }
  function overdue() {
    var td = C.today();
    return C.sortItems(pendingNonRec().filter(function (t) { return t.date && t.date < td; }).map(function (t) { return { t: t, d: t.date }; }))
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
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
    var h = '<div class="card"><div class="wkhead"><button data-a="wk" data-n="-1">‹</button><span>' +
      (ui.weekOff === 0 ? 'Esta semana' : shortDate(monday) + ' – ' + shortDate(C.addDays(monday, 6))) +
      '</span><button data-a="wk" data-n="1">›</button></div><div class="grid"><span></span>';
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
      h += '<span class="tot rk' + (rk ? '' : ' z') + '" style="--c:' + s.color + '" title="Racha: ' + rk + ' días seguidos">' + rk + '</span>';
    });
    return h + '</div></div>';
  }

  function viewHoy() {
    var td = C.today(), items = C.tasksOn(D, td), od = overdue();
    var pend = items.filter(function (x) { return !C.getState(x.t, x.d); }).length;
    setTop('Hoy', longDate(td) + (items.length ? ' · ' + pend + ' pendientes' : ''));
    var h = '';
    if (od.length) h += '<div class="sec">Atrasadas</div>' + list(od, true);
    h += '<div class="sec">Tareas de hoy</div>' + list(items, false, 'No hay tareas para hoy.');
    h += '<div class="sec">Registro de cumplimiento</div>' + weekGrid();
    h += '<div class="note">Toca una casilla para marcar si cumpliste el objetivo del día en ese ámbito. Es independiente de las tareas.</div>' +
      '<div class="note">Mantén pulsada una tarea y arrástrala para ordenarla dentro de su día. Lo que muevas manda; lo que no muevas se ordena solo (prioridad y ámbito).</div>';
    return h;
  }

  // Agrupa por subcategoría (cada grupo en su caja, para que arrastrar no mezcle grupos). Sin subcategorías: lista normal.
  function subGroups(items, scope, rowFn, asSec) {
    var gr = groupBySub(items, scope);
    if (gr.length === 1 && !gr[0].sub) return '<div class="sg">' + items.map(rowFn).join('') + '</div>';
    return gr.map(function (g) {
      var name = esc(g.sub ? g.sub.name : 'Sin subcategoría');
      return (asSec ? '<div class="sec">' + name + '</div>' : '<div class="subh">' + name + '</div>') + '<div class="sg">' + g.items.map(rowFn).join('') + '</div>';
    }).join('');
  }

  function viewBuzon() {
    var items = D.tasks.filter(function (t) { return !t.deleted && !t.date && !C.getState(t); })
      .map(function (t) { return { t: t, d: null }; });
    setTop('Buzón', items.length + ' sin fecha');
    if (!items.length) return '<div class="empty">El buzón está vacío. Las tareas sin fecha aparecen aquí.</div>';
    ui.inbClosed = ui.inbClosed || {};
    var sorted = C.sortItems(items), h = '';
    C.SCOPES.forEach(function (s) {
      var arr = sorted.filter(function (x) { return x.t.scope === s.id; });
      if (!arr.length) return;
      var closed = ui.inbClosed[s.id];
      h += '<div class="grp" style="--c:' + s.color + '"><div class="gh" data-a="grp" data-s="' + s.id + '"><svg class="gico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><b>' + esc(s.name) + '</b><span class="gn">' + arr.length +
        '</span><span class="gch' + (closed ? ' c' : '') + '">⌄</span></div>' +
        (closed ? '' : '<div class="gbody">' + subGroups(arr, s.id, function (x) { return taskRow(x.t, null, false, true); }, false) + '</div>') + '</div>';
    });
    return h;
  }

  function viewProximos() {
    var td = C.today(), h = '';
    setTop('Próximos 7 días', 'Desde mañana');
    for (var i = 1; i <= 7; i++) {
      var d = C.addDays(td, i), items = C.tasksOn(D, d);
      h += '<div class="sec"><span>' + longDate(d) + '</span></div>' + (items.length ? list(items, false) : '<div class="note" style="margin:0 4px 6px">Sin tareas</div>');
    }
    return h;
  }

  function viewTodo() {
    var items = allPending();
    setTop('Todo', items.length + ' pendientes');
    var h = '', last = '#';
    items.forEach(function (x) {
      var key = x.d || '';
      if (key !== last) {
        h += '<div class="sec">' + (x.d ? (x.d < C.today() ? 'Atrasadas · ' : '') + longDate(x.d) : 'Sin fecha') + '</div>'; last = key;
      }
      h += taskRow(x.t, x.d, false);
    });
    return h || '<div class="empty">No hay tareas pendientes.</div>';
  }

  function viewAmbito() {
    var sc = C.scopeById(ui.scope);
    setTop('Por ámbito', sc.name);
    var h = '<div class="chips" style="margin:4px 2px 12px">';
    C.SCOPES.forEach(function (s) {
      h += '<button class="chip sc ' + (s.id === ui.scope ? 'on' : '') + '" style="--c:' + s.color + '" data-a="scope" data-scope="' + s.id + '"><span class="sw"></span>' + s.name + '</button>';
    });
    h += '</div>';
    h += '<div class="row" style="margin:0 2px 6px"><button class="btn" data-a="subman">Editar subcategorías' + (subsOf(ui.scope).length ? ' (' + subsOf(ui.scope).length + ')' : '') + '</button></div>';
    var items = allPending(ui.scope);
    if (!items.length) return h + '<div class="empty">No hay tareas pendientes en este ámbito.</div>';
    return h + subGroups(items, ui.scope, function (x) { return taskRow(x.t, x.d, true, false, true); }, true);
  }

  function hasTasks(d) { return D.tasks.some(function (t) { return !t.deleted && C.occursOn(t, d); }); }
  function dayCell(d, month) {
    var cls = 'day' + (d === C.today() ? ' today' : '') + (d === ui.calSel ? ' sel' : '') + (hasTasks(d) ? ' has' : '') +
      (month && d.slice(0, 7) !== month ? ' out' : '');
    return '<button class="' + cls + '" data-a="calsel" data-date="' + d + '">' + C.parse(d).getDate() + '<span class="dot"></span></button>';
  }
  function viewCal() {
    var sel = ui.calSel, h = '', dh = '';
    DL.forEach(function (l) { dh += '<div class="wd">' + l + '</div>'; });
    if (ui.calOpen) {
      var first = ui.calMonth + '-01', p = first.split('-');
      var start = C.mondayOf(first), cells = '';
      for (var i = 0; i < 42; i++) { var d = C.addDays(start, i); if (i >= 35 && d.slice(0, 7) !== ui.calMonth) break; cells += dayCell(d, ui.calMonth); }
      h += '<div class="calhead"><button class="ar" data-a="calmove" data-n="-1">‹</button><button class="name" data-a="caltoggle">' +
        MESES[+p[1] - 1] + ' ' + p[0] + ' ▴</button><button class="ar" data-a="calmove" data-n="1">›</button></div>' +
        '<div class="calgrid">' + dh + cells + '</div>';
    } else {
      var mon = C.mondayOf(sel), cs = '';
      for (var j = 0; j < 7; j++) cs += dayCell(C.addDays(mon, j), null);
      var sd = C.parse(sel);
      h += '<div class="calhead"><button class="ar" data-a="calmove" data-n="-1">‹</button><button class="name" data-a="caltoggle">' +
        MESES[sd.getMonth()] + ' ' + sd.getFullYear() + ' ▾</button><button class="ar" data-a="calmove" data-n="1">›</button></div>' +
        '<div class="calgrid">' + dh + cs + '</div>';
    }
    setTop('Calendario', longDate(sel));
    var mode = D.meta.calMode === 'dia' ? 'dia' : 'lista';
    h += '<div class="seg"><button class="' + (mode === 'lista' ? 'on' : '') + '" data-a="calmode" data-v="lista">Lista</button>' +
      '<button class="' + (mode === 'dia' ? 'on' : '') + '" data-a="calmode" data-v="dia">Día por horas</button></div>';
    if (mode === 'lista') return h + '<div class="sec">' + longDate(sel) + '</div>' + list(C.tasksOn(D, sel), false, 'Sin tareas este día.');
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
    // reparto en columnas para tareas que se solapan
    var cluster = [], colEnds = [], clEnd = 0;
    function flush() {
      // orden fijo de columnas: tareas a la izquierda, luego calendarios de Google por orden y la universidad siempre a la derecha
      var nc = colEnds.length, cr = [];
      for (var q = 0; q < nc; q++) cr.push({ c: q, r: 99999 });
      cluster.forEach(function (ev) {
        var r = ev.g ? (ev.g.calName === 'Universidad' ? 1000 : ev.g.cal) : -1;
        if (r < cr[ev.c].r) cr[ev.c].r = r;
      });
      var map = {};
      cr.slice().sort(function (p, o) { return p.r - o.r || p.c - o.c; }).forEach(function (o, i) { map[o.c] = i; });
      cluster.forEach(function (ev) { ev.c = map[ev.c]; ev.n = nc; });
      cluster = []; colEnds = [];
    }
    evs.forEach(function (ev) {
      if (cluster.length && ev.s >= clEnd) flush();
      var c = 0; while (c < colEnds.length && colEnds[c] > ev.s) c++;
      colEnds[c] = ev.e; ev.c = c;
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
    var h = '<div class="card"><div class="calhead" style="margin:0 0 6px"><button class="ar" data-a="qmove" data-n="-1">‹</button><span class="name">' + qName(q) +
      (q === C.quarterOf(td) ? ' (actual)' : '') + '</span><button class="ar" data-a="qmove" data-n="1">›</button></div>';
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
    var h = '<div class="sec">Activos</div>';
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

  function viewMas() {
    setTop('Más', '');
    var last = D.meta.lastBackup ? 'Última copia: ' + longDate(D.meta.lastBackup) : 'Aún no has hecho ninguna copia.';
    return '<div class="menu card">' +
      '<button data-a="nav" data-view="proximos">Próximos 7 días</button>' +
      '<button data-a="nav" data-view="todo">Todo</button>' +
      '<button data-a="nav" data-view="ambito">Por ámbito</button>' +
      '<button data-a="nav" data-view="papelera">Papelera</button></div>' +
      accountCard() + '<div class="sec">Copia de seguridad</div><div class="card">' +
      '<div class="note" style="margin:0 0 10px">Tus datos se guardan en este dispositivo y, si has iniciado sesión, también en la nube. Aun así, haz copias de vez en cuando y guárdalas en Archivos o iCloud.</div>' +
      '<button class="btn block" data-a="export">Exportar copia</button>' +
      '<button class="btn block" data-a="import">Importar copia</button>' +
      '<div class="note">' + last + '</div></div><div class="note" style="text-align:center">Versión 21</div>';
  }

  /* ---------- Cuenta y sincronización ---------- */
  function accountCard() {
    if (!window.Sync) return '';
    var s = Sync.info();
    var h = '<div class="sec">Cuenta y sincronización</div><div class="card">';
    if (s.email) {
      h += '<div>' + esc(s.email) + '</div><div class="note" style="margin:2px 0 10px">' + esc(s.text) + '</div>' +
        '<div class="note" style="margin:0 0 10px">Google Calendar: ' + (G.err ? esc(G.err) : G.at ? G.events.length + ' eventos cargados a las ' + hm(new Date(G.at).getHours() * 60 + new Date(G.at).getMinutes()) + '.' : 'pendiente de cargar.') + (G.warn && G.warn.length ? ' Avisos: ' + esc(G.warn.join(' · ')) : '') + '</div>' +
        '<div class="note" style="margin:0 0 10px">Avisos: ' + (D.meta.avisosOn ? 'activados. Llegan a la hora de las tareas que tienen hora.' : 'desactivados.') + '</div>' +
        (D.meta.avisosOn ? '<button class="btn block" data-a="avisotest">Probar aviso ahora</button><button class="btn block" data-a="avisosoff">Desactivar avisos</button>' : '<button class="btn block" data-a="avisoson">Activar avisos en este dispositivo</button>') +
        '<button class="btn block" data-a="syncnow">Sincronizar ahora</button>' +
        '<button class="btn block" data-a="cals">Calendarios (' + calUrls().length + (D.meta.uniUrl ? ' + universidad' : '') + ')</button>' +
        '<button class="btn block" data-a="logout">Cerrar sesión</button>';
    } else {
      h += '<div class="note" style="margin:0 0 10px">Inicia sesión para que tus datos se guarden en la nube y sean los mismos en el móvil y en el ordenador.</div>' +
        '<button class="btn block primary" data-a="login">Iniciar sesión</button>';
    }
    return h + '</div>';
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

  var VIEWS = { hoy: viewHoy, buzon: viewBuzon, proximos: viewProximos, todo: viewTodo, ambito: viewAmbito,
    calendario: viewCal, objetivos: viewObj, papelera: viewPapelera, mas: viewMas };
  var NAVMAP = { proximos: 'mas', todo: 'mas', ambito: 'mas', papelera: 'mas' };

  function setTop(t, s) { $('title').textContent = t; $('subtitle').textContent = s || ''; }
  function render() {
    $('main').innerHTML = VIEWS[ui.view]();
    var on = NAVMAP[ui.view] || ui.view;
    [].forEach.call(document.querySelectorAll('#nav button'), function (b) { b.classList.toggle('on', b.dataset.view === on); });
    $('fab').classList.toggle('hidden', ui.view === 'mas' || ui.view === 'papelera');
    ensureG();
    planAvisos();
    var tl = $('tl');
    if (tl && ui.tlScroll) { ui.tlScroll = false; window.scrollTo(0, Math.max(0, tl.getBoundingClientRect().top + window.scrollY + ui.tlFocus / 60 * HH - 430)); }
  }
  function go(v) { ui.view = v; ui.tlScroll = true; render(); window.scrollTo(0, 0); }

  /* ---------- Hoja inferior ---------- */
  function openSheet(html) {
    var s = $('sheet');
    s.innerHTML = '<div class="ov" data-a="close"></div><div class="panel">' + html + '</div>';
    s.classList.remove('hidden');
  }
  function closeSheet() { closeNotes(true); $('sheet').classList.add('hidden'); $('sheet').innerHTML = ''; form = null; }

  function chipsScope(sel) {
    return C.SCOPES.map(function (s) {
      return '<button class="chip sc ' + (s.id === sel ? 'on' : '') + '" style="--c:' + s.color + '" data-a="fscope" data-v="' + s.id + '"><span class="sw"></span>' + s.name + '</button>';
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

  function defaultDate() {
    if (ui.view === 'hoy') return C.today();
    if (ui.view === 'calendario') return ui.calSel;
    return null;
  }

  /* ---------- Formulario de tarea (compacto, con desplegables) ---------- */
  var IC = {
    cal: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/></svg>'
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

  function refreshTop() {
    var sc = C.scopeById(form.scope), sb = subById(form.sub);
    $('tp-scope').innerHTML = '<i class="sw" style="background:' + sc.color + '"></i>' + esc(sc.name) + '<span class="ch">▾</span>';
    $('tp-sub').innerHTML = (sb ? esc(sb.name) : 'Subcategoría') + '<span class="ch">▾</span>';
    $('tp-sub').classList.toggle('dim', !sb);
    $('tp-prio').innerHTML = IC.flag + (form.priority ? '<b>' + '•'.repeat(form.priority) + '</b>' : '') + '<span class="ch">▾</span>';
    $('tp-prio').classList.toggle('dim', !form.priority);
    var parts = [form.date ? dayWord(form.date) : 'Sin fecha'];
    if (form.time) parts.push(timeText());
    var rl = recLabel(formRec());
    if (rl) parts.push('↻ ' + rl);
    var b = $('tk-datebtn');
    b.innerHTML = IC.cal + '<span>' + esc(parts.join(' · ')) + '</span><span class="ch">' + (form.dateOpen ? '▴' : '▾') + '</span>';
    b.classList.toggle('late', !!(form.date && form.date < C.today() && !form.recType));
    var nb = $('tk-notesbtn'), nh = notesHtml(form.notes);
    nb.classList.toggle('has', !!nh);
    nb.innerHTML = IC.note + (nh ? '<div class="np"><div class="npl">Notas</div><div class="nrich npv">' + nh + '</div></div>' : '<span class="nt">Notas</span>');
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
      if (t.rec && form.ctx) h += menuItem('delone', '', 'Eliminar solo el ' + shortDate(form.ctx), false, 'danger');
      h += menuItem('deltask', '', t.rec ? 'Eliminar toda la serie' : 'Eliminar', false, 'danger');
    }
    el.innerHTML = h; el.classList.remove('hidden');
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
    h += '<button class="acr" data-a="tktime"><span>Hora</span><span class="v">' + (timeText() || 'Ninguna') + ' ' + (form.timeOpen ? '▴' : '▾') + '</span></button>';
    if (form.timeOpen) {
      h += '<div class="row" style="padding:2px 0 0"><div style="flex:1"><div class="note" style="margin:0 0 4px">Inicio</div><input type="time" id="f-time" value="' + (form.time || '') + '"></div>' +
        '<div style="flex:1"><div class="note" style="margin:0 0 4px">Fin (opcional)</div><input type="time" id="f-end" value="' + (form.end || '') + '"></div></div>' +
        '<button class="btn block" data-a="ftimeclear" style="margin:0 0 10px;padding:9px">Quitar hora</button>';
    }
    h += '<button class="acr" data-a="tkrec"><span>Repetir</span><span class="v">' + (recLabel(formRec()) || 'Ninguno') + ' ' + (form.recOpen ? '▴' : '▾') + '</span></button>';
    if (form.recOpen) {
      h += '<div style="padding:2px 0 8px"><select id="f-rec">' +
        [['', 'No se repite'], ['daily', 'Cada día'], ['weekly', 'Cada semana'], ['monthly', 'Cada mes'], ['yearly', 'Cada año'], ['every', 'Cada X días, semanas o meses']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === form.recType ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select><div id="f-rec-extra"></div></div>';
    }
    el.innerHTML = h; el.classList.remove('hidden');
    drawRecExtra();
  }

  function openTask(id, ctxDate, preset) {
    var t = id ? findTask(id) : null;
    var date = t ? t.date : defaultDate();
    form = {
      id: id, ctx: ctxDate || (t && t.date) || null,
      scope: t ? t.scope : (ui.view === 'ambito' ? ui.scope : ui.lastScope),
      sub: t && subById(t.sub) ? t.sub : '',
      priority: t ? (t.priority || 0) : 0,
      date: date || null, time: t && t.time ? t.time : ((preset && preset.time) || null), end: t && t.end ? t.end : null,
      notes: t && t.notes ? t.notes : '',
      recType: t && t.rec ? t.rec.type : '',
      days: t && t.rec && t.rec.days ? t.rec.days.slice() : [],
      n: t && t.rec && t.rec.n ? t.rec.n : 2, unit: t && t.rec && t.rec.unit ? t.rec.unit : 'd',
      menu: null, dateOpen: false, timeOpen: false, recOpen: false, calMonth: null
    };
    if (form.time && !form.date) form.date = C.today();
    var h = '<div id="tk-main"><div class="tk-top"><button class="pill" id="tp-scope" data-a="tkmenu" data-v="scope"></button>' +
      '<button class="pill" id="tp-sub" data-a="tkmenu" data-v="sub"></button><button class="pill" id="tp-prio" data-a="tkmenu" data-v="prio"></button>' +
      (t ? '<button class="pill sq" data-a="tkmenu" data-v="more" aria-label="Más opciones">⋯</button>' : '') + '</div>' +
      '<div class="tk-menu hidden" id="tk-menu"></div>' +
      '<button class="tk-date" id="tk-datebtn" data-a="tkdate"></button><div class="tk-datepanel hidden" id="tk-datepanel"></div>' +
      '<input id="f-title" placeholder="¿Qué necesitas hacer?" value="' + (t ? esc(t.title) : '') + '" autocomplete="off">' +
      '<button class="tk-notesbtn" id="tk-notesbtn" data-a="tknotes"></button>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-a="close" style="flex:1">Cancelar</button><button class="btn primary" data-a="savetask" style="flex:2">' + (t ? 'Guardar' : 'Añadir') + '</button></div></div>';
    openSheet(h);
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
      h = '<div class="row" style="margin-top:8px"><span>Cada</span><input type="number" id="f-n" min="1" max="999" value="' + form.n + '" style="width:80px">' +
        '<select id="f-unit"><option value="d"' + (form.unit === 'd' ? ' selected' : '') + '>días</option><option value="w"' + (form.unit === 'w' ? ' selected' : '') +
        '>semanas</option><option value="m"' + (form.unit === 'm' ? ' selected' : '') + '>meses</option></select></div>';
    }
    el.innerHTML = h;
  }

  function saveTask() {
    var title = $('f-title').value.trim();
    if (!title) { $('f-title').focus(); return; }
    // Si los campos desplegables están abiertos, se toma lo que muestran.
    if ($('f-time')) { form.time = $('f-time').value || null; form.end = $('f-end').value || null; }
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
    if (form.notes && form.notes.trim()) t.notes = form.notes; else delete t.notes;
    // Al cambiar entre repetitiva y única, los estados anteriores ya no valen.
    if (wasRec !== !!rec) { t.states = {}; t.state = null; t.ex = []; }
    ui.lastScope = form.scope;
    save(); closeSheet(); render();
  }

  function openGoal(id) {
    var g = id ? D.goals.filter(function (x) { return x.id === id; })[0] : null;
    form = { goalId: id, scope: g ? g.scope : (ui.view === 'ambito' ? ui.scope : ui.lastScope), status: g ? g.status : 'pendiente' };
    var start = g ? (C.goalStart(g) || C.today()) : C.today(), end = g ? (C.goalEnd(g) || '') : '';
    var h = '<h2>' + (g ? 'Editar objetivo' : 'Nuevo objetivo') + '</h2>' +
      '<input id="g-title" placeholder="¿Qué quieres lograr?" value="' + (g ? esc(g.title) : '') + '" autocomplete="off">' +
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
    if (!g) setTimeout(function () { var el = $('g-title'); if (el) el.focus(); }, 250);
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
    render();
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
    save(); render();
  }
  function pressMove(e) {
    var p = pt(e);
    if (drag) { e.preventDefault(); moveDrag(p); return; }
    if (pressT && press && Math.abs(p.y - press.y) + Math.abs(p.x - press.x) > 10) { clearTimeout(pressT); pressT = null; }
  }
  function pressEnd() { if (pressT) { clearTimeout(pressT); pressT = null; } if (drag) endDrag(); }
  document.addEventListener('touchstart', pressStart, { passive: true });
  document.addEventListener('touchmove', pressMove, { passive: false });
  document.addEventListener('touchend', pressEnd);
  document.addEventListener('touchcancel', pressEnd);
  document.addEventListener('mousedown', pressStart);
  document.addEventListener('mousemove', pressMove);
  document.addEventListener('mouseup', pressEnd);

  document.addEventListener('click', function (e) {
    if (Date.now() < noClickUntil && e.target.closest('.task, .ev')) return;
    var el = e.target.closest('[data-a]');
    if (!el) return;
    var a = el.dataset.a, id = el.dataset.id, d = el.dataset.date, v = el.dataset.v, t;
    switch (a) {
      case 'nav': closeSheet(); go(el.dataset.view); break;
      case 'fab': ui.view === 'objetivos' ? openGoal() : openTask(); break;
      case 'close': closeSheet(); break;
      case 'toggle': t = findTask(id); toggleState(t, d || t.date); break;
      case 'edit': openTask(id, d); break;
      case 'scope': ui.scope = el.dataset.scope; render(); break;
      case 'grp': ui.inbClosed = ui.inbClosed || {}; ui.inbClosed[el.dataset.s] = !ui.inbClosed[el.dataset.s]; render(); break;
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
        ui.calSel = d; ui.calMonth = d.slice(0, 7); ui.tlScroll = true; render(); break;
      case 'calmove':
        var n = +el.dataset.n;
        if (ui.calOpen) {
          var p = ui.calMonth.split('-'), m = new Date(+p[0], +p[1] - 1 + n, 1);
          ui.calMonth = C.fmt(m).slice(0, 7);
          var day = Math.min(C.parse(ui.calSel).getDate(), C.dim(m.getFullYear(), m.getMonth() + 1));
          ui.calSel = ui.calMonth + '-' + C.pad(day);
        } else { ui.calSel = C.addDays(ui.calSel, 7 * n); ui.calMonth = ui.calSel.slice(0, 7); }
        ui.tlScroll = true; render(); break;
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
      case 'avisotest': testAviso(); break;
      case 'cals': openCals(); break;
      case 'calnew': case 'calchg': case 'caldel': calAction(a, id); break;
      case 'gurls':
        var gv = prompt('Pega aquí los enlaces secretos iCal de tus calendarios de Google, separados por un espacio (déjalo vacío para quitarlos):', D.meta.gUrls || '');
        if (gv === null) break;
        gv = gv.trim().replace(/\s+/g, ' ');
        if (gv && gv.split(' ').some(function (x) { return !/^https:\/\//i.test(x); })) { alert('Cada enlace debe empezar por https://'); break; }
        D.meta.gUrls = gv; save(); G.fail = 0; ensureG(true); render(); break;
      case 'uni':
        var uv = prompt('Pega aquí el enlace del horario de la universidad (déjalo vacío para quitarlo):', D.meta.uniUrl || '');
        if (uv === null) break;
        uv = uv.trim();
        if (uv && !/^https:\/\//i.test(uv)) { alert('El enlace debe empezar por https://'); break; }
        D.meta.uniUrl = uv; save(); G.fail = 0; ensureG(true); render(); break;
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
      case 'tktime': form.timeOpen = !form.timeOpen; drawDatePanel(); break;
      case 'tkrec': form.recOpen = !form.recOpen; drawDatePanel(); break;
      case 'fdate':
        if (v === 'none') { form.date = null; form.time = null; form.end = null; form.recType = ''; }
        else form.date = v === 'today' ? C.today() : v === 'tomorrow' ? C.addDays(C.today(), 1) : nextMonday(C.today());
        form.calMonth = form.date ? form.date.slice(0, 7) : null; drawDatePanel(); refreshTop(); break;
      case 'fpick': form.date = d; form.calMonth = d.slice(0, 7); drawDatePanel(); refreshTop(); break;
      case 'fcalmove':
        var cm = (form.calMonth || (form.date || C.today()).slice(0, 7)).split('-'), cd = new Date(+cm[0], +cm[1] - 1 + (+el.dataset.n), 1);
        form.calMonth = C.fmt(cd).slice(0, 7); drawDatePanel(); break;
      case 'ftimeclear': form.time = null; form.end = null; drawDatePanel(); refreshTop(); break;
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
        t = findTask(form.id); t.ex = t.ex || []; t.ex.push(form.ctx); save(); closeSheet(); render(); break;
      case 'deltask':
        t = findTask(form.id); t.deleted = true; t.deletedAt = Date.now(); save(); closeSheet(); render(); break;
      /* formulario de objetivo */
      case 'gstate':
        form.status = v;
        [].forEach.call($('g-st').children, function (c) { c.classList.toggle('on', c.dataset.v === v); }); break;
      case 'gend': $('g-end').value = el.dataset.v === 'q' ? C.quarterEnd(C.quarterOf(C.today())) : ''; break;
      case 'savegoal': saveGoal(); break;
      case 'delgoal':
        if (confirm('¿Eliminar este objetivo?')) { D.goals = D.goals.filter(function (x) { return x.id !== form.goalId; }); save(); closeSheet(); render(); } break;
    }
  });

  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (!form || !id) return;
    if (id === 'f-rec') {
      form.recType = e.target.value;
      if (form.recType && !form.date) form.date = C.today();
      drawRecExtra(); refreshTop(); drawDatePanel();
    } else if (id === 'f-n') { form.n = Math.max(1, parseInt(e.target.value, 10) || 1); refreshTop(); }
    else if (id === 'f-unit') { form.unit = e.target.value; refreshTop(); }
    else if (id === 'f-time' || id === 'f-end') {
      form.time = $('f-time').value || null; form.end = $('f-end').value || null;
      if (form.time && !form.date) form.date = C.today();
      refreshTop();
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
    if (e.target.id === 'f-notes') notesChanged();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'f-title' && form) { e.preventDefault(); saveTask(); }
  });
  $('importFile').addEventListener('change', function (e) {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  // Al volver a abrir la app o cambiar de día, refrescar «Hoy».
  document.addEventListener('visibilitychange', function () { if (!document.hidden && $('sheet').classList.contains('hidden')) render(); });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.gcal) { D.meta.gColors = D.meta.gColors || {}; D.meta.gColors[t.dataset.gcal] = t.value; save(); render(); }
  });

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
