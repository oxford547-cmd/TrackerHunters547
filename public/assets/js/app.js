'use strict';
// Shared helpers for Hunters 547 pedidos UI
document.documentElement.classList.add('js');

(function initSidebar() {
  const body = document.body;
  if (!body.classList.contains('has-sidebar')) return;

  const toggle = document.getElementById('sidebar-toggle');
  const closeBtn = document.getElementById('sidebar-close');
  const backdrop = document.getElementById('sidebar-backdrop');
  const STORAGE_KEY = 'h547.sidebarCollapsed';

  function isMobile() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function setExpanded(open) {
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Restore desktop collapsed preference
  try {
    if (!isMobile() && localStorage.getItem(STORAGE_KEY) === '1') {
      body.classList.add('sidebar-collapsed');
    }
  } catch (_) { /* ignore */ }

  function openDrawer() {
    body.classList.add('sidebar-open');
    if (backdrop) backdrop.hidden = false;
    setExpanded(true);
  }

  function closeDrawer() {
    body.classList.remove('sidebar-open');
    if (backdrop) backdrop.hidden = true;
    setExpanded(false);
  }

  function toggleSidebar() {
    if (isMobile()) {
      if (body.classList.contains('sidebar-open')) closeDrawer();
      else openDrawer();
      return;
    }
    body.classList.toggle('sidebar-collapsed');
    const collapsed = body.classList.contains('sidebar-collapsed');
    setExpanded(!collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch (_) { /* ignore */ }
  }

  toggle?.addEventListener('click', toggleSidebar);
  closeBtn?.addEventListener('click', closeDrawer);
  backdrop?.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && body.classList.contains('sidebar-open')) closeDrawer();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) closeDrawer();
  });

  setExpanded(isMobile() ? false : !body.classList.contains('sidebar-collapsed'));
})();
