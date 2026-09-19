'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const { PORT, SESSION_SECRET } = require('./src/constants');
const { ensureSchema } = require('./src/db');
const { seed } = require('./src/seed');
const { viewLocals } = require('./src/middleware');

ensureSchema();
seed(false);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '8mb' }));
app.use(
  session({
    name: 'h547.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12,
      secure: process.env.NODE_ENV === 'production',
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));
app.use(viewLocals);

app.get('/', (req, res) => {
  if (req.session?.user) {
    const r = req.session.user.role;
    if (r === 'superadmin') return res.redirect('/superadmin');
    if (r === 'encargado') return res.redirect('/encargado');
    if (r === 'chofer') return res.redirect('/chofer');
    if (r === 'cliente') return res.redirect('/cliente');
  }
  res.redirect('/rastreo');
});

app.use(require('./src/routes/auth'));
app.use('/superadmin', require('./src/routes/superadmin'));
app.use('/encargado', require('./src/routes/encargado'));
app.use('/chofer', require('./src/routes/chofer'));
app.use('/cliente', require('./src/routes/cliente'));
app.use('/rastreo', require('./src/routes/rastreo'));
app.use('/api', require('./src/routes/api'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'No encontrado', message: 'Página no encontrada.', status: 404 });
});

app.use((err, req, res, _next) => {
  console.error(err);
  // Body-parser / early errors may skip viewLocals
  res.locals.user = res.locals.user ?? req.session?.user ?? null;
  res.locals.flash = res.locals.flash ?? null;
  res.locals.ORDER_STATUSES = res.locals.ORDER_STATUSES || require('./src/constants').ORDER_STATUSES;
  res.locals.STATUS_BADGE = res.locals.STATUS_BADGE || require('./src/constants').STATUS_BADGE;
  res.locals.statusLabel = res.locals.statusLabel || ((s) => require('./src/constants').ORDER_STATUSES[s] || s);
  res.locals.badgeClass = res.locals.badgeClass || ((s) => require('./src/constants').STATUS_BADGE[s] || 'badge-muted');
  res.locals.brandLogo = res.locals.brandLogo || '/assets/img/hunters547-logo.jpg';
  res.locals.brandName = res.locals.brandName || 'Hunters 547';
  res.locals.portal = res.locals.portal ?? null;
  res.locals.defaultLogo = res.locals.defaultLogo || '/assets/img/hunters547-logo.jpg';

  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({ ok: false, error: err.message || 'Error interno' });
  }
  res.status(500).render('error', {
    title: 'Error',
    message: 'Error interno del servidor.',
    status: 500,
    user: res.locals.user,
    flash: null,
  });
});

app.listen(PORT, () => {
  console.log(`Hunters 547 pedidos → http://localhost:${PORT}`);
  console.log(
    'Login: /login  |  Superadmin: /superadmin  |  Rastreo: /rastreo  |  Demo: superadmin/superadmin123, encargado/encargado123, chofer/chofer123, cliente/cliente123'
  );
});
