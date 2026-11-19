# NOTES.md — Keputusan desain & hal yang masih perlu diputuskan

## Fakta registry (terverifikasi live, 2026-11-19)

- Registry Agent ID (SPACE ID, BSC):
  `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- `balanceOf(0x94D09f59fEf4931B7731E2E2dd1643453Da386B1)` → **1**
  (dompet agen memegang Agent ID).
- `handleOf(0x94D09f59fEf4931B7731E2E2dd1643453Da386B1)` → **`"iyal95"`**
  — **tanpa** akhiran `.ai`. Frontend menambahkan `.ai` hanya untuk tampilan.
- Kontrak hanya memakai `balanceOf`. `handleOf` hanya dipakai frontend
  (off-chain) untuk menampilkan nama. Kontrak ini **bukan** alat pencari
  dompet berdasarkan nama — tidak ada fungsi yang menerima nama dan
  mengembalikan alamat.

## Keputusan desain

1. **Registry di-hardcode sebagai konstanta**, bukan argumen konstruktor.
   Alasannya: tidak mungkin salah konfigurasi saat deploy, tidak ada
   constructor argument saat verifikasi BscScan/Sourcify, dan alamat CREATE2
   hanya bergantung pada bytecode (bukan argumen).
2. **Tanpa pemilik/admin/upgradeability.** Kontrak tidak bisa diubah atau
   dimatikan siapa pun — ini disengaja (aturan hackathon menuntut izin owner
   diungkapkan; di sini tidak ada izin owner sama sekali).
3. **Tanpa biaya/token/pembayaran.** Membuat polling dan memilih hanya bayar
   gas. Ini menjaga adopsi (pengguna tidak perlu mengeluarkan BNB selain gas)
   dan menghindari red line "promised returns".
4. **Batas polling: 2–4 pilihan, pertanyaan ≤200 karakter, pilihan ≤80
   karakter, tenggat ≤30 hari.** Batas ini menjaga biaya gas tetap kecil
   (penyimpanan string on-chain mahal) dan UI tetap terbaca.
5. **Satu suara per alamat per polling** (mapping `voted`), bukan per nama —
   karena satu alamat hanya bisa memegang satu Agent ID, keduanya setara.
6. **Custom error, bukan require string.** Lebih murah gas-nya; frontend
   memetakan nama error DAN selector 4-byte-nya ke pesan Bahasa Indonesia
   (ethers v6 sering hanya memberi "unknown custom error" + data saat revert
   terjadi di estimasi gas — selector tetap terbaca).
7. **Salt CREATE2 = `keccak256("suara-ai-v1")`.** Deterministik dan
   terdokumentasi; kalau kontrak diubah (v2), salt harus diganti supaya
   alamat baru tidak bentrok.
8. **Frontend statis tanpa build step** (ethers v6 via CDN jsDelivr).
   Alasan: GitHub Pages dari `docs/` langsung jalan; tidak ada dependensi
   npm di repo. Mode baca bekerja tanpa dompet (RPC publik BSC).
9. **Parameter `?contract=` dan `?rpc=` di URL** — hook pengujian saja
   (mis. menguji frontend terhadap kontrak di fork lokal). Bukan fitur
   pengguna; tidak dipromosikan di UI.

## Yang sudah diverifikasi (2026-11-19)

- `forge test`: **21/21 lolos** (mock registry, di-etch ke alamat registry asli).
- Deploy percobaan di **fork lokal BSC (anvil)**: berhasil, gas 825.659,
  dari dompet agen (impersonasi lokal, tanpa private key).
- Verifikasi end-to-end dengan ethers v6 (16 cek, semua lolos): baca registry
  di **mainnet** (balanceOf=1, handleOf="iyal95"), baca/tulis di fork
  (buat polling, pilih, hitung suara, hasVoted), dan 4 kasus revert dengan
  selector custom error yang tepat.
- Frontend disajikan lokal (HTTP 200 untuk index.html + app.js), sintaks JS
  lolos `node --check`, CDN ethers 6.13.4 terverifikasi (HTTP 200).
- **Tidak diuji di browser sungguhan** (tidak ada browser di lingkungan ini):
  klik tombol, pop-up dompet, dan tampilan visual belum diklik/dilihat
  langsung. Uji manual di halaman live setelah deploy.

## Temuan saat build (penting)

1. **Alamat proxy di brief salah ketik** (38 digit hex, tidak valid). Alamat
   kanonis yang benar `0x4e59b44847b379578588920cA78FbF26c0B4956C` diambil dari
   README repo Arachnid dan diverifikasi kodenya ada di BSC. Semua
   perhitungan alamat di repo ini memakai alamat kanonis tersebut.
2. **Saldo BNB tipis adalah risiko deploy nyata.** Deploy ~833 ribu gas:
   di 0,05 gwei biayanya ~0,0000417 BNB (aman), tapi di 1 gwei biayanya
   ~0,000833 BNB — **melebihi saldo dompet agen (~0,0006784 BNB)**. Deploy
   hanya saat gas ≤0,5 gwei, atau isi saldo dulu (keputusan iyal).
3. **Fork anvil + bsc-dataseed bermasalah**: `eth_call` ke registry gagal
   dengan "missing trie node" (node upstream tidak melayani state trie).
   Beralih ke `bsc-dataseed1.binance.org` sebagai upstream fork
   menyelesaikan masalah. Kalau mengulang pengujian fork, pakai dataseed1.
4. **Anvil fork menguras saldo dompet agen (lokal)** saat pengujian
   berulang: dompet agen di fork hanya punya saldo mainnet-nya. Solusi:
   `anvil_setBalance` ke 10 ETH (lokal saja) sebelum menjalankan skrip uji.

## Hal yang masih perlu diputuskan (oleh iyal / parent)

1. **Deploy atau tidak, dan kapan** — butuh persetujuan iyal; gas harus
   ≤0,5 gwei saat deploy (lihat §3 DEPLOY.md).
2. **Distribusi: bagaimana mencapai 30 alamat Agent ID yang berinteraksi**
   (syarat Innovation Award). Ini risiko terbesar — konsepnya selesai, tapi
   tanpa 30 pengguna, entri tidak memenuhi syarat. Opsi: posting X dari
   @iyalikhsan, ajak pemegang Agent ID yang dikenal, buat polling pertama
   yang menarik (mis. polling komunitas). Bukan bagian dari build ini.
3. **Polling pertama** — siapa yang membuat polling pembuka dan tentang apa?
   Disarankan satu polling pembuka yang dibuat iyal sendiri setelah deploy
   (bukti produk live + bahan promosi).
4. **Apakah perlu fitur lanjutan?** (belum dibangun, sengaja ditunda)
   - Pencarian/filter polling — tidak perlu untuk MVP.
   - Penghapusan polling oleh pembuat — ditolak: kontrak tanpa admin.
   - Hasil polling real-time via event — frontend saat ini memuat ulang
     setelah transaksi; cukup untuk MVP.
5. **Nama repo publik**: `robiyal/suara-ai` (sesuai brief). Setelah deploy,
   isi `CONTRACT_ADDRESS` di `docs/app.js` (lihat DEPLOY.md §7).

## Status

- Kontrak: selesai, teruji, belum di-deploy.
- Alamat prediksi: `0x49d980c6716e943A9fEc8537bf4f2175A02Efae0`
- Frontend: selesai, teruji baca/tulis via fork, belum menunjuk kontrak live.
- Repo: `https://github.com/robiyal/suara-ai`
- Pages: `https://robiyal.github.io/suara-ai/` (setelah diaktifkan — lihat laporan)
- Batas submit hackathon: 9 Des 2026, 15:00 WIB.
