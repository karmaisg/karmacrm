// Sayfa çizilmeden önce kayıtlı temayı uygular (renk titremesini önler). CSP gereği ayrı dosyadadır.
try {
  const t = localStorage.getItem('osgb-tema');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* depolama kapalı */ }
