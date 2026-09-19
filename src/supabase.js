'use strict';

/**
 * Single server-side Supabase client (service_role).
 * Never import this module from browser / public JS.
 *
 * Realtime is not used. On Node 20 there is no native WebSocket; we pass a
 * dummy transport so createClient does not require the `ws` package.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireSupabaseEnv } = require('./env');

let client;

/** No-op WebSocket so Realtime never loads `ws` or native WebSocket. */
class DisabledRealtimeTransport {
  constructor() {
    this.readyState = 3; // CLOSED
    this.binaryType = 'arraybuffer';
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
  }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return false;
  }
}

function getSupabase() {
  if (client) return client;
  const { url, key } = requireSupabaseEnv();
  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      // Do not open a socket. Service-role REST/RPC only.
      transport: DisabledRealtimeTransport,
      timeout: 1000,
      heartbeatIntervalMs: 60000,
    },
    global: {
      headers: { 'X-Client-Info': 'hunters547-express-server' },
      fetch: (...args) => fetch(...args),
    },
  });
  return client;
}

function throwIfError(result, context) {
  if (result && result.error) {
    const err = new Error(result.error.message || 'Error de base de datos');
    err.code = result.error.code;
    err.details = result.error.details;
    err.hint = result.error.hint;
    err.context = context;
    throw err;
  }
  return result;
}

module.exports = {
  getSupabase,
  throwIfError,
  DisabledRealtimeTransport,
};
