import axios from 'axios';
import dbService from './dbService.js';
import searchService from './searchService.js';
import trendService from './trendService.js';

// Kata kunci tragedi/bencana/kekerasan sungguhan — dibuang dari kandidat trending SEBELUM
// dipilih, bukan diserahkan ke penilaian AI semata. Gaya konten aplikasi ini serba hype/viral
// ("FAKTA GILA!", ajakan follow ceria), sama sekali tidak pantas dipakai buat kejadian nyata
// yang ada korban jiwa/lukanya — bukan cuma etis, tapi juga literally salah nada.
// WAJIB dua bahasa: hasil pencarian Tavily buat topik Indonesia sering didominasi sumber
// berita BAHASA INGGRIS (CNN, Reuters, AP, dst) — versi Indonesia-only sebelumnya kebobolan,
// headline "earthquake... killing at least 20" lolos karena "earthquake"/"killing" tidak
// ada di daftar kata kuncinya (cuma "tsunami" yang kebetulan ketangkap).
const SENSITIVE_TREND_KEYWORDS = /gempa|tsunami|korban tewas|korban jiwa|meninggal dunia|\btewas\b|bencana|kecelakaan|kebakaran|perang|serangan|pembunuhan|bunuh diri|pemerkosaan|\bkdrt\b|pelecehan|terorisme|\bbom\b|ledakan|wabah|pandemi|kerusuhan|penculikan|earthquake|tsunami|\bkill(ed|ing|s)?\b|\bdead\b|death[s]?|died|casualt(y|ies)|victim[s]?|disaster|accident|crash|collapse[d]?|\bfire\b|wildfire|\bwar\b|attack(ed|s)?|murder(ed)?|homicide|suicide|\brape[d]?\b|assault(ed)?|domestic violence|terroris[mt]|\bbomb(ing|ed)?\b|explosion|outbreak|pandemic|epidemic|\briot[s]?\b|kidnap(ped|ping)?|abduct(ed|ion)?|injured|wounded|toll rises|missing (people|persons)/i;

class AIService {
  constructor() {
    const savedConfig = dbService.getAiConfig() || {};
    this.apiEndpoint = savedConfig.aiEndpoint || 'https://generativelanguage.googleapis.com/v1beta/openai';
    this.apiKey = savedConfig.apiKey || '';
    this.model = savedConfig.model || 'gemini-3.5-flash';
  }

  /**
   * Parse JSON dari respons model AI dengan toleransi tinggi:
   * 1. Coba parse langsung
   * 2. Ekstrak blok {} atau []
   * 3. Ekstrak properti topic/niche via regex jika kutip dalam teks merusak JSON
   */
  parseAiJson(rawContent) {
    const cleanJson = (rawContent || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleanJson);
    } catch {
      const objStart = cleanJson.indexOf('{');
      const objEnd = cleanJson.lastIndexOf('}');
      if (objStart !== -1 && objEnd > objStart) {
        try {
          return JSON.parse(cleanJson.slice(objStart, objEnd + 1));
        } catch { /* lanjut ke regex */ }
      }
      const arrStart = cleanJson.indexOf('[');
      const arrEnd = cleanJson.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) {
        try {
          return JSON.parse(cleanJson.slice(arrStart, arrEnd + 1));
        } catch {}
      }

      // Ekstraksi regex untuk format ide topik
      const topicMatch = cleanJson.match(/"topic"\s*:\s*"([\s\S]*?)"\s*,\s*"niche"/i);
      const nicheMatch = cleanJson.match(/"niche"\s*:\s*"([^"]+)"/i);
      if (topicMatch && nicheMatch) {
        return {
          topic: topicMatch[1].trim(),
          niche: nicheMatch[1].trim()
        };
      }

      throw new Error('Respons AI bukan JSON valid (kemungkinan model mencampur teks penjelasan dengan JSON).');
    }
  }

  updateConfig({ apiEndpoint, apiKey, model }) {
    if (apiEndpoint) this.apiEndpoint = apiEndpoint;
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (model) this.model = model;
  }

  /** Cek cepat apakah endpoint AI (Google Gemini) terjangkau — dipakai panel
   * "Status Sistem" di Dasbor supaya kelihatan sebelum generate gagal karena servicenya mati. */
  async pingEndpoint() {
    try {
      const headers = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      await axios.get(`${this.apiEndpoint}/models`, { headers, timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  }

  getConfig() {
    return {
      apiEndpoint: this.apiEndpoint,
      apiKey: this.apiKey ? '***' + this.apiKey.slice(-4) : '',
      hasApiKey: Boolean(this.apiKey && this.apiKey.length > 5),
      model: this.model
    };
  }

  /**
   * Menghasilkan paket konten video Shorts lengkap:
   * Judul, Deskripsi, Tag, Naskah Narasi, dan Scene Breakdown untuk video vertikal 9:16
   */
  async generateShortContent(topic = 'Fakta Unik AI & Teknologi Masa Depan', niche = 'Teknologi & AI', tone = 'Energik & Viral', targetDurationSeconds = null, continuationContext = null) {
    // Durasi & jumlah scene menyesuaikan jenis konten: cerita/dongeng/misteri butuh napas
    // panjang buat membangun plot (3-5 menit), sementara fakta/tips singkat cukup padat di
    // 60-90 detik (minimal 60 detik supaya informasinya nggak kepotong kependekan).
    const storyMode = this.detectStoryMode(niche);
    const isNarrative = storyMode === 'fiction' || storyMode === 'mystery';

    let targetDurationLabel;
    let targetSceneGuidance;
    let exampleDuration;

    // User bisa menimpa perkiraan otomatis lewat dropdown "Target durasi" di Studio —
    // kalau diisi, prompt dipaksa mengikuti angka itu persis, bukan rentang tebakan niche.
    if (Number.isFinite(targetDurationSeconds) && targetDurationSeconds >= 15) {
      const clamped = Math.min(Math.max(Math.round(targetDurationSeconds), 15), 360);
      targetDurationLabel = `${clamped} detik (target pasti dari user, WAJIB dipenuhi — bukan cuma perkiraan)`;
      // Sama seperti pembagian jumlah scene otomatis di bawah: narasi butuh lebih banyak
      // "napas" per scene daripada fakta padat.
      const secondsPerScene = isNarrative ? 25 : 10;
      const sceneCount = Math.min(Math.max(Math.round(clamped / secondsPerScene), 3), 16);
      targetSceneGuidance = `tepat ${sceneCount} scene (satu scene mewakili sekitar ${Math.round(clamped / sceneCount)} detik narasi)`;
      exampleDuration = clamped;
    } else {
      targetDurationLabel = isNarrative ? '180-360 detik (3-6 menit)' : '60-90 detik (minimal 60 detik)';
      // Jumlah scene narrative sengaja dibatasi ke 12-16 (bukan lebih banyak lagi) supaya total
      // output JSON tidak terlalu besar dan generasi tetap cepat dan stabil. Durasi
      // sampai 6 menit dicapai lewat narasi per scene yang lebih panjang (20-30 detik), bukan
      // menambah jumlah scene lebih banyak lagi.
      targetSceneGuidance = isNarrative
        ? 'sekitar 12-16 scene (satu scene mewakili sekitar 20-30 detik narasi) supaya alur cerita tetap punya ruang buat pembukaan, konflik, klimaks, dan penutup tanpa scene yang berlebihan'
        : 'sekitar 6-10 scene (satu scene tiap kira-kira 8-12 detik)';
      exampleDuration = isNarrative ? 270 : 65;
    }

    // Pencarian web (Tavily, opsional — nonaktif kalau belum diatur di Pengaturan) buat
    // menyuntik fakta TERKINI ke prompt. Tanpa ini, AI cuma mengandalkan pengetahuan statis
    // dari data latihan modelnya sendiri, yang bisa ketinggalan/salah untuk topik yang butuh
    // info baru (kejadian terbaru, prestasi terkini seorang tokoh, dll). Dilewati untuk mode
    // fiksi murni (fakta web tidak relevan buat cerita karangan), dan gagal diam-diam kalau
    // pencarian error/nonaktif — generate tetap jalan seperti biasa tanpa konteks tambahan.
    const searchContext = storyMode !== 'fiction' ? await searchService.searchTopic(topic) : null;
    const searchContextBlock = searchContext
      ? `\nKONTEKS FAKTA TERKINI dari pencarian web (WAJIB dipakai sebagai acuan supaya naskah akurat & up to date — jangan tulis sesuatu yang bertentangan dengan info ini, tapi sampaikan dengan gaya bahasa lisan santai sesuai aturan GAYA BAHASA di bawah, jangan ditempel mentah-mentah):\n${searchContext}\n`
      : '';
    const generatedBySuffix = searchContext ? ' + fakta web (Tavily)' : '';

    // Konten bersambung (Part 2, 3, dst) — dipicu manual dari tombol "Buat Part lanjutan" di
    // Riwayat, khusus niche cerita/naratif yang memang ditutup ajakan follow buat lanjutannya
    // (lihat aturan WAJIB di bawah). Blok ini memaksa AI melanjutkan cerita/pembahasan yang
    // SAMA, bukan menulis topik baru yang kebetulan mirip judul — dan memaksa title diakhiri
    // "(Part N)" supaya kelihatan jelas di Riwayat/Studio ini bagian dari seri yang mana.
    const continuationBlock = continuationContext
      ? `\nKONTEKS LANJUTAN — INI PALING PENTING, BACA DULU SEBELUM MENULIS APAPUN:
Ini adalah Part ${continuationContext.partNumber} dari sebuah seri. Part ${continuationContext.partNumber - 1} sebelumnya (judul: "${continuationContext.previousTitle}") sudah tayang dengan naskah:
"""
${(continuationContext.previousNarration || '').slice(0, 1800)}
"""
Video itu ditutup ajakan follow buat lanjutannya — penonton yang nonton video ini SUDAH nonton Part sebelumnya. Tugasmu: LANJUTKAN cerita/pembahasan itu secara koheren, bukan menulis topik baru yang cuma kebetulan bertema sama. Boleh recap SANGAT singkat (maksimal satu kalimat) di scene pertama kalau perlu, tapi jangan mengulang isi Part sebelumnya secara panjang. "title" WAJIB diakhiri dengan " (Part ${continuationContext.partNumber})".\n`
      : '';

    const prompt = `Kamu adalah pakar kreator video Shorts/Reels vertikal viral dengan jutaan penonton.
Tugasmu adalah membuat konten video vertikal (9:16) berdurasi ${targetDurationLabel} dengan topik: "${topic}" dalam kategori niche: "${niche}" dengan gaya bicara "${tone}".
${continuationBlock}${searchContextBlock}Buat jumlah scene sesuai kebutuhan supaya menutupi SELURUH durasi target di atas — jangan berhenti di 4 scene kalau durasinya panjang. Untuk konten ini, buat ${targetSceneGuidance}. Tiap objek scene memakai struktur JSON PERSIS seperti contoh di bawah (sceneNumber, timeRange, visualDescription, captionText, narrationSegment), tinggal ditambah sejumlah scene yang dibutuhkan.

GAYA BAHASA NARASI — PALING PENTING, ini yang bakal dibacakan suara AI, jadi harus terdengar seperti orang ngobrol, bukan teks yang dibaca robot:
- HOOK AWAL (3 DETIK PERTAMA): Kalimat pertama WAJIB sangat provokatif, mengejutkan, atau memicu rasa penasaran ekstrem. Langsung tembak inti masalah/fakta tergila. HARAM menyapa penonton di awal kalimat.
- Pakai bahasa lisan sehari-hari yang santai. Sapa penonton dengan "kamu".
- Panjang kalimat DIVARIASIKAN: selingi kalimat pendek (3-6 kata) di antara kalimat panjang, supaya ada ritme dan tempat menarik napas.
- Pakai koma untuk jeda alami, dan titik tiga (...) kalau butuh jeda dramatis. Jangan bikin kalimat beranak-pinak dengan banyak anak kalimat.
- Maksimal 2 tanda seru di SELURUH naskah. Nada semangat dibentuk lewat pilihan kata, bukan lewat tanda seru bertubi-tubi.
- HARAM pakai klise pembuka: "Tahukah kamu", "Pernahkah kamu", "Di era digital ini", "Siapa sangka", "Mari kita simak", "Tanpa berlama-lama lagi", "Halo teman-teman".
- Hindari kata kaku/formal: "merupakan", "sehingga", "oleh karena itu", "dengan demikian", "sangat luar biasa", "hal tersebut". Ganti dengan versi lisan: "adalah/itu", "jadi", "makanya", "gila sih", "itu".
- Boleh pakai kata sambung obrolan sesekali di awal kalimat: "Nah", "Tapi", "Soalnya", "Jadi", "Dan anehnya".
- Jangan mengulang subjek yang sama di tiap kalimat, dan JANGAN tutup tiap scene dengan kalimat ajakan — kecuali scene paling terakhir (lihat aturan wajib di bawah).
- Naskah harus mengalir antar scene: kalimat terakhir sebuah scene menyambung ke scene berikutnya, bukan berdiri sendiri-sendiri.
- JANGAN tulis narasi dengan HURUF KAPITAL SEMUA (kapital semua hanya untuk "captionText" di layar, bukan untuk suara).

WAJIB — SCENE PALING TERAKHIR harus memicu INTERAKSI lalu ditutup dengan ajakan follow:
- Akhiri dengan SATU pertanyaan terbuka atau pernyataan sedikit kontroversial yang memancing orang untuk berdebat atau membagikan opini mereka di kolom komentar.
- Setelah pertanyaan itu, langsung berikan ajakan follow secara singkat dan natural.
- Pakai kata "follow" (bukan "subscribe" — ini konten Facebook Page, bukan YouTube), tapi JANGAN sebut nama akun/Page tertentu, cukup ajakan generik semacam "follow biar nggak ketinggalan" atau variasi lain yang cocok sama topiknya.
- Ini satu-satunya scene yang boleh berisi interaksi/ajakan — jangan diulang di scene lain.

KEMBALIKAN OUTPUT DALAM FORMAT JSON MURNI TANPA MARKDOWN ATAU TEKS LAIN, dengan skema:
{
  "title": "Judul viral singkat maks 55 karakter + emoji + #shorts",
  "description": "Deskripsi menarik dengan hook kuat, penjelasan singkat, kata kunci SEO, dan 5 hashtag relevan",
  "tags": "tag1, tag2, tag3, tag4, tag5, tag6, tag7, tag8, tag9, tag10, tag11, tag12, tag13, tag14, tag15",
  "narration": "Teks lengkap narasi suara mengikuti GAYA BAHASA di atas — gabungan mulus semua narrationSegment, hook di 3 detik pertama, panjangnya menyesuaikan durationSeconds di bawah",
  "durationSeconds": ${exampleDuration},
  "scenes": [
    {
      "sceneNumber": 1,
      "timeRange": "00:00 - 00:05",
      "visualDescription": "Visual hook dramatis bergaya modern tech sci-fi, teks besar menyala di tengah layar",
      "captionText": "FAKTA GILA AI YANG KAMU GAK TAU!",
      "narrationSegment": "Lima detik. Cuma segitu waktu yang dibutuhkan AI sekarang buat bikin satu video utuh."
    },
    {
      "sceneNumber": 2,
      "timeRange": "00:05 - 00:18",
      "visualDescription": "Animasi kode neon dan robot futuristik bekerja otomatis di cloud server",
      "captionText": "KERJA OTOMATIS 24 JAM!",
      "narrationSegment": "Dia riset topiknya sendiri, nulis naskahnya sendiri, terus upload sendiri ke Facebook. Tiga kali seminggu, tanpa disentuh manusia sama sekali."
    },
    {
      "sceneNumber": 3,
      "timeRange": "00:18 - 00:32",
      "visualDescription": "Grafik follower halaman meledak tajam ke atas dengan nuansa cyberpunk",
      "captionText": "ALGORITMA SUKA KONSISTENSI!",
      "narrationSegment": "Nah, di sini menariknya. Algoritma video pendek itu sayang sama halaman yang rutin... dan jadwal otomatis bikin kamu rutin tanpa harus mikir."
    },
    {
      "sceneNumber": 4,
      "timeRange": "00:32 - 00:40",
      "visualDescription": "Tombol follow berdenyut neon emas dengan efek partikel kaca",
      "captionText": "FOLLOW BIAR GAK KETINGGALAN!",
      "narrationSegment": "Kalau kamu penasaran gimana cara setupnya, tinggal follow. Besok aku bongkar sisanya."
    }
  ]
}
CATATAN: 4 scene di atas cuma contoh FORMAT. Untuk topik ini kamu WAJIB membuat total ${targetSceneGuidance}, dengan jumlah kata di "narration" (gabungan semua narrationSegment) yang cukup panjang untuk dibacakan selama kurang lebih ${exampleDuration} detik (perkirakan ±2.5 kata Indonesia per detik). Berapa pun jumlah scene-nya, SCENE PALING TERAKHIR wajib berisi ajakan follow seperti dijelaskan di aturan GAYA BAHASA di atas.`;

    // Coba panggil API Google Gemini
    const headers = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ai-shorts-studio.local',
      'X-Title': 'AI YouTube Shorts Studio'
    };
    if (this.apiKey && this.apiKey.length > 0) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let lastErrorMessage = 'Alasan tidak diketahui';

    // Coba 1: endpoint yang terdaftar + model yang dikonfigurasi.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await axios.post(
          `${this.apiEndpoint}/chat/completions`,
          {
            model: this.model,
            messages: [
              {
                role: 'system',
                content: 'You are an AI short-video content expert. Always return valid JSON only.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 8000,
            stream: false,
            ...(this.apiEndpoint.includes('localhost') || this.apiEndpoint.includes('openrouter')
              ? { reasoning: { exclude: true, enabled: false } }
              : {})
          },
          { headers, timeout: 340000 }
        );

        const rawContent = response.data?.choices?.[0]?.message?.content || '';
        const parsed = this.parseAiJson(rawContent);
        return {
          ...parsed,
          generatedBy: `${this.model}${generatedBySuffix}`,
          generatedAt: new Date().toISOString()
        };
      } catch (error) {
        lastErrorMessage = this.describeAxiosError(error);
        console.warn(`AI API call gagal dengan model ${this.model} (percobaan ${attempt}/2):`, lastErrorMessage);
        if (attempt === 2) {
          // Fallback jika model utama gagal
          const fallbackCandidates = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'];

          for (const modelCandidate of fallbackCandidates) {
            if (modelCandidate === this.model) continue;
            try {
              const response = await axios.post(
                `${this.apiEndpoint}/chat/completions`,
                {
                  model: modelCandidate,
                  messages: [
                    { role: 'system', content: 'You are an AI short-video content expert. Always return valid JSON only.' },
                    { role: 'user', content: prompt }
                  ],
                  temperature: 0.7,
                  stream: false
                },
                { headers, timeout: 60000 }
              );
              const rawContent = response.data?.choices?.[0]?.message?.content || '';
              const parsed = this.parseAiJson(rawContent);
              return {
                ...parsed,
                generatedBy: `${modelCandidate} (fallback)${generatedBySuffix}`,
                generatedAt: new Date().toISOString()
              };
            } catch (err2) {
              lastErrorMessage = this.describeAxiosError(err2);
              console.warn(`Fallback model ${modelCandidate} gagal:`, lastErrorMessage);
            }
          }
        } // end if (attempt === 2)
      } // end catch
    } // end for attempt

    // Smart Generator untuk menghasilkan konten viral relevan sesuai topik/niche,
    // dengan alasan kegagalan sungguhan disertakan (bukan pesan generik) supaya kelihatan
    // di UI apa yang benar-benar terjadi (timeout, connection refused, dll).
    return this.generateSmartFallback(topic, niche, tone, lastErrorMessage, continuationContext);
  }

  /**
   * Minta AI menilai klaim faktual di naskah narasi. Kalau pencarian web (Tavily) aktif di
   * Pengaturan, hasil pencarian topiknya disuntikkan ke prompt supaya penilaian didasari fakta
   * TERKINI, bukan cuma pengetahuan statis model. Kalau tidak aktif/gagal, ini tetap pemeriksaan
   * oleh model bahasa YANG SAMA yang menulis naskahnya (bukan pencarian internet sungguhan) —
   * hasilnya cuma saringan awal, bukan sumber kebenaran akhir. Disclaimer ini disesuaikan di
   * UI (ShortsStudioView) tergantung apakah konteks web dipakai atau tidak.
   */
  async factCheckNarration(narration = '', topic = '') {
    const text = (narration || '').trim();
    if (!text) {
      throw new Error('Naskah narasi kosong, tidak ada yang bisa dicek.');
    }

    const searchContext = await searchService.searchTopic(topic || text.slice(0, 200));
    const searchContextBlock = searchContext
      ? `\nKONTEKS FAKTA TERKINI dari pencarian web — jadikan ini acuan utama buat menilai klaim yang berkaitan (lebih dipercaya daripada pengetahuan umummu kalau ada perbedaan):\n${searchContext}\n`
      : '';

    const prompt = `Kamu adalah fact-checker yang teliti dan skeptis. Baca naskah narasi video pendek berikut (topik: "${topic}") dan identifikasi klaim FAKTUAL di dalamnya — pernyataan yang bisa benar/salah secara objektif (angka, kejadian, sifat sesuatu), BUKAN opini, gaya bahasa, atau ajakan follow/subscribe.
${searchContextBlock}
Untuk tiap klaim faktual, nilai dengan salah satu dari 4 kategori persis ini:
- "akurat": sesuai pengetahuan umum yang kamu tahu${searchContext ? ' atau konteks pencarian web di atas' : ''}
- "meragukan": terdengar dibesar-besarkan, disederhanakan berlebihan, atau butuh konteks tambahan supaya tidak menyesatkan
- "keliru": bertentangan dengan pengetahuan umum yang kamu tahu${searchContext ? ' atau konteks pencarian web di atas' : ''}
- "tidak_bisa_dipastikan": klaim spesifik (angka presisi, kejadian lokal/personal, detail niche) yang tidak bisa kamu pastikan benar/salahnya${searchContext ? ' bahkan dari konteks pencarian di atas' : ' dari pengetahuan umum'}

Kalau naskahnya cerita fiksi atau tidak mengandung klaim faktual sama sekali, kembalikan claims array kosong dan jelaskan itu di overallNote.

Naskah:
"""
${text}
"""

KEMBALIKAN OUTPUT JSON MURNI TANPA MARKDOWN, skema:
{
  "claims": [
    { "claim": "kutipan/ringkasan klaim, maks 120 karakter", "verdict": "akurat" | "meragukan" | "keliru" | "tidak_bisa_dipastikan", "note": "alasan singkat, maks 140 karakter" }
  ],
  "overallNote": "ringkasan umum 1-2 kalimat tentang keandalan naskah ini secara keseluruhan"
}`;
    const checkedBySuffix = searchContext ? ' + fakta web (Tavily)' : '';

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const callModel = async (model, timeout) => {
      const response = await axios.post(
        `${this.apiEndpoint}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: 'You are a skeptical fact-checker. Always return valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 1800,
          stream: false,
          ...(this.apiEndpoint.includes('localhost') || this.apiEndpoint.includes('openrouter')
            ? { reasoning: { exclude: true, enabled: false } }
            : {})
        },
        { headers, timeout }
      );
      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      return this.parseAiJson(rawContent);
    };

    const attemptModels = [
      this.model,
      this.model === 'gemini-3.5-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.5-flash'
    ];

    let lastError;
    for (let i = 0; i < attemptModels.length; i++) {
      try {
        const parsed = await callModel(attemptModels[i], 90000);
        return {
          claims: Array.isArray(parsed.claims) ? parsed.claims : [],
          overallNote: parsed.overallNote || '',
          checkedBy: `${attemptModels[i]}${i > 0 ? ` (percobaan ke-${i + 1})` : ''}${checkedBySuffix}`,
          usedWebSearch: Boolean(searchContext),
          checkedAt: new Date().toISOString()
        };
      } catch (error) {
        lastError = error;
        console.warn(`Cek fakta gagal dengan model ${attemptModels[i]} (percobaan ${i + 1}/${attemptModels.length}):`, this.describeAxiosError(error));
      }
    }
    throw new Error(`Gagal menjalankan cek fakta setelah ${attemptModels.length}x percobaan: ${this.describeAxiosError(lastError)}`);
  }

  /**
   * Revisi naskah supaya klaim yang ditandai "meragukan"/"keliru" oleh cek fakta diperbaiki,
   * TANPA menulis ulang seluruh naskah dari nol — gaya bahasa, urutan, dan jumlah scene tetap
   * dipertahankan sebisa mungkin, cuma bagian yang bermasalah yang diluruskan/dilunakkan.
   * Skema output PERSIS sama dengan generateShortContent supaya bisa langsung menggantikan
   * hasil naskah sebelumnya di frontend tanpa penanganan khusus.
   */
  async reviseNarrationForFactCheck({ title, description, tags, narration, durationSeconds, scenes }, claims = [], topic = '') {
    const problemClaims = (claims || []).filter((c) => c.verdict === 'meragukan' || c.verdict === 'keliru');
    if (problemClaims.length === 0) {
      throw new Error('Tidak ada klaim bermasalah untuk diperbaiki.');
    }
    if (!narration || !Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('Naskah tidak lengkap, tidak ada yang bisa direvisi.');
    }

    const originalJson = JSON.stringify({ title, description, tags, narration, durationSeconds, scenes }, null, 2);
    const problemList = problemClaims
      .map((c) => `- "${c.claim}" → ditandai ${c.verdict}${c.note ? `: ${c.note}` : ''}`)
      .join('\n');

    const prompt = `Kamu adalah editor naskah video Shorts yang teliti. Naskah video berikut (topik: "${topic}") sudah dicek fakta, dan beberapa klaim di dalamnya ditandai bermasalah.

NASKAH ASLI (JSON):
${originalJson}

KLAIM YANG WAJIB DIPERBAIKI:
${problemList}

TUGASMU:
- Perbaiki HANYA kalimat yang mengandung klaim bermasalah di atas — luruskan, lunakkan (tambah kata seperti "diperkirakan", "sebagian", "menurut sejumlah sumber"), atau ganti dengan pernyataan yang lebih akurat, supaya tidak lagi menyesatkan.
- JANGAN ubah bagian naskah lain yang tidak disebut di atas. Pertahankan gaya bahasa, urutan cerita, dan JUMLAH SCENE yang sama persis (jumlah item di "scenes" harus sama dengan aslinya, sceneNumber & timeRange tetap sama).
- Title/description/tags boleh disesuaikan HANYA kalau memuat klaim yang sama persis; kalau tidak, biarkan sama persis seperti aslinya.
- Tetap ikuti gaya bahasa lisan santai seperti naskah aslinya (kalimat pendek-panjang berselang, tanpa klise, tanpa HURUF KAPITAL SEMUA di narasi), dan scene terakhir tetap ditutup ajakan follow generik seperti sebelumnya.

KEMBALIKAN OUTPUT JSON MURNI TANPA MARKDOWN, dengan skema PERSIS SAMA seperti NASKAH ASLI di atas (title, description, tags, narration, durationSeconds, scenes[] dengan sceneNumber/timeRange/visualDescription/captionText/narrationSegment).`;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const callModel = async (model, timeout) => {
      const response = await axios.post(
        `${this.apiEndpoint}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: 'You are a careful script editor. Always return valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.4,
          max_tokens: 8000,
          stream: false,
          ...(this.apiEndpoint.includes('localhost') || this.apiEndpoint.includes('openrouter')
            ? { reasoning: { exclude: true, enabled: false } }
            : {})
        },
        { headers, timeout }
      );
      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      return this.parseAiJson(rawContent);
    };

    // Pola percobaan-ulang yang sama seperti factCheckNarration
    try {
      const parsed = await callModel(this.model, 180000);
      return { ...parsed, generatedBy: `${this.model} (direvisi sesuai cek fakta)`, generatedAt: new Date().toISOString() };
    } catch (error) {
      console.warn('Revisi naskah gagal dengan model', this.model, '— mencoba ulang:', this.describeAxiosError(error));
      try {
        const fallbackModel = this.model === 'gemini-3.5-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.5-flash';
        const parsed = await callModel(fallbackModel, 180000);
        return { ...parsed, generatedBy: `${fallbackModel} (direvisi sesuai cek fakta, percobaan ke-2)`, generatedAt: new Date().toISOString() };
      } catch (error2) {
        throw new Error(`Gagal merevisi naskah: ${this.describeAxiosError(error2)}`);
      }
    }
  }

  /**
   * Cek naskah/judul/deskripsi terhadap risiko pelanggaran community guideline platform (ujaran
   * kebencian, kekerasan/konten berbahaya, konten dewasa, misinformasi berbahaya, harassment,
   * spam/clickbait menyesatkan) SEBELUM diupload otomatis oleh auto-pilot. Auto-pilot jalan
   * tanpa pengawasan manusia 3x seminggu — tanpa saringan ini, sekali AI generate sesuatu yang
   * menyenggol guideline, langsung terpublish ke channel/halaman asli tanpa ada yang sempat
   * cegah. Sama seperti factCheckNarration, ini penilaian model bahasa (bukan API moderasi resmi
   * platform manapun) — saringan awal yang jauh lebih baik daripada tidak ada sama sekali, tapi
   * bukan jaminan mutlak, terutama untuk pelanggaran yang butuh penilaian bernuansa.
   */
  async checkContentSafety({ title = '', description = '', narration = '' } = {}) {
    const text = [title, description, narration].filter(Boolean).join('\n\n').trim();
    if (!text) {
      return { safe: true, risk: 'aman', concerns: [], overallNote: 'Konten kosong, tidak ada yang bisa dinilai.', checkedBy: 'lokal (tanpa AI)' };
    }

    const prompt = `Kamu adalah reviewer kepatuhan konten yang ketat untuk platform video pendek (YouTube/Facebook/Instagram). Nilai risiko pelanggaran community guideline dari judul, deskripsi, dan naskah narasi video pendek berikut — BUKAN menilai kualitas naskah atau ketepatan fakta.

Kategori yang WAJIB dicek:
- Ujaran kebencian / diskriminasi (SARA, gender, disabilitas, dll)
- Kekerasan atau instruksi aktivitas berbahaya (self-harm, senjata, zat ilegal, dll)
- Konten seksual/dewasa yang tidak pantas untuk audiens umum
- Harassment/perundungan terhadap individu atau kelompok tertentu
- Misinformasi medis/kesehatan yang berbahaya (teori konspirasi hiburan/sejarah boleh)

Judul: "${title}"
Deskripsi: "${description}"
Naskah:
"""
${narration}
"""

KEMBALIKAN OUTPUT JSON MURNI TANPA MARKDOWN, skema:
{
  "risk": "aman" | "perlu_review" | "berisiko",
  "concerns": ["deskripsi singkat tiap masalah spesifik yang ditemukan, kosongkan array kalau aman"],
  "overallNote": "1-2 kalimat kesimpulan"
}
"risk" wajib "aman" kalau memang tidak ada masalah — jangan mengarang masalah supaya kelihatan teliti. Konten fiksi/misteri/horor yang jelas-jelas fiksi TIDAK otomatis "berisiko" hanya karena temanya gelap. Judul yang provokatif, hiperbola, clickbait, atau menyebut "sejarah tersembunyi" adalah DISENGAJA untuk marketing media sosial dan SAMA SEKALI BUKAN PELANGGARAN. Jangan blokir konten karena clickbait.`;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const callModel = async (model) => {
      const response = await axios.post(
        `${this.apiEndpoint}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: 'You are a strict content-policy reviewer. Always return valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 800,
          stream: false,
          response_format: { type: 'json_object' },
          ...(this.apiEndpoint.includes('localhost') || this.apiEndpoint.includes('openrouter')
            ? { reasoning: { exclude: true, enabled: false } }
            : {})
        },
        { headers, timeout: 45000 }
      );
      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      return this.parseAiJson(rawContent);
    };

    try {
      const parsed = await this._checkSafetyWithRetry(callModel);
      const risk = ['aman', 'perlu_review', 'berisiko'].includes(parsed.risk) ? parsed.risk : 'perlu_review';
      return {
        safe: risk === 'aman',
        risk,
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
        overallNote: parsed.overallNote || '',
        checkedBy: `${this.model}`,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      // Gagal total (AI tidak terjangkau) → JANGAN anggap aman diam-diam. Auto-pilot yang
      // memanggil ini wajib memperlakukan hasil ini sebagai "butuh review manual", bukan
      // "lolos", supaya kegagalan teknis tidak berubah jadi celah keamanan konten.
      console.warn('[AIService] Cek keamanan konten gagal total:', this.describeAxiosError(error));
      return {
        safe: false,
        risk: 'perlu_review',
        concerns: [],
        overallNote: `Cek keamanan gagal dijalankan (${this.describeAxiosError(error)}) — dianggap butuh review manual demi keamanan, bukan otomatis lolos.`,
        checkedBy: 'gagal (AI tidak terjangkau)',
        checkedAt: new Date().toISOString()
      };
    }
  }

  /** Retry 1x dengan model cadangan — pola sama seperti factCheckNarration/generateVideoSearchTerms. */
  async _checkSafetyWithRetry(callModel) {
    try {
      return await callModel(this.model);
    } catch (error) {
      console.warn('[AIService] Cek keamanan gagal dengan model', this.model, '— mencoba ulang:', this.describeAxiosError(error));
      const fallbackModel = this.model === 'gemini-3.5-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.5-flash';
      return await callModel(fallbackModel);
    }
  }

  /**
   * Susun kata kunci pencarian video stok (Pexels/Pixabay, dipakai MoneyPrinterTurbo) yang
   * GENERIK — sengaja TIDAK memakai nama orang/tokoh/klub/merek spesifik, karena situs stok
   * footage tidak punya rekaman orang-orang tertentu (atlet, artis, tokoh publik). Kalau
   * dibiarkan memakai nama asli (mis. "Lamine Yamal champion"), pencarian nyaris selalu
   * kosong/meleset jauh dan MoneyPrinterTurbo jatuh ke hasil acak yang sama sekali tidak
   * nyambung (video laminator, orang main biola, dll — pernah terjadi persis begini).
   * Kata kunci disusun berurutan mengikuti alur scene supaya visualnya tetap nyambung dengan
   * narasi (dipasangkan dengan match_materials_to_script di moneyPrinterService.js).
   * Gagal/nonaktif → kembalikan null, pemanggil harus fallback ke auto-generate bawaan MPT.
   */
  async generateVideoSearchTerms(title, scenes) {
    const sceneList = (scenes || []).filter((s) => s && (s.visualDescription || s.captionText));
    if (sceneList.length === 0) return null;

    const sceneLines = sceneList
      .map((s, i) => `${i + 1}. ${(s.visualDescription || s.captionText || '').toString().slice(0, 160)}`)
      .join('\n');

    const prompt = `Kamu menyusun kata kunci pencarian video stok (Pexels/Pixabay) untuk video pendek berjudul "${(title || '').slice(0, 100)}".

ATURAN PALING PENTING: situs stok footage TIDAK PUNYA rekaman orang tertentu (atlet, artis, tokoh publik, politisi, dll) — mereka cuma punya video generik (orang random, tempat, benda, suasana). Jadi:
- JANGAN sebut nama orang, klub, merek, kota, atau event spesifik (misal "Lamine Yamal", "Barcelona", "Piala Dunia 2026") di kata kunci manapun.
- Ganti dengan deskripsi visual GENERIK yang tetap cocok suasananya (misal ganti "Lamine Yamal mengangkat trofi" jadi "young athlete lifting trophy celebration").
- Kata kunci WAJIB Bahasa Inggris (situs stoknya internasional), 2-4 kata per kata kunci.
- Urutannya HARUS mengikuti urutan adegan di bawah, satu kata kunci per adegan.

Adegan (urutan):
${sceneLines}

KEMBALIKAN JSON MURNI array of strings saja, TANPA markdown, TANPA penjelasan, panjang array = jumlah adegan di atas. Contoh: ["young athlete training session", "stadium crowd cheering night"]`;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const callModel = async (model) => {
      const response = await axios.post(
        `${this.apiEndpoint}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: 'You generate generic, name-free stock-footage search terms. Always return a valid JSON array of strings only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.4,
          max_tokens: 600,
          stream: false,
          ...(this.apiEndpoint.includes('localhost') || this.apiEndpoint.includes('openrouter')
            ? { reasoning: { exclude: true, enabled: false } }
            : {})
        },
        { headers, timeout: 60000 }
      );
      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      const parsed = this.parseAiJson(rawContent);
      const terms = Array.isArray(parsed) ? parsed : parsed?.terms;
      if (!Array.isArray(terms) || terms.length === 0) return null;
      const clean = terms
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim().slice(0, 60));
      return clean.length ? clean : null;
    };

    const attemptModels = [
      this.model,
      this.model === 'gemini-3.5-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.5-flash'
    ];

    for (let i = 0; i < attemptModels.length; i++) {
      try {
        const terms = await callModel(attemptModels[i]);
        if (terms) return terms;
      } catch (error) {
        console.warn(`[AIService] Generate kata kunci video gagal dengan model ${attemptModels[i]} (percobaan ${i + 1}/${attemptModels.length}):`, this.describeAxiosError(error));
      }
    }
    console.warn('[AIService] Generate kata kunci video generik gagal total setelah beberapa percobaan, MoneyPrinterTurbo pakai auto-generate bawaan.');
    return null;
  }

  /** Ekstrak pesan error yang berguna dari axios error (timeout, connection refused, body API, dll) */
  describeAxiosError(err) {
    if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
      return `Timeout — AI tidak merespons dalam batas waktu (${err.message})`;
    }
    if (err.code === 'ECONNREFUSED') {
      return `Connection refused — Server AI tidak dapat dihubungi (${err.message})`;
    }
    const data = err.response?.data;
    if (data) {
      if (typeof data === 'string') return data.slice(0, 200);
      return JSON.stringify(data).slice(0, 200);
    }
    return err.message;
  }

  /**
   * Minta AI mengusulkan SATU ide topik acak lintas genre (bukan cuma teknologi),
   * termasuk cerita fiksi/horor/misteri, supaya Studio tidak terpatok topik itu-itu saja.
   * Kalau AI tidak terjangkau, jatuh ke bank topik lokal yang juga diacak.
   */
  async suggestRandomTopic() {
    const categories = [
      'Teknologi & AI', 'Misteri & Horor', 'Cerita Fiksi Pendek', 'Psikologi & Fakta Sosial',
      'Sejarah Tersembunyi', 'Keuangan & Investasi', 'Kesehatan & Sains', 'Hewan & Alam Liar',
      'Konspirasi & Urban Legend', 'Hubungan & Percintaan', 'Motivasi & Karir', 'Game & Pop Culture'
    ];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const tones = ['Energik & Viral', 'Misterius & Penasaran', 'Santai & Relatable', 'Dramatis & Menegangkan'];
    const tone = tones[Math.floor(Math.random() * tones.length)];

    const randomSeed = Math.random().toString(36).substring(2, 8) + Date.now().toString().slice(-4);
    const angles = [
      'fakta mencengangkan yang jarang orang tahu',
      'plot twist cerita mengejutkan di akhir',
      'fenomena aneh tapi 100% nyata',
      'pertanyaan provokatif yang bikin penasaran dan overthinking',
      'sisi gelap atau rahasia yang jarang dibahas publik',
      'trik atau insight psikologis yang relatable dalam kehidupan sehari-hari'
    ];
    const angle = angles[Math.floor(Math.random() * angles.length)];

    const prompt = `Kamu adalah trend-spotter konten Shorts/Reels/TikTok Indonesia kelas dunia.
Tugasmu: Berikan SATU ide topik video Shorts yang BENAR-BENAR SEGAR, SPESIFIK, UNIK, dan BERPOTENSI VIRAL dalam kategori "${category}".
Angle konten yang diinginkan: ${angle}.
Topik harus memiliki hook kuat, tidak klise, bukan topik umum yang membosankan. (Seed acak: ${randomSeed})
KEMBALIKAN OUTPUT JSON MURNI TANPA MARKDOWN, skema:
{"topic": "judul singkat ide topik menarik & catchy, maks 80 karakter", "niche": "${category}"}`;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const callModel = async (model) => {
      const response = await axios.post(
        `${this.apiEndpoint}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: 'You are a creative viral short-video creator. Always return valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 1.0,
          max_tokens: 2500,
          stream: false,
          response_format: { type: 'json_object' }
        },
        { headers, timeout: 60000 }
      );
      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      return this.parseAiJson(rawContent);
    };

    try {
      const parsed = await callModel(this.model);
      return { topic: parsed.topic, niche: parsed.niche || category, tone };
    } catch (error) {
      console.warn(`[AIService] Gagal minta ide topik acak dengan model ${this.model}, coba model cadangan:`, this.describeAxiosError(error));
      try {
        const fallbackModel = this.model === 'gemini-3.5-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.5-flash';
        const parsed = await callModel(fallbackModel);
        return { topic: parsed.topic, niche: parsed.niche || category, tone };
      } catch (err2) {
        console.warn('[AIService] Kedua model AI gagal, fallback ke bank topik lokal acak:', this.describeAxiosError(err2));
        return this.getRandomFallbackTopic(category, tone);
      }
    }
  }

  /**
   * Usulkan topik yang berangkat dari tren sungguhan (berita yang lagi ramai dibicarakan di
   * Indonesia hari ini, lewat Tavily — lihat trendService.js), bukan tebakan AI dari
   * pengetahuan statisnya seperti suggestRandomTopic. Trend yang jelas soal tragedi/bencana/
   * kekerasan dibuang duluan (SENSITIVE_TREND_KEYWORDS) — gaya video ini serba hype/viral,
   * tidak pantas dipakai buat kejadian nyata yang ada korban. Trending kosong/semua sensitif/
   * Tavily nonaktif → fallback ke suggestRandomTopic biasa, sama seperti kalau AI tidak terjangkau.
   */
  async suggestTrendingTopic() {
    const trends = await trendService.getTrendingTopics();
    const safeTrends = trends.filter(
      (t) => !SENSITIVE_TREND_KEYWORDS.test(t.title) && !SENSITIVE_TREND_KEYWORDS.test(t.snippet || '')
    );

    if (safeTrends.length === 0) {
      console.warn('[AIService] Tidak ada trending topic yang aman buat konten hiburan hari ini, pakai suggestRandomTopic sebagai gantinya.');
      return this.suggestRandomTopic();
    }

    const pick = safeTrends[Math.floor(Math.random() * Math.min(safeTrends.length, 6))];
    const niches = [
      'Teknologi & AI', 'Misteri & Horor', 'Cerita Fiksi Pendek', 'Psikologi & Fakta Sosial',
      'Sejarah Tersembunyi', 'Keuangan & Investasi', 'Kesehatan & Sains', 'Hewan & Alam Liar',
      'Konspirasi & Urban Legend', 'Hubungan & Percintaan', 'Motivasi & Karir', 'Game & Pop Culture'
    ];
    const tones = ['Energik & Viral', 'Misterius & Penasaran', 'Santai & Relatable', 'Dramatis & Menegangkan'];
    const tone = tones[Math.floor(Math.random() * tones.length)];

    const prompt = `Ada topik yang lagi ramai dibicarakan di Indonesia hari ini: "${pick.title}"${pick.snippet ? `\nKonteks: ${pick.snippet}` : ''}

Susun SATU ide topik video Shorts yang berangkat dari tren ini, dikemas jadi angle menarik buat video pendek (fakta, analisis singkat, atau sisi menarik di baliknya) — BUKAN sekadar menyalin judul berita mentah-mentah.
Kalau topiknya sensitif/politis/kontroversial/melibatkan tragedi-korban, JANGAN dipaksakan — ganti ke sudut pandang netral & aman sepenuhnya (mis. fakta umum seputar temanya), atau kalau memang tidak ada sudut aman sama sekali, pilih genre "Fakta Unik" umum yang tidak berhubungan dengan tren itu.

KEMBALIKAN OUTPUT JSON MURNI TANPA MARKDOWN, skema:
{"topic": "judul singkat ide topik, maks 80 karakter", "niche": "kategori niche paling cocok dari daftar ini: ${niches.join(', ')}"}`;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const response = await axios.post(
        `${this.apiEndpoint}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a viral short-video trend spotter who avoids sensationalizing real tragedies. Always return valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.8,
          max_tokens: 2500,
          stream: false,
          response_format: { type: 'json_object' }
        },
        { headers, timeout: 60000 }
      );
      const rawContent = response.data?.choices?.[0]?.message?.content || '';
      const parsed = this.parseAiJson(rawContent);
      const niche = niches.includes(parsed.niche) ? parsed.niche : niches[0];
      return { topic: parsed.topic, niche, tone, sourceTrend: pick.title };
    } catch (error) {
      console.warn('[AIService] Gagal susun angle dari trending topic, coba model fallback:', this.describeAxiosError(error));
      try {
        const fallbackModel = this.model === 'gemini-3.5-flash' ? 'gemini-3.5-flash-lite' : 'gemini-3.5-flash';
        const response = await axios.post(
          `${this.apiEndpoint}/chat/completions`,
          {
            model: fallbackModel,
            messages: [
              { role: 'system', content: 'You are a viral short-video trend spotter who avoids sensationalizing real tragedies. Always return valid JSON only.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.8,
            max_tokens: 2500,
            stream: false,
            response_format: { type: 'json_object' }
          },
          { headers, timeout: 60000 }
        );
        const rawContent = response.data?.choices?.[0]?.message?.content || '';
        const parsed = this.parseAiJson(rawContent);
        const niche = niches.includes(parsed.niche) ? parsed.niche : niches[0];
        return { topic: parsed.topic, niche, tone, sourceTrend: pick.title };
      } catch (err2) {
        console.warn('[AIService] Fallback trending juga gagal, pakai suggestRandomTopic:', this.describeAxiosError(err2));
        return this.suggestRandomTopic();
      }
    }
  }

  getRandomFallbackTopic(preferredCategory, tone) {
    const bank = {
      'Teknologi & AI': [
        'Fakta AI yang Bakal Ganti Pekerjaan Manusia', 'Gadget Rahasia yang Baru Dirilis Diam-Diam',
        'AI vs Manusia: Siapa Menang di 2026', 'Fitur Tersembunyi Smartphone yang 90% Orang Gak Tahu',
        'Apa yang Terjadi Jika Internet Dunia Mati 24 Jam?', 'Komputer Kuantum: Ancaman Nyata Sandi Perbankan',
        'Bahaya Digital Footprint yang Gak Bisa Dihapus', 'Teknologi Militer Canggih yang Akhirnya Dibocorkan'
      ],
      'Misteri & Horor': [
        'Misteri Rumah Kosong yang Gak Pernah Terpecahkan', 'Kejadian Aneh yang Direkam CCTV Tengah Malam',
        'Legenda Urban yang Ternyata Fakta', 'Sinyal Radio Aneh dari Luar Angkasa yang Terus Berulang',
        'Kapal Hantu Mary Celeste: Ke Mana Semua Awak Pergi?', 'Hutan Paling Terkutuk di Dunia yang Menolak Pengunjung',
        'Suara Bawah Laut The Bloop yang Bikin Peneliti Bingung', 'Misteri Pendaki Gunung Dyatlov Pass yang Mencekam'
      ],
      'Cerita Fiksi Pendek': [
        'Fiksi: Pesan Singkat dari Nomor Sendiri di Masa Depan', 'Fiksi: Robot yang Belajar Merasa Sedih',
        'Cerita Horor Singkat: Suara Ketukan di Cermin Kamar Mandi', 'Fiksi: Toko yang Menjual Waktu Tambahan Hidup',
        'Cerita Singkat: Pria Terakhir di Bumi Mendengar Pintu Diketuk', 'Fiksi: Aplikasi yang Bisa Memprediksi Kematian',
        'Cerita: Penumpang Misterius di Kereta Terakhir Tengah Malam', 'Fiksi: Ketika Bayanganmu Memutuskan Berhenti Mengikutimu'
      ],
      'Psikologi & Fakta Sosial': [
        'Kenapa Orang Susah Mengaku Salah', 'Trik Psikologi Biar Disukai Orang Baru Kenal',
        'Fakta Aneh Soal Cara Otak Membuat Keputusan', 'Bahaya Gaslighting Halus yang Sering Dikira Perhatian',
        'Efek Dunning-Kruger: Kenapa Orang Kurang Paham Lebih Pede?', 'Kenapa Kamu Sering Lupa Mau Ngapain Pas Masuk Ruangan?',
        'Tanda Teman Toxic yang Diam-Diam Menjatuhkanmu', 'Cara Membaca Bahasa Tubuh Orang yang Sedang Berbohong'
      ],
      'Sejarah Tersembunyi': [
        'Fakta Sejarah yang Sengaja Ditutupi', 'Kejadian Bersejarah yang Nyaris Mengubah Dunia',
        'Rahasia di Balik Bangunan Kuno Terkenal', 'Perang Tersingkat di Dunia yang Cuma Berlangsung 38 Menit',
        'Harta Karun Terbesar yang Belum Pernah Ditemukan', 'Kebiasaan Aneh Para Tokoh Besar Dunia Zaman Dulu',
        'Kota Kuno yang Lenyap Misterius Tanpa Bekas', 'Ilmuwan Jenius yang Karyanya Dicuri Sejarah'
      ],
      'Keuangan & Investasi': [
        'Kesalahan Keuangan yang Bikin Orang Tetap Miskin', 'Cara Kerja Uang yang Gak Diajarin di Sekolah',
        'Investasi Kecil yang Berubah Jadi Kekayaan Besar', 'Trik Psikologi Toko Bikin Kamu Boros Belanja',
        'Perbedaan Pola Pikir Orang Kaya vs Menengah', 'Kebiasaan Finansial yang Diam-Diam Menguras Tabungan',
        'Pelajaran dari Bangkrutnya Miliarder Dunia', 'Kenapa Inflasi Diam-Diam Merampok Gajimu'
      ],
      'Kesehatan & Sains': [
        'Fakta Tubuh Manusia yang Bikin Kaget', 'Kebiasaan Kecil yang Diam-Diam Merusak Kesehatan',
        'Eksperimen Sains yang Hasilnya Gak Terduga', 'Apa yang Terjadi pada Tubuh Kalau Gak Tidur 3 Hari?',
        'Organ Tubuh yang Sebenarnya Gak Kita Butuhkan', 'Kenapa Gula Lebih Bikin Kecanduan daripada yang Kita Duga?',
        'Fakta Menakjubkan Tentang Sistem Imun Manusia', 'Bahaya Duduk Terlalu Lama yang Setara Merokok'
      ],
      'Hewan & Alam Liar': [
        'Hewan dengan Kemampuan Bertahan Hidup Paling Gila', 'Fenomena Alam yang Sulit Dijelaskan Sains',
        'Hewan Purba yang Ternyata Masih Ada', 'Tardigrade: Makhluk Mikroskopis yang Bisa Hidup di Luar Angkasa',
        'Hewan Paling Berbisa di Dunia yang Terlihat Lucu', 'Pohon Tertua di Bumi yang Sudah Hidup Sejak Zaman Es',
        'Komunikasi Rahasia Hewan yang Baru Terungkap', 'Predator Laut Paling Mematikan Selain Hiu'
      ],
      'Konspirasi & Urban Legend': [
        'Teori Konspirasi yang Ternyata Ada Benarnya', 'Urban Legend Populer & Fakta di Baliknya',
        'Rahasia yang Katanya Disembunyikan Pemerintah', 'Area 51: Fakta vs Fiksi yang Beredar',
        'Proyek Rahasia MK-Ultra yang Benar-Benar Terjadi', 'Misteri Segitiga Bermuda: Mitos atau Fakta Ilmiah?',
        'Bungker Mewah Kaum Elit Dunia di Bawah Tanah', 'Satelit Misterius Black Knight: Sampah Antariksa atau UFO?'
      ],
      'Hubungan & Percintaan': [
        'Tanda Hubungan Sehat yang Sering Diabaikan', 'Kesalahan Umum di Awal Hubungan',
        'Cara Mengenali Red Flag Sebelum Terlambat', 'Love Bombing: Trik Manipulatif Berkedok Romantis',
        'Kenapa Orang Bisa Bosan Padahal Masih Sayang?', 'Perbedaan Cowok Cuek vs Cowok yang Gak Peduli',
        'Silent Treatment: Bentuk Hukuman Emosional Paling Dingin', 'Kunci Hubungan Langgeng Menurut Riset 40 Tahun'
      ],
      'Motivasi & Karir': [
        'Kebiasaan Orang Sukses Sebelum Jam 8 Pagi', 'Alasan Kerja Keras Aja Gak Cukup',
        'Skill yang Wajib Dikuasai Sebelum 2030', 'Kenapa Kamu Suka Menunda-Nunda (Bukan Karena Malas)',
        'Cara Negosiasi Gaji Biar Gak Dipandang Rendah', 'Aturan 5 Detik untuk Mengalahkan Rasa Malas',
        'Mindset yang Membedakan Pekerja Keras vs Pekerja Cerdas', 'Pelajaran Pahit Dunia Kerja yang Baru Sadar Pas Dewasa'
      ],
      'Game & Pop Culture': [
        'Easter Egg Tersembunyi di Game Populer', 'Fakta di Balik Layar Film yang Jarang Diketahui',
        'Tren Budaya Pop yang Lagi Viral Sekarang', 'Game Jadul yang Ternyata Mengubah Industri Hiburan',
        'Plot Hole Film Terkenal yang Baru Disadari Penonton', 'Karakter Anime yang Lebih Populer dari Karakter Utamanya',
        'Soundtrack Film yang Dibuat Tanpa Sengaja Jadi Legendaris', 'Misteri Pesan Rahasia di Video Game Terkenal'
      ]
    };
    const list = bank[preferredCategory] || bank['Teknologi & AI'];
    const topic = list[Math.floor(Math.random() * list.length)];
    return { topic, niche: preferredCategory, tone };
  }

  /**
   * Deteksi "mode cerita" dari niche, supaya naskah fallback lokal punya struktur & gaya bahasa
   * yang sesuai (cerita fiksi beneran, misteri yang bikin penasaran, atau fakta yang mengalir),
   * bukan satu skrip generik yang sama untuk semua topik.
   */
  detectStoryMode(niche = '') {
    const n = niche.toLowerCase();
    if (n.includes('fiksi') || n.includes('cerita')) return 'fiction';
    if (n.includes('misteri') || n.includes('horor') || n.includes('konspirasi')) return 'mystery';
    if (n.includes('motivasi') || n.includes('karir')) return 'motivation';
    if (n.includes('hubungan') || n.includes('percintaan')) return 'relationship';
    return 'facts';
  }

  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /**
   * Generator naskah lokal (dipakai HANYA kalau AI utama & semua fallback API gagal dihubungi).
   * Beda dari versi lama, ini menyusun narasi & caption yang
   * benar-benar bercerita tentang topiknya sendiri (bukan iklan generik soal "AI Shorts Studio"),
   * dengan struktur & gaya bahasa yang berubah-ubah sesuai niche, dan sedikit variasi acak supaya
   * tidak selalu terasa sama persis di tiap generate.
   */
  generateSmartFallback(topic, niche, tone, reason = '', continuationContext = null) {
    const mode = this.detectStoryMode(niche);
    const t = topic.trim();

    const templates = {
      fiction: {
        hooks: [
          `Ini kisah tentang ${t}, dan percayalah, endingnya nggak akan kamu tebak.`,
          `Bayangkan kamu ada di posisi ini: ${t}. Begini ceritanya.`,
          `Semua berawal dari hal sepele soal ${t}, sampai akhirnya semua berubah.`
        ],
        builds: [
          `Awalnya semua terlihat biasa saja, sampai satu kejadian kecil membuat semuanya berubah arah.`,
          `Setiap detail yang tampak kecil ternyata jadi kunci dari apa yang terjadi selanjutnya.`,
          `Perlahan, potongan-potongan ceritanya mulai terhubung satu sama lain.`
        ],
        climaxes: [
          `Dan ketika kebenarannya terungkap, semua orang yang mendengarnya terdiam.`,
          `Ternyata jawabannya jauh lebih mengejutkan dari yang siapa pun kira.`,
          `Di titik itulah semuanya masuk akal — dan itu yang bikin merinding.`
        ],
        resolutions: [
          `Ceritanya berakhir dengan satu pelajaran: hal terkecil sekalipun bisa mengubah segalanya.`,
          `Sejak hari itu, semua yang terlibat sepakat untuk nggak pernah menganggap remeh hal seperti ini lagi.`,
          `Dan begitulah kisah ini akhirnya selesai — jauh lebih berkesan dari yang siapa pun bayangkan di awal.`
        ],
        ctas: [
          `Kalau kamu suka cerita kayak gini, follow biar nggak ketinggalan part selanjutnya!`,
          `Komen di bawah menurut kamu endingnya gimana, terus follow biar gak ketinggalan part lain!`
        ]
      },
      mystery: {
        hooks: [
          `Ada satu hal soal ${t} yang sampai sekarang bikin banyak orang penasaran.`,
          `Kalau kamu dengar soal ${t}, kamu bakal mikir dua kali sebelum tidur malam ini.`,
          `Ini fakta soal ${t} yang jarang diomongin orang, tapi begitu tahu, susah dilupain.`
        ],
        builds: [
          `Banyak yang mencoba mencari penjelasan logisnya, tapi selalu ada bagian yang nggak nyambung.`,
          `Semakin digali, semakin banyak pertanyaan baru yang muncul dibanding jawabannya.`,
          `Beberapa saksi cerita hal yang mirip, padahal mereka nggak saling kenal.`
        ],
        climaxes: [
          `Sampai sekarang, belum ada yang bisa menjelaskan ini secara pasti.`,
          `Yang bikin makin aneh, pola kejadiannya terus berulang dari waktu ke waktu.`,
          `Sebagian orang percaya ini kebetulan. Sebagian lagi yakin ada sesuatu yang lebih besar di baliknya.`
        ],
        resolutions: [
          `Yang jelas, kejadian ini sudah tercatat di banyak laporan, dan jadi salah satu misteri yang paling banyak diperbincangkan sampai sekarang.`,
          `Sampai ada bukti baru muncul, ini akan terus jadi salah satu misteri yang belum terpecahkan.`,
          `Satu hal yang pasti: cerita ini nggak akan berhenti dibicarakan dalam waktu dekat.`
        ],
        ctas: [
          `Menurut kamu ini kebetulan atau ada penjelasan lain? Tulis di komentar, dan follow biar gak ketinggalan.`,
          `Follow kalau kamu suka cerita-cerita yang bikin penasaran kayak gini!`
        ]
      },
      motivation: {
        hooks: [
          `Kalau kamu masih ragu soal ${t}, coba dengar ini dulu.`,
          `Ada satu pelajaran soal ${t} yang mengubah cara banyak orang berpikir.`,
          `${t} — kedengarannya sederhana, tapi dampaknya besar kalau kamu paham ini.`
        ],
        builds: [
          `Kebanyakan orang gagal bukan karena kurang usaha, tapi karena nggak sadar hal ini dari awal.`,
          `Perbedaan antara yang berhasil dan yang stuck seringnya ada di satu kebiasaan kecil ini.`,
          `Ini bukan soal bakat, tapi soal konsistensi yang jarang orang mau jalani.`
        ],
        climaxes: [
          `Begitu kamu terapkan ini, kamu bakal lihat hasilnya nggak butuh waktu lama.`,
          `Orang-orang yang berhasil biasanya sudah sadar soal ini jauh sebelum yang lain.`,
          `Ini yang membedakan mereka yang cuma mimpi, dengan yang benar-benar sampai tujuan.`
        ],
        resolutions: [
          `Jadi mulai sekarang, coba terapkan ini pelan-pelan — perubahan besar biasanya dimulai dari langkah kecil yang konsisten.`,
          `Intinya, kamu nggak perlu sempurna dari awal, cukup mulai dan konsisten menjalankannya.`,
          `Pada akhirnya, yang membedakan bukan siapa yang paling pintar, tapi siapa yang paling konsisten menjalankannya.`
        ],
        ctas: [
          `Simpan video ini buat pengingat, dan follow buat tips lainnya!`,
          `Kalau ini bermanfaat, share ke orang yang butuh dengar ini juga — follow juga biar gak ketinggalan.`
        ]
      },
      relationship: {
        hooks: [
          `Soal ${t}, ini hal yang sering banget luput disadari orang.`,
          `Kalau kamu lagi mikirin ${t}, video ini buat kamu.`,
          `${t} itu simpel, tapi banyak orang salah paham soal ini.`
        ],
        builds: [
          `Banyak hubungan yang sebenarnya bisa diselamatkan, kalau saja hal ini disadari lebih awal.`,
          `Komunikasi yang kelihatannya kecil, ternyata paling sering jadi akar masalahnya.`,
          `Ini bukan soal siapa yang benar, tapi soal siapa yang mau lebih dulu mengerti.`
        ],
        climaxes: [
          `Begitu kamu paham ini, cara kamu melihat hubungan bisa berubah total.`,
          `Yang paling penting bukan soal siapa lebih sayang, tapi siapa yang mau bertahan saat susah.`,
          `Dan biasanya, hubungan yang sehat justru dibangun dari hal-hal kecil seperti ini.`
        ],
        resolutions: [
          `Jadi kalau kamu masih di tahap belajar soal ini, nggak apa-apa — yang penting mau terus berusaha mengerti satu sama lain.`,
          `Hubungan yang bertahan lama biasanya bukan yang paling sempurna, tapi yang paling mau saling belajar.`,
          `Dan itu jugalah yang akhirnya bikin sebuah hubungan terasa layak diperjuangkan.`
        ],
        ctas: [
          `Share ke pasangan kamu kalau ini related banget, dan follow biar gak ketinggalan.`,
          `Follow buat pembahasan hubungan yang relate lainnya.`
        ]
      },
      facts: {
        hooks: [
          `Tahukah kamu fakta soal ${t} ini?`,
          `Ini fakta soal ${t} yang mungkin belum pernah kamu dengar.`,
          `Kebanyakan orang salah paham soal ${t} — ini faktanya.`
        ],
        builds: [
          `Faktanya, ini terjadi karena beberapa hal yang jarang dibahas secara terbuka.`,
          `Penelitian dan pengamatan soal ini menunjukkan hasil yang cukup mengejutkan.`,
          `Semakin dalam ditelusuri, semakin jelas kenapa ini penting untuk diketahui.`
        ],
        climaxes: [
          `Dan itulah kenapa hal ini punya dampak lebih besar dari yang kelihatannya.`,
          `Begitu kamu tahu ini, kamu bakal melihatnya dengan cara yang beda mulai sekarang.`,
          `Fakta ini mengubah cara banyak orang memandang topik ini secara keseluruhan.`
        ],
        resolutions: [
          `Jadi lain kali kamu dengar soal ini, kamu bakal punya sudut pandang yang lebih lengkap dari kebanyakan orang.`,
          `Itulah kenapa fakta ini penting untuk terus disebarkan, biar makin banyak yang paham konteksnya.`,
          `Sekarang kamu tahu faktanya — tinggal kamu pilih mau pakai informasi ini buat apa.`
        ],
        ctas: [
          `Follow buat fakta-fakta menarik lainnya tiap hari!`,
          `Share ke temanmu yang juga perlu tahu fakta ini — follow juga biar gak ketinggalan.`
        ]
      }
    };

    const bank = templates[mode];
    const hook = this.pick(bank.hooks);
    const build = this.pick(bank.builds);
    const climax = this.pick(bank.climaxes);
    const resolution = this.pick(bank.resolutions);
    const cta = this.pick(bank.ctas);

    const captionSets = {
      fiction: ['CERITA INI NYATA?!', 'SEMUA BERUBAH DI SINI', 'TWIST-NYA GA NYANGKA', 'INILAH AKHIRNYA', 'FOLLOW BUAT LANJUTANNYA'],
      mystery: ['MASIH JADI MISTERI', 'SEMAKIN ANEH DIGALI', 'BELUM ADA JAWABAN PASTI', 'FAKTANYA SAMPAI SEKARANG', 'FOLLOW, MENURUTMU GIMANA?'],
      motivation: ['INI BEDANYA', 'BUKAN SOAL BAKAT', 'HASILNYA KELIHATAN CEPAT', 'MULAI DARI SEKARANG', 'SIMPAN & FOLLOW'],
      relationship: ['SERING DIABAIKAN', 'AKAR MASALAHNYA DI SINI', 'HUBUNGAN JADI BEDA', 'INTINYA SEPERTI INI', 'SHARE & FOLLOW'],
      facts: ['FAKTA MENGEJUTKAN', 'INI ALASANNYA', 'DAMPAKNYA LEBIH BESAR', 'JADI KESIMPULANNYA', 'FOLLOW UNTUK FAKTA LAINNYA']
    };
    const captions = captionSets[mode];

    const narrationSegments = [hook, build, climax, resolution, cta];
    const visuals = [
      'Visual hook dramatis, close-up dengan pencahayaan sinematik',
      'Montase adegan pendukung yang membangun rasa penasaran',
      'Momen puncak dengan efek visual dramatis dan tempo lebih cepat',
      'Visual penutup yang lebih tenang, memberi kesan kesimpulan/penyelesaian',
      'Ajakan follow dengan visual cerah dan energik'
    ];

    const scenes = narrationSegments.map((seg, idx) => ({
      sceneNumber: idx + 1,
      timeRange: `Scene ${idx + 1}`,
      visualDescription: visuals[idx],
      captionText: captions[idx],
      narrationSegment: seg
    }));

    const cleanNicheTag = (niche || 'shorts').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
    const partSuffix = continuationContext ? ` (Part ${continuationContext.partNumber})` : '';
    return {
      title: `${t.slice(0, 45)}${partSuffix} 👀 #shorts`,
      description: `${hook}\n\n${build}\n\n#shorts #viral #trending #${cleanNicheTag}`,
      tags: `shorts, viral, trending, ${(niche || '').toLowerCase()}, ${t.toLowerCase()}, cerita, fakta, hiburan, reels, fyp`,
      narration: narrationSegments.join(' '),
      durationSeconds: 32,
      scenes,
      generatedBy: `Smart Generator Lokal (AI utama tidak terjangkau${reason ? `: ${reason}` : ''})`,
      generatedAt: new Date().toISOString()
    };
  }
}

export default new AIService();
