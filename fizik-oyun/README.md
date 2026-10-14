# FizikLab 9 – 9. Sınıf Fizik Eğitici Oyunlar

9. sınıf MEB fizik müfredatını (Fizik Bilimine Giriş, Madde ve Özellikleri, Hareket ve Kuvvet, Enerji) oyunlaştıran,
tarayıcıda çalışan, karanlık/aydınlık temalı, mobil uyumlu bir web sitesi.

## Dosyalar
| Dosya | Görevi |
|---|---|
| `index.html` | Sayfa iskeleti, tüm görünümler (ana sayfa, 3 oyun, quiz, skorlar) |
| `style.css` | Tema değişkenleri (dark/light), neon efektler, bileşen ve oyun stilleri |
| `script.js` | Yönlendirme, depolama, 3 oyun, quiz ve skor tablosu |

Düzen için **Tailwind CSS (CDN)** kullanılır; derleme adımı yoktur.

## Çalıştırma
Herhangi bir statik sunucuyla ya da doğrudan `index.html` dosyasını açarak çalışır:

```bash
cd fizik-oyun
python3 -m http.server 8080   # sonra http://localhost:8080
```

Yayın için klasörü GitHub Pages / Netlify / Cloudflare Pages / Render (static) gibi bir statik barındırmaya yüklemek yeterlidir.
(Tailwind CDN ve Google Fonts için internet bağlantısı gerekir.)

## Oyunlar
1. **Özkütle & Sıvı Kulesi** – `d = m/V`. Sıvıları ve cisimleri dereceli silindire sürükle (veya kartı seç + bölmeye dokun). Yanlış yerleştirmede fizik ipucu verilir. 3 seviye, yıldız sistemi.
2. **Sürtünme & İvme Parkuru** – Canvas simülasyonu. Buz/Beton/Kum (k = 0,05 / 0,40 / 0,65), `Fs = k·N`, `a = (F − Fs)/m`. Canlı sayaçlar ve kuvvet / hız–ivme grafikleri; bloğu hedef bölgede durdur. `Boşluk` tuşu ile de itilebilir.
3. **Enerji Dönüşüm Hız Treni** – Tepe yüksekliği, kütle ve ray sürtünmesi ayarlanır. Ray boyunca hareket denklemi çözülür; döngüde `N = m(v²/R + g·cosθ) < 0` olursa vagon raydan ayrılır. Sürtünmesiz kritik yükseklik `h = 2,5R`.
4. **Quiz & Skor Tablosu** – 40 soru, konu seçimi, süreli (20 sn) 10 soruluk tur. Yüksek skor, liderlik tablosu, XP ve oyun rekorları `localStorage` içinde saklanır (anahtar: `fizikLab.v1`).

Tüm hesaplamalarda g = 10 m/s² alınmıştır.
