# AI Shorts Studio

AI Shorts Studio adalah aplikasi berbasis web (React + Express) yang dirancang untuk mengotomatisasi produksi dan penjadwalan video pendek vertikal (9:16). Sistem ini mencakup pembuatan naskah berbasis AI, rendering video otomatis, text-to-speech, hingga pengunggahan langsung ke Facebook Page tanpa intervensi manual.

## Fitur Utama

- Studio AI: Pembuatan judul, deskripsi SEO, tag, dan naskah per-adegan menggunakan model AI (ditenagai oleh Google Gemini resmi atau OpenRouter), dilengkapi dengan generator lokal sebagai cadangan.
- Mode Rendering Video:
  1. Template FFmpeg: Rendering instan dengan latar belakang bertema dan teks caption.
  2. AI Video (fal.ai): Pembuatan aset visual generatif berdasarkan topik tiap adegan.
  3. MoneyPrinterTurbo: Integrasi dengan footage video stok (Pexels/Pixabay) dan penyelarasan subtitle otomatis (berjalan sebagai modul eksternal pihak ketiga dari [harry0703](https://github.com/harry0703/MoneyPrinterTurbo)).
- Text-to-Speech (TTS): Sintesis suara narator neural (termasuk model bahasa Indonesia asli) menggunakan edge-tts-universal.
- Pengecekan Fakta Otomatis: Integrasi dengan Tavily untuk mengambil data aktual dari web dan merevisi klaim faktual pada naskah.
- Penjadwalan (Auto-Pilot): Modul cron job yang secara berkala mengambil antrean topik, merender, dan mengunggah video ke Facebook Page sesuai jadwal (hari dan jam eksekusi bebas dikonfigurasi melalui antarmuka aplikasi).

## Kebutuhan Sistem

- Node.js versi 18 atau lebih baru.
- FFmpeg dan curl terinstal dan terdaftar di dalam PATH sistem operasi.
- Python 3.11+ dan Git (Hanya diperlukan jika menggunakan mode MoneyPrinterTurbo).
- Sistem operasi Windows direkomendasikan untuk kemudahan penggunaan script bawaan.

## Rekomendasi Deployment (Self-Hosting Lokal)

Aplikasi ini melakukan rendering video secara intensif dan menyimpan file riwayat maupun video secara lokal. Oleh karena itu, sistem ini **tidak cocok** untuk di-hosting di layanan cloud serverless (seperti Vercel atau Heroku) atau shared hosting biasa.

Metode operasional yang paling direkomendasikan (dan bebas biaya) adalah **Self-Hosting pada komputer lokal**:
1. Siapkan satu PC atau laptop yang terhubung dengan internet.
2. Jalankan aplikasi menggunakan script `start.bat`.
3. Biarkan komputer tersebut menyala dengan jendela terminal tetap terbuka di latar belakang.

Selama komputer menyala, sistem penjadwalan (Auto-Pilot) akan berjalan secara otonom 24 jam sehari untuk memproduksi dan mengunggah video sesuai jadwal, sehingga Anda tidak perlu menyewa Virtual Private Server (VPS).

## Panduan Instalasi

1. Clone repositori ini ke dalam direktori lokal Anda.
2. Buka terminal dan jalankan perintah berikut untuk menginstal dependensi:
   ```bash
   npm install
   ```
3. Salin file `.env.example` menjadi `.env` (opsional, jika Anda perlu mengubah port default).
4. Jalankan aplikasi menggunakan script batch yang telah disediakan:
   ```bash
   start.bat
   ```
   Script ini akan memproses backend (port 3001) dan frontend (port 5173) secara bersamaan.

Akses antarmuka aplikasi melalui web browser pada alamat: `http://localhost:5173`.

## Konfigurasi Layanan Pihak Ketiga

Pengaturan kredensial untuk layanan eksternal dikelola sepenuhnya melalui Tab Pengaturan pada antarmuka aplikasi. Data ini disimpan secara aman dan terenkripsi secara logis di dalam `server/data/database.json`.

- **Provider AI Naskah**:
  - **Google Gemini (Default & Sangat Direkomendasikan)**: Menggunakan API Key gratis langsung dari [Google AI Studio](https://aistudio.google.com). Base URL disetel ke `https://generativelanguage.googleapis.com/v1beta/openai` dengan model `gemini-2.0-flash` atau `gemini-1.5-flash`.
  - **OpenRouter**: Mendukung berbagai model cloud alternatif (`https://openrouter.ai/api/v1`).
- **Facebook Page**: Membutuhkan Page Access Token dengan izin `pages_manage_posts` dan `pages_read_engagement` dari platform Meta for Developers.
- **fal.ai**: Membutuhkan API Key untuk mengaktifkan fitur render AI generatif.
- **Tavily**: Membutuhkan API Key untuk fitur injeksi fakta aktual pada naskah.

## Struktur Direktori

```text
ai-shorts-studio/
├── server/               # Backend Express (Endpoint REST, Integrasi API, Cron Scheduler)
│   ├── services/         # Logika operasional (AI, Video Render, Integrasi FB)
│   └── data/             # File database.json untuk penyimpanan konfigurasi dan riwayat
├── src/                  # Frontend React (Vite)
│   ├── components/       # Antarmuka Dashboard, Studio, Scheduler, History, Settings
│   └── lib/              # State management
├── public/videos/        # Direktori penyimpanan hasil render video (MP4)
└── MoneyPrinterTurbo/    # Modul eksternal (terunduh saat menjalankan scripts\start-moneyprinter.bat)
```

## Catatan Repositori

- Direktori ini telah dikonfigurasi untuk mengabaikan (git-ignore) file `server/data/database.json` demi mencegah kebocoran kredensial.
- Modul integrasi pengunggahan YouTube (`youtubeService.js`) telah dikembangkan namun ditandai sebagai dorman (tidak aktif) pada rilis saat ini.

## Atribusi Pihak Ketiga

Sistem rendering video ke-3 menggunakan **MoneyPrinterTurbo**. Modul tersebut **bukanlah buatan atau hak milik kreator repositori ini**, melainkan sebuah proyek *open-source* pihak ketiga. Kami sangat berterima kasih kepada kreator aslinya.
- **Kreator Asli**: [@harry0703](https://github.com/harry0703)
- **Repositori Asli**: [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)

## Lisensi

Proyek ini dilisensikan di bawah **MIT License**. Silakan lihat file [LICENSE](LICENSE) untuk informasi lebih lanjut. Anda bebas menggunakan, memodifikasi, dan mendistribusikan proyek ini untuk keperluan pribadi maupun komersial.
