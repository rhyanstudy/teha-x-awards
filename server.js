// Teha X Awards — cerimônia Node sem dependências.
// Senha da mesa: TEHAX_ADMIN_PASSWORD, .env, ou "gloria-eterna".
// Trilha: public/audio/horn-of-plenty.mp3
// Mídia dos indicados: data/media + store.media

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ACTS, EDITION, allCategories, categoryById } from "./ceremony.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DATA_PATH = path.join(DATA_DIR, "store.json");
const MEDIA_DIR = path.join(DATA_DIR, "media");

const PHOTO_MAX = 2_000_000;
const AUDIO_MAX = 900_000;
const AUDIO_MAX_MS = 15_500;
const BODY_JSON_MAX = 120_000;
const UPLOAD_MAX = 2_200_000;

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadEnv();
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const parsedPort = Number(process.env.PORT);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 4173;
const ADMIN_PASSWORD = process.env.TEHAX_ADMIN_PASSWORD || "gloria-eterna";

if (ADMIN_PASSWORD.length < 4) {
  console.error("A senha da mesa precisa ter ao menos 4 caracteres.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const AUDIO = new Set([".mp3", ".ogg", ".wav", ".m4a"]);
const adminSessions = new Map();
const fails = new Map();

function emptyStore(keepMedia = {}) {
  return { votingOpen: false, voters: {}, ballots: {}, media: keepMedia };
}

function load() {
  if (!fs.existsSync(DATA_PATH)) return emptyStore();
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!data || typeof data !== "object") throw new Error("shape");
    if (!data.voters || typeof data.voters !== "object") data.voters = {};
    if (!data.ballots || typeof data.ballots !== "object") data.ballots = {};
    if (!data.media || typeof data.media !== "object") data.media = {};
    if (typeof data.votingOpen !== "boolean") data.votingOpen = false;
    return data;
  } catch {
    try {
      fs.renameSync(DATA_PATH, `${DATA_PATH}.corrupt-${Date.now()}`);
    } catch {
      /* urna ilegível */
    }
    console.error("A urna estava ilegível e foi arquivada.");
    return emptyStore();
  }
}

let store = load();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.rmSync(DATA_PATH, { force: true });
  fs.renameSync(tmp, DATA_PATH);
}

function trackReady() {
  return fs.existsSync(path.join(PUBLIC_DIR, "audio", "horn-of-plenty.mp3"));
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  };
}

function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  res.end(body);
}

function notFound(req, res) {
  const body = Buffer.from("Não encontrado.", "utf8");
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function bearer(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (status) => {
      if (settled) return;
      settled = true;
      const error = new Error("body");
      error.status = status;
      reject(error);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        fail(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", () => fail(400));
  });
}

async function readJson(req) {
  const raw = await readRaw(req, BODY_JSON_MAX);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    const error = new Error("json");
    error.status = 400;
    throw error;
  }
}

function cleanName(input) {
  const name = String(input || "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 32) return null;
  if (/[<>]/.test(name)) return null;
  if (!/[\p{L}\p{N}]/u.test(name)) return null;
  return name;
}

function nameKey(name) {
  return name.toLocaleLowerCase("pt-BR");
}

function mediaKey(categoryId, nominee) {
  return `${categoryId}::${nominee}`;
}

function mediaStamp(categoryId, nominee) {
  return crypto.createHash("sha1").update(mediaKey(categoryId, nominee)).digest("hex").slice(0, 16);
}

function sniffKind(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: "photo", ext: ".jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { kind: "photo", ext: ".png", mime: "image/png" };
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { kind: "photo", ext: ".webp", mime: "image/webp" };
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0x49 &&
    buf[1] === 0x44 &&
    buf[2] === 0x33
  ) {
    return { kind: "audio", ext: ".mp3", mime: "audio/mpeg" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { kind: "audio", ext: ".mp3", mime: "audio/mpeg" };
  }
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS") {
    return { kind: "audio", ext: ".ogg", mime: "audio/ogg" };
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  ) {
    return { kind: "audio", ext: ".wav", mime: "audio/wav" };
  }
  if (buf.length >= 8 && buf.toString("ascii", 4, 8) === "ftyp") {
    return { kind: "audio", ext: ".m4a", mime: "audio/mp4" };
  }
  return null;
}

function publicMediaMap() {
  const map = {};
  for (const [key, entry] of Object.entries(store.media || {})) {
    if (!entry || typeof entry !== "object") continue;
    const item = {};
    if (entry.photo) item.photo = `/media/${entry.photo}`;
    if (entry.audio) {
      item.audio = `/media/${entry.audio}`;
      if (entry.audioMs) item.audioMs = entry.audioMs;
    }
    if (item.photo || item.audio) map[key] = item;
  }
  return map;
}

function unlinkQuiet(file) {
  if (!file) return;
  try {
    fs.unlinkSync(path.join(MEDIA_DIR, file));
  } catch {
    /* arquivo já ausente */
  }
}

function voterByToken(token) {
  if (!token) return null;
  return Object.values(store.voters).find((voter) => voter.token === token) || null;
}

function voterByKey(key) {
  return Object.values(store.voters).find((voter) => voter.nameKey === key) || null;
}

function cleanVotes(voterId) {
  const raw = store.ballots[voterId] || {};
  const votes = {};
  for (const category of allCategories()) {
    if (category.nominees.includes(raw[category.id])) votes[category.id] = raw[category.id];
  }
  return votes;
}

function publicBallot(voter) {
  return {
    edition: EDITION,
    voter: { name: voter.name },
    votingOpen: store.votingOpen,
    acts: ACTS,
    votes: cleanVotes(voter.id),
    media: publicMediaMap(),
  };
}

function mediaStudio() {
  return allCategories().map((category) => ({
    id: category.id,
    title: category.title,
    actTitle: category.actTitle,
    featured: Boolean(category.featured),
    nominees: category.nominees.map((name) => {
      const entry = store.media[mediaKey(category.id, name)] || {};
      return {
        name,
        photo: entry.photo ? `/media/${entry.photo}` : null,
        audio: entry.audio ? `/media/${entry.audio}` : null,
        audioMs: entry.audioMs || null,
      };
    }),
  }));
}

function buildOverview() {
  const categories = allCategories();
  const voters = Object.values(store.voters).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const slips = voters.map((voter) => {
    const ballot = store.ballots[voter.id] || {};
    const choices = categories.map((category) => ({
      id: category.id,
      title: category.title,
      choice: category.nominees.includes(ballot[category.id]) ? ballot[category.id] : null,
    }));
    return {
      id: voter.id,
      name: voter.name,
      createdAt: voter.createdAt,
      voted: choices.filter((choice) => choice.choice).length,
      total: categories.length,
      choices,
    };
  });
  const categoryResults = categories.map((category) => {
    const rows = category.nominees.map((name) => ({
      name,
      votes: slips.filter((slip) => slip.choices.find((choice) => choice.id === category.id)?.choice === name).length,
    }));
    const max = rows.reduce((best, row) => Math.max(best, row.votes), 0);
    return {
      id: category.id,
      title: category.title,
      actId: category.actId,
      actTitle: category.actTitle,
      featured: Boolean(category.featured),
      tie: rows.filter((row) => row.votes === max && max > 0).length > 1,
      rows: rows.map((row) => ({ ...row, lead: max > 0 && row.votes === max })),
    };
  });
  const mediaEntries = Object.values(store.media || {});
  return {
    edition: EDITION,
    votingOpen: store.votingOpen,
    trackReady: trackReady(),
    categoryCount: categories.length,
    voterCount: slips.length,
    complete: slips.filter((slip) => slip.voted === categories.length).length,
    mediaPhotos: mediaEntries.filter((entry) => entry?.photo).length,
    mediaAudios: mediaEntries.filter((entry) => entry?.audio).length,
    voters: slips,
    categories: categoryResults,
    studio: mediaStudio(),
  };
}

function clientIp(req) {
  return req.socket?.remoteAddress || "local";
}

function failState(ip) {
  const now = Date.now();
  let row = fails.get(ip);
  if (!row || now > row.reset) {
    row = { n: 0, reset: now + 10 * 60 * 1000 };
    fails.set(ip, row);
  }
  return row;
}

function sameSecret(input, secret) {
  const left = crypto.createHash("sha256").update(String(input), "utf8").digest();
  const right = crypto.createHash("sha256").update(String(secret), "utf8").digest();
  return crypto.timingSafeEqual(left, right);
}

function issueAdmin() {
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  return token;
}

function adminOk(req) {
  const token = bearer(req);
  const expires = adminSessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) adminSessions.delete(token);
    return false;
  }
  adminSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  return true;
}

function requireAdmin(req, res) {
  if (adminOk(req)) return true;
  send(res, 401, { error: "A mesa não reconheceu a sessão." });
  return false;
}

function normalizeWord(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let start = buf.indexOf(delim);
  while (start !== -1) {
    const after = start + delim.length;
    if (buf[after] === 45 && buf[after + 1] === 45) break;
    let contentStart = buf.indexOf("\r\n\r\n", after);
    if (contentStart === -1) break;
    contentStart += 4;
    const next = buf.indexOf(delim, contentStart);
    if (next === -1) break;
    let contentEnd = next - 2;
    if (contentEnd < contentStart) contentEnd = contentStart;
    const header = buf.slice(after, contentStart - 4).toString("utf8");
    const body = buf.slice(contentStart, contentEnd);
    const nameMatch = /name="([^"]+)"/i.exec(header);
    const fileMatch = /filename="([^"]*)"/i.exec(header);
    if (nameMatch) {
      const name = nameMatch[1];
      if (fileMatch) {
        files[name] = {
          filename: path.basename(fileMatch[1] || "upload"),
          data: body,
        };
      } else {
        fields[name] = body.toString("utf8");
      }
    }
    start = next;
  }
  return { fields, files };
}

function enter(req, res, body) {
  const name = cleanName(body.name);
  if (!name) return send(res, 400, { error: "Use um nome de 2 a 32 caracteres." });
  const token = String(body.token || "") || bearer(req);
  const existing = voterByKey(nameKey(name));
  if (existing) {
    if (existing.token === token) {
      return send(res, 200, { token: existing.token, ...publicBallot(existing) });
    }
    return send(res, 409, {
      error: "Esse nome já está na cerimônia. Volte pelo mesmo aparelho ou peça à mesa para liberar o nome.",
    });
  }
  if (Object.keys(store.voters).length >= 500) {
    return send(res, 403, { error: "A cerimônia chegou ao limite de cédulas." });
  }
  const voter = {
    id: crypto.randomUUID(),
    name,
    nameKey: nameKey(name),
    token: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  store.voters[voter.id] = voter;
  store.ballots[voter.id] = {};
  persist();
  return send(res, 201, { token: voter.token, ...publicBallot(voter) });
}

function currentBallot(req, res) {
  const voter = voterByToken(bearer(req));
  if (!voter) return send(res, 401, { error: "Sem cédula." });
  return send(res, 200, { token: voter.token, ...publicBallot(voter) });
}

function vote(req, res, body) {
  const voter = voterByToken(bearer(req));
  if (!voter) return send(res, 401, { error: "Sem cédula." });
  if (!store.votingOpen) return send(res, 423, { error: "A urna ainda está lacrada." });
  const category = categoryById(String(body.categoryId || ""));
  if (!category) return send(res, 400, { error: "Categoria inexistente." });
  const candidate = String(body.candidate || "");
  if (!category.nominees.includes(candidate)) return send(res, 400, { error: "Indicado fora da cédula." });
  if (!store.ballots[voter.id]) store.ballots[voter.id] = {};
  store.ballots[voter.id][category.id] = candidate;
  persist();
  return send(res, 200, { ok: true, votes: cleanVotes(voter.id) });
}

function adminLogin(req, res, body) {
  const ip = clientIp(req);
  if (failState(ip).n >= 8) {
    return send(res, 429, { error: "Muitas tentativas. Espere alguns minutos." });
  }
  if (!sameSecret(body.password || "", ADMIN_PASSWORD)) {
    failState(ip).n += 1;
    return send(res, 401, { error: "Senha recusada." });
  }
  fails.delete(ip);
  return send(res, 200, { token: issueAdmin() });
}

function setVoting(req, res, body) {
  if (!requireAdmin(req, res)) return;
  if (typeof body.open !== "boolean") return send(res, 400, { error: "Pedido inválido." });
  store.votingOpen = body.open;
  persist();
  return send(res, 200, { overview: buildOverview() });
}

function resetVotes(req, res, body) {
  if (!requireAdmin(req, res)) return;
  if (normalizeWord(body.confirm) !== "ZERAR") {
    return send(res, 400, { error: "Digite ZERAR para confirmar." });
  }
  store.ballots = {};
  for (const id of Object.keys(store.voters)) store.ballots[id] = {};
  persist();
  return send(res, 200, { overview: buildOverview() });
}

function restart(req, res, body) {
  if (!requireAdmin(req, res)) return;
  if (normalizeWord(body.confirm) !== "RECOMECAR") {
    return send(res, 400, { error: "Digite RECOMECAR para confirmar." });
  }
  store = emptyStore(store.media || {});
  persist();
  return send(res, 200, { overview: buildOverview() });
}

function release(req, res, body) {
  if (!requireAdmin(req, res)) return;
  const id = String(body.id || "");
  if (!store.voters[id]) return send(res, 404, { error: "Cédula não encontrada." });
  delete store.voters[id];
  delete store.ballots[id];
  persist();
  return send(res, 200, { overview: buildOverview() });
}

function clearMediaEntry(key, which) {
  const entry = store.media[key];
  if (!entry) return;
  if (!which || which === "photo") {
    unlinkQuiet(entry.photo);
    delete entry.photo;
  }
  if (!which || which === "audio") {
    unlinkQuiet(entry.audio);
    delete entry.audio;
    delete entry.audioMs;
  }
  if (!entry.photo && !entry.audio) delete store.media[key];
  else store.media[key] = entry;
}

function removeMedia(req, res, body) {
  if (!requireAdmin(req, res)) return;
  const category = categoryById(String(body.categoryId || ""));
  const nominee = String(body.nominee || "");
  if (!category || !category.nominees.includes(nominee)) {
    return send(res, 400, { error: "Indicado inválido." });
  }
  const which = body.which === "photo" || body.which === "audio" ? body.which : null;
  clearMediaEntry(mediaKey(category.id, nominee), which);
  persist();
  return send(res, 200, { overview: buildOverview() });
}

async function uploadMedia(req, res) {
  if (!requireAdmin(req, res)) return;
  const type = String(req.headers["content-type"] || "");
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!match) return send(res, 400, { error: "Envie um formulário multipart." });
  const boundary = (match[1] || match[2] || "").trim();
  if (!boundary) return send(res, 400, { error: "Boundary inválido." });
  const raw = await readRaw(req, UPLOAD_MAX);
  const { fields, files } = parseMultipart(raw, boundary);
  const category = categoryById(String(fields.categoryId || ""));
  const nominee = String(fields.nominee || "");
  const want = String(fields.kind || "");
  const file = files.file;
  if (!category || !category.nominees.includes(nominee)) {
    return send(res, 400, { error: "Indicado inválido." });
  }
  if (want !== "photo" && want !== "audio") {
    return send(res, 400, { error: "Use kind=photo ou kind=audio." });
  }
  if (!file || !file.data?.length) return send(res, 400, { error: "Arquivo ausente." });
  const sniffed = sniffKind(file.data);
  if (!sniffed || sniffed.kind !== want) {
    return send(res, 400, {
      error: want === "photo"
        ? "Use JPG, PNG ou WEBP."
        : "Use MP3, OGG, WAV ou M4A.",
    });
  }
  if (want === "photo" && file.data.length > PHOTO_MAX) {
    return send(res, 413, { error: "Foto grande demais (máx. 2 MB)." });
  }
  if (want === "audio" && file.data.length > AUDIO_MAX) {
    return send(res, 413, { error: "Áudio grande demais (máx. 900 KB)." });
  }
  let audioMs = null;
  if (want === "audio") {
    const parsedMs = Number(fields.audioMs);
    if (!Number.isFinite(parsedMs) || parsedMs <= 0 || parsedMs > AUDIO_MAX_MS) {
      return send(res, 400, { error: "A defesa deve ter no máximo 15 segundos." });
    }
    audioMs = Math.round(parsedMs);
  }
  const key = mediaKey(category.id, nominee);
  const stamp = mediaStamp(category.id, nominee);
  const filename = `${want}-${stamp}${sniffed.ext}`;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  clearMediaEntry(key, want);
  if (!store.media[key]) store.media[key] = {};
  fs.writeFileSync(path.join(MEDIA_DIR, filename), file.data);
  if (want === "photo") store.media[key].photo = filename;
  else {
    store.media[key].audio = filename;
    store.media[key].audioMs = audioMs;
  }
  persist();
  return send(res, 200, { overview: buildOverview() });
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/admin/media" && req.method === "POST") {
    return uploadMedia(req, res);
  }
  const body = req.method === "GET" || req.method === "HEAD" ? {} : await readJson(req);
  if (pathname === "/api/session" && req.method === "POST") return enter(req, res, body);
  if (pathname === "/api/session" && req.method === "GET") return currentBallot(req, res);
  if (pathname === "/api/votes" && req.method === "POST") return vote(req, res, body);
  if (pathname === "/api/admin/login" && req.method === "POST") return adminLogin(req, res, body);
  if (pathname === "/api/admin/overview" && req.method === "GET") {
    return requireAdmin(req, res) && send(res, 200, buildOverview());
  }
  if (pathname === "/api/admin/voting" && req.method === "POST") return setVoting(req, res, body);
  if (pathname === "/api/admin/reset" && req.method === "POST") return resetVotes(req, res, body);
  if (pathname === "/api/admin/restart" && req.method === "POST") return restart(req, res, body);
  if (pathname === "/api/admin/release" && req.method === "POST") return release(req, res, body);
  if (pathname === "/api/admin/media/delete" && req.method === "POST") return removeMedia(req, res, body);
  return send(res, 404, { error: "Não encontrado." });
}

function cacheControl(ext, fromMedia) {
  if (fromMedia) return "public, max-age=3600";
  if (ext === ".html" || ext === ".js" || ext === ".css" || AUDIO.has(ext)) return "no-cache";
  return "public, max-age=86400";
}

function serveFile(req, res, full, stat, fromMedia = false) {
  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl(ext, fromMedia),
    ...securityHeaders(),
  };
  const range = req.headers.range;
  if (range && AUDIO.has(ext)) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start <= end && end < stat.size) {
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["Content-Length"] = end - start + 1;
        res.writeHead(206, headers);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(full, { start, end }).pipe(res);
        return;
      }
    }
  }
  headers["Content-Length"] = stat.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(full).pipe(res);
}

function safeJoin(root, pathname) {
  const full = path.resolve(root, `.${pathname}`);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function serveStatic(req, res, pathname) {
  const full = safeJoin(PUBLIC_DIR, pathname);
  if (!full) return send(res, 403, { error: "Acesso recusado." });
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return notFound(req, res);
  }
  if (!stat.isFile()) return notFound(req, res);
  return serveFile(req, res, full, stat);
}

function serveMedia(req, res, pathname) {
  const name = path.basename(pathname.slice("/media/".length));
  if (!name || name !== pathname.slice("/media/".length) || name.includes("..")) {
    return send(res, 400, { error: "Mídia inválida." });
  }
  if (!/^(photo|audio)-[a-f0-9]{16}\.(jpg|png|webp|mp3|ogg|wav|m4a)$/i.test(name)) {
    return notFound(req, res);
  }
  const full = path.join(MEDIA_DIR, name);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return notFound(req, res);
  }
  if (!stat.isFile()) return notFound(req, res);
  return serveFile(req, res, full, stat, true);
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, { error: "Endereço inválido." });
  }
  if (pathname === "/favicon.ico") pathname = "/logo.png";
  if (pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD") {
      return send(res, 405, { error: "Método não aceito." });
    }
    return handleApi(req, res, pathname);
  }
  if (pathname.startsWith("/media/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { error: "Método não aceito." });
    }
    return serveMedia(req, res, pathname);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { error: "Método não aceito." });
  }
  if (pathname === "/") pathname = "/index.html";
  return serveStatic(req, res, pathname);
}

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const net of entries || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (v4 && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent || res.writableEnded) return;
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    const message =
      status === 413 ? "Pedido grande demais." : status === 400 ? "Pedido inválido." : "A cerimônia tropeçou.";
    send(res, status, { error: message });
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`A porta ${PORT} já está em uso.`);
  else console.error(error);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log(`Teha X Awards · ${EDITION}`);
  console.log(`Local:  http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) console.log(`Rede:   ${url}`);
  console.log(`Urna:   ${store.votingOpen ? "aberta" : "lacrada"}`);
  if (process.env.TEHAX_ADMIN_PASSWORD) console.log("Mesa:   senha carregada do ambiente");
  else console.log("Mesa:   senha padrão gloria-eterna");
  if (trackReady()) console.log("Trilha: public/audio/horn-of-plenty.mp3");
  else console.log("Trilha: coloque o instrumental em public/audio/horn-of-plenty.mp3");
  console.log("");
});
