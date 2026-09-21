# Snap

Snapchat'ten esinlenilmiş, tarayıcıda çalışan bir web uygulaması.

## Özellikler

- Kullanıcı kaydı ve girişi
- Kullanıcı adıyla arkadaş arama, arkadaşlık isteği gönderme/kabul etme
- Kamera izni isteme; izin verilirse canlı kamera açılır
- Fotoğraf çekip **snap** olarak arkadaşa gönderme (tek seferlik görüntüleme — açıldıktan sonra sunucudan silinir)
- Metin mesajı gönderme
- Hem snap'lere hem mesajlara **yanıt verme**
- Socket.IO ile gerçek zamanlı teslimat ve bildirimler

## Çalıştırma

```bash
npm install
npm start
```

Sunucu varsayılan olarak `http://localhost:3000` adresinde çalışır. Kamera erişimi için tarayıcının `localhost`'u güvenli kaynak (secure context) olarak kabul ettiğinden emin ol; canlı bir sunucuya taşırken HTTPS kullanılmalı.

## Yapı

- `server/` — Express + Socket.IO backend, SQLite (better-sqlite3) veritabanı
- `public/` — Vanilla HTML/CSS/JS frontend (derleme adımı yok)
