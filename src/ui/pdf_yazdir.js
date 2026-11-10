// OSGB 360 - PDF baytlarını yazdırır: gizli çerçevede açar ve yazdırma penceresini çağırır.
// Tarayıcı çerçevede PDF yazdırmayı engellerse PDF yeni sekmede açılır (oradan Ctrl+P ile yazdırılır). Sayfa güvenlik politikası bu yüzden frame-src/object-src için blob: izni verir.
export function pdfYazdir(bayt) {
  const url = URL.createObjectURL(new Blob([bayt], { type: 'application/pdf' }));
  const cerceve = document.createElement('iframe');
  cerceve.setAttribute('aria-hidden', 'true'); cerceve.tabIndex = -1; cerceve.dataset.pdfYazdir = '1';
  Object.assign(cerceve.style, { position: 'fixed', width: '0', height: '0', border: '0', right: '0', bottom: '0' });
  const temizle = () => { cerceve.remove(); URL.revokeObjectURL(url); };
  return new Promise((coz) => {
    let bitti = false;
    const sonlan = (acildi) => { if (bitti) return; bitti = true; setTimeout(temizle, 120000); coz(acildi); };
    cerceve.addEventListener('load', () => {
      try { cerceve.contentWindow.focus(); cerceve.contentWindow.print(); sonlan('yazdirildi'); }
      catch { window.open(url, '_blank', 'noopener'); sonlan('yeni-sekme'); }
    });
    cerceve.addEventListener('error', () => { window.open(url, '_blank', 'noopener'); sonlan('yeni-sekme'); });
    cerceve.src = url; document.body.append(cerceve);
  });
}
