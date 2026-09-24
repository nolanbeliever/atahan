# Snoop

Snapchat'ten esinlenilmiş, tarayıcıda çalışan bir web uygulaması.

## Özellikler

- Kullanıcı kaydı ve girişi
- Kullanıcı adıyla arkadaş arama, arkadaşlık isteği gönderme/kabul etme
- Kamera izni isteme; izin verilirse canlı kamera açılır
- **69 yüz takipli kamera filtresi** — face-api.js ile gerçek zamanlı yüz takibi; gözlük/aksesuar, uçuşan emoji tacı, hayvan kulakları, baş aksesuarı, bıyık/ağız efektleri ve tam kare renk efektleri (siyah-beyaz, sepya, neon, sinematik…) motorlarından üretiliyor, çekilen snap'e gömülü kaydediliyor. 20 tanesi Snoop Plus'a özel.
- Fotoğraf çekip **snap** olarak arkadaşa gönderme (tek seferlik görüntüleme — açıldıktan sonra sunucudan silinir)
- Telefon galerisinden fotoğraf yükleyip snap olarak gönderme
- **Kendi özel galerin** (🖼️): kamerada çektiğin fotoğrafı kimseye göndermeden, sadece kendine ait galerine kaydedebilirsin — sadece sen görürsün, istediğinde silebilirsin
- **Avatar tasarlama** (profil resmine dokun ✏️): Bitmoji tarzı avatar — 40 kıyafet, 15 saç modeli, 12 saç rengi, 8 ten tonu, göz/ağız/sakal, 14 aksesuar ve 12 arka plan; takım elbise, smokin, deri ceket, astronot, süper kahraman, taç gibi güzel parçalar Snoop Plus'a özel. Avatarın arkadaş listesinde, aramada ve sohbet başlığında görünür
- **Snoop Plus fiyatlandırma** (✨): Snoop Plus aylık 200 TL — uygulamada ödeme yok, almak isteyenler adminlerle konuşur, admin `/admin.html`'den Plus verir
- Metin mesajı gönderme
- Hem snap'lere hem mesajlara **yanıt verme**
- **Streak**: karşılıklı her gün snap/mesaj atan arkadaşlar için 🔥 seri sayacı; her 50 günde bir taraflara 1 haftalık Snoop Plus hediye edilir
- **Snoop Plus**: özel sohbet arka planları, en sevdiğin arkadaşı (⭐) seçme, 20 özel filtre, özel avatar kıyafet ve aksesuarları
- **Oyunlar** (🎮): sohbet içinden erişilen, her biri kolay/orta/zor seviyeli 8 oyun
  - Tek kişilik: Yılan, 2048, Hafıza, Reaksiyon Hızı, Köstebek Vur — skorunu arkadaşına mesaj olarak gönderebilirsin
  - Gerçek zamanlı, arkadaşınla: XO, Taş-Kağıt-Makas, Matematik Düellosu — arkadaşını davet edip aynı anda oynuyorsunuz, sunucu hamleleri Socket.IO ile senkronize ediyor
- **Admin paneli** (`/admin.html`): kullanıcılara elle Plus verme/kaldırma
- Socket.IO ile gerçek zamanlı teslimat ve bildirimler

### ⚠️ Admin hesabı hakkında

Sunucu ilk açılışta otomatik olarak `adminruhi` / `hdabla` bilgileriyle bir admin hesabı oluşturur (istersen `ADMIN_USERNAME` / `ADMIN_PASSWORD` ortam değişkenleriyle değiştirebilirsin). Bu repo **public** olduğu için varsayılan şifre GitHub'da herkese açıktır — deploy ettikten hemen sonra admin hesabıyla giriş yapıp `/admin.html` sayfasındaki "Kendi şifreni değiştir" formundan şifreyi değiştir.

## Çalıştırma

```bash
npm install
npm start
```

Sunucu varsayılan olarak `http://localhost:3000` adresinde çalışır. Kamera erişimi için tarayıcının `localhost`'u güvenli kaynak (secure context) olarak kabul ettiğinden emin ol; canlı bir sunucuya taşırken HTTPS kullanılmalı.

## iPhone'dan aynı WiFi üzerinden test etme (kamera için HTTPS şart)

iOS Safari, kamera erişimine yalnızca **HTTPS** veya gerçek `localhost` üzerinden izin verir. Bilgisayarının yerel ağ IP'si üzerinden düz `http://192.168.x.x:3000` ile açarsan kamera izni istemi hiç çıkmaz. Bunu çözmek için [mkcert](https://github.com/FiloSottile/mkcert) ile yerel, güvenilir bir sertifika oluştur:

1. **mkcert kur** (bilgisayarında):
   - macOS: `brew install mkcert`
   - Windows: `choco install mkcert` (veya `scoop install mkcert`)
   - Linux: dağıtımının paket yöneticisine bak ya da [release sayfasından](https://github.com/FiloSottile/mkcert/releases) indir
2. **Yerel kök sertifikayı oluştur ve bilgisayarına güvenilir olarak ekle:**
   ```bash
   mkcert -install
   ```
3. **Bilgisayarının yerel ağ IP'sini bul:**
   - macOS: `ipconfig getifaddr en0`
   - Windows: `ipconfig` (IPv4 adresi)
   - Linux: `hostname -I`
4. **Bu proje için sertifika üret** (kendi IP'ni `<LAN-IP>` yerine yaz):
   ```bash
   mkdir -p certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 <LAN-IP>
   ```
   `npm start` bu dosyaları otomatik bulup sunucuyu HTTPS ile başlatır.
5. **mkcert'in kök sertifikasını iPhone'a güvenilir yap:**
   ```bash
   mkcert -CAROOT
   ```
   komutunun gösterdiği klasördeki `rootCA.pem` dosyasını AirDrop veya e-posta ile iPhone'a gönder, açtığında bir "profil indirildi" bildirimi çıkar:
   - **Ayarlar → Genel → VPN ve Cihaz Yönetimi** kısmından profili yükle
   - Sonra **Ayarlar → Genel → Bilgi → Sertifika Güven Ayarları** kısmına gir ve mkcert kök sertifikası için tam güveni aç
6. **Sunucuyu başlat ve telefondan bağlan:**
   ```bash
   npm start
   ```
   iPhone Safari'de `https://<LAN-IP>:3000` adresini aç (iPhone ve bilgisayar aynı WiFi'da olmalı). Kamera izni normal şekilde çıkacaktır.
7. **Ana ekrana ekle:** Safari'de paylaş simgesine dokun → **Ana Ekrana Ekle**. Uygulama artık kendi simgesiyle, Safari çubukları olmadan tam ekran açılır.

`certs/` klasörü `.gitignore`'da olduğu için özel anahtarın asla repoya işlenmez.

## Yapı

- `server/` — Express + Socket.IO backend, SQLite (better-sqlite3) veritabanı
- `public/` — Vanilla HTML/CSS/JS frontend (derleme adımı yok), `manifest.webmanifest` ve `img/icon-180.png` "Ana Ekrana Ekle" desteği için
- `public/js/filters.js` — yüz takipli kamera filtreleri; [face-api.js](https://github.com/justadudewhohacks/face-api.js) kütüphanesini ve model dosyalarını jsDelivr CDN'den kullanıcının kendi tarayıcısında yükler (internet bağlantısı gerekir; yüklenemezse kamera yine çalışır, sadece filtreler pasif kalır)
- `certs/` — (gitignore'lu) yerel HTTPS için mkcert sertifikaları, yukarıdaki adımlarla kendin oluşturursun
