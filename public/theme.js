// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
(() => {
  let theme = 'dark';
  try { if (localStorage.getItem('carry.theme') === 'light') theme = 'light'; } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101318' : '#f5f6f9');
})();
