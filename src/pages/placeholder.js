// OSGB 360 - Henüz yapılmamış modüller için bilgilendirme sayfası.
import { html } from '../lib/format.js';
import { emptyState } from '../ui/components.js';
import { menuOgesi } from '../modules.js';

export function yakindaSayfasi(id) {
  const o = menuOgesi(id);
  return {
    baslik: o?.ad ?? 'Modül',
    altBaslik: '',
    govde: html`<section class="card">${emptyState({
      simge: o?.simge ?? 'info',
      baslik: o?.asama ? `Bu modül Aşama ${o.asama}'te eklenecek` : 'Bu modül sonraki aşamalarda eklenecek',
      metin: o?.aciklama ?? 'Bu bölüm henüz hazır değil.',
      eylem: html`<a class="btn btn-secondary" href="#/panel">Panele dön</a>`,
    })}</section>`,
  };
}
