#!/usr/bin/env python3
"""İSG teklif şablonunu (örnek Word teklifi) alan işaretli şablona çevirir: python3 tools/sablon_hazirla.py ornek.docx src/assets/teklif_sablonu.docx
Örnek belgedeki firma/kişi/sayı/fiyat/tarih yerlerini {{ALAN}} işaretleriyle değiştirir; uygulama bu işaretleri doldurur."""
import re, sys, zipfile

kaynak, hedef = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(kaynak)
d = zin.read('word/document.xml').decode('utf8')
RSID = re.compile(r' w:rsid\w*="[^"]*"')
d = RSID.sub('', d)

def paragraflar(x):
    return list(re.finditer(r'<w:p(?: [^>]*)?>(?:(?!<w:p[ >]).)*?</w:p>', x, flags=re.S))

def metin(p):
    return ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p))

def ilk_calisma_rpr(p, kalin=None):
    runs = re.findall(r'<w:r>(<w:rPr>.*?</w:rPr>)?', p, flags=re.S)
    return runs

def calisma(rpr, token):
    return f'<w:r>{rpr}<w:t xml:space="preserve">{token}</w:t></w:r>'

def rpr_of(run_xml):
    m = re.search(r'<w:rPr>.*?</w:rPr>', run_xml, flags=re.S)
    return m.group(0) if m else ''

def p_ac(p):
    return re.match(r'<w:p(?: [^>]*)?>(?:<w:pPr>.*?</w:pPr>)?', p, flags=re.S).group(0)

def kalan_runlari_degistir(p, bas_metin_biter, token):
    """Paragrafta, metni 'bas_metin_biter'den sonra başlayan tüm run'ları tek run'a (token) çevirir."""
    gövde = p_ac(p)
    sonrasi = p[len(gövde):-len('</w:p>')]
    parcalar = re.findall(r'<w:r>.*?</w:r>', sonrasi, flags=re.S)
    kes = 0; sayac = 0
    for i, r in enumerate(parcalar):
        sayac += len(metin(r))
        if sayac >= bas_metin_biter: kes = i + 1; break
    return gövde + ''.join(parcalar[:kes]) + calisma(rpr_of(parcalar[kes]), token) + '</w:p>'

out = d
for m in reversed(paragraflar(d)):
    p = m.group(0); t = metin(p); yeni = None
    if t == 'Sayın Mustafa BAYINDIR':
        yeni = re.sub(r'<w:t[^>]*>.*?</w:t>', '<w:t xml:space="preserve">{{SAYIN}}</w:t>', p, count=1, flags=re.S)
    elif t == 'EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞAAT MET. SAN ve TİC. LTD. ŞTİ.':
        yeni = re.sub(r'<w:t[^>]*>.*?</w:t>', '<w:t xml:space="preserve">{{FIRMA}}</w:t>', p, count=1, flags=re.S)
    elif t.startswith('EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞAAT MET. SAN ve TİC. LTD. ŞTİ.’nin'):
        # firma adı run'ı + tek run: {{A_DEVAMI}}
        runs = re.findall(r'<w:r>.*?</w:r>', p, flags=re.S)
        yeni = p_ac(p) + re.sub(r'<w:t[^>]*>.*?</w:t>', '<w:t xml:space="preserve">{{FIRMA}}</w:t>', runs[0], count=1, flags=re.S) + calisma(rpr_of(runs[0]), '{{A_DEVAMI}}') + '</w:p>'
    elif t.startswith('EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞAAT MET. SAN ve TİC. LTD. ŞTİ. raporun'):
        yeni = p.replace('EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞAAT MET. SAN ve TİC. LTD. ŞTİ.', '{{FIRMA}}', 1)
    elif t.startswith('Tehlike sınıfına uygun iş güvenliği uzmanı'):
        yeni = kalan_runlari_degistir(p, len('Tehlike sınıfına uygun iş güvenliği uzmanı belgesine sahip mühendis, mimar veya teknik eleman '), '{{UZMAN_SURESI}}')
    elif t.startswith('İş yeri hekimi belgesine sahip'):
        yeni = kalan_runlari_degistir(p, len('İş yeri hekimi belgesine sahip tıp doktoru '), '{{HEKIM_SURESI}}')
    elif t.startswith('Yukarıda kapsamı ve detayları'):
        runs = re.findall(r'<w:r>.*?</w:r>', p, flags=re.S)
        # runs[0] metin, runs[1..4] kalın fiyat, runs[5] ’dir.
        yeni = p_ac(p) + runs[0] + calisma(rpr_of(runs[1]), '{{UCRET}}') + runs[5] + '</w:p>'
    elif t.startswith('Sözleşme 31.12.2026'):
        runs = re.findall(r'<w:r>.*?</w:r>', p, flags=re.S)
        yeni = p_ac(p) + calisma(rpr_of(runs[0]), '{{SOZLESME_SATIRI}}') + '</w:p>'
        # hemen sonraki boş paragrafı da işaretle (satır kalkarsa o da kalksın)
        sonra = out[m.end():]
        bos = re.match(r'<w:p(?: [^>]*)?>(?:<w:pPr>.*?</w:pPr>)?</w:p>', sonra, flags=re.S)
        assert bos, 'sözleşme satırından sonra boş paragraf bekleniyordu'
        isaretli = bos.group(0)[:-len('</w:p>')] + calisma(rpr_of(runs[0]), '{{SOZLESME_BOSLUK}}') + '</w:p>'
        out = out[:m.start()] + yeni + isaretli + sonra[len(bos.group(0)):]
        continue
    if yeni is not None:
        out = out[:m.start()] + yeni + out[m.end():]

assert 'EGEPOL' not in out and 'BAYINDIR' not in out, 'örnek firma/kişi adı kalmış'
for tok in ['{{SAYIN}}', '{{FIRMA}}', '{{A_DEVAMI}}', '{{UZMAN_SURESI}}', '{{HEKIM_SURESI}}', '{{UCRET}}', '{{SOZLESME_SATIRI}}', '{{SOZLESME_BOSLUK}}']:
    assert tok in out, tok + ' yerleştirilemedi'
assert out.count('{{FIRMA}}') == 3

zout = zipfile.ZipFile(hedef, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    veri = out.encode('utf8') if it.filename == 'word/document.xml' else zin.read(it.filename)
    zout.writestr(it.filename, veri)
zout.close()
print('tamam', hedef)
