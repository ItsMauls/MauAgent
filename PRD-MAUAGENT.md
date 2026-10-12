# PRD: MauAgent — Automation Creative Agency Berbasis AI Multi-Agen

Versi: 1.0 · Tanggal: 11 Oktober 2026 · Pemilik: Maulana Ibrahim
Dokumen pendamping: "MauAgent: Rancangan Sistem Agensi Kreatif AI" (rancangan arsitektur dan riset).

> Catatan untuk Claude Code atau coding agent lain: baca seluruh dokumen ini sebelum menulis kode. Kerjakan sesuai urutan di bagian "Rencana build" dan jangan melompat ke fase berikutnya sebelum acceptance criteria fase sekarang lolos. Bila ada keputusan yang tidak tercakup di sini, pilih opsi paling sederhana, catat di `DECISIONS.md`, dan lanjutkan.

---

## 1. Ringkasan

MauAgent adalah aplikasi yang meniru alur kerja creative agency sungguhan. Satu peran agensi = satu agen AI, dan agen-agen berjalan **berurutan**. Pengguna (pemilik agensi) berperan sebagai Client: memberi brief, lalu menyetujui, merevisi, atau meminta regenerasi hasil. Setelah disetujui, konten dipublikasikan otomatis ke Instagram dan TikTok, dan dasbor terpisah memantau tren, performa, status pipeline, dan biaya.

Alur peran:

```
Client (pengguna) → Account Manager → Creative Director → Art Director
→ Producer → Execution Team (Videographer → Post-production)
→ Account Team (QC) → Client Approval → [Revisi / Regenerate] → Final Deliverable → Publish → Dasbor
```

### 1.1 Tujuan

1. Dari satu brief, hasilkan konten video pendek 9:16 siap tayang dengan intervensi manusia minimal, tetapi dengan titik approval yang jelas.
2. Setiap agen menghasilkan artefak terstruktur yang sesuai perannya, dan agen berikutnya hanya bergantung pada artefak itu.
3. Biaya terkendali: setiap pengeluaran tercatat, estimasi tampil sebelum regenerasi, dan ada batas budget.
4. Dua sumber video yang bisa dicampur per shot: Veo API (otomatis) dan Manual Upload (video dibuat manual di aplikasi Gemini lalu diunggah).
5. Publikasi otomatis ke Instagram dan TikTok setelah approve.
6. Dasbor untuk pipeline, approval, biaya, tren, dan analitik.

### 1.2 Bukan tujuan (v1)

- Multi-tenant untuk banyak klien eksternal (satu pengguna dulu, tetapi skema data menyertakan `brandKitId` agar mudah diperluas).
- Editor video visual penuh di browser.
- Platform selain Instagram dan TikTok (YouTube Shorts dll. ditunda).
- Aplikasi mobile native.
- Scraping platform yang melanggar ketentuan layanan.

### 1.3 Persona

- **Owner/Client:** pemilik agensi, engineer full-stack berbahasa Indonesia. Memberi brief, memeriksa hasil, memutuskan approve/revisi/regenerate, dan memantau biaya.

---

## 2. Keputusan teknis (sudah ditetapkan)

| Area | Keputusan |
| --- | --- |
| Bahasa/runtime | TypeScript, Node.js 20+ |
| Web app dan dasbor | Next.js (App Router), Auth0 untuk login |
| Database | PostgreSQL dengan Prisma |
| Penyimpanan aset | S3 (presigned URL untuk upload dan akses) |
| Orkestrasi alur | Inngest (durable workflow). Tiap agen = satu `step.run`. Jeda approval = `step.waitForEvent` dengan timeout 7 hari |
| Lapisan agen | Vercel AI SDK atau Mastra, keluaran terstruktur divalidasi Zod |
| Video | Google Veo 3.1 lewat Gemini API (Lite untuk draf, Fast untuk final) dan jalur Manual Upload. Tidak ada penyedia video lain |
| Gambar keyframe dan QC video | Gemini (gambar dan multimodal) |
| Suara, musik, transkrip | ElevenLabs (Scribe, Voice Isolator, Voice Changer, Eleven Music) |
| Editing | FFmpeg (utama), Remotion (opsional untuk subtitle animasi) |
| Tren | vidIQ MCP (`https://mcp.vidiq.com/mcp`) |
| Publikasi | Instagram Graph API langsung; TikTok via Content Posting API (mode inbox/draft) atau Orshot Publish selama audit TikTok belum lolos |
| Infra | AWS (ECS/Fargate atau Lambda), CI/CD GitHub Actions, Docker |
| LLM per agen | Konfigurasi per agen lewat env/config, tanpa hardcode. Default: model kuat untuk Creative Director, model menengah untuk Account Manager dan Art Director, model murah untuk Producer |

Prinsip: model ID, harga, dan penyedia **tidak di-hardcode**. Semua lewat `config` dan tabel `PriceBook` karena cepat berubah. Verifikasi ID model Veo/Gemini terbaru dari dokumentasi resmi sebelum implementasi.

---

## 3. Alur dan state

### 3.1 Status kampanye

`DRAFTING → AWAITING_VIDEO_UPLOAD (hanya jalur manual) → POST_PRODUCTION → AWAITING_APPROVAL → APPROVED → PUBLISHING → PUBLISHED`

Cabang: `AWAITING_APPROVAL → REVISING → AWAITING_APPROVAL`, `AWAITING_APPROVAL → REGENERATING → AWAITING_APPROVAL`, `AWAITING_APPROVAL → REJECTED`, `AWAITING_APPROVAL → EXPIRED` (timeout 7 hari). Status `FAILED` untuk kegagalan permanen setelah retry.

### 3.2 Pseudocode orkestrator (Inngest)

```ts
export const campaignPipeline = inngest.createFunction(
  { id: "campaign-pipeline" },
  { event: "campaign/brief.submitted" },
  async ({ event, step }) => {
    const brief = event.data.clientBrief;
    const internal = await step.run("account-manager", () => runAgent("accountManager", { brief }));
    const creative = await step.run("creative-director", () => runAgent("creativeDirector", { internal }));
    const visual = await step.run("art-director", () => runAgent("artDirector", { creative, brief }));
    const plan = await step.run("producer", () => runAgent("producer", { visual, budgetCapUsd: brief.budgetCapUsd }));
    // budget gate: bila plan.estCostUsd > cap, berhenti dan minta keputusan Anda lewat waitForEvent

    await step.run("execution-videographer", () => produceShots(plan)); // veo_api: generate; manual_upload: buat Prompt Package
    // jalur manual: tunggu event "shot/asset.uploaded" untuk semua shot manual
    await step.waitForEvent("wait-uploads", { event: "campaign/assets.complete", match: "data.campaignId", timeout: "14d" });

    const bundle = await step.run("post-production", () => runPostProduction(plan));
    const pkg = await step.run("account-team-qc", () => runAgent("accountTeam", { bundle, brief }));

    // loop approval
    while (true) {
      const decision = await step.waitForEvent("client-decision", {
        event: "campaign/client.decision", match: "data.campaignId", timeout: "7d",
      });
      if (!decision) return markExpired();
      if (decision.data.type === "approve") break;
      if (decision.data.type === "reject") return markRejected();
      await step.run("handle-revision", () => routeRevision(decision.data)); // revise | regenerate
    }

    await step.run("publish", () => publishAll(pkg));
    await step.run("schedule-metrics", () => scheduleMetricPulls(pkg)); // T+1 jam, T+24 jam, T+7 hari
  }
);
```

Idempotensi: setiap `step.run` yang memanggil API berbiaya memakai idempotency key (`campaignId + step + attempt`) agar retry tidak memicu generate ganda.

---

## 4. Kebutuhan fungsional

Setiap agen: input = artefak sebelumnya, output = artefak JSON tervalidasi Zod, tersimpan di tabel `Artifact` dengan versi, `agentRole`, `costUsd`, dan `runId`. Agen **tidak** membaca riwayat percakapan, hanya artefak.

### F1. Client Brief (pengguna)
- Form di dasbor: tujuan bisnis, produk/tempat usaha, target audiens, platform, budget cap (USD), deadline, brand kit, referensi (tautan atau upload).
- Output: `ClientBrief { objective, audience, kpi, platforms[], budgetCapUsd, deadline, brandKitId, references[] }`.

### F2. Account Manager
- Memanggil vidIQ MCP untuk mengambil sinyal tren yang relevan dengan niche (outlier Reels/TikTok, trending, keyword).
- Output: `InternalBrief { problemStatement, insight, mandatories[], tone, deliverables[{platform, format, durationSec}], trendRefs[] }`.

### F3. Creative Director
- Menghasilkan 3 opsi konsep lalu memilih satu dengan alasan.
- Output: `CreativeBrief { bigIdea, conceptOptions[3]{title, logline, whyItWorks, hook}, chosenConcept, keyMessage, cta }`.

### F4. Art Director
- Menerjemahkan konsep menjadi arahan visual dan shot list; membuat keyframe gambar lewat Gemini bila perlu.
- Output: `VisualDirection { moodboardPrompts[], palette, typography, shotList[{shotId, durationSec, cameraMove, subject, setting, lighting, onScreenText, voLine}], styleRefImageUrls[] }`.

### F5. Producer
- Menentukan `source` per shot (`veo_api` atau `manual_upload`), resolusi, batas percobaan, dan menghitung estimasi biaya **dengan kode deterministik** (bukan LLM) dari `PriceBook`.
- Budget gate: bila estimasi melebihi `budgetCapUsd`, alur berhenti dan menunggu keputusan pengguna.
- Output: `ProductionPlan { shots[{shotId, source, resolution, maxAttempts, estCostUsd}], estCostUsd, timeline, approvalsNeeded }`.

### F6. Execution Team, tahap 1: Videographer
- Jalur `veo_api`: memanggil Gemini API (Veo). Draf memakai Lite 720p, final memakai Fast 1080p setelah approve. Hasil disimpan ke S3 sebagai `ShotAsset` versi baru.
- Jalur `manual_upload`: menghasilkan **Prompt Package** per shot (lihat F7) dan menjeda alur sampai semua slot terisi.
- Video 9:16, tiap shot sekitar 8 detik.

### F7. Mode Manual Upload
- Prompt Package per shot, ditampilkan sebagai kartu siap salin: prompt final (subjek, setting, gerak kamera, pencahayaan, gaya, rasio 9:16, durasi), dialog/VO Bahasa Indonesia dalam tanda kutip, catatan referensi (keyframe/karakter untuk dilampirkan), nama file yang diminta (mis. `kampanyeA_shot02_v1.mp4`), urutan generate dan tips konsistensi karakter.
- Upload MP4 lewat presigned URL S3, satu slot per shot dengan riwayat versi.
- Validasi otomatis (ffprobe): durasi, resolusi, rasio 9:16, keberadaan audio, ukuran file. Bila gagal, dasbor menjelaskan apa yang salah dan slot tetap terbuka.
- Pencatatan biaya jalur ini: jumlah percobaan per shot (batas `maxAttempts`), bukan dolar video.

### F8. Execution Team, tahap 2: Post-production
Video Gemini sudah ber-audio, jadi tahap ini menyempurnakan, bukan membuat suara dari nol. Sama untuk kedua jalur.
- **Transkriptor:** timestamp per kata dari audio klip (ElevenLabs Scribe atau Whisper), teks dikoreksi dengan `voLine` asli dari shot list.
- **Subtitler:** subtitle bergaya brand (warna, font, animasi kata per kata), dibakar ke video (FFmpeg ASS atau Remotion).
- **Audio Engineer:** Voice Isolator untuk membersihkan suara; opsional Voice Changer ke satu voice ID brand agar suara konsisten antar-shot; musik latar dengan ducking; normalisasi sekitar -14 LUFS.
- **Editor:** gabung klip, transisi, intro/outro logo, end card CTA.
- **Finisher:** export 1080×1920 H.264/AAC dengan moov atom di depan, thumbnail, caption dan hashtag per platform.
- Output: `RenderBundle { clips[], captions.srt, finalCut.mp4, thumbnail.jpg }`.

### F9. Account Team (QC dan paket approval)
- QC memakai Gemini multimodal: apakah visual sesuai shot list, dialog sesuai skrip, brand-safety.
- Output: `ApprovalPackage { previewUrl, captionPerPlatform, hashtags, brandSafetyChecklist, selfScore, costSoFar }`.

### F10. Approval, revisi, regenerasi
- UI: pratinjau 9:16, perbandingan versi berdampingan, tombol Approve, Revisi (catatan teks), Regenerate (pilih shot), Reject.
- Sebelum Regenerate, UI menampilkan estimasi: "regenerasi N shot × model × durasi ≈ US$X; total kampanye menjadi US$Y dari cap US$Z".
- **Routing revisi:** LLM kecil mengklasifikasikan catatan ke agen sasaran (konsep → Creative Director, visual → Art Director, edit/tempo/subtitle → Post-production). Hanya tahap itu dan setelahnya yang diulang.
- Revisi caption hanya memanggil LLM; revisi edit hanya me-render ulang tanpa menyentuh Gemini; regenerasi per shot, bukan seluruh video.
- Timeout 7 hari → `EXPIRED` dan kirim pengingat (email).
- Semua revisi menyimpan versi artefak, bisa dibandingkan dan dikembalikan tanpa biaya.

### F11. Publikasi
- **Instagram:** Graph API untuk Reels. Alur: `POST /{ig-user-id}/media` (`media_type=REELS`, `video_url` publik dari S3 presigned) → polling status container → `POST /media_publish`. Penjadwalan lewat `step.sleepUntil` karena API tidak punya parameter jadwal. Cek kuota lewat `GET /{ig-user-id}/content_publishing_limit` sebelum posting. Spesifikasi video H.264/HEVC + AAC, moov atom di depan.
- **TikTok:** Content Posting API mode upload ke inbox (draft) atau Direct Post; sebelum audit lolos semua Direct Post otomatis privat (SELF_ONLY), jadi pakai mode inbox atau Orshot Publish. Ajukan audit TikTok sejak Fase 1.
- Abstraksi `Publisher` (interface) dengan implementasi `InstagramGraphPublisher`, `TikTokInboxPublisher`, `OrshotPublisher`.
- Hasil: `PublishResult { platform, postId, permalink, status }`.

### F12. Trend Scout
- Job terjadwal harian (cron Inngest) memanggil vidIQ MCP dan menyimpan `TrendSignal { platform, url, outlierScore, hook, format, audio, capturedAt }`.
- Cache hasil di Postgres untuk menghemat kredit vidIQ yang terbatas.
- Account Manager mengambil 5 sinyal teratas yang relevan dengan niche kampanye.

### F13. Dasbor
Lima halaman dalam satu aplikasi Next.js:

| Halaman | Isi |
| --- | --- |
| Pipeline | Kanban per kampanye, status tiap agen (antre, jalan, selesai, gagal), durasi, retry, tautan artefak |
| Approval | Antrean menunggu keputusan, pratinjau, diff versi, tombol aksi dengan estimasi biaya, slot upload MP4 jalur manual |
| Biaya | Total per kampanye, provider, agen, dan alasan (awal/revisi/regenerate); burn rate bulanan vs cap; biaya per video yang disetujui; rasio regenerasi |
| Tren | Sinyal vidIQ terbaru, skor outlier, tren yang sudah dipakai jadi kampanye |
| Analitik | Views, reach, interaksi, follower, engagement rate per post dan per konsep |

Analitik Instagram: gunakan `views`, `reach`, likes, comments, saved, shares, `ig_reels_avg_watch_time`. Jangan memakai `impressions` dan `plays` (dihapus Meta sejak 21 April 2025). Analitik TikTok: Display API `/v2/video/list/` dan `/v2/video/query/` (scope `video.list`) untuk view, like, comment, share; `/v2/user/info/` (scope `user.info.stats`) untuk follower dan jumlah video. Metrik ditarik pada T+1 jam, T+24 jam, T+7 hari setelah posting. Umpan balik performa per konsep/hook/tren dikembalikan sebagai konteks untuk Creative Director.

---

## 5. Model data (Prisma, tingkat konsep)

| Entitas | Field penting |
| --- | --- |
| `BrandKit` | id, name, logoUrl, palette, fonts, voiceId, styleNotes |
| `Campaign` | id, brandKitId, clientBrief (JSON), status, budgetCapUsd, createdAt |
| `Run` | id, campaignId, inngestRunId, status, startedAt, endedAt |
| `Step` | id, runId, agentRole, status, attempt, startedAt, endedAt, error |
| `Artifact` | id, campaignId, agentRole, version, payload (JSON), costUsd, createdAt |
| `Shot` | id, campaignId, shotId, source (`veo_api` / `manual_upload`), maxAttempts, status |
| `ShotAsset` | id, shotId, version, s3Key, durationSec, hasAudio, validation (JSON), origin (`veo` / `upload`) |
| `Decision` | id, campaignId, type (`approve` / `revise` / `regenerate` / `reject`), notes, targetAgent, shotIds[], createdAt |
| `CostEntry` | id, campaignId, step, provider, model, units, unitPrice, usd, attempt, reason (`initial` / `revision` / `regenerate`) |
| `PriceBook` | provider, model, unit, unitPrice, effectiveFrom |
| `TrendSignal` | lihat F12 |
| `PublishJob` | id, campaignId, platform, status, postId, permalink, scheduledAt |
| `MetricSnapshot` | id, publishJobId, capturedAt, metrics (JSON) |

---

## 6. Kebutuhan non-fungsional

- **Keandalan:** retry per langkah, tanpa pengulangan langkah yang sudah sukses; idempotency key untuk semua panggilan berbiaya; alur harus selamat dari restart server.
- **Observabilitas:** log terstruktur per `campaignId` dan `step`; setiap kegagalan terlihat di dasbor Pipeline.
- **Keamanan:** semua kunci API (Gemini, ElevenLabs, vidIQ, Meta, TikTok, Orshot) di secret manager/env, tidak di repo; akses dasbor hanya lewat Auth0; presigned URL berumur pendek; token OAuth Meta/TikTok disimpan terenkripsi.
- **Kepatuhan:** beri label konten AI sesuai kebijakan platform; hanya musik berlisensi komersial; tidak ada scraping yang melanggar ketentuan layanan.
- **Kinerja:** pembuatan Prompt Package dan satu langkah agen teks selesai di bawah 60 detik; dasbor memuat halaman utama di bawah 2 detik pada data wajar.
- **Biaya:** semua biaya tercatat per panggilan; budget cap per kampanye dan per bulan ditegakkan di kode, bukan hanya UI.
- **Bahasa:** UI dan keluaran konten dalam Bahasa Indonesia secara default.

---

## 7. Rencana build (urut, dengan acceptance criteria)

### Fase 0 — Spike dan Mode Manual Upload (minggu 1–2)
Bangun: monorepo Next.js + Prisma + Inngest dev server; auth Auth0; form Client Brief; agen F2–F5 (output JSON); Videographer menghasilkan Prompt Package; slot upload dengan validasi ffprobe; post-production minimal (gabung klip + subtitle dengan FFmpeg); approval manual di dasbor.
Acceptance:
- [ ] Brief dikirim dan agen F2–F5 menghasilkan artefak yang lolos validasi Zod, tersimpan dengan versi.
- [ ] Prompt Package tampil sebagai kartu siap salin untuk tiap shot.
- [ ] MP4 yang tidak sesuai (bukan 9:16, tanpa audio) ditolak dengan pesan jelas.
- [ ] Setelah semua slot terisi, alur lanjut otomatis dan menghasilkan `finalCut.mp4` 1080×1920 dengan subtitle.

### Fase 1 — MVP end-to-end (minggu 3–5)
Bangun: semua agen; `PriceBook`, `CostEntry`, budget gate; loop revisi/regenerate per shot dengan routing; post-production lengkap (ElevenLabs, Voice Isolator, musik, normalisasi); jalur Veo API (Lite draf, Fast final); publikasi Instagram (Graph API) dan TikTok (inbox atau Orshot); ajukan App Review Meta dan audit TikTok.
Acceptance:
- [ ] Satu kampanye berjalan dari brief sampai post terbit di Instagram dan draft/post di TikTok tanpa intervensi selain approval.
- [ ] Estimasi biaya tampil sebelum Regenerate dan total kampanye tidak bisa melewati budget cap tanpa konfirmasi eksplisit.
- [ ] Revisi "potong lebih cepat" hanya menjalankan ulang post-production, tanpa memanggil Gemini.
- [ ] Retry setelah kegagalan tidak membuat biaya generate ganda (uji dengan menyuntikkan error).
- [ ] Menunggu approval lebih dari 7 hari mengubah status menjadi `EXPIRED` dan mengirim pengingat.

### Fase 2 — Tren dan analitik (minggu 6–8)
Bangun: Trend Scout vidIQ terjadwal dengan cache; penarikan metrik Instagram dan TikTok (T+1 jam, T+24 jam, T+7 hari); halaman Tren, Analitik, Biaya.
Acceptance:
- [ ] Halaman Tren menampilkan sinyal harian dan menandai tren yang sudah dipakai kampanye.
- [ ] Halaman Analitik menampilkan views, reach, engagement rate per post, tanpa metrik yang sudah dihapus.
- [ ] Halaman Biaya menampilkan biaya per video yang disetujui dan rasio regenerasi.

### Fase 3 — Optimasi (bulan 3 dan seterusnya)
Umpan balik performa ke Creative Director; A/B hook; evaluasi otomatis sebelum approval; dukungan multi-brand.

---

## 8. Struktur repo yang disarankan

```
mauagent/
  apps/web/                 # Next.js: dasbor, API routes, Auth0
  packages/agents/          # definisi agen, prompt, skema Zod per artefak
  packages/workflows/       # fungsi Inngest (campaign-pipeline, trend-scout, metrics)
  packages/providers/       # VideoProvider (Veo), Publisher (IG, TikTok, Orshot), ElevenLabs, vidIQ client
  packages/media/           # FFmpeg/Remotion, ffprobe validator
  packages/db/              # skema Prisma, seed PriceBook
  infra/                    # Terraform/Docker, GitHub Actions
  DECISIONS.md
```

Interface kunci:

```ts
interface VideoProvider { generate(shot: ShotSpec, opts: { tier: "draft" | "final" }): Promise<ShotAssetRef>; }
interface Publisher { publish(pkg: ApprovalPackage, account: AccountRef): Promise<PublishResult>; }
```

`VideoProvider` hanya punya satu implementasi (Veo) saat ini, tetapi tetap dibuat sebagai interface agar mudah diganti bila harga atau versi model berubah.

---

## 9. Estimasi biaya operasional (acuan anggaran)

Asumsi: 30 video per bulan, tiap video 4 shot × 8 detik, rata-rata 2 percobaan per shot.

| Komponen (USD per bulan) | Jalur Veo API | Jalur Manual Upload |
| --- | --- | --- |
| Video Veo 3.1 | 163–230 | 0 (kuota langganan) |
| LLM semua agen | 10–40 | 10–40 |
| ElevenLabs | 6–22 | 6–22 |
| vidIQ | 19–49 | 19–49 |
| Publikasi (Orshot, 2 akun) | 24 | 24 |
| Infra AWS dan Inngest | 30–100 | 30–100 |
| Total | 250–465 | 90–235 |

Catatan: langganan Google AI Plus tidak bisa dipakai memanggil Veo dari kode; jalur API ditagih terpisah. Harga vendor cepat berubah, jadi isi `PriceBook` dari halaman harga resmi saat implementasi.

---

## 10. Risiko dan pertanyaan terbuka

| Risiko/pertanyaan | Dampak | Penanganan |
| --- | --- | --- |
| Audit TikTok lama atau ditolak | Post TikTok tidak bisa publik lewat API sendiri | Pakai mode inbox/draft atau Orshot; ajukan audit sejak Fase 1 |
| App Review Meta memakan beberapa minggu | Publikasi Instagram tertunda | Uji dengan akun sendiri yang berperan di aplikasi; ajukan review sejak Fase 1 |
| Video aplikasi Gemini mungkin berwatermark, durasi per generate pendek, kuota harian terbatas | Jalur manual kurang layak untuk produksi | Cek di akun AI Plus sebelum Fase 0 selesai; gunakan jalur manual untuk validasi dan shot hero saja |
| Kredit vidIQ terbatas dan tanpa top-up | Trend Scout berhenti di tengah bulan | Cache hasil; batasi frekuensi panggilan; sumber tren cadangan manual |
| Data Instagram/TikTok vidIQ bukan dari API resmi | Sinyal tren bisa bias | Perlakukan sebagai salah satu sinyal |
| Konsistensi karakter dan suara antar-shot | Kualitas visual dan audio tidak seragam | Deskripsi karakter yang sama persis di semua prompt; Voice Changer ke satu voice ID |
| ID model Veo di Vertex dijadwalkan pensiun paling cepat 17 November 2026 | Panggilan gagal setelah pensiun | Model ID di config; pantau changelog |

Pertanyaan yang perlu dijawab pemilik produk sebelum Fase 1:
1. Apakah jalur Manual Upload hanya untuk Fase 0, atau mode permanen?
2. Akun Instagram dan TikTok mana yang jadi target awal, dan apakah sudah berjenis Business/Creator?
3. Berapa budget cap default per kampanye dan per bulan?
4. Channel pengingat approval: email saja, atau juga Telegram/WhatsApp?
