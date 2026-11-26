/* Gestor: cálculos del dinero (sin pantalla). Lo usa app.js y se puede probar aparte.
   Datos: D.money = {
     cfg: { start: 'AAAA-MM-DD' (primer día del primer periodo), day: 5 (día en que empieza cada periodo),
            split: { fijos, libres, inversion, ahorro } (porcentajes de la nómina, suman 100),
            init: { t, e, f, l, i } (céntimos al empezar: tarjeta, efectivo, fijos disponibles, libres disponibles, inversión pendiente),
            subs: { fijos: [...], libres: [...] } },
     mov: [{ id, date, cat, c (céntimos, positivo; en «ajuste» lleva signo), acc: 't'|'e', sub, txt, to (solo ajuste), sp (reparto de una nómina), at }]
   }
   Reglas (las mismas que la página Gestor de Notion):
   - La nómina se reparte entre fijos, libres, inversión y ahorro según el reparto (se guarda con cada nómina).
   - Propinas y otros ingresos van enteros al ahorro.
   - Fijos y libres son del periodo: al empezar el siguiente, lo que sobra pasa a ahorro (y lo gastado de más lo resta).
   - La inversión pendiente se acumula de un periodo a otro.
   - Ahorro = dinero total − lo que queda en fijos, libres e inversión (si un presupuesto está en negativo, cuenta como 0).
   - El ahorro se reserva primero en la tarjeta; lo que no quepa, en efectivo. */
(function (root) {
  'use strict';
  var CATS = [
    { id: 'fijos', name: 'Gastos fijos', short: 'Fijos', kind: 'gasto', color: '#ff9f43' },
    { id: 'libres', name: 'Libres de culpa', short: 'Libres', kind: 'gasto', color: '#ff6fa8' },
    { id: 'inversion', name: 'Inversión', short: 'Inversión', kind: 'gasto', color: '#a56bff' },
    { id: 'ahorro', name: 'Pagado con ahorros', short: 'Con ahorros', kind: 'gasto', color: '#34c759' },
    { id: 'nomina', name: 'Nómina', short: 'Nómina', kind: 'ingreso', color: '#4a9bff' },
    { id: 'extra', name: 'Propinas y otros ingresos', short: 'Otros ingresos', kind: 'ingreso', color: '#2ec4b6' },
    { id: 'retirada', name: 'Sacar efectivo', short: 'Sacar efectivo', kind: 'traspaso', color: '#8d8d96' },
    { id: 'deposito', name: 'Ingresar efectivo', short: 'Ingresar efectivo', kind: 'traspaso', color: '#8d8d96' },
    { id: 'ajuste', name: 'Ajuste de saldo', short: 'Ajuste', kind: 'ajuste', color: '#8d8d96' }
  ];
  var SPLIT = { fijos: 50, libres: 20, inversion: 20, ahorro: 10 };
  var SUBS = {
    fijos: ['Supermercado', 'Gasolina', 'Transporte', 'Salud', 'Peluquería', 'Otros fijos'],
    libres: ['Comida fuera', 'Ocio', 'Suscripciones', 'Compras personales', 'Otros libres']
  };
  function cat(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]; return CATS[CATS.length - 1]; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }

  // Periodo que contiene el día d (del día «day» de un mes al día anterior del mes siguiente).
  function periodOf(d, day) {
    day = day || 5;
    var x = parse(d), y = x.getFullYear(), m = x.getMonth();
    if (x.getDate() < day) m--;
    var s = new Date(y, m, day), e = new Date(y, m + 1, day - 1);
    return { start: fmt(s), end: fmt(e) };
  }
  function nextPeriod(p, day) { return periodOf(addDays(p.end, 1), day); }
  function prevPeriod(p, day) { return periodOf(addDays(p.start, -1), day); }

  // Céntimos <-> texto
  function toCents(v) {
    if (typeof v === 'number') return Math.round(v * 100);
    var s = String(v == null ? '' : v).trim().replace(/\s|€/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  function eur(c, sign) {
    c = Math.round(c || 0);
    var neg = c < 0, a = Math.abs(c), ent = Math.floor(a / 100), dec = pad(a % 100);
    var s = String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : sign && c > 0 ? '+' : '') + s + ',' + dec + ' €';
  }
  function plain(c) { var a = Math.abs(Math.round(c || 0)); return (c < 0 ? '-' : '') + Math.floor(a / 100) + ',' + pad(a % 100); }

  function blank() { return { cfg: null, mov: [] }; }
  function cfgOf(M) {
    var c = M && M.cfg;
    if (!c) return null;
    return {
      start: c.start, day: c.day || 5,
      split: c.split || SPLIT,
      init: c.init || { t: 0, e: 0, f: 0, l: 0, i: 0 },
      subs: c.subs || SUBS
    };
  }
  function splitOk(sp) {
    var n = ['fijos', 'libres', 'inversion', 'ahorro'], s = 0;
    for (var i = 0; i < n.length; i++) { var v = +sp[n[i]]; if (!(v >= 0 && v <= 100)) return false; s += v; }
    return Math.abs(s - 100) < 0.001;
  }
  // Reparto de una nómina en céntimos (el ahorro se lleva el redondeo).
  function share(c, sp) {
    var f = Math.round(c * sp.fijos / 100), l = Math.round(c * sp.libres / 100), i = Math.round(c * sp.inversion / 100);
    return { fijos: f, libres: l, inversion: i, ahorro: c - f - l - i };
  }
  function sorted(mov) {
    return (mov || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0); });
  }

  // Estado completo hasta «td» (incluido): saldos, presupuestos del periodo actual e historial de periodos.
  function calc(M, td) {
    var cf = cfgOf(M);
    if (!cf || !cf.start) return null;
    var day = cf.day, init = cf.init;
    var t = init.t || 0, e = init.e || 0, f = init.f || 0, l = init.l || 0, inv = init.i || 0, invTot = 0;
    var p = periodOf(cf.start, day), hist = [], cur = newStats(p, f, l);
    function newStats(per, f0, l0) {
      return { start: per.start, end: per.end, fIni: f0, lIni: l0, nom: 0, extra: 0, asigF: 0, asigL: 0, asigI: 0, asigA: 0,
        gF: 0, gL: 0, gI: 0, gA: 0, adj: 0, subs: {}, n: 0 };
    }
    function close() {
      cur.fFin = f; cur.lFin = l; cur.toSave = f + l; // lo que pasa al ahorro (negativo: lo que resta)
      hist.push(cur);
      p = nextPeriod(p, day);
      f = 0; l = 0;
      cur = newStats(p, 0, 0);
    }
    var limit = td && td > cf.start ? td : cf.start;
    sorted(M.mov).forEach(function (m) {
      if (m.date < cf.start) return;
      while (m.date > cur.end) close();
      var c = Math.round(m.c || 0), acc = m.acc === 'e' ? 'e' : 't';
      var sgn = function (v) { if (acc === 'e') e += v; else t += v; };
      cur.n++;
      switch (m.cat) {
        case 'nomina':
          var sh = share(c, m.sp && splitOk(m.sp) ? m.sp : cf.split);
          sgn(c); f += sh.fijos; l += sh.libres; inv += sh.inversion;
          cur.nom += c; cur.asigF += sh.fijos; cur.asigL += sh.libres; cur.asigI += sh.inversion; cur.asigA += sh.ahorro; break;
        case 'extra': sgn(c); cur.extra += c; break;
        case 'fijos': sgn(-c); f -= c; cur.gF += c; break;
        case 'libres': sgn(-c); l -= c; cur.gL += c; break;
        case 'inversion': sgn(-c); inv -= c; invTot += c; cur.gI += c; break;
        case 'ahorro': sgn(-c); cur.gA += c; break;
        case 'retirada': t -= c; e += c; break;
        case 'deposito': e -= c; t += c; break;
        case 'ajuste':
          sgn(c); cur.adj += c;
          if (m.to === 'fijos') f += c; else if (m.to === 'libres') l += c; else if (m.to === 'inversion') inv += c;
          break;
      }
      if ((m.cat === 'fijos' || m.cat === 'libres') && m.sub) {
        var k = m.cat + '|' + m.sub; cur.subs[k] = (cur.subs[k] || 0) + c;
      }
    });
    while (limit > cur.end) close();
    var total = t + e;
    var ahorro = total - Math.max(0, f) - Math.max(0, l) - Math.max(0, inv);
    var tAh = Math.min(Math.max(t, 0), Math.max(ahorro, 0)), eAh = Math.max(ahorro, 0) - tAh;
    return {
      cfg: cf, period: { start: cur.start, end: cur.end }, cur: cur, hist: hist,
      t: t, e: e, total: total, fijos: f, libres: l, inversion: inv, invTot: invTot,
      ahorro: ahorro, tAhorro: tAh, eAhorro: eAh, tLibre: t - tAh, eLibre: e - eAh
    };
  }
  // Estadísticas de un periodo concreto (el actual o uno del historial)
  function statsFor(S, start) {
    if (!S) return null;
    if (S.cur.start === start) return S.cur;
    for (var i = 0; i < S.hist.length; i++) if (S.hist[i].start === start) return S.hist[i];
    return null;
  }
  // Movimientos de un periodo, del más reciente al más antiguo
  function movIn(M, a, b) {
    return sorted(M.mov).filter(function (m) { return m.date >= a && m.date <= b; }).reverse();
  }
  // Para cuadrar con el banco: movimientos de ajuste que hacen falta para llegar a los saldos reales
  function adjustFor(S, realT, realE) {
    var out = [];
    if (realT != null && !isNaN(realT) && realT !== S.t) out.push({ acc: 't', c: realT - S.t });
    if (realE != null && !isNaN(realE) && realE !== S.e) out.push({ acc: 'e', c: realE - S.e });
    return out;
  }

  root.Money = {
    CATS: CATS, SPLIT: SPLIT, SUBS: SUBS, cat: cat, periodOf: periodOf, nextPeriod: nextPeriod, prevPeriod: prevPeriod,
    toCents: toCents, eur: eur, plain: plain, blank: blank, cfgOf: cfgOf, splitOk: splitOk, share: share,
    calc: calc, statsFor: statsFor, movIn: movIn, adjustFor: adjustFor
  };
  if (typeof module !== 'undefined') module.exports = root.Money;
})(typeof self !== 'undefined' ? self : this);
