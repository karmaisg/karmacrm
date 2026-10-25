// OSGB 360 - Hash tabanlı yönlendirme: #/firmalar/<id>
export function rotaAyir(hash = location.hash) {
  const temiz = String(hash).replace(/^#\/?/, '').split('?')[0];
  return temiz.split('/').filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
}

export const git = (yol) => { location.hash = `#/${String(yol).replace(/^#?\/?/, '')}`; };

export function dinle(cb) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
