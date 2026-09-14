'use strict';

(function () {
  const watchers = new Map();

  async function postLocation(orderId, pos) {
    const body = {
      order_id: orderId,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
    const res = await fetch('/api/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Error al enviar ubicación');
    }
    return data;
  }

  function setStatus(orderId, msg, isError) {
    const el = document.getElementById('gps-status-' + orderId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#d56767' : '';
  }

  document.querySelectorAll('.js-share-gps').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = Number(btn.dataset.orderId);
      if (!navigator.geolocation) {
        setStatus(orderId, 'Geolocalización no disponible en este navegador', true);
        return;
      }
      if (watchers.has(orderId)) {
        navigator.geolocation.clearWatch(watchers.get(orderId));
        watchers.delete(orderId);
        btn.textContent = 'Compartir ubicación en vivo';
        setStatus(orderId, 'GPS detenido');
        return;
      }

      btn.textContent = 'Detener GPS';
      setStatus(orderId, 'Solicitando permiso…');

      const wid = navigator.geolocation.watchPosition(
        async (pos) => {
          try {
            await postLocation(orderId, pos);
            setStatus(
              orderId,
              `Enviado ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy || 0)} m)`
            );
          } catch (err) {
            setStatus(orderId, err.message, true);
          }
        },
        (err) => {
          setStatus(orderId, 'Error GPS: ' + err.message, true);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
      watchers.set(orderId, wid);
    });
  });

  document.querySelectorAll('.js-mark-delivered').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const orderId = Number(btn.dataset.orderId);
      if (!confirm('¿Marcar este pedido como Entregado?')) return;
      if (watchers.has(orderId)) {
        navigator.geolocation.clearWatch(watchers.get(orderId));
        watchers.delete(orderId);
      }
      try {
        const res = await fetch('/api/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ order_id: orderId, status: 'entregado' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'Error');
        location.reload();
      } catch (err) {
        alert(err.message);
      }
    });
  });
})();
