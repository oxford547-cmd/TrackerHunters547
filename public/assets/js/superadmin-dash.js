'use strict';

(function () {
  const el = document.getElementById('dash-data');
  if (!el || typeof Chart === 'undefined') return;
  let data;
  try {
    data = JSON.parse(el.textContent);
  } catch (_) {
    return;
  }

  const orange = '#ff6b00';
  const red = '#ff2d00';
  const muted = '#9a9a9a';
  const grid = 'rgba(255,255,255,.06)';

  Chart.defaults.color = '#c8c8c8';
  Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = '"Inter", system-ui, sans-serif';

  const statusColors = {
    pedido_colocado: '#5a5a5a',
    confirmado: '#ff9f43',
    en_preparacion: '#ff6b00',
    en_camino: '#ff2d00',
    entregado: '#84BD00',
    cancelado: '#d56767',
  };

  const trendCanvas = document.getElementById('chartTrend');
  if (trendCanvas) {
    const ctx = trendCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, orange);
    g.addColorStop(1, red);
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: (data.trend || []).map((t) => t.label),
        datasets: [
          {
            label: 'Pedidos',
            data: (data.trend || []).map((t) => t.count),
            backgroundColor: g,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a1a',
            borderColor: 'rgba(255,107,0,.4)',
            borderWidth: 1,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: muted },
            grid: { color: grid },
          },
        },
      },
    });
  }

  const statusCanvas = document.getElementById('chartStatus');
  if (statusCanvas) {
    const rows = data.statuses || [];
    new Chart(statusCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: rows.map((s) => s.label),
        datasets: [
          {
            data: rows.map((s) => s.count),
            backgroundColor: rows.map((s) => statusColors[s.key] || orange),
            borderWidth: 0,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, padding: 12, color: '#d0d0d0' },
          },
        },
      },
    });
  }

  const portalCanvas = document.getElementById('chartPortals');
  if (portalCanvas) {
    const ctx = portalCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 400, 0);
    g.addColorStop(0, orange);
    g.addColorStop(1, red);
    const portals = data.portals || [];
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: portals.map((p) => p.name),
        datasets: [
          {
            label: 'Pedidos',
            data: portals.map((p) => p.orders),
            backgroundColor: g,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 28,
          },
          {
            label: 'Entregas',
            data: portals.map((p) => p.delivered),
            backgroundColor: 'rgba(132,189,0,.75)',
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#d0d0d0', boxWidth: 10 } },
          tooltip: { backgroundColor: '#1a1a1a' },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { precision: 0, color: muted },
            grid: { color: grid },
          },
          y: { grid: { display: false }, ticks: { color: '#eee' } },
        },
      },
    });
  }
})();
