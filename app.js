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

  function save() { C.save(localStorage, D); if (window.Sync) Sync.changed(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function longDate(s) { var d = C.parse(s); return DIAS[C.weekday(d)] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function shortDate(s) { var d = C.parse(s); return d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); }
  function findTask(id) { return D.tasks.filter(function (t) { return t.id === id; })[0]; }

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

  function taskRow(t, d, showDate) {
    var sc = C.scopeById(t.scope), st = C.getState(t, d || t.date);
    var dots = '';
    for (var i = 0; i < (t.priority || 0); i++) dots += '<i></i>';
    var meta = [];
    if (showDate && d) meta.push(shortDate(d));
    if (t.time) meta.push(t.end ? t.time + '–' + t.end : t.time);
    meta.push(sc.name);
    if (t.rec) meta.push('↻ ' + recLabel(t.rec));
    var mark = st === 'done' ? '✓' : st === 'wontdo' ? '✕' : '';
    return '<div class="task ' + (st || '') + '" style="--c:' + sc.color + '" data-group="' + (d || '') + '">' +
      '<span class="bar"></span><span class="dots">' + dots + '</span>' +
      '<button class="chk" data-a="toggle" data-id="' + t.id + '" data-date="' + (d || '') + '" aria-label="Completar">' + mark + '</button>' +
      '<div class="body" data-a="edit" data-id="' + t.id + '" data-date="' + (d || '') + '"><div class="t">' + esc(t.title) +
      '</div><div class="m">' + esc(meta.join(' · ')) + '</div></div></div>';
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
    var tot = C.weekTotals(D, monday);
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
      h += '<span class="tot">' + tot[s.id] + '/7</span>';
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

  function viewBuzon() {
    var items = D.tasks.filter(function (t) { return !t.deleted && !t.date && !C.getState(t); })
      .map(function (t) { return { t: t, d: null }; });
    setTop('Buzón', items.length + ' sin fecha');
    return list(C.sortItems(items), false, 'El buzón está vacío. Las tareas sin fecha aparecen aquí.');
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
    var items = allPending(ui.scope);
    return h + list(items, true, 'No hay tareas pendientes en este ámbito.');
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
    var evs = items.filter(function (x) { return x.t.time; }).map(function (x) {
      var s = mins(x.t.time), e = x.t.end ? mins(x.t.end) : s + 60;
      if (e <= s) e = s + 30;
      return { x: x, s: s, e: Math.min(e, 1440) };
    }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    // reparto en columnas para tareas que se solapan
    var cluster = [], colEnds = [], clEnd = 0;
    function flush() { cluster.forEach(function (ev) { ev.n = colEnds.length; }); cluster = []; colEnds = []; }
    evs.forEach(function (ev) {
      if (cluster.length && ev.s >= clEnd) flush();
      var c = 0; while (c < colEnds.length && colEnds[c] > ev.s) c++;
      colEnds[c] = ev.e; ev.c = c;
      clEnd = cluster.length ? Math.max(clEnd, ev.e) : ev.e;
      cluster.push(ev);
    });
    flush();
    var h = '';
    if (untimed.length) h += '<div class="sec">Sin hora</div>' + list(untimed, false);
    h += '<div class="sec">' + longDate(sel) + '</div><div class="tl" id="tl" style="height:' + (24 * HH) + 'px">';
    for (var i = 0; i < 24; i++) {
      h += '<div class="hl" style="top:' + (i * HH) + 'px;height:' + HH + 'px" data-a="slot" data-h="' + i + '"><span>' + C.pad(i) + ':00</span></div>';
    }
    evs.forEach(function (ev) {
      var t = ev.x.t, sc = C.scopeById(t.scope), st = C.getState(t, sel);
      var top = ev.s / 60 * HH, ht = Math.max((ev.e - ev.s) / 60 * HH - 2, 28);
      h += '<div class="ev ' + (st || '') + '" style="--c:' + sc.color + ';--fg:' + fgFor(sc.color) + ';top:' + top + 'px;height:' + ht + 'px;left:calc(54px + (100% - 58px) * ' + ev.c + ' / ' + ev.n +
        ');width:calc((100% - 58px) / ' + ev.n + ' - 3px)"><button class="evchk" data-a="toggle" data-id="' + t.id + '" data-date="' + sel + '" aria-label="Completar">' +
        (st === 'done' ? '✓' : st === 'wontdo' ? '✕' : '') + '</button><div class="evb" data-a="edit" data-id="' + t.id + '" data-date="' + sel + '"><div class="evt">' + esc(t.title) +
        '</div><div class="evm">' + t.time + (t.end ? '–' + t.end : '') + '</div></div></div>';
    });
    if (sel === C.today()) {
      var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
      h += '<div class="now" style="top:' + (nm / 60 * HH) + 'px"></div>';
    }
    ui.tlFocus = evs.length ? evs[0].s : (sel === C.today() ? new Date().getHours() * 60 : 7 * 60);
    return h + '</div>';
  }

  function qName(q) { return q.slice(6) + 'º trimestre ' + q.slice(0, 4); }
  function viewObj() {
    setTop('Objetivos', qName(ui.quarter));
    var h = '<div class="calhead"><button class="ar" data-a="qmove" data-n="-1">‹</button><span class="name">' + qName(ui.quarter) +
      (ui.quarter === C.quarterOf(C.today()) ? ' (actual)' : '') + '</span><button class="ar" data-a="qmove" data-n="1">›</button></div>';
    var gs = D.goals.filter(function (g) { return g.quarter === ui.quarter; });
    if (!gs.length) return h + '<div class="empty">No hay objetivos en este trimestre. Pulsa + para añadir uno.</div>';
    C.SCOPES.forEach(function (s) {
      var arr = gs.filter(function (g) { return g.scope === s.id; });
      if (!arr.length) return;
      h += '<div class="sec">' + s.name + '</div>';
      arr.forEach(function (g) {
        var st = C.GOAL_STATES.filter(function (x) { return x.id === g.status; })[0] || C.GOAL_STATES[0];
        h += '<div class="goal ' + g.status + '" style="--c:' + s.color + '"><span class="bar"></span><div class="t" data-a="goaledit" data-id="' + g.id + '">' +
          esc(g.title) + '</div><button class="pill ' + g.status + '" data-a="goalcycle" data-id="' + g.id + '">' + st.name + '</button></div>';
      });
    });
    return h;
  }

  function viewPapelera() {
    var items = D.tasks.filter(function (t) { return t.deleted; });
    setTop('Papelera', items.length + ' tareas');
    if (!items.length) return '<div class="empty">La papelera está vacía.</div>';
    var h = '';
    items.forEach(function (t) {
      var sc = C.scopeById(t.scope);
      h += '<div class="card" style="border-left:5px solid ' + sc.color + '"><div>' + esc(t.title) + '</div><div class="note" style="margin:2px 0 10px">' +
        sc.name + (t.date ? ' · ' + shortDate(t.date) : '') + '</div><div class="row"><button class="btn" data-a="restore" data-id="' + t.id +
        '">Recuperar</button><button class="btn danger" data-a="purge" data-id="' + t.id + '">Borrar para siempre</button></div></div>';
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
      '<div class="note">' + last + '</div></div><div class="note" style="text-align:center">Versión 6</div>';
  }

  /* ---------- Cuenta y sincronización ---------- */
  function accountCard() {
    if (!window.Sync) return '';
    var s = Sync.info();
    var h = '<div class="sec">Cuenta y sincronización</div><div class="card">';
    if (s.email) {
      h += '<div>' + esc(s.email) + '</div><div class="note" style="margin:2px 0 10px">' + esc(s.text) + '</div>' +
        '<button class="btn block" data-a="syncnow">Sincronizar ahora</button>' +
        '<button class="btn block" data-a="logout">Cerrar sesión</button>';
    } else {
      h += '<div class="note" style="margin:0 0 10px">Inicia sesión para que tus datos se guarden en la nube y sean los mismos en el móvil y en el ordenador.</div>' +
        '<button class="btn block primary" data-a="login">Iniciar sesión</button>';
    }
    return h + '</div>';
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
  function closeSheet() { $('sheet').classList.add('hidden'); $('sheet').innerHTML = ''; form = null; }

  function chipsScope(sel) {
    return C.SCOPES.map(function (s) {
      return '<button class="chip sc ' + (s.id === sel ? 'on' : '') + '" style="--c:' + s.color + '" data-a="fscope" data-v="' + s.id + '"><span class="sw"></span>' + s.name + '</button>';
    }).join('');
  }

  function defaultDate() {
    if (ui.view === 'hoy') return C.today();
    if (ui.view === 'calendario') return ui.calSel;
    return null;
  }

  function openTask(id, ctxDate, preset) {
    var t = id ? findTask(id) : null;
    form = {
      id: id, ctx: ctxDate || (t && t.date) || null,
      scope: t ? t.scope : (ui.view === 'ambito' ? ui.scope : ui.lastScope),
      priority: t ? (t.priority || 0) : 0,
      recType: t && t.rec ? t.rec.type : '',
      days: t && t.rec && t.rec.days ? t.rec.days.slice() : [],
      n: t && t.rec && t.rec.n ? t.rec.n : 2, unit: t && t.rec && t.rec.unit ? t.rec.unit : 'd'
    };
    var date = t ? t.date : defaultDate();
    var h = '<h2>' + (t ? 'Editar tarea' : 'Nueva tarea') + '</h2>' +
      '<input id="f-title" placeholder="¿Qué necesitas hacer?" value="' + (t ? esc(t.title) : '') + '" autocomplete="off">' +
      '<div class="lbl">Ámbito</div><div class="chips" id="f-scope">' + chipsScope(form.scope) + '</div>' +
      '<div class="lbl">Prioridad</div><div class="chips" id="f-prio">' +
      ['Sin prioridad', '•', '••', '•••'].map(function (l, i) {
        return '<button class="chip ' + (i === form.priority ? 'on' : '') + '" data-a="fprio" data-v="' + i + '">' + l + '</button>';
      }).join('') + '</div>' +
      '<div class="lbl">Fecha</div><div class="row"><input type="date" id="f-date" value="' + (date || '') + '">' +
      '<button class="btn" data-a="fdate" data-v="today">Hoy</button><button class="btn" data-a="fdate" data-v="tomorrow">Mañana</button>' +
      '<button class="btn" data-a="fdate" data-v="none">Sin fecha</button></div>' +
      '<div class="lbl">Hora (opcional)</div><div class="row"><div style="flex:1"><div class="note" style="margin:0 0 4px">Inicio (opcional)</div><input type="time" id="f-time" value="' + (t && t.time ? t.time : (preset && preset.time) || '') +
      '"></div><div style="flex:1"><div class="note" style="margin:0 0 4px">Fin (opcional)</div><input type="time" id="f-end" value="' + (t && t.end ? t.end : '') +
      '"></div><button class="btn" data-a="ftimeclear" style="align-self:flex-end">Quitar</button></div>' +
      '<div class="lbl">Repetir</div><select id="f-rec">' +
      [['', 'No se repite'], ['daily', 'Cada día'], ['weekly', 'Cada semana'], ['monthly', 'Cada mes'], ['yearly', 'Cada año'], ['every', 'Cada X días, semanas o meses']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === form.recType ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select><div id="f-rec-extra"></div><div class="actions"><button class="btn primary" data-a="savetask">' + (t ? 'Guardar' : 'Añadir') + '</button>';
    if (t) {
      var st = C.getState(t, form.ctx || t.date);
      h += '<button class="btn" data-a="wontdo">' + (st === 'wontdo' ? 'Quitar «No lo haré»' : 'No lo haré') + '</button>';
      if (t.rec && form.ctx) h += '<button class="btn danger" data-a="delone">Eliminar solo el ' + shortDate(form.ctx) + '</button>';
      h += '<button class="btn danger" data-a="deltask">' + (t.rec ? 'Eliminar toda la serie' : 'Eliminar') + '</button>';
    }
    h += '<button class="btn" data-a="close">Cancelar</button></div>';
    openSheet(h);
    drawRecExtra();
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
    var date = $('f-date').value || null, time = $('f-time').value || null, end = $('f-end').value || null;
    if (end && !time) { alert('Pon también la hora de inicio, o quita la de fin.'); return; }
    if (end && end <= time) { alert('La hora de fin debe ser posterior a la de inicio.'); return; }
    var ty = $('f-rec').value, rec = null;
    if ((ty || time) && !date) date = C.today();
    if (ty === 'weekly') rec = { type: 'weekly', days: form.days.slice().sort() };
    else if (ty === 'every') rec = { type: 'every', n: Math.max(1, parseInt($('f-n').value, 10) || 1), unit: $('f-unit').value };
    else if (ty) rec = { type: ty };
    var t = form.id ? findTask(form.id) : null;
    if (!t) { t = { id: C.uid(), created: Date.now() }; D.tasks.push(t); }
    var wasRec = !!t.rec;
    t.title = title; t.scope = form.scope; t.priority = form.priority; t.date = date; t.time = time; t.end = end; t.rec = rec;
    // Al cambiar entre repetitiva y única, los estados anteriores ya no valen.
    if (wasRec !== !!rec) { t.states = {}; t.state = null; t.ex = []; }
    ui.lastScope = form.scope;
    save(); closeSheet(); render();
  }

  function openGoal(id) {
    var g = id ? D.goals.filter(function (x) { return x.id === id; })[0] : null;
    var cur = C.quarterOf(C.today()), qs = [];
    for (var i = -2; i <= 4; i++) qs.push(C.shiftQuarter(cur, i));
    form = { goalId: id, scope: g ? g.scope : (ui.view === 'ambito' ? ui.scope : ui.lastScope), status: g ? g.status : 'pendiente' };
    if (g && qs.indexOf(g.quarter) < 0) qs.push(g.quarter);
    var qSel = g ? g.quarter : ui.quarter;
    if (qs.indexOf(qSel) < 0) qs.push(qSel);
    qs.sort();
    var h = '<h2>' + (g ? 'Editar objetivo' : 'Nuevo objetivo') + '</h2>' +
      '<input id="g-title" placeholder="¿Qué quieres lograr este trimestre?" value="' + (g ? esc(g.title) : '') + '" autocomplete="off">' +
      '<div class="lbl">Ámbito</div><div class="chips" id="f-scope">' + chipsScope(form.scope) + '</div>' +
      '<div class="lbl">Trimestre</div><select id="g-q">' + qs.map(function (q) { return '<option value="' + q + '"' + (q === qSel ? ' selected' : '') + '>' + qName(q) + '</option>'; }).join('') + '</select>' +
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
    var g = form.goalId ? D.goals.filter(function (x) { return x.id === form.goalId; })[0] : null;
    if (!g) { g = { id: C.uid() }; D.goals.push(g); }
    g.title = title; g.scope = form.scope; g.quarter = $('g-q').value; g.status = form.status;
    ui.lastScope = form.scope; ui.quarter = g.quarter;
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
    if (!row || e.target.closest('.chk')) return;
    var p = pt(e); press = p;
    pressT = setTimeout(function () { pressT = null; startDrag(row, p); }, 350);
  }
  function startDrag(row, p) {
    drag = { row: row, group: row.dataset.group, box: row.parentNode };
    row.classList.add('drag'); document.body.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(15);
  }
  function moveDrag(p) {
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
    if (Date.now() < noClickUntil && e.target.closest('.task')) return;
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
        if (confirm('¿Cerrar sesión? Los datos seguirán guardados en este dispositivo.')) { Sync.signOut(); render(); } break;
      case 'syncnow': Sync.sync(); break;
      /* formulario de tarea */
      case 'fscope':
        form.scope = v;
        [].forEach.call($('f-scope').children, function (c) { c.classList.toggle('on', c.dataset.v === v); }); break;
      case 'fprio':
        form.priority = +v;
        [].forEach.call($('f-prio').children, function (c) { c.classList.toggle('on', c.dataset.v === v); }); break;
      case 'fdate':
        $('f-date').value = v === 'today' ? C.today() : v === 'tomorrow' ? C.addDays(C.today(), 1) : ''; break;
      case 'ftimeclear': $('f-time').value = ''; $('f-end').value = ''; break;
      case 'fday':
        var k = form.days.indexOf(+v); if (k >= 0) form.days.splice(k, 1); else form.days.push(+v);
        el.classList.toggle('on'); break;
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
      case 'savegoal': saveGoal(); break;
      case 'delgoal':
        if (confirm('¿Eliminar este objetivo?')) { D.goals = D.goals.filter(function (x) { return x.id !== form.goalId; }); save(); closeSheet(); render(); } break;
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'f-rec') {
      form.recType = e.target.value;
      if (form.recType && !$('f-date').value) $('f-date').value = C.today();
      drawRecExtra();
    } else if (e.target.id === 'f-n') form.n = Math.max(1, parseInt(e.target.value, 10) || 1);
    else if (e.target.id === 'f-unit') form.unit = e.target.value;
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
