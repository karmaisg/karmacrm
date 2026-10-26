// OSGB 360 - Görüşme ve not kayıtları: zaman çizelgesi ve form (firma kartı ve potansiyel müşteri kartında ortak).
import { html, tarihSaat, yerelDeger, yerelIso } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, openFormModal, confirmDialog, toast } from '../ui/components.js';
import { GORUSME_TURLERI } from '../lib/puanlama.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const TUR_SIMGE = { gorusme: 'users', arama: 'phone', eposta: 'mail', ziyaret: 'pin', not: 'file', sikayet: 'alert', cozum: 'check' };
const TUR_TON = { sikayet: 'danger', cozum: 'success' };

export function gorusmeFormuAc(app, { kayit = null, companyId = null, leadId = null, opportunityId = null, kisiler = [], onDone = null }) {
  const duzenle = kayit !== null;
  const kisiSecenekleri = [{ deger: '', etiket: 'Belirtilmedi' }].concat(
    kisiler.filter((k) => !k.archived_at || k.id === kayit?.contact_id).map((k) => ({ deger: k.id, etiket: k.full_name })),
  );
  openFormModal({
    baslik: duzenle ? 'Görüşmeyi düzenle' : 'Görüşme / not ekle',
    altBaslik: 'Kayıtlar silinmez; yanlış kayıt arşive alınabilir.',
    gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Kaydet',
    govde: html`
      ${field({ ad: 'kind', etiket: 'Tür', zorunlu: true, deger: kayit?.kind ?? 'gorusme', secenekler: Object.entries(GORUSME_TURLERI).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'occurred_at', etiket: 'Tarih ve saat', tur: 'datetime-local', zorunlu: true, deger: yerelDeger(kayit?.occurred_at ?? new Date().toISOString()) })}
      ${field({ ad: 'contact_id', etiket: 'Görüşülen kişi', deger: kayit?.contact_id ?? '', secenekler: kisiSecenekleri, tam: true })}
      ${field({ ad: 'summary', etiket: 'Özet', zorunlu: true, deger: kayit?.summary ?? '', maksUzunluk: 200, tam: true, yerTutucu: 'Örn. Teklif için bilgi istedi' })}
      ${field({ ad: 'details', etiket: 'Ayrıntılar', tur: 'textarea', satir: 4, deger: kayit?.details ?? '', maksUzunluk: 4000, tam: true })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('summary')) h.summary = 'Özet zorunludur.';
      const zaman = yerelIso(g('occurred_at'));
      if (!zaman) h.occurred_at = 'Tarih ve saati seçin.';
      if (Object.keys(h).length) return { errors: h };
      const degerler = {
        kind: g('kind'), occurred_at: zaman, summary: g('summary'), details: bosIseNull(g('details')), contact_id: bosIseNull(g('contact_id')),
      };
      if (duzenle) await app.api.updateActivity(kayit.id, degerler);
      else await app.api.createActivity({ ...degerler, company_id: companyId, lead_id: leadId, opportunity_id: opportunityId });
      toast(duzenle ? 'Görüşme güncellendi.' : 'Görüşme kaydedildi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
}

/** Zaman çizelgesi. Düzenleme/arşivleme düğmeleri data-gorusme-eylem ile işaretlenir; olayları sayfa yönetir. */
export function zamanCizelgesi(app, kayitlar, { kisiAdi = new Map(), kullaniciAdi = new Map() } = {}) {
  if (!kayitlar.length) {
    return emptyState({ simge: 'history', baslik: 'Henüz görüşme kaydı yok', metin: 'Telefon, ziyaret, e-posta ve notları buraya ekleyin; geçmiş tek yerde görünür.' });
  }
  const duzenleyebilir = app.can('contacts', 'edit');
  const arsivleyebilir = app.can('contacts', 'archive');
  return html`<ol class="timeline">${kayitlar.map((k) => html`<li class="tl-item">
    <span class="tl-ic tl-${TUR_TON[k.kind] ?? 'neutral'}">${icon(TUR_SIMGE[k.kind] ?? 'file', 16)}</span>
    <div class="tl-body">
      <div class="tl-head"><strong>${k.summary}</strong>${pill(GORUSME_TURLERI[k.kind] ?? k.kind, TUR_TON[k.kind] ?? 'neutral')}</div>
      <div class="tl-meta">${tarihSaat(k.occurred_at)}${k.contact_id && kisiAdi.get(k.contact_id) ? ` · ${kisiAdi.get(k.contact_id)}` : ''}${k.created_by && kullaniciAdi.get(k.created_by) ? ` · kaydeden: ${kullaniciAdi.get(k.created_by)}` : ''}</div>
      ${k.details ? html`<p class="tl-text prewrap">${k.details}</p>` : ''}
    </div>
    <div class="tl-act">
      ${duzenleyebilir ? html`<button type="button" class="icon-btn" data-gorusme-eylem="duzenle" data-id="${k.id}" aria-label="Görüşmeyi düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
      ${arsivleyebilir ? html`<button type="button" class="icon-btn" data-gorusme-eylem="arsivle" data-id="${k.id}" aria-label="Görüşmeyi arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}
    </div></li>`)}</ol>`;
}

export async function gorusmeArsivle(app, kayit) {
  const onay = await confirmDialog({ baslik: 'Görüşmeyi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true,
    mesaj: `"${kayit.summary}" kaydı arşive alınacak ve çizelgede görünmeyecek. Kayıt silinmez.` });
  if (!onay) return false;
  try { await app.api.archiveActivity(kayit.id); toast('Görüşme arşive alındı.'); return true; }
  catch (e) { toast(humanError(e), 'hata'); return false; }
}
