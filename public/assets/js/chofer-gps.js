'use strict';

(function () {
  const watchers = new Map();
  let pendingOrderId = null;
  let photoFile = null;
  let sigDirty = false;

  const modal = document.getElementById('delivery-modal');
  const photoInput = document.getElementById('delivery-photo');
  const photoPreview = document.getElementById('delivery-photo-preview');
  const canvas = document.getElementById('signature-pad');
  const errEl = document.getElementById('delivery-modal-err');
  const codeEl = document.getElementById('delivery-modal-code');
  const ctx = canvas ? canvas.getContext('2d') : null;

  function setStatus(orderId, msg, isError) {
    const el = document.getElementById('gps-status-' + orderId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#d56767' : '';
  }

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

  function clearCanvas() {
    if (!ctx || !canvas) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    sigDirty = false;
  }

  function setupSignature() {
    if (!canvas || !ctx) return;
    clearCanvas();
    let drawing = false;

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const src = e.touches && e.touches[0] ? e.touches[0] : e;
      return {
        x: ((src.clientX - r.left) / r.width) * canvas.width,
        y: ((src.clientY - r.top) / r.height) * canvas.height,
      };
    }

    function start(e) {
      e.preventDefault();
      drawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      sigDirty = true;
    }
    function end(e) {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
  }

  function openModal(orderId, code) {
    pendingOrderId = orderId;
    photoFile = null;
    if (photoInput) photoInput.value = '';
    if (photoPreview) photoPreview.textContent = 'Sin foto seleccionada';
    if (errEl) errEl.textContent = '';
    if (codeEl) codeEl.textContent = code || String(orderId);
    clearCanvas();
    if (modal) modal.hidden = false;
  }

  function closeModal() {
    pendingOrderId = null;
    if (modal) modal.hidden = true;
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
    btn.addEventListener('click', () => {
      const orderId = Number(btn.dataset.orderId);
      openModal(orderId, btn.dataset.code || '');
    });
  });

  document.querySelectorAll('.js-close-delivery').forEach((el) => {
    el.addEventListener('click', closeModal);
  });

  document.getElementById('js-clear-sig')?.addEventListener('click', clearCanvas);

  photoInput?.addEventListener('change', () => {
    const f = photoInput.files && photoInput.files[0];
    photoFile = f || null;
    if (photoPreview) {
      photoPreview.textContent = f ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)' : 'Sin foto seleccionada';
    }
  });

  document.getElementById('js-confirm-delivery')?.addEventListener('click', async () => {
    if (errEl) errEl.textContent = '';
    if (!pendingOrderId) return;
    if (!photoFile) {
      if (errEl) errEl.textContent = 'Debes tomar o subir una foto de entrega.';
      return;
    }
    if (!sigDirty) {
      if (errEl) errEl.textContent = 'Debes capturar la firma del receptor.';
      return;
    }

    const orderId = pendingOrderId;
    if (watchers.has(orderId)) {
      navigator.geolocation.clearWatch(watchers.get(orderId));
      watchers.delete(orderId);
    }

    const fd = new FormData();
    fd.append('order_id', String(orderId));
    fd.append('status', 'entregado');
    fd.append('photo', photoFile, photoFile.name || 'delivery.jpg');
    fd.append('signature', canvas.toDataURL('image/png'));

    const btn = document.getElementById('js-confirm-delivery');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/status', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error al marcar entregado');
      closeModal();
      location.reload();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  setupSignature();
})();
