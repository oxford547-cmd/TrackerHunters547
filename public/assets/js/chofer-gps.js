'use strict';

(function () {
  const watchers = new Map();

  function pad(el) {
    return document.querySelector('.js-signature[data-order-id="' + el + '"]');
  }

  document.querySelectorAll('.js-signature').forEach((canvas) => {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    let drawing = false;
    function pos(ev) {
      const r = canvas.getBoundingClientRect();
      const t = ev.touches ? ev.touches[0] : ev;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function start(ev) {
      drawing = true;
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ev.preventDefault();
    }
    function move(ev) {
      if (!drawing) return;
      const p = pos(ev);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ev.preventDefault();
    }
    function end() {
      drawing = false;
    }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
  });

  document.querySelectorAll('.js-clear-sig').forEach((btn) => {
    btn.addEventListener('click', () => {
      const canvas = pad(btn.dataset.orderId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  });

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
        const fd = new FormData();
        fd.append('order_id', String(orderId));
        fd.append('status', 'entregado');
        const photo = document.querySelector('.js-delivery-photo[data-order-id="' + orderId + '"]');
        if (photo && photo.files && photo.files[0]) fd.append('photo', photo.files[0]);
        const canvas = pad(orderId);
        if (canvas) {
          const blank = document.createElement('canvas');
          blank.width = canvas.width;
          blank.height = canvas.height;
          if (canvas.toDataURL() !== blank.toDataURL()) {
            fd.append('signature', canvas.toDataURL('image/png'));
          }
        }
        const res = await fetch('/api/status', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: fd,
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
