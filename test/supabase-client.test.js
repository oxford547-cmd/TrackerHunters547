'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DisabledRealtimeTransport } = require('../src/supabase');

test('transport dummy no abre socket (Node 20 sin ws)', () => {
  const ws = new DisabledRealtimeTransport();
  assert.equal(ws.readyState, 3);
  assert.doesNotThrow(() => ws.send('x'));
  assert.doesNotThrow(() => ws.close());
});

test('createClient no exige SUPABASE_* hasta getSupabase()', () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_API_KEY;
  const { getSupabase } = require('../src/supabase');
  assert.throws(() => getSupabase(), /SUPABASE_URL/);
});
