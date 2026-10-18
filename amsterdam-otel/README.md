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

### Render'a deploy (Blueprint)

Bu klasörde oyuna özel bir Blueprint dosyası var: [`render.yaml`](render.yaml). Kökteki `render.yaml` eski Snoop uygulamasınındır.

1. Render → **Blueprints** → kendi Blueprint'in → **Settings** → **Blueprint Path** alanına `amsterdam-otel/render.yaml` yaz ve kaydet.
2. **Manual sync** ile senkronize et → `amsterdam-otel` adlı web servisi oluşur (`rootDir: amsterdam-otel`, `npm ci` / `npm start`, sağlık kontrolü `/health`).
3. Blueprint daha önce Snoop servisini oluşturduysa o servis **otomatik silinmez**; istemiyorsan panelden elle sil (ücretsiz plandaki aylık çalışma saatini paylaşırlar).

Ücretsiz planda servis 15 dk hareketsiz kalınca uyur (ilk açılış ~1 dk sürebilir) ve oyun durumu bellekte tutulduğu için yeniden başlatmada sıfırlanır.

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Sunucu portu |
| `DAY_LENGTH_SEC` | `240` | Bir oyun gününün (07:00 → 23:00) gerçek süresi |
| `NIGHT_LENGTH_SEC` | `150` | Gecenin (23:00 → 07:00) gerçek süresi; herkes uyursa erken biter. `0` → gece atlanır |
| `WEEKEND_SPEED` | `2` | Hafta sonu (otel kapalı) günleri kaç kat hızlı aksın |
| `START_DAY` | `0` | Başlangıç günü (0 = Pazartesi … 5 = Cumartesi, 6 = Pazar) |
| `START_HOUR` | `7` | Başlangıç saati (7–22) |
| `SPAWN_MIN_MIN` / `SPAWN_MAX_MIN` | `40` / `90` | Misafir gelişleri arası (oyun dakikası) |
| `STAY_MIN_MIN` / `STAY_MAX_MIN` | `150` / `420` | Konaklama süresi (oyun dakikası) |
| `MAX_PLAYERS` | `16` | Aynı anda bağlanabilecek görevli sayısı |
| `START_WALLET` | `30` | Yeni oyuncunun kişisel cüzdanı (€) |
| `DATABASE_URL` | — | PostgreSQL adresi (ör. ücretsiz Neon). Varsa tüm kalıcı kayıt buraya yazılır |
| `HOUSE_FILE` | `data/house.json` | `DATABASE_URL` yokken kullanılan yerel kayıt dosyası |

Örnek — hafta sonu modunu hemen görmek için: `START_DAY=5 START_HOUR=10 npm start`

### Kalıcı kayıt (paralar sıfırlanmasın)

Oyun her değişiklikten sonra otomatik kaydeder: evler ve eşyalar, ev sahipleri, oyuncu cüzdanları (tarayıcıdaki
gizli anahtara bağlı), otel kasası, günün özeti ve oyun günü/saati. Render'ın ücretsiz planında sunucunun diski
her yeniden başlatmada (deploy ya da 15 dk boşta kalıp uyuma) silindiği için kaydın bir veritabanında durması gerekir:

1. [neon.tech](https://neon.tech)'te ücretsiz bir PostgreSQL veritabanı aç (GetRich Tycoon'da kullandığın Neon
   veritabanı da olur; oyun kendi tablosunu açar: `amsterdam_otel_state`).
2. Neon'daki bağlantı adresini (`postgresql://…?sslmode=require`) kopyala.
3. Render → amsterdam-otel servisi → **Environment** → `DATABASE_URL` olarak ekle ve kaydet (servis yeniden başlar).

Açılış logunda `Kayıt: PostgreSQL (DATABASE_URL)` görünür. Veritabanına ulaşılamazsa sunucu boş bir kayıtla açılıp
eski kaydın üstüne yazmasın diye başlamaz (Render yeniden dener). `DATABASE_URL` yoksa kayıt yerel dosyaya yazılır.

## Kontroller

| PC | Mobil / Tablet |
| --- | --- |
| **W A S D** / ok tuşları: yürü, **Shift**: koş | **Sol taraf**: parmağın bastığı yerde beliren dinamik joystick (sonuna kadar itince koşar) |
| **Fare**: etrafa bak (Pointer Lock) | **Sağ taraf**: dokunup sürükleyerek kamera çevir |
| **E** / **Space** / **Sol tık**: aksiyon | Tek, şeffaf **Aksiyon** butonu |
| **F**: seçili ürünü tüket · **Q** / **1–4**: ürün seç | Hedef yokken **Aksiyon**: seçili ürünü tüket · envanterde dokunarak seç |
| **B**: dekorasyon modu (evde) · **1–9 / 0 / fare tekerleği / C / R / X** | **🛠 Dekor** butonu ve alt çubuk |
| Gece evindeki yatakta **E**: uyu · yürüyünce ya da tekrar **E** ile kalk | **Uyu** / **Kalk** |
| Saksıda **E**: tohum ek · hasat et | **Ek** / **Hasat** |
| **T**: TV yayınına katıl / kendi ekranında kapat | **▶ Katıl** çipi |
| Barda **E**: bardak al · koy · çalkala · servis et · topla · yıka · soğutucu dolap / fıçıdan malzeme seç | **Aksiyon** (butonun etiketi bakılan şeye göre değişir: Al, Koy, Dolap, Fıçı, Servis…) |
| Barda **K**: tarif kitabı (30 içecek) · restoranda **K**: menü kütüphanesi | Sipariş listesindeki **📖** |
| **F** / **E**: elindeki yiyeceği ısır (her ısırık 2 sn) | **Aksiyon**: ısır |
| Araca bakıp **E**: bin (sahibi sürer, arkadaşı arkaya biner) · sürerken **W/S** gaz-fren, **A/D** direksiyon, **E** in ve park et | **Bin** / **Arkaya** / **Park** · joystick: gaz ve direksiyon |
| Kirli odada arızaya bakıp **E**: mini oyun (ovala, basılı tut, zamanla, şalter kaldır) | **Aksiyon** · mini oyun dokunarak |
| Achterstraat'ta başkasının kapısında **E**: zili çal · ev sahibiysen **Y** / **N**: içeri al / alma | **Zil** butonu · istemdeki **Evet** / **Hayır** |
| **Enter**: sohbet (yaz, Enter gönder, Esc kapat) | **💬** butonu: sohbet |
| **M**: hızlı ışınlanma (otel, ev, garaj, drag pisti) | Telefonda **🗺️ Işınlan** |
| **P**: akıllı telefon (📷 kamera: **Space** / tık çek, **P** / **Esc** telefona dön · 📸 InstaHotel · 🏨 Otel) | **📱** butonu: telefon · vizörde **📸 Çek** / **✕** · ana çubuğa dokun ya da yukarı kaydır: kapat |
| **Esc**: duraklat / paneli kapat | ⚙ butonu: ayarlar |

Hedeflenen iş (dağınık yatak / çöp) zeminde turuncu halka ile işaretlenir ve ekranın altında ipucu çıkar.

## Oyun döngüsü

- **Lobi + koridor + 4 oda (101–104)** — Resepsiyon PC'den 4 kata (16 oda) kadar büyür. Sağ üstteki pano her odanın durumunu gösterir: **Boş / Dolu / Kirli** (kirli odalarda kalan iş sayısıyla). Koridorda her kapının yanında aynı renkte bir durum lambası vardır.
- **Misafir akışı:** sokaktan gelir → resepsiyonda kayıt (oda ücreti **€95** kasaya girer) → boş odaya yürür → konaklama süresi bitince çıkar, oda **Kirli** olur. Boş oda yoksa lobideki kanepede bekler; süre dolarsa ayrılır.
- **Temizlik:** kirli odaya gir, yatağı düzelt, 2–3 çöpü topla ve 1–2 arızayı gider (bkz. Detaylı temizlik ve tamirat) → oda **Boş** olur. Dolu odaların kapısı kilitlidir (misafir mahremiyeti).
- **Zarar verme / kırma mekaniği yoktur.**
- **Bahşiş:** odayı bitiren görevli misafirin bıraktığı **€4–12** bahşişi kişisel **cüzdanına** alır (otel kasasından ayrı; başlangıç cüzdanı €30).
- **Zaman:** Pazartesi–Cuma otel açık (misafir kabulü 08:00–19:00). **Cumartesi–Pazar otel kapalı:** giriş kapısı kapanır, tabela "KAPALI · Gesloten" olur, yeni misafir gelmez, zaman 2 kat hızlı akar. Konaklamalar gece de sürer; gece yarısını aşanlar gece ya da ertesi sabah çıkış yapar (Cumartesi sabahı son misafirler ayrılır → hafta sonu temizlik zamanı). 23:00'te otel kapanır (bkz. Gece döngüsü). Her gün sonunda günlük özet bildirimi gelir.

## Otelin büyümesi — yıldızlar, üst katlar, çalışanlar

- **Yıldız / itibar (1★–5★).** Temizlenen oda **+2**, odasına yerleşen misafir **+1**, boş oda bulamayıp giden misafir **−2**
  itibar. Eşikler 0 / 40 / 120 / 250 / 450. Her yıldız oda ücretini **+€15** artırır (1★ €95 … 5★ €155). Yıldızlar
  sol üstteki panelde ve otelin cephesinde (HOTEL tabelasının sağında) görünür.
- **💻 Resepsiyon bilgisayarı** (resepsiyon masasının kuzey ucundaki monitör, **E**): **Genel** (yıldız, itibar çubuğu,
  kasa, oda durumu), **🏗️ Yükseltmeler** ve **🧹 Çalışanlar** sekmeleri.
- **Üst katlar:** kasa parasıyla **2. kat €1.500 (2★)**, **3. kat €3.500 (3★)**, **4. kat €7.000 (4★)** — sırayla. Her kat
  4 oda ekler (201–204, 301–304, 401–404) ve misafirleri daha sık getirir. Lobinin kuzey duvarındaki (resepsiyonun
  karşısı) **🛗 asansörle** katlar arasında gidilir; misafirler ve temizlikçiler de asansörü kullanır. Oda panosu
  birden çok katta kompakt görünüme geçer (kat başına bir satır, kirli odada kalan iş rozeti).
- **🧹 Temizlikçi (HotelWorkerSystem):** **€200** (kasadan, bir kerelik; 1★'de bile), en fazla 6. Kirli odaları kendisi
  bulur, yatağı düzeltir, çöpleri toplar, arızaları giderir. Bir iş **1★'de 10 sn → 5★'de 2 sn**; her 12 işte bir
  **seviye** atlar (seviye başına %6 daha hızlı). Odada bulduğu bahşiş ve tamirat teşekkürü **otelin kasasına** gider.
  Başında isim etiketi (🧹 Fatma · Sv.2), elinde kova ve paspas vardır; gece lobiye döner.
- **Kesintisiz yönetim:** müfettiş / zabıta denetimi, ceza ya da yıldız düşürme yoktur; itibar yalnızca odalar ve
  misafirlerle değişir, otel kendi akışında büyür.
- Hepsi kalıcıdır (itibar, katlar, temizlikçiler ve seviyeleri).

### Lüks paketler — 8 katlı lüks otel, 12 katlı gökdelen, çatı Aqua Park, VIP suitleri

Resepsiyon PC → **🏗️ Yükseltmeler** sekmesinin altında **💎 Lüks paketler** (kurallar: `shared/architecture.js`,
sunucu: `ArchitectureService`, istemci: `HotelArchitectureUpgrades`). Kasadan ödenir, sırayla alınır, herkes için
anında geçerlidir ve kalıcıdır (`hotelState().arch = { level }`, yayın `HOTEL_STATE.arch`).

| Paket | Fiyat | Koşul | Kazanımlar |
| --- | --- | --- | --- |
| 🏨 **Lüks Otel** | **€50.000** | 4 katın hepsi açık + **4★** | 5–8. katlar (501–804), lüks iç mekân, 2 alkolsüz lounge bar, personel odası, en fazla **15** temizlikçi |
| 🏙️ **Ultra Lüks Gökdelen** | **€100.000** | Lüks Otel + **5★** | 9–12. katlar (901–1204), çatı Aqua Park (asansörde **☀️ Çatı**), 12. kat **VIP suitleri**, en fazla **30** temizlikçi |

- **Katlar:** her yeni kat 4 oda; üst katlar gibi asansörle (ışınlanma) çıkılır, misafirler ve temizlikçiler de asansör
  bacaklarıyla gider. Kat kaydırması 20 m (`FLOOR_DZ`: 12. kat = 240). Misafir geliş sıklığı kat sayısıyla artmaya devam eder.
- **Cephe:** sokak cephesi 8 katlı tuğla bir binaya (tente, pirinç direkler, altın **HOTEL AMSTERDAM ★** yazısı, kademeli taç),
  Gökdelen'de 12 katlı cam giydirme gökdelene (ışıklı taç, anten, çatı tabelası) dönüşür. Gece pencerelerin bir kısmı yanar.
- **Lüks iç mekân:** tüm odalarda balıksırtı parke, damask duvar kâğıdı, lacivert-altın koridor halısı, maun kapılar,
  şampanya rengi yatak örtüsü; her odaya kadife yatak başı, aplikler, berjer ve avize.
- **Lounge barlar (alkolsüz):** 📚 **Library Lounge** (5. kat; kitaplık + şömine) ve 🌆 **Sky Lounge** (8. kat; panoramik
  pencereler) — sahanlığın doğusundaki kemerden girilir. Barmen, taburelerde ve koltuklarda misafirler, renkli meyve
  suyu şişeleriyle arka raf. Her gün **10:00–23:00** her açık oyun saatinde kasaya **2 × €30 × doluluk çarpanı
  (0.5–1) × bar bonusu** (konser / reklam) yazılır; birikir ve 3 saatte bir (ya da kapanışta) tek bildirimle ödenir
  (≈ €585 / gün). Bar De Tulp mekaniği değişmez.
- **Personel odası (5. kat, sahanlığın batısı):** 7.–30. temizlikçi burada bekler, işe asansörle gider.
- **Çatı Aqua Park & teras:** ana havuz, kaydıraklı çocuk havuzu (dekoratif), şezlong + şemsiyeler, **Taze Sap & Snack**
  büfesi (alkolsüz), cam korkuluk, şehir silueti; altın kemerli geçidin arkasında **VIP bölümü** (sonsuzluk havuzu, cabanalar).
- **VIP misafir:** Gökdelen varken ve boş VIP suiti varken yeni misafir %35 olasılıkla ⭐ VIP gelir (altın kuşak, gözlük).
  Yalnızca **1201–1204** suitlerine yerleşir, **€300** öder, **+3 itibar** verir; konaklamasının ortasında çatıdaki VIP
  şezlonguna çıkar ve çıkışı oradan yapar. Normal misafirler 12. kata asla yerleşmez. VIP suitleri: altın direkli
  cibinlikli geniş yatak, jakuzi, altın tavan silmesi.
- **Arayüz:** asansör paneli 12 kat + çatıyı kaydırılabilir üç sütunlu ızgarada gösterir; 5+ katta oda panosu kat başına
  yalnızca renkli noktalara (●●●○) iner.
- **Pil:** 5–12. katlar ve çatı ilk ziyarette (asansör kararmasının arkasında) kurulur; her bölüm tek StaticBatcher ve
  yalnızca oyuncunun bulunduğu kat çizilir. Havuz suyu / yüzücüler yalnızca oyuncu çatıdayken canlanır.

## Achterstraat Canlı Müzik Sahnesi — müzisyenler, konser kalabalığı, bar bonusu

- **Sahne (€900, otelin kasasından, bir kez):** Resepsiyon PC → **🏗️ Yükseltmeler** → **🎤 Canlı Müzik Sahnesi**.
  Satın alınana kadar Achterstraat'ın batısında (otelin arka duvarının batısı, Huis 1–2'nin karşısı) sarı-siyah
  şeritli, dubalı boş bir alan ve "Sahne alanı — Resepsiyon PC'den satın al" tabelası durur. Alınınca herkes için
  ahşap platform + basamaklar, siyah fon, alüminyum truss, spot kafaları, **ACHTERSTRAAT LIVE** afişi, hoparlörler,
  mikrofon sehpası ve karşıdaki evlerin cephesine uzanan ampul zincirleri belirir. Sahne ile evlerin kapıları
  arasında ≥ 1.6 m yürüme yolu kalır (sokak lambası ve çiçek kasası bunun için yer değiştirdi).
- **Müzisyen kiralama:** sahnenin önünde (basamakların önü) **E** → panel. Ücret **günlük**, otelin kasasından:

  | Grup | Ücret | Kalabalık | Set sonu bar bonusu (120 oyun dk) |
  | --- | --- | --- | --- |
  | 🎸 Akustik Gitarist | €120 | 5 kişi | bar müşterisi ×1.8 · bahşiş +%50 |
  | 🎧 DJ Kabini | €220 | 9 kişi | bar müşterisi ×2 · bahşiş +%60 |
  | 🎷 Caz Grubu (saksafon, kontrbas, davul) | €350 | 7 kişi | bar müşterisi ×2 · bahşiş +%80 |

  Günde tek grup; gece ve 22:00'den sonra kiralanamaz. Grup o gün 23:00'e kadar **set (240 oyun dk ≈ 60 sn) →
  mola (60 oyun dk ≈ 15 sn)** döngüsüyle çalar (hafta sonu iki kat hızlı).
- **Sahnede:** müzisyenler (kollu karakterler + enstrümanlar: gitar ve amfi; pikaplı DJ masası, mikser, dizüstü,
  kulaklık; saksafon, kontrbas, davul seti) vuruşa göre çalar: tıngırdatma, kafa sallama + yumruk, saksafonu
  kaldırma, parmakla bas, bagetler. Spotların hüzmeleri vuruşla nabız gibi atar (gece daha belirgin).
- **Prosedürel 3D müzik (WebAudio, ses dosyası yok):** gitarda parmakla çalınan akor arpejleri; DJ'de dört vuruşlu
  kick, hi-hat, clap, bas synth ve akor stab'ları; cazda swing ride, yürüyen kontrbas ve vibratolu saksafon
  melodisi. Notalar sunucunun set başlangıcına göre planlanır ve "rastgelelik" ölçü numarasından türetilir →
  oyuncular aynı ölçüyü / melodiyi duyar. Ses sahnede bir PannerNode'dan gelir: uzaklaştıkça kısılır, 35 m'de
  biter; yalnızca Achterstraat'ta ve steeg'de açık, oyuncu evlerinin içinde boğuk duyulur, otelin içinde çalmaz.
  Ayarlardaki **Ses efektleri** ve paneldeki **Sahne müziği (bu cihazda)** anahtarı müziği kapatır.
- **Konser kalabalığı:** set başlayınca yoldan geçenler birer birer gelir (otelin arka kapısından, steeg'in
  kemerinden ve sokağın batı ucundaki geçitten) ve sahnenin önünde yarım çemberde dans eder / alkışlar.
  Set bitince kalabalık arka kapıdan koridora, lobiden **Bar De Tulp**'a yürür (birkaçı steeg'den sokağa); ilk kişi
  barın kapısına varınca 120 oyun dakikalık **bar bonusu** başlar (üstteki çipte: "🎸 Konser kalabalığı barda") ve
  herkese "Set bitti! Kalabalık Bar De Tulp'a akın ediyor" bildirimi gider. Set bittiğinde sahnenin yanında bir
  oyuncu varsa seyirciler **bahşiş kavanozuna** kişi başı €3 bırakır (kasaya). 23:00'te biten son sette bar kapalı
  olduğundan kalabalık evine dağılır (bonus yok).
- **Sunucu yetkili:** PC / sahne mesafesi, kasa, günde tek grup, saat, grup kimliği (prototipsiz tablo, tip
  dönüştürme yok) doğrulanır. Sahne ve günün rezervasyonu kalıcıdır (`hotelState.stage`); kalabalık kalıcı değildir.
- **Pil:** sahne çalışma anında bir kez kurulur ve malzeme başına tek mesh'e birleştirilir (hüzmeler, mercekler,
  ampuller köşe renkli üç mesh). Müzisyen, ışık ve kalabalık animasyonu YALNIZCA set çalarken, oyuncu sahneye 30 m
  içindeyken ve sahne görüş alanındayken çizilir; aksi halde motor uyur. Müzik zamanlayıcısı (100 ms, 0.25 sn ileri
  planlama) yalnızca duyulabilirken çalışır; dinleyici konumu yalnızca oyuncu hareket edince güncellenir; panner
  HRTF yerine ucuz `equalpower`. Sunucuda ayrı zamanlayıcı yok (`HotelSimulation.tick` → `StageService.update`).
## Akıllı telefon ve InstaHotel reklamları

Masaüstünde **P**, mobilde **📱** → ekranın ortasından bir telefon çıkar (çentik, saat çubuğunda oyun saati ve pil,
ana ekranda uygulamalar). **Esc**, tekrar **P**, ana çubuğa dokunmak / yukarı kaydırmak ya da telefonun dışına dokunmak kapatır.

- **📷 Kamera:** telefon küçük bir vizöre iner (ızgara, deklanşör, son fotoğraf). Etrafa bakabilirsin ama yürüyemezsin.
  **Space** / tık / **📸 Çek** → beyaz flaş + deklanşör sesi. Fotoğrafın konusu durduğun yerden bulunur
  (📍 Bar De Tulp, 📍 Oda 203, 📍 Senin evin, 📍 Achterstraat…). Sürerken kamera açılmaz.
- **🖼️ Galeri:** en fazla **12** fotoğraf, yalnızca bu tarayıcıda (localStorage; yer yoksa yalnızca bellekte). Silinebilir,
  doğrudan InstaHotel'de paylaşılabilir.
- **📸 InstaHotel (@hotel.amsterdam):** tüm oyuncuların gönderileri (en yeni üstte), takipçi / gönderi sayısı, ❤️ beğeni
  (gönderi başına oyuncu başına bir kez; çift dokunuş da beğenir). **＋ Yeni gönderi:** galeriden fotoğraf seç →
  açıklama yaz (en fazla 200 karakter, sohbetle aynı temizlik) → **bütçe** seç → **Paylaş**.

  | Bütçe (otel kasasından) | Beğeni / takipçi (1★, yıldızla artar) | Etki |
  | --- | --- | --- |
  | **Organik · €0** | 20–60 / 2–8 | — |
  | **€50 · Yerel reklam** | 150–300 / 20–45 | 1 oyun günü turist akını: misafir ×2, bar ×1.5 |
  | **€150 · Şehir kampanyası** | 500–900 / 60–120 | misafir ×3, bar ×2.2, bar bahşişi +%15 |
  | **€300 · Viral kampanya** | 1200–2000 / 150–260 | misafir ×4, bar ×3, bar bahşişi +%30 |

  Beğeni ve takipçiler gönderiden sonra **sunucuda** 45–90 sn boyunca adım adım artar (rastgele, otelin yıldızıyla
  ×1 … ×2); telefon sayaçları canlı sayar. Eşiklerde bildirim gelir ("📸 Gönderin 500 beğeniye ulaştı!",
  "📈 @hotel.amsterdam 1B takipçiye ulaştı!").
- **Kurallar:** oyuncu başına **20 sn'de bir** gönderi; otel genelinde aynı anda **tek ücretli kampanya** (süren kampanya
  bitmeden yenisi açılmaz — organik gönderi her zaman serbest); kasada bütçe kadar para olmalı. Sunucu her şeyi doğrular:
  fotoğraf yalnızca katı biçimli `data:image/jpeg;base64,…` (JPEG imzası, ≤ ~90 KB), bütçe yalnızca 0 / 50 / 150 / 300
  (sayı olarak), konum yalnızca bilinen bölge kimlikleri. Akışta fotoğraf yalnızca doğrulanmış `<img src>` olarak çizilir.
- **Turist akını (ücretli kampanya, 1 oyun günü):** üstte 📸 bonus çipi çıkar. Misafirler **2–4 kişilik turist kafileleri**
  hâlinde (sırt çantası, boyunda fotoğraf makinesi, renkli şapka) birlikte gelir ve **resepsiyonda sıra** oluşur: masa
  doluyken gelen misafir masanın arkasından **+X yönünde** (0.8 m arayla, en fazla 6 kişi) sıraya girer, masa boşalınca
  sıradaki öne geçer (ilk gelen ilk kayıt olur; turistin kaydı 4 sn). Kafileler boş oda sayısını aşmaz — akın oteli
  **%100 doluluğa** kadar doldurur ama odasız kalıp itibar kaybettirmez. 19:00'da (ve hafta sonu / gece) kabul kapanınca
  sıradakiler ve gelmekte olan kafile ayrılır. Bar müşterileri de daha sık gelir (barın tabureleri hızla dolar).
- **🏨 Otel:** kasa, yıldız, katlar, doluluk, kirli oda ve günün geliri (salt okunur).
- **Kalıcılık:** takipçiler ve son **6** gönderi (fotoğraflarıyla, toplam ~400 KB'a kadar; sığmayan eskilerin fotoğrafı
  düşer), beğenenler (anahtar özeti) otel kaydında tutulur; bellekte son 20 gönderi. Kampanyanın kalan süresi BoostService
  ile kalıcıdır; yarım kalmış beğeni artışı yeniden başlatmada kaydedilen toplamına tamamlanır.
- **Pil / ağ:** telefon açıkken 3D motor tamamen durur (yalnızca DOM); yalnızca kamera vizörü motoru çalıştırır. Çekim tek
  kare çizip aynı görevde tuvali kopyalar (`preserveDrawingBuffer` kapalı kalır), 16:9 kırpar, en fazla 640×360 JPEG
  (~0.7, hedef ≤ 60 KB). Sunucu beğeni / takipçi için yalnızca sayaç yayınlar (3 sn'de bir, simülasyon tick'inde);
  sayaç animasyonu kısa bir rAF ile ve yalnızca telefon açıkken. Yeni bağlanana yalnızca en yeni 4 gönderinin fotoğrafı
  gider; diğerleri akışta göründükçe tek tek istenir. Saat çubuğu yalnızca telefon açıkken saniyede bir güncellenir.

## Ev matbaası (sahte para) ve polis baskını

Achterstraat'taki **kendi evinde**, arka sol köşede **E** → **🖨️ Ev matbaası kur** (€600, cüzdandan, bir kez).
Tamamen oyun içi para: basılan para otel kasasına değil **kişisel cüzdanına** gider.

- **Para bas:** matbaanın başında **E** → 45 sn sonra **+€500** cüzdana (basılan desteler makinenin üstünde birikir,
  kırmızı çalışma lambası yanar).
- **Polis baskını:** her partide **%30** ihtimal; partinin ortalarında bir anda kırmızı-mavi yanıp sönen **🚨 POLİS
  BASKINI** bandı ve siren — **15 saniyen var**:
  - matbaanın başında **E: örtüyle gizle** (2 sn basılı tut) ya da
  - evin **doğu duvarındaki kitaplıktan gizli bölmeye kaç** (ekran kararır; yürürsen bölmeden çıkarsın).
  Polis kapıya gelir (iki polis + tepe lambası) ve arar. Gizlendiysen eli boş döner, baskı kaldığı yerden sürer.
  Gizlenmediysen **cüzdandan €1.000'e kadar ceza**, parti yanar ve matbaa **1 oyun günü mühürlenir**.
- Sunucu yetkili: kendi evinde ve matbaanın / bölmenin yanında olmak, gizleme süresi doğrulanır; polis kapındayken
  ışınlanıp kaçamazsın. Matbaa ve mühür kalıcıdır; süren parti sunucu yeniden başlarsa iptal olur.

## Hızlı ışınlanma

Masaüstünde **M**, telefonda **🗺️ Işınlan** → **🏨 Otel lobisi · 🏡 Evim · 🍽️ Gurme Restoran · 🅿️ Yeraltı garajı · 🏁 Drag pisti**.
Konumu sunucu yazar; araçtayken, uyurken, gizli bölmedeyken ya da evinde polis baskını sürerken ışınlanılmaz
(4 sn bekleme). Kısa bir kararma geçişi olur.

## Detaylı temizlik ve tamirat (mini oyunlar)

Misafir çıkınca odada dağınık yatak ve çöplere ek olarak 1–2 arıza çıkar; hepsi 3D'de görünür. Arızaya bakıp
**E** → mini oyun paneli açılır:

| Arıza | Görünüşü | Mini oyun |
| --- | --- | --- |
| 🧽 Yerde / duvarda leke | kahverengi içecek / çamur lekesi | Fare ya da parmakla lekenin üstünde ov; %85'i silinince biter |
| 💡 Patlak ampul | tavan lambası karanlık, kırık ampul sarkıyor | Patlak ampulü basılı tutarak sök → kutudan yenisini al → basılı tutarak tak |
| 🔧 Damlayan musluk | lavabodan damla, yerde su birikintisi | Gidip gelen ibre yeşil bölgedeyken **Sık!** (Boşluk / E), 3 kez — bölge her seferinde daralır |
| ⚡ Atan sigorta | sigorta kutusunda kırmızı ışık | İnen (kırmızı) şalterleri kaldır, sonra ana şalteri kaldır |

- Oda yalnızca tüm işler (arızalar dahil) bitince **Boş** olur. İşi bitiren oyuncuya misafirin bahşişine ek olarak
  **tamir edilen her arıza için +€2** ve oda ilk işten itibaren **90 sn içinde** bittiyse **+€5 hız bonusu** verilir.
- Sunucu doğrular: odanın içinde ve arızanın yanında olmak, mini oyunun en kısa süresi (anında bitirme yok).

## Şehir içi ulaşım — bisiklet ve scooter

- **Steeg:** coffee shop ile barın doğusundan geçen açık hava ara sokağı, sokağı Achterstraat'a bağlar (sokak
  ucunda kemerli giriş, Achterstraat ucunda komşu binanın altındaki kemer). Artık otelin içinden geçmeden evine
  gidebilirsin.
- **Büfe:** steeg ağzının yanındaki "Fiets & Scooter" büfesinden satın al: 🚲 bisiklet €35 (25 km/sa, arkasında
  bagaj minderi) · 🛵 elektrikli scooter €60 (34 km/sa, iki kişilik uzun sele). Araç büfenin önündeki P'ye park edilir.
- **Sürüş (FPV):** araca bakıp **E** → sürücü koltuğu. **W/S** gaz-fren-geri, **A/D** direksiyon (mobilde joystick),
  fare / sağ taraf bakış. Hız yumuşak artar, bırakınca süzülür, virajda kamera hafifçe eğilir; altta hız göstergesi.
  Binalara sürülmez (kapılarda yalnızca sürücüye özel engeller).
- **Co-op:** başka bir oyuncunun aracına bakıp **E** → arkaya binersin. Sürücü nereye, sen oraya; etrafa serbestçe
  bakarsın. Sürücü park edince iner, aracın yanına bırakılırsın.
- **Park:** sokakta, steeg'de ya da Achterstraat'ta istediğin yerde **E** → inip park edersin (otelin ve evlerin
  önünde P tabelaları var). Araçlar ve son park yerleri hesabına bağlı olarak kaydedilir.

## Yeraltı garajı ve AutoGalerie

- **Garaj ("Hotel Amsterdam Garage", −1):** otelin önündeki sokakta, batı tarafta (Bizim Ev ile otel kapısı arasında)
  **"P ↓"** tabelalı rampa ağzı var. İçine yürüyen ya da süren garaja iner (kısa kararma geçişi). Beton sütunlar,
  numaralı park yerleri (**P-01…P-34**), flüoresan şeritler, tavan kirişleri, kapalı **−2** rampası, kuzeyde sokağa
  çıkış rampası (**⇡ Uitrit · Çıkış**), doğu duvarında **🏁 Drag pisti** tüneli ve asansör (**E → lobiye çık**).
  Hızlı ışınlanmadaki 🅿️ hedefi asansörün önüne (garaja bakarak) bırakır.
- **AutoGalerie:** telefonda **🚗 AutoGalerie** uygulaması ya da garajdaki terminal (**E**). Renk ve ödeme kaynağı
  (**🎒 cüzdan** — ev matbaasının parası da buraya girer — ya da **🏨 otel kasası**) seçilir. Kurgusal markalar,
  Hollanda fiyatları (≈ $ bilgi olarak):

  | Model | Sınıf | Fiyat | En yüksek hız | 0–100 |
  | --- | --- | --- | --- | --- |
  | Polder P6 “Kikker” | Mikro araba (varyomatik) | €12.000 | 120 km/s | 19,5 sn |
  | Lindeman Stip 1.0 | Şehir arabası | €18.000 | 160 km/s | 12,4 sn |
  | Kade Vier 1.5 | Kompakt hatchback | €28.000 | 205 km/s | 8,9 sn |
  | Vonk e-Stad | Elektrikli hatchback | €36.000 | 160 km/s | 7,3 sn |
  | Duinwagen Terra 7 | Aile SUV'u | €48.000 | 200 km/s | 8,4 sn |
  | Vonk Bliksem Performance | Elektrikli performans sedanı | €58.000 | 225 km/s | 4,4 sn |
  | Graaf Regent 540 | Yönetici sedanı | €62.000 | 250 km/s | 5,6 sn |
  | Stormvogel 390 Coupé | Spor coupé | €95.000 | 280 km/s | 4,1 sn |
  | Graaf Imperator GT V12 | Lüks GT | €185.000 | 320 km/s | 3,6 sn |
  | Valkenier Tempesta | Süper araba | €280.000 | 340 km/s | 2,9 sn |

  Oyuncu başına en fazla **6 araba**. Yeni araba ilk boş numaralı park yerine bırakılır; garaj doluysa otelin önüne.
  Arabalar ve son park yerleri anahtar özetine bağlı kaydedilir (`hotel.garage`).
- **Sürüş (FPV):** arabaya bakıp **E** → sürücü koltuğu (Hollanda: soldan direksiyon). **W/S** gaz-fren-geri, **A/D**
  direksiyon; fare / sağ taraf yalnızca **başı çevirir** (araba direksiyonla döner, hızlanınca bakış yola döner).
  Torpido, dönen direksiyon simidi, ibreli gösterge, fren yapınca yanan stop lambaları, altta km/s + vites + devir
  çubuğu. Hızlandıkça görüş açısı genişler, yüksek hızda kamera hafifçe titrer ("sallanmayı azalt" açıksa titreşim
  yok). Motor sesi WebAudio ile sentezlenir (devir / vites / silindir sayısı; elektriklilerde uğultu). Mobilde
  joystick ya da büyük **⛽ / 🛑** pedallar. Başka bir oyuncu ön sağ koltuğa binebilir (**E**).
- **Nerede sürülür:** garajda ve otelin önündeki sokakta **30 km/s** sınırıyla, drag alanında tam hızla. Steeg'e,
  Achterstraat'a ve binalara araba girmez (yalnızca sürücüye özel engeller). Park da yalnızca bu üç bölgede.
  Arabayla rampadan / tünelden geçersen araba (ve yolcun) seninle gelir; hızlı ışınlanma araçtayken çalışmaz.
- **Sunucu doğrular:** model / renk / kaynak (tip denetimi, prototipsiz tablolar), bakiye, araba sınırı, geçit
  konumu, park bölgesi. Araba sürücüsünün her konumu bulunduğu yerin hız sınırına (× 1.15 + 1.5 m/sn, en fazla
  0.8 sn birikim) göre kırpılır; araba bölgesi dışına giden konum yok sayılır.
- **Pil:** garaj ve pist ayrı gruplardır, yalnızca oyuncu oradayken görünür; o sırada otel dünyası kameranın katman
  maskesiyle hiç çizilmez. Garaj ~20, araba ~12 draw call (statik parçalar araba başına birleştirilir). Kokpit
  (FOV, ses, gösterge) yalnızca sürerken çalışır; duran arabada kare çizilmez.

## Drag pisti

- **Yer:** şehir kenarı (garajdaki **🏁 Drag pisti** tünelinden arabanla ya da hızlı ışınlanmayla yürüyerek).
  İki şeritli (**SOL / SAĞ**) **402 m** çeyrek mil: burnout kutusu, ışık ağacı, 100 / 200 / 300 m ve ⅛ mil
  işaretleri, satranç desenli bitiş, bitiş köprüsünde şerit zaman tabloları, beton bariyerler, pist sonunda
  paraşüt + kum havuzu + lastik duvar. Yanında serbest sürüş alanı (boyalı oval, çim iç saha, slalom dubaları),
  tribün ve seyirciler, lale tarlaları, yel değirmenleri. Kuzeydoğudaki **🅿️ Garaja dön** tüneli garaja götürür.
- **Yarış:** sağdaki panelden **🏁 Solo** ya da **⚔️ Düello** seç (masaüstünde fare kilitliyken **G** modu değiştirir, **L** liderlik tablosunu açar); arabanla şeridinde çizginin hemen gerisinde dur
  → sahneye girersin. Işık ağacı: ön sahne / sahne → 3 sarı (0,5 sn arayla) → **yeşil**. Yeşilden önce kalkan
  **kırmızı ışık** yer (jump start), şeridinden çıkan diskalifiye olur, 40 sn'de bitiremeyen DNF. Düelloda ilk gelen
  90 sn rakip bekler; ikinci şerit sahneye girince ortak geri sayım başlar, çizgiyi önce geçen (reaksiyon + ET)
  kazanır. Bahis yok — saf spor.
- **Zamanlama (sunucu):** yalnızca sunucuya gelen konum örneklerinden ara değerlemeyle: reaksiyon (yeşil → 5 cm),
  0–100 km/s, ⅛ mil ve ¼ mil ET, hız tuzağı (son 20 m'nin ortalaması). Koşu, modelin kuramsal en iyisinden
  belirgin hızlıysa geçersiz sayılır. Sonuç kartı, bitiş tabloları ve paddock tabelası güncellenir.
- **Liderlik tablosu (🏆):** en iyi 10 çeyrek mil ET'si, oyuncu başına bir kayıt, kalıcı (`hotel.drag`).
- **Not:** reaksiyon süresi tek yönlü ağ gecikmesini de içerir (yerel ağda birkaç ms, internette daha fazla).

## Sohbet

- Masaüstünde **Enter**, mobilde **💬** sohbet kutusunu açar; yaz ve Enter / **Gönder**. Yazarken oyun tuşları
  çalışmaz; Esc ya da boş Enter kapatır. Mobilde kutu klavyenin kapatmaması için ekranın üstüne çıkar.
- Son mesajlar sol altta görünür, 12 sn sonra solar; yeni bağlanan son 30 mesajı görür.
- Yazanın başının üstünde 6 sn konuşma balonu çıkar.
- Küfür filtresi yok. Sunucu yalnızca mesajı temizler (en fazla 160 karakter, görünmez kontrol karakterleri),
  ırkçı / homofobik hakaret kelimelerini yıldızlar, hızlı mesaj serisini ve aynı mesajın tekrarını engeller.
  Mesajlar kaydedilmez.

## Gece döngüsü — eve dön, yatağında uyu

- Saat **23:00**'te otel kapanır ve gece başlar: gökyüzü kararır, pencereler lacivert olur, HUD'da **🌙 GECE · EVE GİT** yazar.
  21:00'den itibaren alacakaranlık başlar. Işık geçişi birkaç saniyelik tek seferlik bir animasyondur; gölge haritası
  yeniden çizilmez, gece boyunca karede ek iş yoktur.
- Achterstraat'taki evine git, yatağa bakıp **E** → yatarsın, ekran kararır ve kaç oyuncunun uyuduğu yazar.
  **Çevrimiçi herkes uyuyunca sabah 07:00 olur** ve yeni gün başlar. 21:00'den sonra erkenden de yatılabilir.
- Biri hiç yatmazsa gece `NIGHT_LENGTH_SEC` (varsayılan 150 sn) sonunda kendiliğinden biter (AFK oyuncu kimseyi kilitlemez).
  Uyumayan son oyuncu oyundan çıkarsa ve kalanların hepsi uyuyorsa sabah hemen olur.
- Her yeni ev sahibine bir kez **hediye yatak** verilir (arka köşede). Taşıyıp satabilirsin ama hediye yatağın iadesi yoktur;
  yeni yatak dekor marketinden €15. Kendi evinde, Bizim Ev'de ya da içeri alındığın evde uyuyabilirsin.
- Sunucu doğrular: saat, evde olmak, yatağın yanında olmak; yürüyen oyuncu uyanır.

## Ev bahçesi — nane, çilek, lale

- Dekor marketinden **saksı** (€5) al ve kendi evine koy. Saksıya bakıp **E** → tohum seç (her biri €2):

  | Tohum | Olgunlaşma | Hasat | Bloemenmarkt'ta |
  | --- | --- | --- | --- |
  | 🌿 Nane | 1 oyun günü | 6 demet | €6 |
  | 🍓 Çilek | 2 oyun günü | 6 kase | €12 |
  | 🌷 Lale | 3 oyun günü | 14 dal | €28 |

- Bitki oyun saatiyle kendiliğinden büyür (gece ve uyurken de): tohum → filiz → yapraklanma → olgun (laleler açar, çilekler
  kızarır). Saksıya bakınca yüzde ve kalan süre görünür. Olgunlaşınca **E** → hasat et, ürün çiçek pazarına satılır ve
  para cüzdanına girer; saksı yeni tohuma hazırdır.
- Bahçe yalnızca kendi evinde ve yalnızca ev sahibine açık (misafirler başkasının emeğini hasat edemez). Saksılar ve
  bitkiler evle birlikte kaydedilir.
- Pil: evre değişimi saniyede bir saat güncellemesinde kontrol edilir; değişince yalnızca o evin birleştirilmiş mobilya
  geometrisi yeniden kurulur.

## Bizim Ev — dekorasyon, LED'ler ve YouTube TV

Otelin batısında, sokağa açılan ortak bir kanal evi ("HUIS 7"). Aynı sunucudaki herkes paylaşır ve birlikte dekore eder;
hafta sonları otel kapalıyken takılmak için ideal.

- **Dekorasyon modu:** evin içinde **B** (mobilde **🛠 Dekor**). Alttaki çubuktan eşyayı seç (1–9), rengini seç (**C** ya da renk
  noktaları), **R** ile döndür, zemine bakıp **E** / **Aksiyon** ile yerleştir. Yeşil önizleme = olur, kırmızı = olmaz (sebebi
  ekranda yazar; birinin durduğu yere katı eşya konmaz). Bir eşyaya bakıp **X** / **🗑 Kaldır** → eşya kalkar; bu oturumda
  kendi aldığın eşyaysa fiyatının yarısı cüzdana döner (başkasının ya da önceki oturumun eşyası para getirmez — cüzdan her
  girişte yenilendiği için ev, sınırsız para aktarma yolu olmasın).
- **Eşyalar (kişisel cüzdandan):** kanepe €18, berjer €10, armut koltuk €7, televizyon €25, sehpa €8, halı €6, bitki €4,
  ayaklı lamba €6, LED şerit €5 (8 renk), **tavan RGB LED €6**, **yatak €15**, **köşe koltuk €24**, **kitaplık €12**,
  **duvar rafı €5**, **tablo €6** (6 eser: Mondriaan, Lale tarlası, Kanal evleri, Yıldızlı gece, Yel değirmeni, Ayçiçekleri —
  renk seçimi eseri değiştirir), **saksı €5**. Halılar eşyaların altına serilebilir; LED şerit duvarın üst kenarına,
  tablo ve raf göz hizasına monte edilir (ikisi aynı duvarda üst üste durabilir).
  Kapının önü boş kalmalı; evde en fazla 80 eşya olabilir (oyuncu evlerinde 30). 9'dan fazla eşya olduğu için katalogda
  fare tekerleğiyle ya da tıklayarak gezinilir.
- **Tavan RGB LED:** seçip **tavana bak** → istediğin yere yapışır. **R** ile yön: düz (X), düz (Z), çapraz ╱, çapraz ╲.
  Tavan şeritleri birbirini kesebilir (yıldız / ızgara desenleri) ve tavana renkli ışık vurur. Kaldırmak için tavandaki
  şeride bakıp **X**.
- **LED partisi:** kapının yanındaki anahtara bakıp **E** → tavan ışığı kapanır, oda kararır, LED şeritler duvara renkli ışık
  vurur. Işık durumu herkes için ortaktır.
- **Televizyon / YouTube:** TV'ye bakıp **E** → YouTube linkini yapıştır (watch, youtu.be, shorts, music linkleri
  yazarken gömme biçimine çevrilir) → **▶ Oynat**. Video YouTube'un resmi gömülü oynatıcısıyla (youtube-nocookie.com)
  çalar ve Three.js `CSS3DRenderer` ile doğrudan TV'nin ekranında hareketli oynar. Evdeki herkesin ekranında video
  **kendiliğinden** başlar: önce sessiz başlar (sessiz otomatik oynatma iPad/iPhone dahil her tarayıcıda serbesttir),
  sonra sesi açmayı dener; tarayıcı izin vermezse **🔇 Sesi aç** çipi çıkar (masaüstünde **T**). Oynatıcı sunucudaki
  başlangıç zamanına göre 4 sn'de bir denetlenir; 2.5 sn'den fazla kayarsa o ana sarılır → herkes aynı anı izler.
  **T** videoyu kendi ekranında kapatır, tekrar **T** geri getirir. (YouTube videosu çapraz kökenli bir iframe'de
  oynadığı için WebGL dokusuna — `VideoTexture` — çizilemez; CSS3D tek yoldur.) Evden çıkınca oynatıcı kapanır. Bağlantı koparsa geri gelince TV durumu sunucuyla
  eşitlenir. Not: video katmanı 3D sahnenin üstünde olduğu için TV'nin önünden geçen biri videonun arkasında kalır.
  Sahibi başka sitelerde oynatılmaya izin vermeyen videolar açılmaz (sunucu YouTube oEmbed ile kontrol eder).
- **Kalıcılık:** ev `data/house.json` dosyasına kaydedilir (`HOUSE_FILE` ile değiştirilebilir). Render'ın ücretsiz planında
  disk kalıcı olmadığından yeniden deploy'da ev sıfırlanır.
- **Pil:** tüm mobilyalar tek geometride birleştirilir (eşya sayısından bağımsız ~3 draw call); LED ışığı gerçek ışık kaynağı
  değil, ucuz bir additive degradedir; ev boştayken motor yine uyur. Video oynatmanın kendisi (YouTube) pil harcar.

## Achterstraat — oyuncu evleri, kapı zili ve misafirler

Otel koridorunun sonundaki arka kapıdan çıkılan dar sokakta 8 dar kanal evi var (Huis 1–8). Oyuna giren her
oyuncuya bir ev verilir; ev, tarayıcında saklanan gizli bir anahtara bağlıdır. Böylece yeniden bağlanınca aynı ev ve
aynı cüzdan geri gelir (sunucu anahtarın yalnızca özetini tutar). Tüm evler doluysa 3 günden uzun süredir gelmeyen
bir sahibin evi yeni oyuncuya verilir.

- **Kapı:** evinin kapısı sana açılır; başkalarının kapısı kapalıdır. Kapının yanındaki isim levhası ev sahibini ve
  çevrimiçi olup olmadığını gösterir.
- **Kapı zili:** başkasının kapısında **E** / **Zil** → ev sahibinin ekranına "🔔 X kapıda — içeri alınsın mı?
  [Evet / Hayır]" istemi düşer (masaüstünde **Y** / **N**). Evet derse içeri ışınlanırsın ve o oturum boyunca kapı sana
  açılır; Hayır derse ya da 25 sn içinde yanıt gelmezse haber verilir. Aynı kapıyı 8 sn'den sık çalamazsın.
- **Eşya koruması:** bir oyuncunun evindeki eşyaları yalnızca ev sahibi yerleştirebilir, kaldırabilir (satıp yarı
  fiyatını geri alabilir) ve yalnızca o dekor modunu açabilir. Misafirler eşyalara dokunamaz ama TV'yi kullanabilir.
  Bunu sunucu doğrular; istemciyi değiştirmek işe yaramaz. Bizim Ev ortak ev olarak kalır: herkes dekore eder.
- **3D TV:** TV'ye yaklaşıp **E** → YouTube linkini yapıştır. Video, Three.js `CSS3DRenderer` ile TV'nin ekranına
  oturan bir iframe'de oynar; evdeki herkes aynı saniyeden izler. Evden çıkınca oynatıcı tamamen kapanır.
- **Pil:** CSS3D katmanı yalnızca motor bir kare çizdiğinde güncellenir (ayrı döngü yok). Telefonda iframe
  640×360 boyutunda; mobil/tablette render ölçeği 1.0 ve FPS kilidi bu katman için de geçerli.

## Dış cephe — graffiti, neon tabela ve balkon

Achterstraat'ta **kendi evinin önünde** **B** (mobilde **🛠 Dekor**) → dış cephe modu (evin içinde B yine iç
dekorasyon modunu açar). Alttaki çubukta üç sekme var (**Q** ile geçilir): **🎨 Graffiti · 💡 Neon · 🏗️ Balkon**.
Herkes tüm cepheleri görür; yalnızca ev sahibi kendi cephesini düzenler (sunucu doğrular).

- **Graffiti (sprey):** önce **🧴 sprey kutusu** al: **€3 = 4 sıkım** (sıkımlar evin stoğunda durur, en fazla 40).
  Duvara bak → şablon duvarda önizlenir (yeşil olur / kırmızı olmaz), **E / Aksiyon'u ~0.8 sn basılı tut** →
  "pssst", ilerleme halkası, boya zerrecikleri → graffiti çıkar (her biri 1 sıkım). 12 şablon: kalp, lale, yıldız,
  taç, gülen yüz, dalga, şimşek, XXX (Amsterdam haçları), AMSTERDAM, HOI!, balon harflerle **isim etiketi** ve
  **serbest yazı** (**T** / ✏️, en fazla 12 karakter). 8 renk (**C**), 3 boyut (**R**: S / M / L).
  Kapı, pencere, zil / isim levhası ve fenerin üstüne boya olmaz; cephe sınırı (zeminden 0.2–3.0 m) dışına taşmaz;
  cephe başına en fazla 16 graffiti (üst üste binebilir). Bakılan graffiti'yi **X** siler (iade yok).
- **Neon tabela (€12):** üç yer — kapı üstü, üst kat penceresi, balkon korkuluğu (balkon gerekir). Yazı en fazla
  14 karakter (**T**), 9 renk + gökkuşağı. Aynı yere yeni yazı / renk yine €12; **X** kaldırır (iade yok).
- **Balkon (€25, bir kez):** üst kat penceresinin altında döşeme + korkuluk (siyah ferforje / beyaz / kanal yeşili).
  Eşyalar: masa + 2 sandalye €8, lale kutuları €5, ışık zinciri €6, şemsiye €7. Süs amaçlı (üstüne çıkılmaz).
- **Kalıcılık:** cephe ev kaydının `exterior` alanında saklanır; ev boşaltılınca (3 gün gelmeyen sahip) cephe de silinir.
- **Pil:** her evin TÜM graffiti'leri tek bir kanvas dokusunda ve tek düzlemde; balkon + eşyalar tek mesh, ampuller
  tek mesh, neon / ampul parıltıları tek additive mesh. Yalnızca o evin cephesi değişince yeniden kurulur.
  Neon parıltısı statiktir (kare başı animasyon yok); gece yalnızca parıltı malzemesinin opaklığı artar. Mod kapalıyken
  ve sprey sürmezken kare başına iş yoktur.

## Yeraltı Kart Kulübü — blackjack, poker, zar (18+, yalnızca oyun parası)

Steeg'de (coffee shop'un doğusundaki ara sokak), barın arkasındaki tabelasız kapı — önünde bir kapı görevlisi ve
küçük pirinç "♣" levha. İçeride loş, perdeli bir oda: yeşil çuha masalar, sarkıt lambalar, raf. Masaya yaklaşıp **E**
ile oturulur; ilk seferde coffee shop'taki **18+ onayı** istenir (aynı onay ikisinde de geçerli). Gerçek para yoktur:
bahisler oyun içi euro ile oynanır.

- **Blackjack** (krupiyeye karşı, 4 koltuk): €2–100 bahis, 12 sn bahis süresi, sıra başına 15 sn (süre dolarsa
  durur). Kart Çek / Dur / İkiye Katla; krupiye 17'de durur. Blackjack 3:2, kazanç 1:1, eşitlikte bahis geri.
- **Poker** (Texas Hold'em, sabit limit, 4 koltuk): boş koltuklarda NPC oyuncular oturur, birden çok oyuncu aynı
  masada oynayabilir. Körler €1/€2, bahis €2/€4, sokak başına en fazla 3 artırma; masaya €20 fişle oturulur,
  kalkınca fişler bozdurulur. Yan pot ve bölünmüş pot desteklenir; kimsenin kapalı kartı showdown'dan önce
  başkasına gönderilmez.
- **Zar düellosu:** oturanlar (ve 1–2 NPC) pota pay koyar, herkes iki zar atar, en yüksek toplam potun tamamını alır;
  beraberlikte yalnızca berabere kalanlar yeniden atar.
- **Kaynak:** her bahis 🎒 **cüzdandan** ya da 🏦 **otel kasasından** (kasada en az €500 varsa, el başına en fazla
  €50) — kazanç aynı kaynağa döner.
- Odadan çıkan masadan kalkar; blackjack'te kart dağıtıldıktan sonra kalkan bahsini kaybeder, pokerde kalkan
  pas geçmiş sayılır. Masada insan oyuncu kalmayınca masa sıfırlanır (zamanlayıcı çalışmaz).

## Bar De Tulp — alkolsüz bar, barmenlik ve yiyecekler

Lobinin doğu duvarındaki kapıdan girilen küçük bar (coffee shop'un arkasında). Her gün 10:00–23:00 açık; hafta sonu
otel kapalıyken de müşteri gelir.

- **Müşteriler:** sokaktan gelip dört bar taburesinden birine oturur ve sipariş verir (başlarında sipariş baloncuğu,
  sağ üstte sabır çubuklu sipariş listesi). Sabırları tükenirse kalkıp giderler. Kirli bardak duran tabureye oturmazlar.
- **30 içecek, hepsi alkolsüz** (`shared/drinks.js`), dört kategori:
  - 🥃 **Şatlar** (€8–10): Espresso Shot, Zencefil Shot, Nar Shot, Vitamin Shot.
  - 🫗 **Fıçı & Şişe** (€8–12): Fıçı Limonata, Zencefilli Gazoz, Köpüklü Elma (şampanya yerine), Kırmızı / Beyaz Üzüm
    Suyu (şarap yerine).
  - 🍹 **Kokteyller** (€25–40, ünlü kokteyllerin alkolsüz hâlleri): Virgin Mojito, Virgin Margarita, Virgin Piña Colada,
    Plaj Günbatımı, Long Island Buzlu Çay, Virgin Spritz, Virgin Espresso Martini, Virgin Cosmopolitan, Tonik & Misket,
    Zencefil Sour, Shirley Temple, Tropik Fırtına (5 malzeme, €40), Çilekli Mocktail.
  - 🥤 **Soft & Klasikler** (€8–14): Kola, Portakal Suyu, Buzlu Çay, Enerji İçeceği, Soda & Misket, Limonata,
    Çilekli Milkshake, Sıcak Çikolata.
- **Malzeme istasyonları (26 malzeme):** arka tezgâhtaki 5 musluk (limon, çilek, süt, kakao, soda); barın batı ucundaki
  **🧊 soğutucu dolap** (misket limonu, nane, buz, şeker şurubu, portakal / ananas / kızılcık / üzüm suları, hindistan
  cevizi kreması, şeftali, nar şurubu, kola, tonik, zencefil, espresso, soğuk çay, enerji içeceği — E → seçim paneli);
  tezgâhtaki **🫗 fıçı kulesi** (fıçı limonata, zencefilli gazoz, elma gazozu).
- **📖 Tarif kitabı (RecipeBook):** doğu duvarındaki menü panosunun önündeki kürsüde **E**, barın içindeyken **K**, ya da
  sipariş listesindeki 📖 (en uzun bekleyen siparişin tarifini açar). Her içecek için bardak, malzemeler ve hangi
  istasyondan alındıkları, yöntem (çalkala / bardakta karıştır / doğrudan doldur), fiyat ve zorluk.
- **Barmenlik:** raftan temiz bardak al → malzemeleri koy (sırası serbest, en fazla 5; dökme 1.5 sn) → gerekiyorsa
  çalkalayıcıda çalkala (2 sn) → müşteriye servis et. Şat ve fıçı içecekleri doğrudan doldurulur. Bardak siparişe
  uymuyorsa ipucu neyin eksik / fazla olduğunu söyler; yanlış içeceği lavaboya dökebilirsin.
- **Siparişler ve gelir:** müşteriler 30 içecekten ağırlıklı rastgele sipariş verir; çok malzemeli içecekte daha sabırlıdırlar
  (2'nin üstündeki her adım +12 sn). Doğru servis: **fiyat + bahşiş otel kasasına** — bahşiş fiyatın %10'u (geç) ile
  %35'i (hemen) arası, yani kokteyllerde €4–14. Konser kalabalığı / reklam kampanyası bonusları bahşişi ayrıca artırır.
- **Toplama ve yıkama:** müşteri içip gidince tezgâhta kirli bardak kalır. Topla (aynı anda en fazla 3), lavaboda yıka
  (2.2 sn) → bardaklar rafa döner. Barda toplam 6 bardak var; yıkamazsan temiz bardak biter.
- **Yiyecekler:** 🍫 Brownie (€3, 4 ısırık) ve 🧇 Stroopwafel (€2, 3 ısırık) — tezgâhın ucundaki vitrinden al, her
  ısırık 2 sn (ısırma animasyonu, kırıntılar). Yerken yürüyebilirsin; bar dışında da yenir.
- **Birinci şahıs eller:** bardak alma, dökme, çalkalama, servis, toplama, yıkama, ısırma ve otel odalarında çöp
  toplama animasyonları. Diğer oyuncular elinde ne tuttuğunu ve kol hareketini görür.
- **Sunucu yetkili:** her adım tek istek; sunucu konumu, sırayı ve süreyi (ör. ısırıklar arası en az 2 sn) doğrular.
  İstemci animasyonu bekletmeden (iyimser) oynatır, reddedilirse geri alır.
- **Pil:** eller kameraya bağlı küçük bir grup (ayrı render geçişi yok), yalnızca animasyon sürerken kare çizilir;
  sabır çubukları CSS geçişiyle akar (kare başı DOM yazımı yok). Ayarlardaki "sallanma/dalgalanmayı azalt" el
  animasyonlarının genliğini de kısar.

## Gurme Restoran & Mutfak — De Gouden Lepel (GourmetRestaurant + KitchenSystem)

Lobinin batı duvarındaki kapıdan (resepsiyonun arkası) girilen tam teşekküllü restoran: güneyde **6 lüks masalı yemek
salonu** (beyaz örtü, kadife sandalyeler, sarkıt lambalar) ve batı duvarında **açık büfe**, kuzeyde **açık mutfak**;
aralarında ısıtıcı lambalı **garson tezgâhı (pass, 4 tabak yeri)**. Mutfağa pass'in doğu ucundan girilir. Hızlı ışınlanma
listesinde de var (🍽️ Gurme Restoran). Açık: 07:00–22:30 (hafta sonu da).

- **Menü kütüphanesi (7 tabak):** 🥩 Wagyu Biftek €120 · 🍕 İtalyan Pizzası €38 · 🍔 Gurme Burger €45 · 🍣 Suşi Tabağı €75 ·
  lüks tatlılar 🧁 Çikolatalı Sufle €28 ve 🍰 Çilekli Pavlova €26 · 🍳 Kahvaltı Tabağı €32. Mutfaktaki tarif panosu, sipariş
  listesindeki 📖 ya da restoranda **K** tarifleri açar.
- **FPV mutfak (KitchenSystem):** 🧊 **buzdolabı** (24 malzeme; bekleyen siparişler için tek tıkla "malzemeleri seç"
  kısayolu, seçilenler tek tek tepsiye alınır, en fazla 4) → **istasyon**: 🍳 ocakta tava (4 sn, tava sallanır, cızırtı),
  🔥 taş fırın (5 sn, kürek fırına girer, ağız parlar) ya da 🔪 hazırlık tezgâhı (3 sn, sol elde bıçakla doğrama) →
  🍽️ **tabak rafında tabakla** → **masaya servis et** ya da **garson tezgâhına koy** (oradan alınabilir). Yanlış yöntem /
  eksik malzeme ipucuyla reddedilir, tepsi 🗑️ çöpe atılır. Yemeğini bitiren müşteri **kirli tabak** bırakır: topla
  (en fazla 3) → bulaşık lavabosu. Elde tepsi / tava / tabak birinci şahıs modelli; diğer oyuncular da elindekini görür.
- **Müşteriler:** sokaktan gelenler ve **odasındaki otel misafirleri** (asansörle iner; 12. kattaki **⭐ VIP**'ler
  öncelikli ve yalnızca lüks tabak ister, fiyat ×1.5, bahşiş ×2). Misafir restorandayken çıkışı ertelenir, yemekten
  sonra odasına döner. Sabır ~100 sn (lüks tabakta +20); sabrı biten kalkar.
- **Açık büfe kahvaltı (07:00–11:00):** müşterilerin çoğu tabağını büfeden kendisi doldurur (€22, VIP €40; 24 porsiyon
  stok). Büfe azalınca **tazele** (+8 porsiyon, €24 malzeme kasadan) ya da aşçıya bırak.
- **Gelir:** satış + bahşiş (hızlı servis %25'e kadar; konser / reklam bonusları geçerli) **otelin kasasına**.
- **Memnuniyet:** iyi ve hızlı servis odadaki misafirin konaklamasını **1–3 saat uzatır** (VIP'te iki kat; uzatma
  ücreti de kasaya) ve +1 / VIP +2 itibar verir. Otelin memnuniyet puanı (%) yemek başına güncellenir; %50'nin üstünde
  yeni misafirler daha uzun kalır (en çok ×1.4). Kalkıp giden müşteri puanı düşürür.
- **Mutfak personeli (Resepsiyon PC → 🧹 Çalışanlar):** 👨‍🍳 **Gurme Aşçı** €600 (en fazla 3) bekleyen siparişleri kendisi
  pişirip pass'e koyar, kahvaltıda büfeyi tazeler; 🤵 **Garson** €350 (en fazla 4) pass'teki tabağı bekleyen masaya taşır,
  kirli masaları toplar. Otelin **yıldızı** arttıkça mutfak hızlanır (5★'de işler %40 kısa), aşçı her 10 işte seviye
  atlar; otel **doluluğu** ve yıldız arttıkça restoran kalabalıklaşır. Personel, büfe stoğu ve memnuniyet kalıcıdır.
- **Sunucu yetkili:** konum, el, süre, tarif ve yöntem `RestaurantService`'te doğrulanır (tip denetimi, prototipsiz
  tablolar); aşçı / garson NPC'leri `KitchenStaffService`'te (misafirlerle aynı ağ biçimi, `kind: 'chef' | 'waiter'`).
  NPC'ler restoranın içinde şeritlerden yürür (masaların, pass'in ve adanın içinden geçmez).

## Bar müdavimleriyle arkadaşlık

Bar De Tulp'un müşterileri 12 kişilik sabit bir müdavim kadrosundan gelir (Sanne, Daan, Emma, Lars…); her birinin
kısa bir biyografisi, sevdiği / sıkıldığı konular, espri anlayışı ve en sevdiği içeceği vardır.

- Oturan bir müşterinin önüne (tezgâhın müşteri tarafı) gelip **E** → diyalog paneli:
  - **💬 Sohbet et:** üç konudan birini seç. En sevdiği konu +15, sevdiği +8, sıkıldığı −6 (biyografi ipucu verir).
  - **😄 Espri yap:** esprilere bayılan +12 · bazen gülen +5 ya da 0 · espriden hoşlanmayan −4.
  - **🥤 İçecek ısmarla:** cüzdandan öde; en sevdiği içecek +16, diğerleri +7.
  - Her eylem müşterinin her ziyaretinde bir kez yapılabilir. Seviye kişi başına %0–100'dür ve kalıcıdır.
- **%80'de 🏠 Eve davet et:** müdavim bardan kalkar ve Achterstraat'taki evinde belirir (herkes görür).
  Evde yanına gidip **E** → **💬 Sohbet et**, **📺 Birlikte TV izle** (TV'de bir video açıkken), **👋 Uğurla**.
- Misafir 23:00'te (otel kapanınca) "iyi geceler" deyip gider. Ziyaret keyifli geçtiyse (sohbet ya da TV)
  arkadaşlık +5 artar ve ertesi gün **moral bonusu** gelir: oda bahşişleri +%20.
- Sunucu doğrular: mesafe, seviye, para, ev sahipliği; aynı anda tek misafir, bir müdavim tek eve.

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
│       ├── RelationshipService.js # Müdavimlerle arkadaşlık: diyalog etkileri, eve davet, moral bonusu
│       ├── VehicleService.js    # Bisiklet / scooter: satın alma, sürücü + yolcu, park, kalıcılık (arabalar da burada 'car')
│       ├── GarageService.js     # Yeraltı garajı + AutoGalerie: araba satın alma, park yerleri, kalıcılık, rampa / tünel, hız denetimi
│       ├── DragRaceService.js   # Drag pisti: sahne, ışık ağacı zamanları, sunucu zamanlaması, düello, liderlik tablosu
│       ├── GameClock.js         # Gün döngüsü: hafta içi açık / hafta sonu kapalı, gece (23:00–07:00)
│       ├── RoomManager.js       # Oda durumları ve temizlik işleri
│       ├── GuestManager.js      # Misafir yaşam döngüsü ve rotaları (üst kata asansörle iki bacak), turist kafilesi + resepsiyon kuyruğu
│       ├── HotelGrowthService.js # İtibar / yıldız, kat satın alma, asansör (12 kat + çatı)
│       ├── ArchitectureService.js # Lüks paketler: satın alma, 8/12 kat, lounge geliri, VIP olasılığı, personel odası
│       ├── BoostService.js      # Geçici bonuslar (konser kalabalığı, reklam): bar / misafir sıklığı, bahşiş
│       ├── TeleportService.js   # Hızlı ışınlanma: hedefler, doğrulama, bekleme
│       ├── WorkerService.js     # Temizlikçi NPC'ler: iş seçimi, süreli işler, seviye, bahşiş kasaya
│       ├── RestaurantService.js # Gurme Restoran: masalar, müşteriler (otel misafirleri / VIP), açık büfe, mutfak adımları, memnuniyet
│       ├── KitchenStaffService.js # Aşçı / garson NPC'leri: iş adımları (pişir → pass → masa), büfe tazeleme, seviye
│       ├── StageService.js      # Achterstraat sahnesi: satın alma, grup kiralama, set/mola, kalabalık NPC'leri, bar bonusu
│       ├── MarketingService.js  # InstaHotel: gönderi doğrulama, beğeni / takipçi artışı, kampanya → turist akını (boost)
│       ├── routes.js            # Lobi ↔ oda ↔ oda rotaları (asansör bacakları)
│       ├── CasinoService.js     # Kart Kulübü: blackjack, poker (NPC'li), zar düellosu; cüzdan / kasa bahisleri
│       └── CoffeeShopService.js # Cüzdan, envanter, trip zarı, slot, bahşiş
│   └── house/                   # Evler: HouseService (yatak/uyku kontrolü dahil), GardenService (saksı, ekim, hasat), ExteriorService (dış cephe), CounterfeitService (ev matbaası + polis baskını),
│                                #   FileStore / PgStore (kayıt), YouTube oEmbed + küçük resim vekili
├── shared/                      # Sunucu + istemci ortak kodu (ESM)
│   ├── constants.js             # Durumlar, olay adları, fiyat, saatler, ürünler, trip/slot
│   ├── drinks.js                # Bar: 30 alkolsüz içecek, 26 malzeme, kategoriler, istasyonlar
│   ├── counterfeit.js           # Ev matbaası kuralları (fiyat, parti, baskın, ceza), evdeki noktalar, ışınlanma
│   ├── layout.js                # Otel + coffee shop + ev yerleşimi: duvarlar, odalar, rota noktaları
│   ├── friends.js               # Müdavimler, konular, espriler, arkadaşlık kuralları
│   ├── vehicles.js              # Araç türleri, hız / ivme, yolcu koltuğu
│   ├── cars.js                  # AutoGalerie kataloğu, araba fiziği, garaj / sokak rampası / drag pisti yerleşimi, geçitler, hız sınırları
│   ├── chat.js                  # Sohbet mesajı temizleme
│   ├── maintenance.js           # Oda arızaları, noktaları, mini oyun süreleri, bonuslar
│   ├── hotel.js                 # Yıldız eşikleri, kat fiyatları, temizlikçi süreleri
│   ├── restaurant.js            # Restoran: 24 malzeme, 7 tabaklık menü, pişirme yöntemleri, kurallar, personel, NPC şerit rotaları
│   ├── architecture.js          # Lüks paketler (fiyat, koşul, kat / temizlikçi sınırı), VIP suit kuralları, lounge geliri
│   ├── stage.js                 # Canlı müzik sahnesi: yer, gruplar (ücret, kalabalık, bonus), set takvimi, kalabalık noktaları
│   ├── marketing.js             # InstaHotel: bütçeler, fotoğraf / açıklama doğrulama, konum etiketleri, turist kafilesi + kuyruk
│   ├── casino.js                # Deste, blackjack puanı, poker el değerlendirici, masa kuralları
│   ├── exterior.js              # Dış cephe kataloğu (graffiti, neon, balkon) ve yerleşim doğrulaması
│   ├── house.js                 # Mobilya kataloğu, yerleşim kuralları (duvar slotları, tavan), bitkiler, YouTube link ayrıştırma
│   └── path.js                  # Deterministik rota örnekleme
├── public/                      # İstemci (derleme yok)
│   ├── index.html               # Canvas, HUD, dokunmatik kontroller, menüler
│   ├── css/style.css            # (+ hotel.css, exterior.css, casino.css, interactive-tv.css, stage.css, bar-drinks.css, phone.css, garage.css, restaurant.css)
│   └── js/
│       ├── main.js              # Her şeyi birbirine bağlar
│       ├── core/                # Engine (FPS kilidi, uyku), Device, Settings, Sfx (WebAudio)
│       ├── world/               # Otel, coffee shop, bar, Bizim Ev, Achterstraat evleri, steeg + araç büfesi, sahne (StageBuilding); dokular, malzemeler, çarpışma
│       │                        #   GarageBuilding (garaj + sokak rampası), DragStripBuilding (pist + manzara), CarModels (prosedürel arabalar), CarWorldKit
│       ├── controls/            # Klavye/fare, dokunmatik joystick, FPV oyuncu
│       ├── game/                # Misafirler, diğer oyuncular, etkileşim, durum
│       │   ├── CoffeeShopSystem.js  # Tezgâh/slot etkileşimi, paneller, envanter, tüketim
│       │   ├── TripEffects.js       # Shader, sallanma, hayaletler, baloncuk, ses, emote'lar
│       │   ├── HouseSystem.js       # Evler: birleştirilmiş mobilya, dekorasyon modu (yetkili), ışık, kapı
│       │   ├── HouseVisitingSystem.js # Achterstraat: kapılar, kapı zili, misafir erişimi, ışınlama
│       │   ├── InteractiveTV.js     # YouTube paneli, CSS3DRenderer ile TV ekranında video, senkron katılım
│       │   ├── InteractiveTVFix.js  # YouTube oynatıcı köprüsü: sessiz başlat → sesi aç, sapma düzeltme
│       │   ├── NpcRelationshipSystem.js # Bar müdavimleriyle diyalog, arkadaşlık çubuğu, evdeki misafir
│       │   ├── ChatSystem.js        # Sohbet kutusu, mesaj geçmişi, konuşma balonları
│       │   ├── CityVehicleSystem.js # Araç modelleri, FPV sürüş, arkaya binme, büfe, hız göstergesi
│       │   ├── HotelMaintenanceSystem.js # Arıza görselleri ve 4 mini oyun (leke, ampul, musluk, sigorta)
│       │   ├── ReceptionPC.js       # Resepsiyon bilgisayarı paneli, asansör, yıldız tabelası, kat filtresi
│       │   ├── HotelWorkerSystem.js # Temizlikçi görünümü (kova/paspas) ve Çalışanlar sekmesi
│       │   ├── HotelArchitectureUpgrades.js # Lüks paketler: PC kartları, doku değişimi, cephe, tembel kat / çatı inşası (world/LuxuryBuilding.js, LuxuryTextures.js)
│       │   ├── LiveStageSystem.js   # Canlı müzik sahnesi: alan / sahne, müzisyenler ve animasyonları, panel, PC satırı
│       │   ├── StageMusic.js        # Prosedürel sahne müziği (WebAudio): gitar, DJ, caz; PannerNode ile 3D, set senkronu
│       │   ├── StreetEvents.js      # Konser kalabalığı: kollar, dans / alkış animasyonu, arka kapının açılması
│       │   ├── SmartphoneSystem.js  # Akıllı telefon (P / 📱): ana ekran, kamera vizörü + çekim, galeri, Otel uygulaması
│       │   ├── InstaHotelMarketing.js # InstaHotel: akış, beğeni, yeni gönderi + reklam bütçesi, canlı sayaçlar
│       │   ├── UndergroundCasino.js # Kart Kulübü: kapı / koltuk etkileşimi, masa panelleri, NPC'ler
│       │   ├── ExteriorCustomization.js # Ev cephesi: sprey graffiti (nişan + önizleme), neon tabela, balkon
│       │   ├── BarSystem.js         # Bar De Tulp: istasyonlar, siparişler, uzak oyuncu kolları
│       │   ├── MixologyBarSystem.js # Soğutucu dolap + fıçı kulesi: malzeme seçimi (30 içecekli kütüphane)
│       │   ├── RecipeBook.js        # Tarif kitabı paneli (kürsü / K / 📖)
│       │   ├── GourmetRestaurant.js # Restoran binası (salon, büfe, pass, açık mutfak), tabak modelleri, sipariş baloncukları + listesi, aşçı / garson aksesuarları, PC personel bölümü
│       │   ├── KitchenSystem.js     # FPV mutfak: buzdolabı seçici, tava / fırın / tezgâh, tabaklama, servis, menü kütüphanesi, mutfak elleri
│       │   ├── HomeCounterfeitSystem.js # Ev matbaası: kurulum, baskı, polis baskını bandı, gizli bölme, polis
│       │   ├── FastTravelSystem.js  # Hızlı ışınlanma paneli (M / telefonda 🗺️)
│       │   ├── UndergroundGarage.js # Garaj, AutoGalerie (telefon + terminal), rampa / tünel geçitleri, araba eklentisi, alan görünürlüğü
│       │   ├── CarCockpit.js        # Araba kokpiti: km/s + vites göstergesi, FOV, titreşim, motor sesi, dokunmatik pedallar
│       │   ├── DragRaceTrack.js     # Drag pisti: ışık ağacı, otomatik sahne, canlı süre, sonuç kartı, tablolar, liderlik
│       │   ├── ViewModel.js         # Birinci şahıs eller (dökme, çalkalama, ısırma, toplama…)
│       │   ├── NightCycle.js        # Gece görünümü, yatakta uyuma, uyku ekranı
│       │   ├── HerbalBotanySystem.js # Ev bahçesi: tohum paneli, büyüme evreleri, hasat
│       │   └── FurnitureModels.js   # Köşe renkli düşük poligonlu mobilya modelleri
│       ├── net/Network.js       # Socket.io istemcisi, saat senkronu
│       └── ui/                  # HUD, ayarlar paneli
└── test/                        # Sunucu testleri (node:test): simülasyon, coffee shop, evler, bar (30 içecek), gece + bahçe, arkadaşlık, ulaşım + tamirat, büyüme (kat, temizlikçi), lüks paketler (architecture), sahne, InstaHotel (gönderi, kampanya, kuyruk), garaj + AutoGalerie, drag pisti, gurme restoran (mutfak, otel misafiri / VIP, büfe, aşçı / garson)
```

## Sonraki aşamalar için notlar

- Oda durumları, misafirler ve envanter kalıcı değil (kasa, cüzdanlar, evler, bitkiler ve oyun saati kalıcı).
- Otel kasasındaki para henüz harcanmıyor (yükseltmeler / personel / dekor için ekonomi sonraki aşamada); kişisel cüzdan coffee shop'ta harcanıyor.
- Ses, resepsiyonda oyuncu etkileşimi, misafir memnuniyeti ve oda yükseltmeleri planlanabilir.
