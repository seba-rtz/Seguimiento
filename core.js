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
    for (var i = 0; i < (limit || 400); i++, d = addDays(d, 1)) {
      if (occursOn(t, d) && !getState(t, d)) return d;
    }
    return null;
  }

  function sortItems(items) { // items: [{t, d}]
    return items.sort(function (a, b) {
      var ta = a.t.time || '99:99', tb = b.t.time || '99:99';
      if (ta !== tb) return ta < tb ? -1 : 1;
      if ((b.t.priority || 0) !== (a.t.priority || 0)) return (b.t.priority || 0) - (a.t.priority || 0);
      return a.t.title.localeCompare(b.t.title, 'es');
    });
  }

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
  function load(storage) {
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return emptyData();
      var d = JSON.parse(raw);
      if (!validate(d)) return emptyData();
      d.meta = d.meta || {};
      return d;
    } catch (e) { return emptyData(); }
  }
  function save(storage, data) { storage.setItem(KEY, JSON.stringify(data)); }

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
    shiftQuarter: shiftQuarter, occursOn: occursOn, getState: getState, setState: setState,
    nextOccurrence: nextOccurrence, sortItems: sortItems, tasksOn: tasksOn, emptyData: emptyData,
    uid: uid, validate: validate, load: load, save: save, weekTotals: weekTotals
  };
  if (typeof module !== 'undefined') module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
