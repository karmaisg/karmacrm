// OSGB 360 - Cari hesap: firma bazında ekstre (faturalar alacak, tahsilatlar borç), yıl/tarih aralığı, Excel çıktısı.
// Hesap: lib/cari.js (saf, testli). Tahsilat tarihi buradan da düzenlenebilir (gerçek tahsilat tarihine çekmek için).
import { html, bugun, para2 } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, toast, field, openFormModal, confirmDialog } from '../ui/components.js';
import { ODEME_YONTEMLERI } from '../lib/finans.js';
import { bosIseNull } from '../lib/veri.js';
import { cariEkstre, cariYillari, cariExcel, CARI_DURUM, trTarih, donemMetni } from '../lib/cari.js';
import { faturaDurumu } from '../lib/finans.js';
import { dosyaIndir, dosyaAdiParcasi } from '../ui/indir.js';
import { humanError } from '../lib/api.js';
import { tahsilatFormuAc, firmaTahsilatFormuAc } from './faturalar.js';

const XLSX_TURU = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let logoOnbellek = null;
async function logoBaytlari() {
  if (logoOnbellek) return logoOnbellek;
  try {
    const r = await fetch('assets/karma-logo.png');
    if (!r.ok) return null;
    logoOnbellek = new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
  return logoOnbellek;
}

export async function cariSayfasi(app) {
  if (!app.can('invoices', 'view') || !app.can('companies', 'view')) {
    return { baslik: 'Cari hesap', altBaslik: '', govde: emptyState({ simge: 'lock', baslik: 'Bu sayfa için gerekli izinler eksik', metin: 'Cari hesap için firma ve gelir/tahsilat görüntüleme yetkisi gerekir.' }) };
  }
  const [firmalar, faturalar, tahsilatlar, kalemler, kisiler] = await Promise.all([
    app.api.listCompanies(), app.api.listInvoices(), app.api.listPayments(), app.api.listAllInvoiceItems(),
    app.can('contacts', 'view') ? app.api.listContacts() : [],
  ]);
  const bugunStr = bugun();
  const yilBugun = bugunStr.slice(0, 4);
  const faturaliFirmaIdleri = new Set(faturalar.filter((f) => !f.archived_at && f.company_id).map((f) => f.company_id));
  const liste = firmalar.filter((f) => !f.archived_at && (f.customer_status === 'musteri' || faturaliFirmaIdleri.has(f.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const durum = { firma: new URLSearchParams(location.hash.split('?')[1] ?? '').get('firma') || liste[0]?.id || '', yil: yilBugun, bas: '', bit: '' };
  const olusturabilir = app.can('invoices', 'edit');

  const aralik = () => (durum.yil === 'aralik' ? { baslangic: durum.bas, bitis: durum.bit }
    : durum.yil === 'tum' ? { baslangic: '', bitis: '' } : { baslangic: `${durum.yil}-01-01`, bitis: `${durum.yil}-12-31` });
  const ekstre = () => cariEkstre({ faturalar, tahsilatlar, kalemler, companyId: durum.firma, ...aralik() });
  const firmaOf = () => liste.find((f) => f.id === durum.firma);

  const ust = () => {
    const yillar = durum.firma ? cariYillari(faturalar, tahsilatlar, durum.firma) : [];
    if (!yillar.includes(yilBugun)) yillar.unshift(yilBugun);
    return html`<div class="toolbar">
      <label class="select-inline"><span class="sr-only">Firma</span><select id="cari-firma">${liste.map((f) => html`<option value="${f.id}" ${f.id === durum.firma ? html`selected` : ''}>${f.name}</option>`)}</select></label>
      <label class="select-inline"><span class="sr-only">Dönem</span><select id="cari-yil">
        ${yillar.map((y) => html`<option value="${y}" ${y === durum.yil ? html`selected` : ''}>${y}</option>`)}
        <option value="tum" ${durum.yil === 'tum' ? html`selected` : ''}>Tüm dönem</option><option value="aralik" ${durum.yil === 'aralik' ? html`selected` : ''}>Tarih aralığı…</option></select></label>
      ${durum.yil === 'aralik' ? html`<label class="select-inline"><span class="sr-only">Başlangıç tarihi</span><input type="date" id="cari-bas" value="${durum.bas}" max="${durum.bit || ''}"></label>
        <label class="select-inline"><span class="sr-only">Bitiş tarihi</span><input type="date" id="cari-bit" value="${durum.bit}" min="${durum.bas || ''}"></label>` : ''}
    </div>`;
  };

  const tablo = () => {
    if (!durum.firma) return emptyState({ simge: 'receipt', baslik: 'Henüz firma yok', metin: 'Firma eklenip fatura kesildiğinde cari ekstre burada görünür.' });
    const e = ekstre();
    const { baslangic } = aralik();
    if (!e.satirlar.length && !e.devir) return emptyState({ simge: 'receipt', baslik: 'Bu dönemde hareket yok', metin: 'Farklı bir yıl veya tarih aralığı seçin.' });
    const ton = { alacakli: 'warning', borclu: 'info', kapali: 'success' }[e.durum];
    return html`<div class="kpi-grid">
        <div class="card kpi"><div><div class="kpi-l">Toplam borç (tahsilat)</div><div class="kpi-v" id="cari-top-borc">${para2(e.toplamBorc)}</div></div></div>
        <div class="card kpi"><div><div class="kpi-l">Toplam alacak (fatura)</div><div class="kpi-v" id="cari-top-alacak">${para2(e.toplamAlacak)}</div></div></div>
        <div class="card kpi"><div><div class="kpi-l">Bakiye</div><div class="kpi-v" id="cari-bakiye">${para2(e.bakiye)}</div><div class="kpi-s">${pill(CARI_DURUM[e.durum], ton)}</div></div></div>
      </div>
      ${e.tahminiTarihliAdet ? html`<div class="notice notice-warn pad-t" role="status" id="cari-tahmini">Bu dönemde <strong>${e.tahminiTarihliAdet}</strong> tahsilatın tarihi gerçek değil (toplu işaretlemede fatura tarihi kullanıldı). Satırdaki kalem simgesiyle gerçek tahsilat tarihini girin.</div>` : ''}
      <div class="table-wrap pad-t"><table class="table" id="cari-tablo"><thead><tr><th scope="col">Tarih</th><th scope="col" class="num">Borç</th><th scope="col" class="num">Alacak</th><th scope="col" class="num">Bakiye</th><th scope="col">Açıklama</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
        ${e.devir ? html`<tr class="muted"><td>${baslangic ? trTarih(baslangic) : ''}</td><td class="num">${e.devir < 0 ? para2(-e.devir) : para2(0)}</td><td class="num">${e.devir > 0 ? para2(e.devir) : para2(0)}</td><td class="num">${para2(e.devir)}</td><td><em>Önceki dönemden devir</em></td><td></td></tr>` : ''}
        ${e.satirlar.map((s) => html`<tr data-cari-satir="${s.tur}"><td>${trTarih(s.tarih)}</td><td class="num">${para2(s.borc)}</td><td class="num"><span class="${s.alacak ? 'neg' : ''}">${para2(s.alacak)}</span></td><td class="num">${para2(s.bakiye)}</td>
          <td><em>${s.aciklama}</em>${s.tahmini ? html` ${pill('Tarih tahmini', 'warning')}` : ''}</td>
          <td class="actions">${s.tur === 'tahsilat' && olusturabilir ? (s.grup
            ? html`<button type="button" class="icon-btn" data-cari-grup-duzenle="${s.grup}|${s.tarih}" aria-label="Tahsilat tarihini düzenle" title="Tarih / yöntem / not düzenle">${icon('pencil', 16)}</button><button type="button" class="icon-btn" data-cari-grup-iptal="${s.grup}|${s.tarih}" aria-label="Tahsilatı iptal et" title="Tahsilatı iptal et">${icon('trash', 16)}</button>`
            : html`<button type="button" class="icon-btn" data-cari-duzenle="${s.kayit.id}" aria-label="Tahsilatı düzenle" title="Tahsilat tarihini / tutarını düzenle">${icon('pencil', 16)}</button>`) : ''}</td></tr>`)}
      </tbody><tfoot><tr><th scope="row">Toplam</th><td class="num">${para2(e.toplamBorc)}</td><td class="num">${para2(e.toplamAlacak)}</td><td class="num">${para2(e.bakiye)}</td><td colspan="2">${CARI_DURUM[e.durum]}</td></tr></tfoot></table></div>`;
  };

  const excelIndir = async () => {
    const f = firmaOf(); if (!f) return;
    const e = ekstre(); const { baslangic, bitis } = aralik();
    const yetkili = kisiler.find((k) => k.company_id === f.id && !k.archived_at)?.full_name ?? '';
    const logoBayt = await logoBaytlari();
    const bayt = cariExcel({ firma: f, yetkili, ekstre: e, baslangic, bitis, logoBayt });
    const ad = `cari-${dosyaAdiParcasi(f.name)}-${durum.yil === 'aralik' ? `${baslangic || 'basi'}_${bitis || bugunStr}` : durum.yil}.xlsx`;
    dosyaIndir(ad, bayt, XLSX_TURU);
    toast(`Excel indirildi: ${ad}`);
  };

  return {
    baslik: 'Cari hesap', altBaslik: 'Firma bazında hesap ekstresi: faturalar alacak, tahsilatlar borç hanesinde (KDV dahil)',
    eylemler: html`${olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="cari-tahsilat">${icon('wallet', 18)} Tahsilat gir</button> ` : ''}<button type="button" class="btn btn-secondary" data-action="cari-excel">${icon('download', 18)} Excel olarak indir</button>`,
    govde: html`<section class="card card-flush"><div id="cari-ust">${ust()}</div></section><section class="card pad-t" id="cari-govde">${tablo()}</section>`,
    mount(kok) {
      const ciz = () => { kok.querySelector('#cari-ust').innerHTML = ust().s; kok.querySelector('#cari-govde').innerHTML = tablo().s; };
      kok.addEventListener('change', (ev) => {
        const t = ev.target;
        if (t.id === 'cari-firma') { durum.firma = t.value; durum.yil = yilBugun; ciz(); }
        else if (t.id === 'cari-yil') { durum.yil = t.value; ciz(); }
        else if (t.id === 'cari-bas') { durum.bas = t.value; kok.querySelector('#cari-govde').innerHTML = tablo().s; }
        else if (t.id === 'cari-bit') { durum.bit = t.value; kok.querySelector('#cari-govde').innerHTML = tablo().s; }
      });
      kok.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-action="cari-excel"]')) { try { await excelIndir(); } catch (err) { toast(humanError(err), 'hata'); } return; }
        if (ev.target.closest('[data-action="cari-tahsilat"]')) {
          const f = firmaOf(); if (!f) return;
          const idler = new Set(faturalar.filter((x) => x.company_id === f.id).map((x) => x.id));
          firmaTahsilatFormuAc(app, { firma: f, faturalar: faturalar.filter((x) => x.company_id === f.id), tahsilatlar: tahsilatlar.filter((x) => idler.has(x.invoice_id)), onDone: () => app.yenile() });
          return;
        }
        const gd = ev.target.closest('[data-cari-grup-duzenle]');
        if (gd) {
          const [grup, tarihi] = gd.dataset.cariGrupDuzenle.split('|');
          const uyeler = tahsilatlar.filter((x) => x.group_id === grup && x.paid_at === tarihi && !x.archived_at); if (!uyeler.length) return;
          const ilk = uyeler[0];
          openFormModal({
            baslik: 'Tahsilatı düzenle', altBaslik: `${uyeler.length} faturaya dağıtılmış tahsilat · toplam ${para2(uyeler.reduce((t, x) => t + Number(x.amount), 0))}`, gonderEtiketi: 'Değişiklikleri kaydet',
            govde: html`<div class="notice notice-info field-full" role="note">Tutarı değiştirmek için bu tahsilatı iptal edip yeniden girin; dağıtım yeniden yapılır.</div>
              ${field({ ad: 'paid_at', etiket: 'Tahsilat tarihi', tur: 'date', zorunlu: true, deger: tarihi, max: bugunStr })}
              ${field({ ad: 'method', etiket: 'Ödeme yöntemi', deger: ilk.method ?? ODEME_YONTEMLERI[0], secenekler: ODEME_YONTEMLERI.map((y) => ({ deger: y, etiket: y })) })}
              ${field({ ad: 'notes', etiket: 'Not', tam: true, maksUzunluk: 300, deger: ilk.notes ?? '' })}`,
            async onSubmit(fd) {
              const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
              if (!g('paid_at')) h.paid_at = 'Tarihi seçin.'; else if (g('paid_at') > bugun()) h.paid_at = 'Tahsilat tarihi gelecekte olamaz.';
              if (Object.keys(h).length) return { errors: h };
              await app.api.updatePaymentGroup(grup, tarihi, { paid_at: g('paid_at'), method: bosIseNull(g('method')), notes: bosIseNull(g('notes')) });
              toast('Tahsilat güncellendi.');
            },
            onDone: () => app.yenile(),
          });
          return;
        }
        const gi = ev.target.closest('[data-cari-grup-iptal]');
        if (gi) {
          const [grup, tarihi] = gi.dataset.cariGrupIptal.split('|');
          if (await confirmDialog({ baslik: 'Tahsilat iptal edilsin mi?', mesaj: 'Bu tahsilatın bağlı olduğu tüm faturalardaki ödeme kayıtları iptal edilir; faturalar tekrar açık kalır.', onayEtiketi: 'Tahsilatı iptal et', tehlikeli: true })) {
            try { await app.api.archivePaymentGroup(grup, tarihi); toast('Tahsilat iptal edildi.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          }
          return;
        }
        const d = ev.target.closest('[data-cari-duzenle]'); if (!d) return;
        const p = tahsilatlar.find((x) => String(x.id) === d.dataset.cariDuzenle); if (!p) return;
        const fatura = faturalar.find((x) => x.id === p.invoice_id); if (!fatura) return;
        const durumF = faturaDurumu(fatura, tahsilatlar.filter((x) => x.invoice_id === fatura.id && !x.archived_at), bugunStr);
        tahsilatFormuAc(app, { fatura, durum: durumF, firmaAdi: firmaOf()?.name ?? '', tahsilat: p, onDone: () => app.yenile() });
      });
    },
  };
}
