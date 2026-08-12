/*
 * 今天你拉了吗？ — 真搭子后端（MVP）
 * 仅做匿名配对 + 脱敏状态中转 + 互踩吐槽转发；不存储任何原始排便记录。
 * 内存存储，进程重启即清空（隐私友好，MVP 足够）。
 *
 * 启动：node server.js  （PORT 默认 3000）
 * 前端用同源相对路径 /api/* 调用，因此本服务同时 serve 前端静态资源。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/* ---------- 内存状态（MVP：不持久化） ---------- */
const waitingPool = [];          // [{ uid, status, ts }]
const pairs = new Map();         // code -> { uid, status }
const uidToCode = new Map();     // uid  -> { myCode, buddyCode }
const stomps = new Map();        // toCode -> [{ from, text, ts }]
const POOL_TTL = 60 * 1000;      // 等待者 60s 超时

function genCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return '神秘便友#' + n;
}
function sweepPool() {
  const t = Date.now();
  for (let i = waitingPool.length - 1; i >= 0; i--) {
    if (t - waitingPool[i].ts > POOL_TTL) waitingPool.splice(i, 1);
  }
}
setInterval(sweepPool, 15000);

/* ---------- 工具 ---------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', c => {
      data += c; size += c.length;
      if (size > 1e5) { req.destroy(); reject(new Error('body too big')); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
/* 只放行脱敏公开字段，杜绝任何原始记录进入服务端 */
function sanitizeStatus(s) {
  s = s || {};
  return {
    streak: Number.isFinite(s.streak) ? Math.max(0, Math.min(9999, s.streak | 0)) : 0,
    todayChecked: !!s.todayChecked,
    shape: (Number.isFinite(s.shape) && s.shape >= 1 && s.shape <= 7) ? (s.shape | 0) : null,
    achievement: !!s.achievement
  };
}

/* ---------- API 路由 ---------- */
async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  try {
    /* 入池 / 配对 */
    if (url === '/api/match' && req.method === 'POST') {
      const b = await readBody(req);
      const uid = String(b.uid || '').slice(0, 64);
      if (!uid) return sendJSON(res, 400, { error: 'uid required' });
      sweepPool();
      // 已配对：直接返回现有搭子
      if (uidToCode.has(uid)) {
        const { myCode, buddyCode } = uidToCode.get(uid);
        const bp = pairs.get(buddyCode);
        return sendJSON(res, 200, { paired: true, buddy: { code: buddyCode, status: bp ? bp.status : null }, myCode: myCode });
      }
      // 从等待池找另一个人配对
      const idx = waitingPool.findIndex(w => w.uid !== uid);
      if (idx >= 0) {
        const other = waitingPool.splice(idx, 1)[0];
        const myCode = genCode();
        const buddyCode = genCode();
        pairs.set(myCode, { uid, status: sanitizeStatus(b.status) });
        pairs.set(buddyCode, { uid: other.uid, status: sanitizeStatus(other.status) });
        uidToCode.set(uid, { myCode, buddyCode });
        uidToCode.set(other.uid, { myCode: buddyCode, buddyCode: myCode });
        return sendJSON(res, 200, { paired: true, buddy: { code: buddyCode, status: other.status }, myCode: myCode });
      }
      // 暂无他人，进池等待
      waitingPool.push({ uid, status: sanitizeStatus(b.status), ts: Date.now() });
      return sendJSON(res, 200, { paired: false, message: 'waiting' });
    }

    /* 更新自己的公开状态（让搭子刷新看到） */
    if (url === '/api/status' && req.method === 'POST') {
      const b = await readBody(req);
      const uid = String(b.uid || '').slice(0, 64);
      if (uidToCode.has(uid)) {
        const { myCode } = uidToCode.get(uid);
        if (pairs.has(myCode)) pairs.get(myCode).status = sanitizeStatus(b.status);
      }
      return sendJSON(res, 200, { ok: true });
    }

    /* 互踩：踩一脚转发给搭子 */
    if (url === '/api/stomp' && req.method === 'POST') {
      const b = await readBody(req);
      const to = String(b.to || '').slice(0, 64);
      const text = String(b.text || '').slice(0, 120);
      if (!to || !text) return sendJSON(res, 400, { error: 'to/text required' });
      if (!stomps.has(to)) stomps.set(to, []);
      const arr = stomps.get(to);
      arr.push({ from: String(b.from || '').slice(0, 64), text, ts: Date.now() });
      if (arr.length > 20) arr.shift();
      return sendJSON(res, 200, { ok: true });
    }

    /* 取别人踩我的吐槽（用我的 code 查） */
    if (url.startsWith('/api/stomp/') && req.method === 'GET') {
      const code = decodeURIComponent(url.slice('/api/stomp/'.length)).slice(0, 64);
      const arr = stomps.get(code) || [];
      return sendJSON(res, 200, { stomps: arr });
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJSON(res, 400, { error: String(e && e.message ? e.message : e) });
  }
}

/* ---------- 静态服务 ---------- */
function serveStatic(req, res) {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(DIR, p));
  if (!fp.startsWith(DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('🚽 今天你拉了吗？真搭子后端已启动： http://localhost:' + PORT);
});
