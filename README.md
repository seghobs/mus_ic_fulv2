# Musicful AI Studio

Yerel müzik stüdyosu: şarkı üretimi, görev takibi, YouTube ses önizlemesi ve müzik kütüphanesi.

## Başlatma

Python 3.12 ve Node.js kurulu olmalıdır. Windows'ta `calistir.bat` dosyasını çalıştırın. Başlatıcı Python bağımlılıklarını kontrol eder ve sunucu hazır olduğunda tarayıcıyı açar. Kapatmak için Ctrl+C kullanın.

Hesapları uygulamanın Ayarlar bölümünden ekleyin. Gemini özellikleri için `GEMINI_API_KEY` ortam değişkenini ayarlayın veya proje kökünde Git tarafından yok sayılan `gemini.local.json` dosyasını oluşturun:

```json
{"api_key": "YOUR_GEMINI_API_KEY"}
```

YouTube kanal işlemleri ayrıca yerel OAuth yapılandırması gerektirir. Hesaplar, tokenler, taslaklar, ayarlar ve oluşturulan dosyalar depoya dahil edilmez.

## Bu sürüm

- Birbiriyle uyumlu stüdyo teması, paneller ve pencereler.
- Arka planda oturum yenileme ve hesaba bağlı görev takibi.
- SSE ile tamamlanan üretimlerin güncellenmesi.
- yt-dlp ile ses önizlemesi ve akış üzerinden oynatma.
- Üretim araçları, WAV hazırlama ve hesap kayıtları.
- Sunucu hazır olduğunda tarayıcı açma ve Ctrl+C ile kapanma.
- Telif / Filtre Bypass seçeneğinin kaldırılması.

## Doğrulama

```text
python -m unittest discover -s tests
node --test tests/*.test.cjs
```
