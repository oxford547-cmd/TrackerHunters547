'use strict';

const { getPortal, branding, DEFAULT_LOGO } = require('./portal');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user || !roles.includes(req.session.user.role)) {
      if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ ok: false, error: 'Sin permiso' });
      }
      return res.status(403).send('Sin permiso para esta sección.');
    }
    next();
  };
}

/** Tenant users must belong to a portal. Superadmin is global. */
function requirePortal(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    return res.redirect('/login');
  }
  if (user.role === 'superadmin') return next();
  if (!user.portal_id) {
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ ok: false, error: 'Cuenta sin portal asignado' });
    }
    return res.status(403).send('Cuenta sin portal asignado.');
  }
  next();
}

/** Locals for all views */
async function viewLocals(req, res, next) {
  try {
    res.locals.user = req.session?.user || null;
    res.locals.flash = req.session?.flash || null;
    if (req.session) delete req.session.flash;
    res.locals.ORDER_STATUSES = require('./constants').ORDER_STATUSES;
    res.locals.STATUS_BADGE = require('./constants').STATUS_BADGE;
    res.locals.statusLabel = (s) => require('./constants').ORDER_STATUSES[s] || s;
    res.locals.badgeClass = (s) => require('./constants').STATUS_BADGE[s] || 'badge-muted';

    let portal = null;
    if (req.session?.user?.portal_id) {
      portal = await getPortal(req.session.user.portal_id);
    }
    const b = branding(portal);
    res.locals.portal = b.portal;
    res.locals.brandLogo = b.brandLogo;
    res.locals.brandName = b.brandName;
    res.locals.defaultLogo = DEFAULT_LOGO;
    res.locals.mailFrom = require('./services/email').smtpFrom();
    res.locals.mailFromAddress = require('./services/email').smtpFromAddress();
    next();
  } catch (err) {
    next(err);
  }
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function sessionUser(row) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const customer_id = num(row.customer_id ?? row.cliente_id ?? null);
  return {
    id: num(row.id),
    username: row.username,
    role: row.role,
    name: row.name,
    customer_id,
    cliente_id: customer_id,
    portal_id: num(row.portal_id),
  };
}

module.exports = {
  wrap,
  requireAuth,
  requireRole,
  requirePortal,
  viewLocals,
  setFlash,
  sessionUser,
};
