/* Lógica de la app: ámbitos, fechas, recurrencia y almacenamiento. Sin interfaz. */
(function (root) {
  'use strict';

  var SCOPES = [
    { id: 'salud', name: 'Salud', color: '#34c759' },
    { id: 'formacion', name: 'Formación', color: '#4a9bff' },
    { id: 'proyectos', name: 'Proyectos', color: '#ff4d4d' },
    { id: 'tareas', name: 'Tareas', color: '#f5c518' },
    { id: 'descanso', name: 'Descanso', color: '#a56bff' }
  ];
  var PRIORITIES = ['Sin importancia', 'Poco importante', 'Menos importante', 'Importante'];
  var GOAL_STATES = [
    { id: 'pendiente', name: 'Pendiente' },
    { id: 'en_curso', name: 'En curso' },
    { id: 'cumplido', name: 'Cumplido' }
  ];
  var KEY = 'seguimiento.v1';

  function scopeById(id) {
    for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i].id === id) return SCOPES[i];
    return SCOPES[3];
  }

  /* ---------- Fechas (texto AAAA-MM-DD, hora local) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { return fmt(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function diffDays(a, b) {
    var x = parse(a), y = parse(b);
    return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) -
      Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5);
  }
  function weekday(d) { return (d.getDay() + 6) % 7; } // lunes = 0
  function dim(y, m1) { return new Date(y, m1, 0).getDate(); }
  function mondayOf(s) { return addDays(s, -weekday(parse(s))); }
  function quarterOf(s) { var d = parse(s); return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1); }
  function shiftQuarter(q, n) {
    var y = +q.slice(0, 4), k = +q.slice(6) - 1 + n;
    y += Math.floor(k / 4); k = ((k % 4) + 4) % 4;
    return y + '-Q' + (k + 1);
  }

  /* ---------- Trimestres y objetivos con fechas ---------- */
  function quarterStart(q) { return q.slice(0, 4) + '-' + pad((+q.slice(6) - 1) * 3 + 1) + '-01'; }
  function quarterEnd(q) { return addDays(quarterStart(shiftQuarter(q, 1)), -1); }
  // Objetivos antiguos (solo con trimestre): su inicio y su fin son los del trimestre.
  function goalStart(g) { return g.start || (g.quarter ? quarterStart(g.quarter) : ''); }
  function goalEnd(g) { return g.end != null ? g.end : (g.quarter ? quarterEnd(g.quarter) : ''); }
  function firstMarkDay(data) {
    var f = '';
    Object.keys(data.log).forEach(function (d) {
      var day = data.log[d];
      if (!day || (f && d >= f)) return;
      for (var k in day) if (day[k]) { f = d; return; }
    });
    return f;
  }
  // Cumplimiento por ámbito en un trimestre: días marcados entre días transcurridos.
  // Cuenta desde el primer día con registro (si cae dentro del trimestre) hasta hoy o el fin del trimestre.
  function quarterStats(data, q, td) {
    var qs = quarterStart(q), qe = quarterEnd(q), fm = firstMarkDay(data);
    var from = (fm && fm > qs) ? fm : qs, to = td < qe ? td : qe;
    var res = { q: q, qs: qs, qe: qe, from: from, to: to, days: 0, scopes: {} };
    SCOPES.forEach(function (s) { res.scopes[s.id] = 0; });
    if (!fm || from > to) return res;
    res.days = diffDays(from, to) + 1;
    for (var i = 0; i < res.days; i++) {
      var day = data.log[addDays(from, i)];
      if (day) SCOPES.forEach(function (s) { if (day[s.id]) res.scopes[s.id]++; });
    }
    return res;
  }

  /* ---------- Recurrencia ---------- */
  function occursOn(t, d) {
    if (!t.date) return false;
    if (!t.rec) return t.date === d;
    if (d < t.date) return false;
    if (t.ex && t.ex.indexOf(d) >= 0) return false;
    var r = t.rec, s = parse(t.date), x = parse(d);
    var clampDay = Math.min(s.getDate(), dim(x.getFullYear(), x.getMonth() + 1));
    switch (r.type) {
      case 'daily': return true;
      case 'weekly':
        var days = (r.days && r.days.length) ? r.days : [weekday(s)];
        return days.indexOf(weekday(x)) >= 0;
      case 'monthly': return x.getDate() === clampDay;
      case 'yearly': return x.getMonth() === s.getMonth() && x.getDate() === clampDay;
      case 'every':
        var n = Math.max(1, +r.n || 1);
        if (r.unit === 'd') return diffDays(t.date, d) % n === 0;
        if (r.unit === 'w') return diffDays(t.date, d) % (7 * n) === 0;
        var md = (x.getFullYear() - s.getFullYear()) * 12 + (x.getMonth() - s.getMonth());
        return md % n === 0 && x.getDate() === clampDay;
    }
    return false;
  }

  function getState(t, d) {
    if (t.rec) return (t.states && t.states[d]) || null;
    return t.state || null;
  }
  function setState(t, d, s) {
    if (t.rec) {
      t.states = t.states || {};
      if (s) t.states[d] = s; else delete t.states[d];
    } else {
      t.state = s || null;
    }
  }

  function nextOccurrence(t, from, limit) {
    if (!t.date) return null;
    if (!t.rec) return t.date >= from ? t.date : null;
    var d = from < t.date ? t.date : from;
    // Las repeticiones «cada X meses/semanas» pueden estar a más de 400 días: se busca hasta el intervalo completo (máx. 10 años).
    if (!limit) {
      limit = 400;
      if (t.rec.type === 'every') {
        var n = Math.max(1, +t.rec.n || 1);
        limit = Math.min(3700, Math.max(400, (t.rec.unit === 'm' ? n * 31 : t.rec.unit === 'w' ? n * 7 : n) + 31));
      }
    }
    for (var i = 0; i < limit; i++, d = addDays(d, 1)) {
      if (occursOn(t, d) && !getState(t, d)) return d;
    }
    return null;
  }

  // Orden: (la fecha la fija cada vista) -> orden arrastrado -> prioridad -> ámbito -> creación.
  function scopeIndex(id) { for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i].id === id) return i; return 99; }
  function orderOf(t) { return t.order != null ? t.order : (t.created || 0); }
  function cmp(a, b) {
    // 1.º el orden que el usuario ha arrastrado; 2.º el orden por defecto.
    var ma = a.t.order != null, mb = b.t.order != null;
    if (ma && mb && a.t.order !== b.t.order) return a.t.order - b.t.order;
    if (ma !== mb) return ma ? -1 : 1;
    var pa = a.t.priority || 0, pb = b.t.priority || 0;
    if (pa !== pb) return pb - pa;
    var sa = scopeIndex(a.t.scope), sb = scopeIndex(b.t.scope);
    if (sa !== sb) return sa - sb;
    var oa = a.t.created || 0, ob = b.t.created || 0;
    if (oa !== ob) return oa - ob;
    return a.t.title.localeCompare(b.t.title, 'es');
  }
  function sortItems(items) { return items.sort(cmp); } // items: [{t, d}]

  function tasksOn(data, d) {
    var out = [];
    data.tasks.forEach(function (t) { if (!t.deleted && occursOn(t, d)) out.push({ t: t, d: d }); });
    return sortItems(out);
  }

  /* ---------- Datos ---------- */
  function emptyData() { return { v: 1, tasks: [], log: {}, goals: [], meta: {} }; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function validate(d) {
    return d && typeof d === 'object' && Array.isArray(d.tasks) && Array.isArray(d.goals) && d.log && typeof d.log === 'object';
  }
  // Si lo guardado está dañado, se conserva aparte antes de empezar de cero (para no perderlo al guardar encima).
  function rescue(storage, raw) { try { if (raw) storage.setItem(KEY + '.corrupta', raw); } catch (e) { /* sin espacio: no se puede hacer más */ } }
  function load(storage) {
    var raw = null;
    try {
      raw = storage.getItem(KEY);
      if (!raw) return emptyData();
      var d = JSON.parse(raw);
      if (!validate(d)) { rescue(storage, raw); return emptyData(); }
      d.meta = d.meta || {};
      return d;
    } catch (e) { rescue(storage, raw); return emptyData(); }
  }
  // Devuelve false si no se pudo guardar (por ejemplo, almacenamiento lleno), en vez de fallar en silencio.
  function save(storage, data) {
    try { storage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }

  function weekTotals(data, monday) {
    var res = {};
    SCOPES.forEach(function (s) {
      var n = 0;
      for (var i = 0; i < 7; i++) {
        var day = data.log[addDays(monday, i)];
        if (day && day[s.id]) n++;
      }
      res[s.id] = n;
    });
    return res;
  }

  root.Core = {
    SCOPES: SCOPES, PRIORITIES: PRIORITIES, GOAL_STATES: GOAL_STATES, KEY: KEY,
    scopeById: scopeById, pad: pad, fmt: fmt, parse: parse, today: today, addDays: addDays,
    diffDays: diffDays, weekday: weekday, dim: dim, mondayOf: mondayOf, quarterOf: quarterOf,
    shiftQuarter: shiftQuarter, quarterStart: quarterStart, quarterEnd: quarterEnd, goalStart: goalStart, goalEnd: goalEnd,
    quarterStats: quarterStats, occursOn: occursOn, getState: getState, setState: setState,
    nextOccurrence: nextOccurrence, sortItems: sortItems, cmp: cmp, orderOf: orderOf, tasksOn: tasksOn, emptyData: emptyData,
    uid: uid, validate: validate, load: load, save: save, weekTotals: weekTotals
  };
  if (typeof module !== 'undefined') module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
