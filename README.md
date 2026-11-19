# Suara .ai — Satu nama, satu suara

Polling on-chain di BNB Chain. Hanya pemegang **Agent ID** (nama `.ai` yang
tidak bisa dipindah-tangankan) yang bisa membuat polling dan memilih — satu
nama, satu suara. Dibangun untuk **Binance Agent ID Hackathon**
(Growth Award + Innovation Award, total hadiah 60.000 USDC).

- **Kontrak:** `src/SuaraAI.sol` — tanpa biaya, tanpa token, tanpa pembayaran,
  tanpa pemilik/admin, tanpa upgradeability.
- **Frontend:** `docs/` — situs statis (ethers v6 via CDN, tanpa build step),
  disajikan lewat GitHub Pages.
- **Status:** kontrak selesai + teruji, **belum di-deploy**. Lihat `DEPLOY.md`.

## Cara kerja

1. Siapa pun bisa membaca semua polling tanpa dompet (mode baca via RPC publik BSC).
2. Pemegang Agent ID menghubungkan dompet (Binance Wallet / MetaMask) di BNB Chain.
   Frontend menampilkan nama `.ai`-nya (diambil dari registry, ditambah akhiran `.ai`).
3. Pemegang Agent ID membuat polling: pertanyaan (maks 200 karakter), 2–4 pilihan
   (maks 80 karakter tiap pilihan), tenggat maks 30 hari.
4. Pemegang Agent ID memilih — satu suara per alamat per polling. Jumlah suara
   tercatat on-chain dan tampil langsung di halaman.

Agent ID dipakai sebagai **gerbang identitas**: kontrak memeriksa
`balanceOf` di registry SPACE ID (`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`).
Nama `.ai` dipakai sebagai identitas pemilih — **bukan** untuk mencari alamat
dompet orang lain (fitur seperti itu dilarang aturan hackathon dan tidak ada
di sini).

## Struktur repo

```
src/SuaraAI.sol          Kontrak utama
test/SuaraAI.t.sol       21 tes Foundry (mock registry)
script/PredictAddress.s.sol  Menghitung alamat CREATE2 (hanya baca, tanpa broadcast)
docs/index.html          Frontend
docs/app.js              Logika frontend (ethers v6)
DEPLOY.md                Cara deploy + verifikasi (baca ini sebelum deploy)
NOTES.md                 Keputusan desain + hal yang masih perlu diputuskan
```

## Pengembangan

```shell
forge build
forge test            # 21 tes, harus lolos semua
```

Frontend lokal:

```shell
cd docs && python3 -m http.server 8931
# buka http://localhost:8931/
# Untuk menguji dengan kontrak di fork lokal:
# http://localhost:8931/?rpc=http://localhost:8545&contract=0x...
```

## Lisensi

MIT — lihat `LICENSE`.
