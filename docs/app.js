// Suara .ai — frontend (ethers v6, no build step)
// Reads work with no wallet via the public BSC RPC. Writing (create/vote)
// needs an injected wallet (Binance Wallet / MetaMask) on BNB Chain (56)
// and an Agent ID (.ai name) on the connected address.

const CONFIG = {
  RPC_URL: "https://bsc-dataseed.bnbchain.org",
  REGISTRY: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  // Alamat kontrak SuaraAI setelah di-deploy. Kosong = belum di-deploy.
  CONTRACT_ADDRESS: "",
  // Alamat CREATE2 yang diprediksi (salt keccak256("suara-ai-v1")).
  PREDICTED_ADDRESS: "0x49d980c6716e943A9fEc8537bf4f2175A02Efae0",
};

const REGISTRY_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function handleOf(address account) view returns (string)",
];

const SUARA_ABI = [
  "function pollCount() view returns (uint256)",
  "function getPoll(uint256 pollId) view returns (string question, string[] options, uint256[] votes, uint256 deadline, address creator, uint256 totalVotes)",
  "function hasVoted(uint256 pollId, address voter) view returns (bool)",
  "function createPoll(string question, string[] options, uint256 deadline) returns (uint256)",
  "function vote(uint256 pollId, uint256 option)",
  "event PollCreated(uint256 indexed pollId, address indexed creator, string question, uint256 deadline)",
  "event Voted(uint256 indexed pollId, address indexed voter, uint256 indexed option, uint256 totalVotes)",
];

const BSC_CHAIN_ID = 56;
const MAX_POLLS_SHOWN = 50;

// Alamat kontrak bisa di-override untuk pengujian: ?contract=0x...
// RPC juga bisa di-override untuk pengujian lokal: ?rpc=http://localhost:8545
const params = new URLSearchParams(location.search);
const CONTRACT =
  (params.get("contract") || CONFIG.CONTRACT_ADDRESS || "").trim();
const RPC_URL = params.get("rpc") || CONFIG.RPC_URL;

const $ = (id) => document.getElementById(id);
const readProvider = new ethers.JsonRpcProvider(RPC_URL);
const registryRead = new ethers.Contract(CONFIG.REGISTRY, REGISTRY_ABI, readProvider);
const suaraRead = CONTRACT
  ? new ethers.Contract(CONTRACT, SUARA_ABI, readProvider)
  : null;

let browserProvider = null;
let signer = null;
let account = null;
let isHolder = false;
let aiName = null;
let onBsc = false;

const nameCache = new Map(); // address (lowercase) -> ".ai" name or short address

const ERROR_ID = [
  { keys: ["NotAgentIDHolder", "0x9ed3633c"], text: "Alamat ini tidak memegang Agent ID. Hanya pemegang nama .ai yang bisa membuat polling dan memilih." },
  { keys: ["AlreadyVoted", "0x7c9a1cf9"], text: "Kamu sudah memilih di polling ini." },
  { keys: ["PollClosed", "0x5e24da25"], text: "Polling ini sudah ditutup." },
  { keys: ["InvalidOptionCount", "0x71327d98"], text: "Polling harus punya 2–4 pilihan." },
  { keys: ["InvalidQuestion", "0x81e1c048"], text: "Pertanyaan harus 1–200 karakter." },
  { keys: ["InvalidOption", "0x2a719531"], text: "Setiap pilihan harus 1–80 karakter." },
  { keys: ["InvalidDeadline", "0x769d11e4"], text: "Tenggat harus di masa depan dan paling lama 30 hari." },
  { keys: ["InvalidOptionIndex", "0x3566f12c"], text: "Pilihan tidak valid." },
  { keys: ["PollNotFound", "0xf9d6fdec"], text: "Polling tidak ditemukan." },
];

function shortAddr(addr) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function friendlyError(err) {
  // ethers v6 sering hanya memberi "unknown custom error" + data 0x... saat
  // revert terjadi di estimasi gas — jadi cocokkan nama error ATAU selector-nya.
  let hay = "";
  try {
    hay = JSON.stringify(err) || "";
  } catch (_) {}
  hay += " " + String((err && (err.reason || err.message || err.data)) || err || "");
  for (const entry of ERROR_ID) {
    if (entry.keys.some((k) => hay.includes(k))) return entry.text;
  }
  const msg = String((err && (err.reason || err.message)) || err || "");
  if (msg.includes("user rejected") || msg.includes("User denied")) {
    return "Transaksi dibatalkan di dompet.";
  }
  if (msg.includes("insufficient funds")) {
    return "Saldo BNB tidak cukup untuk gas.";
  }
  return "Terjadi kesalahan: " + msg.slice(0, 200);
}

async function resolveName(addr) {
  const key = addr.toLowerCase();
  if (nameCache.has(key)) return nameCache.get(key);
  let display = shortAddr(addr);
  try {
    const handle = await registryRead.handleOf(addr);
    if (handle) display = handle + ".ai";
  } catch (_) {
    // handleOf gagal (mis. alamat tanpa nama) — tampilkan alamat pendek.
  }
  nameCache.set(key, display);
  return display;
}

function timeLeft(deadlineSec) {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineSec - now;
  if (diff <= 0) return "Ditutup";
  const days = Math.floor(diff / 86400);
  if (days >= 1) return `Tutup dalam ${days} hari`;
  const hours = Math.floor(diff / 3600);
  if (hours >= 1) return `Tutup dalam ${hours} jam`;
  const mins = Math.max(1, Math.floor(diff / 60));
  return `Tutup dalam ${mins} menit`;
}

function deadlineDate(deadlineSec) {
  return new Date(deadlineSec * 1000).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function voteButtonState(pollId, closed, alreadyVoted) {
  if (!account) return { disabled: true, reason: "Hubungkan dompet untuk memilih." };
  if (!onBsc) return { disabled: true, reason: "Pindah ke jaringan BNB Chain untuk memilih." };
  if (!isHolder) return { disabled: true, reason: "Alamat ini tidak memegang Agent ID." };
  if (closed) return { disabled: true, reason: "Polling sudah ditutup." };
  if (alreadyVoted) return { disabled: true, reason: "Kamu sudah memilih di polling ini." };
  return { disabled: false, reason: "" };
}

async function renderPolls() {
  const list = $("pollList");
  if (!suaraRead) {
    list.innerHTML = "<p class='muted'>Belum ada polling — kontrak belum di-deploy.</p>";
    return;
  }
  list.innerHTML = "<p class='muted'>Memuat polling…</p>";
  let count;
  try {
    count = Number(await suaraRead.pollCount());
  } catch (e) {
    list.innerHTML = `<p class='error'>Gagal membaca kontrak: ${friendlyError(e)}</p>`;
    return;
  }
  if (count === 0) {
    list.innerHTML = "<p class='muted'>Belum ada polling. Jadilah yang pertama membuatnya.</p>";
    return;
  }
  list.innerHTML = "";
  const start = Math.max(0, count - MAX_POLLS_SHOWN);
  for (let id = count - 1; id >= start; id--) {
    let p;
    try {
      p = await suaraRead.getPoll(id);
    } catch (e) {
      continue;
    }
    const question = p[0];
    const options = p[1];
    const votes = p[2].map((v) => Number(v));
    const deadline = Number(p[3]);
    const creator = p[4];
    const total = Number(p[5]);
    const closed = Math.floor(Date.now() / 1000) > deadline;
    const creatorName = await resolveName(creator);
    let alreadyVoted = false;
    if (account) {
      try {
        alreadyVoted = await suaraRead.hasVoted(id, account);
      } catch (_) {}
    }

    const card = document.createElement("div");
    card.className = "card";
    const state = voteButtonState(id, closed, alreadyVoted);

    const head = document.createElement("div");
    head.className = "row";
    head.innerHTML =
      `<span class="pill ${closed ? "closed" : "open"}">${closed ? "Ditutup" : "Dibuka"}</span>` +
      `<span class="muted">${timeLeft(deadline)} · ${deadlineDate(deadline)}</span>`;
    card.appendChild(head);

    const q = document.createElement("p");
    q.className = "poll-q";
    q.textContent = question;
    card.appendChild(q);

    const meta = document.createElement("div");
    meta.className = "poll-meta";
    meta.textContent = `Dibuat oleh ${creatorName} · ${total} suara`;
    card.appendChild(meta);

    options.forEach((opt, i) => {
      const pct = total > 0 ? Math.round((votes[i] / total) * 100) : 0;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vote" + (alreadyVoted ? " voted" : "");
      btn.disabled = state.disabled;
      btn.innerHTML =
        `<span class="row"><span class="grow"></span><span class="muted">${votes[i]} suara · ${pct}%</span></span>` +
        `<span class="bar-wrap"><span class="bar" style="width:${pct}%"></span></span>`;
      btn.querySelector(".grow").textContent = opt;
      btn.addEventListener("click", () => doVote(id, i, btn));
      card.appendChild(btn);
    });

    if (state.reason) {
      const r = document.createElement("div");
      r.className = "muted";
      r.style.marginTop = "8px";
      r.textContent = state.reason;
      card.appendChild(r);
    }
    const err = document.createElement("div");
    err.className = "error";
    err.hidden = true;
    card.appendChild(err);
    card.dataset.errId = "err-" + id;
    list.appendChild(card);
  }
}

async function doVote(pollId, option, btn) {
  const card = btn.closest(".card");
  const errBox = card.querySelector(".error");
  errBox.hidden = true;
  btn.disabled = true;
  try {
    const contract = new ethers.Contract(CONTRACT, SUARA_ABI, signer);
    const tx = await contract.vote(pollId, option);
    btn.textContent = "Menunggu konfirmasi…";
    await tx.wait();
    await refreshAccountState();
    await renderPolls();
  } catch (e) {
    errBox.textContent = friendlyError(e);
    errBox.hidden = false;
    btn.disabled = false;
    await renderPolls();
  }
}

async function refreshAccountState() {
  if (!account) {
    isHolder = false;
    aiName = null;
    onBsc = false;
    return;
  }
  try {
    const net = await browserProvider.getNetwork();
    onBsc = Number(net.chainId) === BSC_CHAIN_ID;
  } catch (_) {
    onBsc = false;
  }
  try {
    const bal = await registryRead.balanceOf(account);
    isHolder = bal > 0n;
  } catch (_) {
    isHolder = false;
  }
  if (isHolder) {
    aiName = await resolveName(account);
  } else {
    aiName = null;
  }
}

function renderAccount() {
  const status = $("status");
  const line = $("accountLine");
  const btn = $("connectBtn");
  if (!account) {
    status.textContent = "Belum terhubung. Kamu tetap bisa membaca semua polling.";
    line.textContent = "";
    btn.textContent = "Hubungkan dompet";
    btn.disabled = false;
  } else {
    const netNote = onBsc ? "BNB Chain" : "bukan BNB Chain";
    status.innerHTML = "";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = isHolder
      ? `Terhubung sebagai ${aiName} `
      : `Terhubung: ${shortAddr(account)} `;
    status.appendChild(nameSpan);
    const pill = document.createElement("span");
    pill.className = "pill " + (isHolder ? "holder" : "");
    pill.textContent = isHolder ? "Pemegang Agent ID" : "Tidak punya Agent ID";
    status.appendChild(pill);
    line.textContent = `Jaringan: ${netNote} · ${shortAddr(account)}`;
    btn.textContent = "Putuskan";
    btn.disabled = false;
  }
  updateCreateForm();
}

function updateCreateForm() {
  const btn = $("createBtn");
  const reason = $("createReason");
  const form = $("createForm");
  if (!CONTRACT) {
    btn.disabled = true;
    reason.textContent = "Kontrak belum di-deploy, jadi polling belum bisa dibuat.";
    form.querySelectorAll("input, select, button").forEach((el) => {
      if (el.id !== "createBtn") el.disabled = true;
    });
    return;
  }
  form.querySelectorAll("input, select").forEach((el) => (el.disabled = false));
  $("addOptBtn").disabled = document.querySelectorAll(".optInput").length >= 4;
  $("removeOptBtn").disabled = document.querySelectorAll(".optInput").length <= 2;
  if (!account) {
    btn.disabled = true;
    reason.textContent = "Hubungkan dompet untuk membuat polling.";
  } else if (!onBsc) {
    btn.disabled = true;
    reason.textContent = "Pindah ke jaringan BNB Chain untuk membuat polling.";
  } else if (!isHolder) {
    btn.disabled = true;
    reason.textContent = "Alamat ini tidak memegang Agent ID — hanya pemegang nama .ai yang bisa membuat polling.";
  } else {
    btn.disabled = false;
    reason.textContent = `Membuat polling sebagai ${aiName}.`;
  }
}

async function connect() {
  if (!window.ethereum) {
    alert("Tidak ada dompet yang terdeteksi. Pasang Binance Wallet atau MetaMask dulu.");
    return;
  }
  try {
    browserProvider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await browserProvider.send("eth_requestAccounts", []);
    account = accounts[0];
    signer = await browserProvider.getSigner();
    await refreshAccountState();
    renderAccount();
    await renderPolls();
    window.ethereum.on("accountsChanged", async (accs) => {
      account = accs.length ? accs[0] : null;
      signer = account ? await browserProvider.getSigner() : null;
      await refreshAccountState();
      renderAccount();
      await renderPolls();
    });
    window.ethereum.on("chainChanged", async () => {
      await refreshAccountState();
      renderAccount();
      await renderPolls();
    });
  } catch (e) {
    alert(friendlyError(e));
  }
}

function disconnect() {
  account = null;
  signer = null;
  browserProvider = null;
  isHolder = false;
  aiName = null;
  onBsc = false;
  renderAccount();
  renderPolls();
}

$("connectBtn").addEventListener("click", () => {
  if (account) disconnect();
  else connect();
});

$("addOptBtn").addEventListener("click", () => {
  const box = $("optionsBox");
  const n = box.querySelectorAll(".optInput").length;
  if (n >= 4) return;
  const label = document.createElement("label");
  label.innerHTML = `Pilihan ${n + 1} <span class="hint">(maks 80 karakter)</span>`;
  const input = document.createElement("input");
  input.className = "optInput";
  input.type = "text";
  input.maxLength = 80;
  input.placeholder = `Pilihan ${["ketiga", "keempat"][n - 2] || ""}`;
  input.required = true;
  label.appendChild(input);
  box.appendChild(label);
  updateCreateForm();
});

$("removeOptBtn").addEventListener("click", () => {
  const labels = $("optionsBox").querySelectorAll("label");
  if (labels.length <= 2) return;
  labels[labels.length - 1].remove();
  updateCreateForm();
});

$("createForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const errBox = $("createError");
  const okBox = $("createOk");
  errBox.hidden = true;
  okBox.hidden = true;
  const question = $("qInput").value.trim();
  const options = [...document.querySelectorAll(".optInput")]
    .map((i) => i.value.trim())
    .filter((s) => s.length > 0);
  const days = Number($("durationSel").value);
  const deadline = Math.floor(Date.now() / 1000) + days * 86400;
  const btn = $("createBtn");
  btn.disabled = true;
  btn.textContent = "Mengirim…";
  try {
    const contract = new ethers.Contract(CONTRACT, SUARA_ABI, signer);
    const tx = await contract.createPoll(question, options, deadline);
    btn.textContent = "Menunggu konfirmasi…";
    const receipt = await tx.wait();
    okBox.textContent = "Polling dibuat. Tx: " + receipt.hash.slice(0, 18) + "…";
    okBox.hidden = false;
    $("qInput").value = "";
    document.querySelectorAll(".optInput").forEach((i) => (i.value = ""));
    await renderPolls();
  } catch (e) {
    errBox.textContent = friendlyError(e);
    errBox.hidden = false;
  } finally {
    btn.textContent = "Buat polling";
    updateCreateForm();
  }
});

// --- init ---
(function init() {
  $("contractAddr").textContent = CONTRACT || "(belum di-deploy)";
  $("bscLink").href = CONTRACT
    ? "https://bscscan.com/address/" + CONTRACT
    : "https://bscscan.com/address/" + CONFIG.PREDICTED_ADDRESS;
  if (!CONTRACT) {
    $("deployNotice").hidden = false;
    $("predictedAddr").textContent = CONFIG.PREDICTED_ADDRESS;
  }
  if (!window.ethereum) {
    $("connectBtn").disabled = true;
    $("connectBtn").textContent = "Tidak ada dompet terdeteksi";
  }
  renderAccount();
  renderPolls();
})();
