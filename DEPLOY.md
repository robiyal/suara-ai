# DEPLOY.md — Cara men-deploy Suara .ai ke BNB Chain

> **Belum di-deploy.** Dokumen ini menyiapkan semuanya; deploy dilakukan
> parent (Muse) setelah persetujuan iyal. Tidak ada langkah di sini yang
> me-broadcast apa pun — semua perintah di bawah adalah preview / baca saja,
> kecuali `baw contract-call execute` yang memang mengeksekusi.

## 0. Ringkasan

| Item | Nilai |
|---|---|
| Kontrak | `SuaraAI` (`src/SuaraAI.sol`, Solidity ^0.8.20, dikompilasi solc 0.8.26, optimizer on, runs 200) |
| Chain | BNB Chain (chain id 56) |
| Deployer (dompet agen) | `0x94D09f59fEf4931B7731E2E2dd1643453Da386B1` |
| Metode deploy | CREATE2 via deterministic deployment proxy (Arachnid) |
| Alamat proxy | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Salt | `keccak256("suara-ai-v1")` = `0xff83bfff9c0b0ecf795562790fd8f86daef1b4305d7fe4d27868e553ebf277b2` |
| **Alamat kontrak yang diprediksi** | **`0x49d980c6716e943A9fEc8537bf4f2175A02Efae0`** |
| Bytecode (creation) | 3.600 byte — `out/SuaraAI.sol/SuaraAI.json` (field `bytecode.object`) |
| ABI | `out/SuaraAI.sol/SuaraAI.json` (field `abi`) |
| Estimasi gas deploy | **833.379 gas** (eth_estimateGas, 2026-11-19) |
| Biaya deploy @ 0,05 gwei | **~0,0000417 BNB** |
| Saldo dompet agen | ~0,0006784 BNB (cek ulang sebelum deploy) |

## 1. Koreksi alamat proxy (penting)

Alamat proxy yang tertulis di brief awal,
`0x4e59b44847b379578588920cA78FbF26c0B3B3`, **tidak valid** — hanya 38 digit
hex, dan `cast` menolaknya (`invalid string length`). Alamat kanonis yang
benar, dari README repo
[Arachnid/deterministic-deployment-proxy](https://github.com/Arachnid/deterministic-deployment-proxy),
adalah:

```
0x4e59b44847b379578588920cA78FbF26c0B4956C
```

Keberadaan kodenya di BSC sudah diverifikasi live (2026-11-19):

```shell
cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url https://bsc-dataseed.bnbchain.org
# 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3...
```

Bytecode ini sama dengan init code proxy di README repo tersebut. **Semua
perhitungan alamat di dokumen ini memakai alamat kanonis di atas.** Jika
alamat prediksi tidak cocok saat preview, berhenti — jangan deploy ke alamat
lain tanpa menghitung ulang.

## 2. Alamat yang diprediksi (sudah dihitung 3×, hasilnya sama)

Dihitung dengan dua cara independen yang hasilnya cocok:

```shell
# Cara 1 — Foundry script (hanya baca, tanpa broadcast)
forge script script/PredictAddress.s.sol

# Cara 2 — cast
BYTECODE=$(forge inspect SuaraAI bytecode)
cast create2 --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --salt 0xff83bfff9c0b0ecf795562790fd8f86daef1b4305d7fe4d27868e553ebf277b2 \
  --init-code "$BYTECODE"
# -> 0x49d980c6716e943A9fEc8537bf4f2175A02Efae0
```

> **Peringatan:** alamat ini hanya benar jika bytecode persis sama dengan
> yang dikompilasi di repo ini (solc 0.8.26, optimizer on, runs 200). Kalau
> kontrak diubah lalu dikompilasi ulang, hitung ulang alamatnya dengan
> `forge script script/PredictAddress.s.sol` sebelum deploy.

## 3. Peringatan gas — baca dulu

Saldo dompet agen tipis (~0,0006784 BNB). Deploy 833.379 gas:

| Harga gas | Biaya deploy | Cukup? |
|---|---|---|
| 0,05 gwei (saat ini) | ~0,0000417 BNB | Ya (~16× lipat) |
| 0,5 gwei | ~0,000417 BNB | Ya |
| 1 gwei | ~0,000833 BNB | **Tidak — melebihi saldo** |

**Aturan:** jalankan deploy hanya saat harga gas BSC ≤ 0,5 gwei, dan periksa
angka biaya di hasil `preview` sebelum `execute`. Kalau harga gas sedang
tinggi, tunggu sampai turun — atau isi dulu saldo BNB dompet agen (di luar
ruang lingkup dokumen ini; perlu keputusan iyal). Jangan menaikkan gas limit
di luar kebutuhan: `gasLimit 1000000` sudah memberi margin ~20% di atas
estimasi.

## 4. Deploy via baw (jalur utama)

`baw` tidak punya perintah deploy — deploy dilakukan sebagai contract call
biasa ke proxy: calldata = **salt 32 byte + init code**. Value 0 (tanpa BNB).

```shell
cd ~/workspace/suara-ai
BAW=~/workspace/baw-cli/node_modules/.bin/baw
BYTECODE=$(forge inspect SuaraAI bytecode)
SALT=ff83bfff9c0b0ecf795562790fd8f86daef1b4305d7fe4d27868e553ebf277b2
INPUT="0x${SALT}${BYTECODE#0x}"
# INPUT harus 3.632 byte: ${#INPUT} = 7266 karakter (termasuk "0x")

# Langkah 1 — PREVIEW (tidak broadcast; periksa biaya + alamat hasil di output)
$BAW contract-call preview --binanceChainId 56 \
  --from 0x94D09f59fEf4931B7731E2E2dd1643453Da386B1 \
  --to 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --value 0 --inputData "$INPUT" --gasLimit 1000000 --json

# Langkah 2 — EXECUTE (hanya setelah preview dicek dan disetujui iyal)
$BAW contract-call execute --requestId <requestId dari preview> --json
```

Setelah execute berhasil, verifikasi alamat hasil:

```shell
cast code 0x49d980c6716e943A9fEc8537bf4f2175A02Efae0 --rpc-url https://bsc-dataseed.bnbchain.org
# harus mengembalikan bytecode (bukan 0x)

cast call 0x49d980c6716e943A9fEc8537bf4f2175A02Efae0 "pollCount()(uint256)" --rpc-url https://bsc-dataseed.bnbchain.org
# harus 0
```

## 5. Fallback — deploy via Remix (kalau jalur baw gagal)

Kalau `baw contract-call` tidak bisa dipakai (mis. sesi habis atau preview
gagal berulang):

1. Buka [remix.ethereum.org](https://remix.ethereum.org), buat file
   `SuaraAI.sol`, tempel isi `src/SuaraAI.sol`.
2. Compile dengan solc **0.8.26**, optimizer **on**, runs **200**.
3. Hubungkan **dompet iyal sendiri** (Binance Wallet / MetaMask) di BNB Chain —
   jangan pernah memasukkan seed/private key ke Remix atau ke mana pun.
4. Deploy dengan **"Deploy" biasa** (bukan CREATE2) — alamat hasil akan
   berbeda dari prediksi di atas (alamat CREATE biasa dari nonce dompet).
   Catat alamat hasil deploy dan pakai alamat itu untuk langkah 6–7.
5. Alternatif CREATE2 di Remix: deploy via proxy dengan calldata yang sama
   seperti §4 (salt + init code) — alamat hasil sama dengan prediksi.

## 6. Verifikasi kontrak (wajib — syarat hackathon)

### Opsi A — Sourcify via forge (diutamakan)

```shell
cd ~/workspace/suara-ai
forge verify-contract --chain-id 56 --verifier sourcify \
  0x49d980c6716e943A9fEc8537bf4f2175A02Efae0 \
  src/SuaraAI.sol:SuaraAI
```

### Opsi B — BscScan UI

1. Buka `https://bscscan.com/address/0x49d980c6716e943A9fEc8537bf4f2175A02Efae0#code`
   → **Verify & Publish**.
2. Compiler type: Solidity (Single file). Compiler: **v0.8.26**.
   Optimization: **Yes, 200 runs**. License: **MIT**.
3. Tempel isi `src/SuaraAI.sol`. **Tidak ada constructor argument**
   (alamat registry di-hardcode sebagai konstanta, bukan argumen konstruktor).
4. EVM version: default (Cancun untuk solc 0.8.26).

Cek hasil: halaman kontrak BscScan harus menampilkan centang hijau
"Contract Source Code Verified" dan tab **Read Contract** menampilkan
`pollCount`, `getPoll`, `hasVoted`, `REGISTRY`.

## 7. Setelah deploy — sambungkan frontend

1. Isi alamat kontrak di `docs/app.js`:
   `CONTRACT_ADDRESS: "0x49d980c6716e943A9fEc8537bf4f2175A02Efae0"`
   (atau alamat hasil deploy kalau memakai fallback Remix).
2. Commit + push ke `main` — GitHub Pages (sumber `docs/`) terbit otomatis.
3. Uji di halaman live: buat satu polling percobaan dari dompet agen
   (iyal95.ai), pilih satu suara, pastikan jumlahnya tampil.
4. Catat alamat kontrak final di `NOTES.md` dan di laporan submit.

## 8. Submit hackathon (dilakukan parent, bukan di sini)

Entri butuh: nama proyek (**Suara .ai**), website (URL GitHub Pages),
alamat kontrak, dan deskripsi pemakaian Agent ID. Deskripsi yang disarankan:

> Suara .ai adalah polling on-chain di BNB Chain. Hanya alamat yang memegang
> Agent ID (nama .ai non-transferable dari registry SPACE ID) yang bisa
> membuat polling dan memilih, satu suara per alamat per polling. Kontrak
> memeriksa balanceOf di registry Agent ID; nama .ai dipakai sebagai
> identitas pemilih, bukan untuk mencari alamat dompet orang lain.

Batas submit: **9 Desember 2026, 15:00 WIB**. Innovation Award butuh
**≥30 alamat Agent ID berinteraksi** dengan kontrak selama periode lomba —
distribusi/promosinya fase terpisah setelah deploy.
