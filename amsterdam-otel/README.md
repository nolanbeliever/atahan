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
| Barda **E**: bardak al · koy · çalkala · servis et · topla · yıka | **Aksiyon** (butonun etiketi bakılan şeye göre değişir: Al, Koy, Çalkala, Servis…) |
| **F** / **E**: elindeki yiyeceği ısır (her ısırık 2 sn) | **Aksiyon**: ısır |
| Araca bakıp **E**: bin (sahibi sürer, arkadaşı arkaya biner) · sürerken **W/S** gaz-fren, **A/D** direksiyon, **E** in ve park et | **Bin** / **Arkaya** / **Park** · joystick: gaz ve direksiyon |
| Kirli odada arızaya bakıp **E**: mini oyun (ovala, basılı tut, zamanla, şalter kaldır) | **Aksiyon** · mini oyun dokunarak |
| Achterstraat'ta başkasının kapısında **E**: zili çal · ev sahibiysen **Y** / **N**: içeri al / alma | **Zil** butonu · istemdeki **Evet** / **Hayır** |
| **Enter**: sohbet (yaz, Enter gönder, Esc kapat) | **💬** butonu: sohbet |
| **Esc**: duraklat / paneli kapat | ⚙ butonu: ayarlar |

Hedeflenen iş (dağınık yatak / çöp) zeminde turuncu halka ile işaretlenir ve ekranın altında ipucu çıkar.

## Oyun döngüsü

- **Lobi + koridor + 4 oda (101–104).** Sağ üstteki pano her odanın durumunu gösterir: **Boş / Dolu / Kirli** (kirli odalarda kalan iş sayısıyla). Koridorda her kapının yanında aynı renkte bir durum lambası vardır.
- **Misafir akışı:** sokaktan gelir → resepsiyonda kayıt (oda ücreti **€95** kasaya girer) → boş odaya yürür → konaklama süresi bitince çıkar, oda **Kirli** olur. Boş oda yoksa lobideki kanepede bekler; süre dolarsa ayrılır.
- **Temizlik:** kirli odaya gir, yatağı düzelt, 2–3 çöpü topla ve 1–2 arızayı gider (bkz. Detaylı temizlik ve tamirat) → oda **Boş** olur. Dolu odaların kapısı kilitlidir (misafir mahremiyeti).
- **Zarar verme / kırma mekaniği yoktur.**
- **Bahşiş:** odayı bitiren görevli misafirin bıraktığı **€4–12** bahşişi kişisel **cüzdanına** alır (otel kasasından ayrı; başlangıç cüzdanı €30).
- **Zaman:** Pazartesi–Cuma otel açık (misafir kabulü 08:00–19:00). **Cumartesi–Pazar otel kapalı:** giriş kapısı kapanır, tabela "KAPALI · Gesloten" olur, yeni misafir gelmez, zaman 2 kat hızlı akar. Konaklamalar gece de sürer; gece yarısını aşanlar gece ya da ertesi sabah çıkış yapar (Cumartesi sabahı son misafirler ayrılır → hafta sonu temizlik zamanı). 23:00'te otel kapanır (bkz. Gece döngüsü). Her gün sonunda günlük özet bildirimi gelir.

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

## Bar De Tulp — alkolsüz bar, barmenlik ve yiyecekler

Lobinin doğu duvarındaki kapıdan girilen küçük bar (coffee shop'un arkasında). Her gün 10:00–23:00 açık; hafta sonu
otel kapalıyken de müşteri gelir.

- **Müşteriler:** sokaktan gelip dört bar taburesinden birine oturur ve sipariş verir (başlarında sipariş baloncuğu,
  sağ üstte sabır çubuklu sipariş listesi). Sabırları tükenirse kalkıp giderler. Kirli bardak duran tabureye oturmazlar.
- **İçecekler (hepsi alkolsüz):** 🍋 Limonata (limon + soda) · 🍹 Çilekli Mocktail (çilek + limon + soda, çalkala) ·
  🥤 Çilekli Milkshake (süt + çilek, çalkala) · ☕ Sıcak Çikolata (süt + kakao). Malzemelerin sırası serbest.
- **Barmenlik:** raftan temiz bardak al → arka tezgâhtaki dispenserlerden malzemeleri koy (dökme animasyonu, 1.5 sn) →
  gerekiyorsa çalkalayıcıda çalkala (2 sn) → müşteriye servis et. Bardak siparişe uymuyorsa ipucu neyin eksik
  olduğunu söyler; yanlış içeceği lavaboya dökebilirsin. Doğru servis: içeceğin fiyatı kasaya, hızına göre €2–6
  bahşiş cüzdanına.
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
│       ├── VehicleService.js    # Bisiklet / scooter: satın alma, sürücü + yolcu, park, kalıcılık
│       ├── GameClock.js         # Gün döngüsü: hafta içi açık / hafta sonu kapalı, gece (23:00–07:00)
│       ├── RoomManager.js       # Oda durumları ve temizlik işleri
│       ├── GuestManager.js      # Misafir yaşam döngüsü ve rotaları
│       └── CoffeeShopService.js # Cüzdan, envanter, trip zarı, slot, bahşiş
│   └── house/                   # Evler: HouseService (yatak/uyku kontrolü dahil), GardenService (saksı, ekim, hasat),
│                                #   FileStore / PgStore (kayıt), YouTube oEmbed + küçük resim vekili
├── shared/                      # Sunucu + istemci ortak kodu (ESM)
│   ├── constants.js             # Durumlar, olay adları, fiyat, saatler, ürünler, trip/slot
│   ├── layout.js                # Otel + coffee shop + ev yerleşimi: duvarlar, odalar, rota noktaları
│   ├── friends.js               # Müdavimler, konular, espriler, arkadaşlık kuralları
│   ├── vehicles.js              # Araç türleri, hız / ivme, yolcu koltuğu
│   ├── chat.js                  # Sohbet mesajı temizleme
│   ├── maintenance.js           # Oda arızaları, noktaları, mini oyun süreleri, bonuslar
│   ├── house.js                 # Mobilya kataloğu, yerleşim kuralları (duvar slotları, tavan), bitkiler, YouTube link ayrıştırma
│   └── path.js                  # Deterministik rota örnekleme
├── public/                      # İstemci (derleme yok)
│   ├── index.html               # Canvas, HUD, dokunmatik kontroller, menüler
│   ├── css/style.css
│   └── js/
│       ├── main.js              # Her şeyi birbirine bağlar
│       ├── core/                # Engine (FPS kilidi, uyku), Device, Settings, Sfx (WebAudio)
│       ├── world/               # Otel, coffee shop, bar, Bizim Ev, Achterstraat evleri, steeg + araç büfesi; dokular, malzemeler, çarpışma
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
│       │   ├── BarSystem.js         # Bar De Tulp: istasyonlar, siparişler, uzak oyuncu kolları
│       │   ├── ViewModel.js         # Birinci şahıs eller (dökme, çalkalama, ısırma, toplama…)
│       │   ├── NightCycle.js        # Gece görünümü, yatakta uyuma, uyku ekranı
│       │   ├── HerbalBotanySystem.js # Ev bahçesi: tohum paneli, büyüme evreleri, hasat
│       │   └── FurnitureModels.js   # Köşe renkli düşük poligonlu mobilya modelleri
│       ├── net/Network.js       # Socket.io istemcisi, saat senkronu
│       └── ui/                  # HUD, ayarlar paneli
└── test/                        # Sunucu testleri (node:test): simülasyon, coffee shop, evler, bar, gece + bahçe, arkadaşlık, ulaşım + tamirat
```

## Sonraki aşamalar için notlar

- Oda durumları, misafirler ve envanter kalıcı değil (kasa, cüzdanlar, evler, bitkiler ve oyun saati kalıcı).
- Otel kasasındaki para henüz harcanmıyor (yükseltmeler / personel / dekor için ekonomi sonraki aşamada); kişisel cüzdan coffee shop'ta harcanıyor.
- Ses, resepsiyonda oyuncu etkileşimi, misafir memnuniyeti ve oda yükseltmeleri planlanabilir.
