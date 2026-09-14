'use strict';

(function () {
  const mapEl = document.getElementById('map');
  if (!mapEl || typeof L === 'undefined') return;

  const codigo = mapEl.dataset.codigo;
  let lat = parseFloat(mapEl.dataset.lat);
  let lng = parseFloat(mapEl.dataset.lng);
  const hasSeed = !Number.isNaN(lat) && !Number.isNaN(lng);

  const map = L.map('map').setView(hasSeed ? [lat, lng] : [19.4326, -99.1332], hasSeed ? 14 : 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  let marker = null;
  if (hasSeed) {
    marker = L.marker([lat, lng]).addTo(map);
  }

  const meta = document.getElementById('loc-meta');

  async function poll() {
    try {
      const res = await fetch('/api/track/' + encodeURIComponent(codigo), {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!data.ok) return;

      if (data.order.status !== 'en_camino') {
        if (meta) meta.textContent = 'Estado: ' + (data.order.status_label || data.order.status);
        return;
      }

      if (data.location) {
        const { lat: la, lng: ln, created_at } = data.location;
        if (marker) {
          marker.setLatLng([la, ln]);
        } else {
          marker = L.marker([la, ln]).addTo(map);
        }
        map.setView([la, ln], Math.max(map.getZoom(), 14));
        if (meta) meta.textContent = 'Última actualización: ' + created_at;
      }
    } catch (_) {
      /* ignore transient network errors */
    }
  }

  setInterval(poll, 5000);
  poll();
})();
