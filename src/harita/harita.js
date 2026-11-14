// OSGB 360 - Harita çerçevesi (harita.html). Ana uygulama ile postMessage üzerinden konuşur; Google Haritalar yalnızca burada yüklenir.
//
// Ana uygulama -> çerçeve:  baslat {anahtar} | isaretler {liste, sigdir} | bul {id, sorgu} | duzelt {id} | odak {id}
// Çerçeve -> ana uygulama:  hazir | hata {kod, mesaj} | sec {id} | planla {id} | duzelt {id} | tasindi {id, enlem, boylam} | bulundu {id, enlem, boylam, kesinlik} | bulunamadi {id, durum}
const ust = window.parent; const KOKEN = window.location.origin;
const gonder = (m) => ust.postMessage(m, KOKEN);
const durumEl = document.getElementById('durum');
const duyur = (metin) => { durumEl.textContent = metin ?? ''; };

let harita = null; let bilgiPenceresi = null; let geocoder = null; let yukleniyor = false;
let isaretler = new Map(); let duzeltilen = null;

const SVG = (renk, secili) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${secili ? 40 : 32}" height="${secili ? 52 : 42}" viewBox="0 0 32 42"><path d="M16 1C8 1 1.5 7.4 1.5 15.3 1.5 26 16 41 16 41s14.5-15 14.5-25.7C30.5 7.4 24 1 16 1z" fill="${renk}" stroke="${secili ? '#111827' : '#fff'}" stroke-width="${secili ? 3 : 2}"/><circle cx="16" cy="15" r="5.5" fill="#fff"/></svg>`)}`;

function bilgiIcerigi(m) {
  const kok = document.createElement('div'); kok.className = 'bilgi';
  const b = document.createElement('strong'); b.textContent = m.baslik; kok.append(b);
  if (m.adres) { const p = document.createElement('p'); p.textContent = m.adres; kok.append(p); }
  for (const s of m.satirlar ?? []) { const e = document.createElement('span'); e.className = 'satir'; e.textContent = s; kok.append(e); }
  const d = document.createElement('div'); d.className = 'dugmeler';
  const dugme = (metin, olay, birincil) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = metin; if (birincil) x.className = 'birincil'; x.addEventListener('click', () => gonder({ t: olay, id: m.id })); d.append(x); };
  dugme(m.secili ? 'Seçimden çıkar' : 'Seçime ekle', 'sec');
  if (m.planlanabilir) dugme('Ziyaret planla', 'planla', true);
  if (m.duzeltilebilir) dugme('Konumu düzelt', 'duzelt');
  kok.append(d); return kok;
}

function isaretleriCiz(liste, sigdir) {
  for (const x of isaretler.values()) x.marker.setMap(null);
  isaretler = new Map(); const sinir = new google.maps.LatLngBounds();
  for (const m of liste) {
    const konum = { lat: Number(m.enlem), lng: Number(m.boylam) };
    const marker = new google.maps.Marker({ map: harita, position: konum, title: m.baslik, icon: { url: SVG(m.renk, m.secili), scaledSize: new google.maps.Size(m.secili ? 40 : 32, m.secili ? 52 : 42), anchor: new google.maps.Point(m.secili ? 20 : 16, m.secili ? 52 : 42) }, draggable: m.id === duzeltilen, zIndex: m.secili ? 10 : 1 });
    marker.addListener('click', () => { bilgiPenceresi.setContent(bilgiIcerigi(m)); bilgiPenceresi.open({ map: harita, anchor: marker }); });
    marker.addListener('dragend', () => { const p = marker.getPosition(); gonder({ t: 'tasindi', id: m.id, enlem: p.lat(), boylam: p.lng() }); });
    isaretler.set(m.id, { marker, m }); sinir.extend(konum);
  }
  if (sigdir && liste.length) {
    if (liste.length === 1) { harita.setCenter(sinir.getCenter()); harita.setZoom(14); } else harita.fitBounds(sinir, 48);
  }
}

function yukle(anahtar) {
  if (yukleniyor || harita) return; yukleniyor = true; duyur('Harita yükleniyor…');
  window.gm_authFailure = () => { duyur('Google Haritalar anahtarı reddedildi.'); gonder({ t: 'hata', kod: 'anahtar', mesaj: 'Google anahtarı reddedildi. Anahtarın "Maps JavaScript API" ve "Geocoding API" için açık olduğunu, faturalandırma hesabının bağlı olduğunu ve site adresi kısıtının doğru olduğunu kontrol edin.' }); };
  window.__haritaHazir = () => {
    try {
      harita = new google.maps.Map(document.getElementById('harita'), { center: { lat: 39, lng: 35 }, zoom: 6, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy', clickableIcons: false });
      bilgiPenceresi = new google.maps.InfoWindow(); geocoder = new google.maps.Geocoder();
      duyur(''); gonder({ t: 'hazir' });
    } catch (e) { duyur('Harita başlatılamadı.'); gonder({ t: 'hata', kod: 'baslatilamadi', mesaj: 'Harita başlatılamadı.' }); }
  };
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(anahtar)}&callback=__haritaHazir&loading=async&language=tr&region=TR&v=weekly`;
  s.async = true;
  s.onerror = () => { duyur('Google Haritalar yüklenemedi.'); gonder({ t: 'hata', kod: 'yuklenemedi', mesaj: 'Google Haritalar yüklenemedi. İnternet bağlantınızı ve reklam/izleme engelleyicilerinizi kontrol edin.' }); };
  document.head.append(s);
  setTimeout(() => { if (!harita) { duyur(''); gonder({ t: 'hata', kod: 'zamanasimi', mesaj: 'Harita zamanında yüklenemedi.' }); } }, 20000);
}

const KESINLIK = { ROOFTOP: 'iyi', RANGE_INTERPOLATED: 'iyi', GEOMETRIC_CENTER: 'orta', APPROXIMATE: 'dusuk' };
function bul({ id, sorgu }, deneme = 0) {
  if (!geocoder) { gonder({ t: 'bulunamadi', id, durum: 'HARITA_YOK' }); return; }
  geocoder.geocode({ address: sorgu, region: 'tr', componentRestrictions: { country: 'TR' } }, (sonuclar, durum) => {
    if (durum === 'OK' && sonuclar?.length) {
      const g = sonuclar[0].geometry; gonder({ t: 'bulundu', id, enlem: g.location.lat(), boylam: g.location.lng(), kesinlik: sonuclar[0].partial_match ? 'dusuk' : (KESINLIK[g.location_type] ?? 'orta') });
    } else if (durum === 'OVER_QUERY_LIMIT' && deneme < 3) setTimeout(() => bul({ id, sorgu }, deneme + 1), 1200 * (deneme + 1));
    else gonder({ t: 'bulunamadi', id, durum });
  });
}

window.addEventListener('message', (e) => {
  if (e.origin !== KOKEN || e.source !== ust) return;
  const m = e.data; if (!m || typeof m.t !== 'string') return;
  if (m.t === 'baslat') yukle(String(m.anahtar ?? ''));
  else if (!harita) return;
  else if (m.t === 'isaretler') isaretleriCiz(Array.isArray(m.liste) ? m.liste : [], !!m.sigdir);
  else if (m.t === 'bul') bul(m);
  else if (m.t === 'duzelt') { duzeltilen = m.id ?? null; for (const [id, x] of isaretler) x.marker.setDraggable(id === duzeltilen); }
  else if (m.t === 'yerlestir') {   // konumu olmayan firma için haritanın ortasına sürüklenebilir iğne koyar
    const c = harita.getCenter(); if (harita.getZoom() < 9) harita.setZoom(11);
    for (const x of isaretler.values()) x.marker.setMap(null); isaretler = new Map();
    const marker = new google.maps.Marker({ map: harita, position: c, title: String(m.baslik ?? ''), draggable: true, zIndex: 20 });
    marker.addListener('dragend', () => { const p = marker.getPosition(); gonder({ t: 'tasindi', id: m.id, enlem: p.lat(), boylam: p.lng() }); });
    isaretler.set(m.id, { marker, m: { id: m.id } }); duzeltilen = m.id;
  }
  else if (m.t === 'odak') { const x = isaretler.get(m.id); if (x) { harita.panTo(x.marker.getPosition()); harita.setZoom(Math.max(harita.getZoom(), 14)); google.maps.event.trigger(x.marker, 'click'); } }
});
gonder({ t: 'cerceve' });
