// SEGUIMIENTO-WIDGET v4 · Widget grande de Seguimiento para Scriptable (solo lectura)
const BASE = 'https://seba-rtz.github.io/Seguimiento/';
const SB = 'https://brclicidivpxqmzfxwsb.supabase.co';
const KEY = 'sb_publishable_javfWi55UYm9z1f8pEYZMg_KSKgIlsa';
const fm = FileManager.local();
const dir = fm.documentsDirectory();
const cp = function (n) { return fm.joinPath(dir, 'seguimiento-' + n); };

async function textCached(name, url) {
  try {
    const t = await new Request(url).loadString();
    if (t && t.length > 200) { fm.writeString(cp(name), t); return t; }
  } catch (e) {}
  return fm.fileExists(cp(name)) ? fm.readString(cp(name)) : null;
}

async function getData(Core) {
  let email = Keychain.contains('seg.email') ? Keychain.get('seg.email') : null;
  let pass = Keychain.contains('seg.pass') ? Keychain.get('seg.pass') : null;
  if (!email || !pass) {
    if (!config.runsInApp) return { error: 'Abre el script en Scriptable e inicia sesión una vez.' };
    const a = new Alert();
    a.title = 'Iniciar sesión';
    a.message = 'Escribe el correo y la contraseña de tu app de seguimiento. Se guardan solo en el llavero de este iPhone.';
    a.addTextField('Correo', '');
    a.addSecureTextField('Contraseña', '');
    a.addAction('Entrar');
    a.addCancelAction('Cancelar');
    const r = await a.presentAlert();
    if (r === -1) return { error: 'No has iniciado sesión.' };
    email = a.textFieldValue(0).trim();
    pass = a.textFieldValue(1);
  }
  try {
    const tr = new Request(SB + '/auth/v1/token?grant_type=password');
    tr.method = 'POST';
    tr.headers = { apikey: KEY, 'Content-Type': 'application/json' };
    tr.body = JSON.stringify({ email: email, password: pass });
    const tj = await tr.loadJSON();
    if (tr.response.statusCode === 400) {
      Keychain.remove('seg.email'); Keychain.remove('seg.pass');
      return { error: 'Correo o contraseña incorrectos. Vuelve a abrir el script para probar otra vez.' };
    }
    if (!tj || !tj.access_token) throw new Error('login');
    Keychain.set('seg.email', email); Keychain.set('seg.pass', pass);
    const dr = new Request(SB + '/rest/v1/datos?select=contenido&limit=1');
    dr.headers = { apikey: KEY, Authorization: 'Bearer ' + tj.access_token };
    const rows = await dr.loadJSON();
    const D = rows && rows[0] && rows[0].contenido ? rows[0].contenido : Core.emptyData();
    fm.writeString(cp('data.json'), JSON.stringify({ D: D, at: Date.now() }));
    return { D: D, stale: false };
  } catch (e) {
    if (fm.fileExists(cp('data.json'))) {
      const c = JSON.parse(fm.readString(cp('data.json')));
      return { D: c.D, stale: true };
    }
    return { error: 'Sin conexión y sin datos guardados.' };
  }
}

async function main() {
  const coreSrc = await textCached('core.js', BASE + 'core.js?t=' + Date.now());
  const w = new ListWidget();
  w.backgroundColor = new Color('#121214');
  w.url = 'shortcuts://run-shortcut?name=Abrir%20Seguimiento'; // el atajo abre la app web instalada (webapp://)
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  const GREY = new Color('#9a9aa0'), ORANGE = new Color('#ff9f43'), TXT = new Color('#f2f2f2'), OFF = new Color('#2a2a2e');
  const txt = function (parent, s, size, color, bold) {
    const t = parent.addText(String(s));
    t.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
    t.textColor = color || TXT;
    t.lineLimit = 1;
    return t;
  };
  if (!coreSrc) { txt(w, 'No se pudo cargar la app. Comprueba la conexión.', 13, TXT); return w; }
  const Core = new Function(coreSrc + '\nreturn (typeof window !== "undefined" && window.Core) || globalThis.Core;')();
  const res = await getData(Core);
  if (res.error) { txt(w, res.error, 13, TXT); return w; }
  const D = res.D;

  const sw = Device.screenSize().width;
  const W = sw >= 428 ? 364 : sw >= 414 ? 360 : sw >= 390 ? 338 : 321;
  w.setPadding(14, 16, 12, 16);
  const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const today = Core.today(), pd = Core.parse(today);

  /* Tareas de hoy */
  const items = Core.tasksOn(D, today);
  const pending = items.filter(function (x) { return !Core.getState(x.t, x.d); });
  const done = items.filter(function (x) { return Core.getState(x.t, x.d) === 'done'; });
  const list = pending.concat(done);
  const head = w.addStack();
  head.centerAlignContent();
  txt(head, 'Hoy', 16, TXT, true);
  head.addSpacer(6);
  txt(head, DIAS[Core.weekday(pd)] + ' ' + pd.getDate() + ' ' + MES[pd.getMonth()], 12, GREY);
  head.addSpacer();
  txt(head, res.stale ? 'sin conexión' : (pending.length === 1 ? '1 pendiente' : pending.length + ' pendientes'), 12, res.stale ? GREY : ORANGE);
  w.addSpacer(6);
  const MAX = 5;
  const shown = list.length > MAX ? list.slice(0, MAX - 1) : list;
  shown.forEach(function (x, i) {
    const t = x.t, isDone = Core.getState(t, x.d) === 'done', sc = Core.scopeById(t.scope);
    const r = w.addStack();
    r.centerAlignContent();
    r.spacing = 7;
    const bar = r.addStack();
    bar.size = new Size(3, 16);
    bar.cornerRadius = 2;
    bar.backgroundColor = new Color(sc.color, isDone ? 0.4 : 1);
    const tt = txt(r, (isDone ? '✓ ' : '') + t.title, 13, TXT);
    if (isDone) tt.textOpacity = 0.45;
    r.addSpacer();
    if (t.time) txt(r, t.end ? t.time + '–' + t.end : t.time, 11, GREY);
    const d = r.addStack();
    d.size = new Size(24, 14);
    d.addSpacer();
    txt(d, '•'.repeat(t.priority || 0), 11, GREY);
    w.addSpacer(4);
  });
  if (list.length > MAX) txt(w, '+' + (list.length - MAX + 1) + ' más', 12, GREY);
  if (!list.length) txt(w, 'No hay tareas para hoy.', 13, GREY);
  w.addSpacer();

  /* Registro de cumplimiento de la semana */
  const monday = Core.mondayOf(today), tot = Core.weekTotals(D, monday);
  const cw = Math.floor((W - 32 - 62 - 28 - 32) / 7);
  const gridRow = function (label, lcol, cells, total) {
    const r = w.addStack();
    r.centerAlignContent();
    r.spacing = 4;
    const l = r.addStack();
    l.size = new Size(62, 14);
    txt(l, label, 11, lcol);
    cells.forEach(function (c) {
      const s = r.addStack();
      s.size = new Size(cw, 14);
      s.centerAlignContent();
      if (c.fill) { s.backgroundColor = c.fill; s.cornerRadius = 3; s.size = new Size(cw, 13); }
      if (c.border) { s.borderColor = ORANGE; s.borderWidth = 1.5; }
      if (c.t) { s.addSpacer(); txt(s, c.t, 11, c.tc); s.addSpacer(); }
    });
    const q = r.addStack();
    q.size = new Size(28, 14);
    q.addSpacer();
    txt(q, total, 11, GREY);
  };
  const letters = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  gridRow('Esta semana', GREY, letters.map(function (l, i) { return { t: l, tc: Core.addDays(monday, i) === today ? ORANGE : GREY }; }), '');
  w.addSpacer(3);
  Core.SCOPES.forEach(function (s) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const day = Core.addDays(monday, i), on = !!(D.log[day] && D.log[day][s.id]);
      cells.push({ fill: on ? new Color(s.color) : OFF, border: day === today });
    }
    gridRow(s.name, new Color(s.color), cells, tot[s.id] + '/7');
    w.addSpacer(3);
  });
  w.addSpacer();

  /* Objetivos del trimestre: uno por cada uno de los tres primeros ámbitos */
  const q = Core.quarterOf(today);
  txt(w, 'Objetivos del ' + q.slice(6) + '.º trimestre', 11, GREY);
  w.addSpacer(4);
  ['salud', 'formacion', 'proyectos'].forEach(function (id) {
    const sc = Core.scopeById(id);
    const gs = D.goals.filter(function (g) { return g.quarter === q && g.scope === id; });
    const g = gs.filter(function (x) { return x.status !== 'cumplido'; })[0] || gs[0];
    const r = w.addStack();
    r.centerAlignContent();
    r.spacing = 7;
    const bar = r.addStack();
    bar.size = new Size(3, 16);
    bar.cornerRadius = 2;
    bar.backgroundColor = new Color(sc.color);
    txt(r, g ? g.title : 'Sin objetivo este trimestre', 13, g ? TXT : GREY);
    r.addSpacer();
    if (g) {
      const st = g.status === 'cumplido' ? ['Cumplido', new Color('#34c759')] : g.status === 'en_curso' ? ['En curso', ORANGE] : ['Pendiente', GREY];
      txt(r, st[0], 11, st[1]);
    }
    w.addSpacer(4);
  });
  return w;
}

const widget = await main();
if (config.runsInApp) await widget.presentLarge();
Script.setWidget(widget);
Script.complete();
