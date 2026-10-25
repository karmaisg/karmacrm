// OSGB 360 - Kullanıcılar ve yetki matrisi.
import { html, raw, tarih, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, pill, emptyState, field, openFormModal, toast } from '../ui/components.js';
import { epostaGecerli } from '../lib/veri.js';
import { humanError } from '../lib/api.js';
import { MODUL_ADLARI, MODUL_SIRASI, ROL_SIRASI, ROL_ADLARI, AYRICALIKLI_ROLLER } from '../modules.js';

export async function kullanicilarSayfasi(app) {
  const [kullanicilar, roller, izinler] = await Promise.all([
    app.api.listUsers(), app.api.listRoles(), app.api.listRolePermissions(),
  ]);
  const rolId = new Map(roller.map((r) => [r.id, r]));
  const rolAdi = (r) => ROL_ADLARI[r?.key] ?? r?.name ?? '—';
  const benim = app.ctx.user.id;
  const ben = app.ctx.role;
  const benAyricalikli = AYRICALIKLI_ROLLER.includes(ben.key);
  const ekleyebilir = app.can('users', 'create');
  const duzenleyebilir = app.can('users', 'edit');
  const durum = { sekme: 'kullanicilar', rol: ROL_SIRASI.find((k) => !AYRICALIKLI_ROLLER.includes(k)) ?? ROL_SIRASI[0] };
  const izin = new Map(izinler.map((p) => [`${p.role_id}:${p.module}`, p]));
  const siraliRoller = ROL_SIRASI.map((k) => roller.find((r) => r.key === k)).filter(Boolean);

  const atanabilirRoller = (mevcut = null) => siraliRoller.filter((r) => benAyricalikli || !AYRICALIKLI_ROLLER.includes(r.key) || r.id === mevcut);

  // ---------------------------------------------------------------- kullanıcı tablosu
  function kullaniciTablosu() {
    const liste = [...kullanicilar].sort((a, b) => trSirala(a.full_name, b.full_name));
    const satir = (u) => {
      const kendi = u.id === benim;
      const r = rolId.get(u.role_id);
      const dokunulamaz = AYRICALIKLI_ROLLER.includes(r?.key) && !benAyricalikli;
      return html`<tr class="${u.is_active ? '' : 'row-muted'}">
        <td><span class="cell-main">${avatar(u.full_name)}<span><strong>${u.full_name}</strong>${kendi ? html`<small>Siz</small>` : ''}</span></span></td>
        <td class="hide-sm">${u.email || html`<span class="muted">—</span>`}</td>
        <td>${rolAdi(r)}</td>
        <td>${u.is_active ? pill('Aktif', 'success') : pill('Pasif', 'neutral')}</td>
        <td class="hide-md">${tarih(String(u.created_at ?? '').slice(0, 10))}</td>
        <td class="actions">${duzenleyebilir && !kendi && !dokunulamaz
          ? html`<button type="button" class="icon-btn" data-kullanici="${u.id}" aria-label="${u.full_name} kullanıcısını düzenle" title="Düzenle">${icon('pencil', 18)}</button>`
          : ''}</td></tr>`;
    };
    return html`<section class="card card-flush">
      <div class="card-head"><div><h2 class="card-title">Kullanıcılar <span class="chip-n">${kullanicilar.length}</span></h2>
        <p class="card-sub">Kendi rolünüzü ve durumunuzu değiştiremezsiniz; böylece yanlışlıkla kilitlenmezsiniz.</p></div>
        ${ekleyebilir ? html`<button type="button" class="btn btn-primary btn-sm" data-action="kullanici-ekle">${icon('plus', 16)} Kullanıcı ekle</button>` : ''}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Ad soyad</th><th scope="col" class="hide-sm">E-posta</th><th scope="col">Rol</th><th scope="col">Durum</th><th scope="col" class="hide-md">Eklenme</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${liste.map(satir)}</tbody></table></div></section>`;
  }

  function kullaniciEkleFormu() {
    openFormModal({
      baslik: 'Kullanıcı ekle',
      altBaslik: 'Önce Supabase > Authentication > Users bölümünden kullanıcıyı oluşturun; sonra aynı e-postayı buraya yazın.',
      govde: html`${field({ ad: 'email', etiket: 'E-posta', tur: 'email', zorunlu: true, tam: true, maksUzunluk: 120 })}
        ${field({ ad: 'full_name', etiket: 'Ad soyad', zorunlu: true, tam: true, maksUzunluk: 120 })}
        ${field({ ad: 'role', etiket: 'Rol', zorunlu: true, tam: true, deger: '', secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(atanabilirRoller().map((r) => ({ deger: r.key, etiket: rolAdi(r) }))) })}`,
      async onSubmit(fd) {
        const g = (k) => String(fd.get(k) ?? '').trim();
        const h = {};
        if (!epostaGecerli(g('email'))) h.email = 'Geçerli bir e-posta adresi yazın.';
        if (!g('full_name')) h.full_name = 'Ad soyad zorunludur.';
        if (!g('role')) h.role = 'Rol seçin.';
        if (Object.keys(h).length) return { errors: h };
        await app.api.addUser({ email: g('email'), adSoyad: g('full_name'), rol: g('role') });
        toast('Kullanıcı eklendi.');
      },
      onDone: () => app.yenile(),
    });
  }

  function kullaniciDuzenleFormu(u) {
    openFormModal({
      baslik: 'Kullanıcıyı düzenle', altBaslik: u.email || u.full_name,
      govde: html`${field({ ad: 'full_name', etiket: 'Ad soyad', zorunlu: true, tam: true, deger: u.full_name, maksUzunluk: 120 })}
        ${field({ ad: 'role_id', etiket: 'Rol', zorunlu: true, deger: u.role_id, secenekler: atanabilirRoller(u.role_id).map((r) => ({ deger: r.id, etiket: rolAdi(r) })) })}
        ${field({ ad: 'is_active', etiket: 'Durum', deger: u.is_active ? '1' : '0', secenekler: [{ deger: '1', etiket: 'Aktif' }, { deger: '0', etiket: 'Pasif (giriş yapamaz)' }] })}`,
      async onSubmit(fd) {
        const g = (k) => String(fd.get(k) ?? '').trim();
        if (!g('full_name')) return { errors: { full_name: 'Ad soyad zorunludur.' } };
        await app.api.updateUser(u.id, { full_name: g('full_name'), role_id: g('role_id'), is_active: g('is_active') === '1' });
        toast('Kullanıcı güncellendi.');
      },
      onDone: () => app.yenile(),
    });
  }

  // ---------------------------------------------------------------- yetki matrisi
  function matris() {
    const rol = siraliRoller.find((r) => r.key === durum.rol) ?? siraliRoller[0];
    const kilitli = AYRICALIKLI_ROLLER.includes(rol.key);
    const duzenlenebilir = duzenleyebilir && !kilitli;
    const kutu = (modul, alan, etiket) => {
      const p = izin.get(`${rol.id}:${modul}`);
      const deger = !!p?.[alan];
      return html`<td class="perm"><input type="checkbox" data-izin="${modul}" data-alan="${alan}" ${deger ? raw('checked') : ''} ${duzenlenebilir ? '' : raw('disabled')}
        aria-label="${MODUL_ADLARI[modul]}: ${etiket}"></td>`;
    };
    return html`<section class="card card-flush">
      <div class="card-head"><div><h2 class="card-title">Yetki matrisi</h2>
        <p class="card-sub">${kilitli ? 'Sistem yöneticisi ve işletme sahibi yetkileri sabittir; arayüzden değiştirilemez.' : 'Değişiklikler kutuya tıklar tıklamaz kaydedilir ve denetim kaydına yazılır. Kullanıcılar bir sonraki girişlerinde (veya sayfayı yenilediklerinde) yeni yetkiyi alır.'}</p></div>
        <label class="select-inline"><span class="sr-only">Rol seçin</span>
          <select id="matris-rol">${siraliRoller.map((r) => html`<option value="${r.key}" ${r.key === rol.key ? raw('selected') : ''}>${rolAdi(r)}</option>`)}</select></label></div>
      <div class="table-wrap"><table class="table table-matrix"><thead><tr><th scope="col">Modül</th><th scope="col">Görüntüle</th><th scope="col">Oluştur</th><th scope="col">Düzenle</th><th scope="col">Arşivle</th></tr></thead>
      <tbody>${MODUL_SIRASI.map((m) => html`<tr><th scope="row">${MODUL_ADLARI[m]}</th>${kutu(m, 'can_view', 'görüntüle')}${kutu(m, 'can_create', 'oluştur')}${kutu(m, 'can_edit', 'düzenle')}${kutu(m, 'can_archive', 'arşivle')}</tr>`)}</tbody></table></div>
      <p class="fine pad">Not: "Düzenle" ve "Arşivle" yetkileri, ilgili modülde "Görüntüle" yetkisi olmadan işe yaramaz.</p></section>`;
  }

  const sekmeCubugu = () => html`<div class="tabs" role="tablist" aria-label="Kullanıcı yönetimi">
    <button type="button" role="tab" class="tab ${durum.sekme === 'kullanicilar' ? 'tab-on' : ''}" aria-selected="${durum.sekme === 'kullanicilar'}" data-sekme="kullanicilar">Kullanıcılar</button>
    <button type="button" role="tab" class="tab ${durum.sekme === 'yetkiler' ? 'tab-on' : ''}" aria-selected="${durum.sekme === 'yetkiler'}" data-sekme="yetkiler">Yetki matrisi</button></div>`;
  const icerik = () => (durum.sekme === 'yetkiler' ? matris() : (kullanicilar.length ? kullaniciTablosu() : emptyState({ simge: 'users', baslik: 'Kullanıcı yok' })));

  return {
    baslik: 'Kullanıcılar ve yetkiler',
    altBaslik: 'Kimin hangi modülü görebileceğini ve değiştirebileceğini yönetin',
    govde: html`<div id="kul-sekmeler">${sekmeCubugu()}</div><div id="kul-icerik" role="tabpanel">${icerik()}</div>`,
    mount(kok) {
      const ciz = () => { kok.querySelector('#kul-sekmeler').innerHTML = sekmeCubugu().s; kok.querySelector('#kul-icerik').innerHTML = icerik().s; };
      kok.addEventListener('change', async (e) => {
        if (e.target.id === 'matris-rol') { durum.rol = e.target.value; ciz(); kok.querySelector('#matris-rol')?.focus(); return; }
        const c = e.target.closest('[data-izin]');
        if (!c) return;
        const rol = siraliRoller.find((r) => r.key === durum.rol);
        const modul = c.dataset.izin, alan = c.dataset.alan, yeni = c.checked;
        c.disabled = true;
        try {
          const kayit = await app.api.setPermission(rol.id, modul, { [alan]: yeni });
          izin.set(`${rol.id}:${modul}`, kayit);
          toast('Yetki kaydedildi.');
        } catch (err) {
          c.checked = !yeni;
          toast(humanError(err), 'hata');
        } finally { c.disabled = false; }
      });
      kok.addEventListener('click', (e) => {
        const t = e.target.closest('[data-sekme]');
        if (t) { durum.sekme = t.dataset.sekme; ciz(); kok.querySelector(`[data-sekme="${durum.sekme}"]`)?.focus(); return; }
        if (e.target.closest('[data-action="kullanici-ekle"]')) { kullaniciEkleFormu(); return; }
        const d = e.target.closest('[data-kullanici]');
        if (d) { const u = kullanicilar.find((x) => x.id === d.dataset.kullanici); if (u) kullaniciDuzenleFormu(u); }
      });
    },
  };
}
