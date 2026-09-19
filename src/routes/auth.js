'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { findActiveUserByUsername, findPortalById } = require('../db');
const { setFlash, sessionUser, wrap } = require('../middleware');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session?.user) {
    return res.redirect(roleHome(req.session.user.role));
  }
  res.render('login', { title: 'Iniciar sesión' });
});

router.post(
  '/login',
  wrap(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await findActiveUserByUsername(username);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      setFlash(req, 'danger', 'Usuario o contraseña incorrectos.');
      return res.redirect('/login');
    }

    if (user.role !== 'superadmin' && user.portal_id) {
      const portal = await findPortalById(user.portal_id);
      if (!portal || !portal.active) {
        setFlash(req, 'danger', 'El portal de esta cuenta está inactivo. Contacta a Hunters 547.');
        return res.redirect('/login');
      }
    }

    req.session.user = sessionUser(user);
    res.redirect(roleHome(user.role));
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

function roleHome(role) {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'encargado') return '/encargado';
  if (role === 'chofer') return '/chofer';
  if (role === 'cliente') return '/cliente';
  return '/';
}

module.exports = router;
