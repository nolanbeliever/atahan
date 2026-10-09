# 🌷 Amsterdam Otel — FPV Otel Yönetimi (MVP / 1. Aşama)

Amsterdam temalı, birinci şahıs (FPV) perspektifinden oynanan, tarayıcıda çalışan çok oyunculu 3D otel yönetimi oyunu.
**Hotel De Tulp**'ta kat görevlisisin: misafirler resepsiyona gelir, boş odaya yerleşir; çıkış yapınca oda **Kirli** olur.
Odaya girip yatağı düzeltir, çöpleri toplarsın ve oda yeniden **Boş** olur.

- **Teknolojiler:** Node.js + Express 5, Socket.io 4 (WebSocket), Three.js (r185, WebGL)
- **Derleme adımı yok:** istemci saf ES modülleri + import map ile çalışır
- **Görsel dosya yok:** tüm dokular (mermer, parke, tuğla, kanal evleri, Delft mavisi tablo…) Canvas ile prosedürel üretilir

## Çalıştırma

```bash
cd amsterdam-otel
npm install
npm start          # http://localhost:3000
```

Aynı ağdaki telefon/tablet ile `http://<bilgisayar-ip>:3000` adresinden bağlanabilirsin. Birden fazla cihaz aynı oteli birlikte yönetir.

Geliştirme için: `npm run dev` (dosya değişince sunucu yeniden başlar), testler için: `npm test`.

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Sunucu portu |
| `DAY_LENGTH_SEC` | `240` | Bir oyun gününün (07:00 → 23:00) gerçek süresi |
| `WEEKEND_SPEED` | `2` | Hafta sonu (otel kapalı) günleri kaç kat hızlı aksın |
| `START_DAY` | `0` | Başlangıç günü (0 = Pazartesi … 5 = Cumartesi, 6 = Pazar) |
| `START_HOUR` | `7` | Başlangıç saati (7–22) |
| `SPAWN_MIN_MIN` / `SPAWN_MAX_MIN` | `40` / `90` | Misafir gelişleri arası (oyun dakikası) |
| `STAY_MIN_MIN` / `STAY_MAX_MIN` | `150` / `420` | Konaklama süresi (oyun dakikası) |
| `MAX_PLAYERS` | `16` | Aynı anda bağlanabilecek görevli sayısı |

Örnek — hafta sonu modunu hemen görmek için: `START_DAY=5 START_HOUR=10 npm start`

## Kontroller

| PC | Mobil / Tablet |
| --- | --- |
| **W A S D** / ok tuşları: yürü, **Shift**: koş | **Sol taraf**: parmağın bastığı yerde beliren dinamik joystick (sonuna kadar itince koşar) |
| **Fare**: etrafa bak (Pointer Lock) | **Sağ taraf**: dokunup sürükleyerek kamera çevir |
| **E** / **Space** / **Sol tık**: aksiyon | Tek, şeffaf **Aksiyon** butonu |
| **F**: seçili ürünü tüket · **Q** / **1–4**: ürün seç | Hedef yokken **Aksiyon**: seçili ürünü tüket · envanterde dokunarak seç |
| **Esc**: duraklat / paneli kapat | ⚙ butonu: ayarlar |

Hedeflenen iş (dağınık yatak / çöp) zeminde turuncu halka ile işaretlenir ve ekranın altında ipucu çıkar.

## Oyun döngüsü

- **Lobi + koridor + 4 oda (101–104).** Sağ üstteki pano her odanın durumunu gösterir: **Boş / Dolu / Kirli** (kirli odalarda kalan iş sayısıyla). Koridorda her kapının yanında aynı renkte bir durum lambası vardır.
- **Misafir akışı:** sokaktan gelir → resepsiyonda kayıt (oda ücreti **€95** kasaya girer) → boş odaya yürür → konaklama süresi bitince çıkar, oda **Kirli** olur. Boş oda yoksa lobideki kanepede bekler; süre dolarsa ayrılır.
- **Temizlik:** kirli odaya gir, yatağı düzelt, 2–3 çöpü topla → oda **Boş** olur. Dolu odaların kapısı kilitlidir (misafir mahremiyeti).
- **Zarar verme / kırma mekaniği yoktur.**
- **Bahşiş:** odayı bitiren görevli misafirin bıraktığı **€4–12** bahşişi kişisel **cüzdanına** alır (otel kasasından ayrı; başlangıç cüzdanı €30).
- **Zaman:** Pazartesi–Cuma otel açık (misafir kabulü 08:00–19:00). **Cumartesi–Pazar otel kapalı:** giriş kapısı kapanır, tabela "KAPALI · Gesloten" olur, yeni misafir gelmez, zaman 2 kat hızlı akar. Gece yarısını aşan konaklamalar ertesi sabah 07:00'de çıkış yapar (Cumartesi sabahı son misafirler ayrılır → hafta sonu temizlik zamanı). Her gün sonunda günlük özet bildirimi gelir.

## Coffee Shop ve Trip Sistemi (18+)

> Kurgusal içerik. Bu bölüm uyuşturucu kullanımını ve etkilerini tasvir ettiği için oyunun yaş sınırını yükseltir
> (PEGI 18 / App Store 17+); mağazalarda yayınlarken buna göre etiketlenmelidir. Dükkân ilk açıldığında oyuncudan
> 18 yaş onayı istenir (tarayıcıda hatırlanır).

- **Mekân:** Otelin doğusunda, sokağa açılan **"De Groene Molen"** coffee shop'u: yeşil ahşap vitrin, neon tabela, menü panosu, kavanozlu raflar, budtender, ip ışıklar ve bir **Lucky Tulp** slot makinesi. FPV olarak içeri girilir.
- **Satın alma:** Tezgâha bakıp **E** / **Aksiyon** → ürün paneli. **Amnesia Haze** (€12), **Space Cake** (€8), **White Widow** (€10), **Northern Lights** (€11) kişisel cüzdandan alınır ve envantere eklenir.
- **Tüketim:** **F** (mobilde hedef yokken **Aksiyon**) → sunucu zar atar: **%50 İyi Trip / %50 Kötü Trip**, **2 dakika**. Trip sürerken yeni ürün tüketilemez; kalan süre üstte gösterilir.
- **İyi Trip:** doygunluk ve parlaklık artar (shader); ekranda komik baloncuklar ve sentezlenmiş kıkırdama sesi. **Şans bonusu (sunucuda uygulanır):** slot kazanma ihtimali **+%25** (temel %30 → %37,5), bahşişler **+%20**.
- **Kötü Trip:** kenarlarda kırmızı/koyu, kalp atışıyla nabız gibi atan **vignette**, **kamera sallanması** ve görüşün **dalgalanması**; koridorda/sokakta yalnızca o oyuncunun gördüğü kırmızı gözlü **gölge figürler** (yaklaşınca kaybolur); ara ara **kusma** (ekrana kırmızı sıçrama, kamera öne eğilir, kısa süre hareket edemezsin); yürüyüş **%30 yavaş**.
- **Çok oyunculu:** Ekran efektleri ve halüsinasyonlar **tamamen yerel**dir. Diğer oyuncular yalnızca o kişinin yavaşladığını, başının üstünde **"HA HA HA!"** baloncuğuyla kıkırdadığını ya da öne eğilip **kırmızı parçacık püskürterek kustuğunu** görür. Satın alma, zar, slot sonucu, bahşiş ve emote'lar sunucuda doğrulanır (mesafe, bakiye, trip türü, bekleme süresi).
- **Slot:** €5'lık çevirme; 🌷🚲🧀 üçlüsü x2, 🌀 x5, 💰 x20.

**Trip efektlerinin pil maliyeti:** `EffectComposer` yalnızca trip sürerken takılır, bitince söküp render hedeflerini serbest bırakır. Tüm efektler **tek bir tam ekran shader geçişinde** (doygunluk + parlaklık + vignette + dalga) ve HalfFloat yerine **8-bit sRGB render hedefiyle** çalışır. Render hedefi motorun `pixelRatio`'sunu kullanır, yani mobilde **1.0**. İyi trip efekti statik olduğundan motor boştayken yine **uyur**. Kötü trip'teki sallanma/dalga için FPS sınırında (mobilde 30) sürekli çizim gerekir. Ayarlardaki **"sallanma/dalgalanmayı azalt"** seçeneği bunu kapatır; işletim sisteminde "hareketi azalt" açıksa varsayılan olarak açık gelir. Kıkırdama sesi WebAudio ile sentezlenir (ses dosyası yok) ve çalmadığında ses bağlamı askıya alınır.

## Performans ve pil optimizasyonu

| Önlem | Nerede |
| --- | --- |
| **FPS kilidi:** mobil/tablette varsayılan **30**, masaüstünde **60** (ayarlardan 30/60). 90/120 Hz ekranlarda fazladan kare çizilmez. | `core/Engine.js`, `core/Settings.js` |
| **Tek rAF döngüsü + uyku modu:** oyuncu durduğunda ve yürüyen misafir/animasyon yoksa `requestAnimationFrame` döngüsü **tamamen durur** (saniyede 0 kare). Girdi veya ağ olayı döngüyü uyandırır. | `core/Engine.js` |
| Sekme gizlenince, oyun duraklatılınca (Esc / menü) ve WebGL bağlamı kaybolunca hiç kare çizilmez. | `core/Engine.js`, `main.js` |
| **Render ölçeği:** mobil/tablette `pixelRatio` **≤ 1.0**; masaüstünde ≤ 1.5. | `core/Settings.js` |
| **Dinamik kalite:** cihaza göre Düşük / Orta / Yüksek ön ayar (doku 128/256/512 px, gölge yok/512/1024). Cihaz hedef FPS'i tutturamazsa sırasıyla render ölçeği → gölgeler → doku çözünürlüğü otomatik düşürülür. | `core/Engine.js`, `world/Textures.js` |
| **Statik gölge:** gölge haritası her karede değil, yalnızca bir kez çizilir. Karakterlerde ucuz "blob" gölge. | `core/Engine.js`, `game/Characters.js` |
| **Geometri birleştirme:** tüm statik parçalar malzeme başına tek mesh → ~90 draw call, ~12 bin üçgen. | `world/StaticBatcher.js` |
| Ucuz malzemeler (`MeshLambertMaterial` / `MeshBasicMaterial`), ton eşleme yok, son işlem yalnızca trip sırasında, `powerPreference: 'low-power'` (mobil). | `world/Materials.js`, `core/Engine.js`, `game/TripEffects.js` |
| **Ağ:** doğrudan WebSocket (polling yok), konum en fazla 10 Hz ve yalnızca değişince; misafir hareketi istemcide rota + zaman damgasından hesaplanır (karede mesaj yok); oyuncu yokken sunucu simülasyonu tamamen durur. | `net/Network.js`, `shared/path.js`, `server/game/HotelSimulation.js` |
| **Düşük pil:** Battery API destekleniyorsa, şarjda değilken pil %20'nin altına inince FPS 30'a kilitlenir. | `main.js` |
| CSS'te `backdrop-filter`/blur ve sürekli animasyon yok; HUD yalnızca değer değişince DOM'a yazar. | `css/style.css`, `ui/HUD.js` |

Ayarlardaki **FPS göstergesi** çizilen kare sayısını, render ölçeğini ve motorun durumunu (aktif / uyku / duraklatıldı) gösterir.

## Klasör yapısı

```
amsterdam-otel/
├── package.json
├── server/                      # Node.js + Express + Socket.io (yetkili sunucu)
│   ├── index.js                 # HTTP sunucusu, statik dosyalar, three.js servis
│   ├── config.js                # Ortam değişkenleriyle ayarlar
│   ├── net/socketHandlers.js    # Socket olayları, hız sınırlama, doğrulama
│   └── game/
│       ├── HotelSimulation.js   # Simülasyon (ağdan bağımsız, test edilebilir)
│       ├── GameClock.js         # Gün döngüsü: hafta içi açık / hafta sonu kapalı
│       ├── RoomManager.js       # Oda durumları ve temizlik işleri
│       ├── GuestManager.js      # Misafir yaşam döngüsü ve rotaları
│       └── CoffeeShopService.js # Cüzdan, envanter, trip zarı, slot, bahşiş
├── shared/                      # Sunucu + istemci ortak kodu (ESM)
│   ├── constants.js             # Durumlar, olay adları, fiyat, saatler, ürünler, trip/slot
│   ├── layout.js                # Otel + coffee shop yerleşimi: duvarlar, odalar, rota noktaları
│   └── path.js                  # Deterministik rota örnekleme
├── public/                      # İstemci (derleme yok)
│   ├── index.html               # Canvas, HUD, dokunmatik kontroller, menüler
│   ├── css/style.css
│   └── js/
│       ├── main.js              # Her şeyi birbirine bağlar
│       ├── core/                # Engine (FPS kilidi, uyku), Device, Settings
│       ├── world/               # Otel + coffee shop geometrisi, dokular, malzemeler, çarpışma
│       ├── controls/            # Klavye/fare, dokunmatik joystick, FPV oyuncu
│       ├── game/                # Misafirler, diğer oyuncular, etkileşim, durum
│       │   ├── CoffeeShopSystem.js  # Tezgâh/slot etkileşimi, paneller, envanter, tüketim
│       │   └── TripEffects.js       # Shader, sallanma, hayaletler, baloncuk, ses, emote'lar
│       ├── net/Network.js       # Socket.io istemcisi, saat senkronu
│       └── ui/                  # HUD, ayarlar paneli
└── test/                        # Sunucu testleri (node:test): simülasyon + coffee shop
```

## Sonraki aşamalar için notlar

- Kalıcılık yok: kasa ve oda durumları sunucu yeniden başlayınca sıfırlanır.
- Otel kasasındaki para henüz harcanmıyor (yükseltmeler / personel / dekor için ekonomi sonraki aşamada); kişisel cüzdan coffee shop'ta harcanıyor.
- Ses, resepsiyonda oyuncu etkileşimi, misafir memnuniyeti ve oda yükseltmeleri planlanabilir.
