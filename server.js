/*
 * 今天你拉了吗？ — 真搭子后端（v2）
 * 匿名配对 + 脱敏状态中转 + 互踩吐槽转发 + 隐私埋点；不存储任何原始排便记录。
 * 关键升级（相对 MVP）：
 *   - 搭子状态落盘（data/buddies.json），重启/休眠不再清空配对（信任底线）
 *   - 异步配对 + 离线留言：不再要求两人同时在线
 *   - GET /healthz 健康检查，供 Render healthCheck + 外部保活 ping
 *   - POST /e 隐私埋点端点（仅匿名事件，无 PII，追加写日志）
 *
 * 启动：node server.js  （PORT 默认 3000）
 * 前端用同源相对路径 /api/* 调用，因此本服务同时 serve 前端静态资源。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const DATA_DIR = path.join(DIR, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const BUDDY_FILE = path.join(DATA_DIR, 'buddies.json');
const EVENT_FILE = path.join(DATA_DIR, 'events.log');

/* ---------- 持久化状态（搭子配对 + 离线留言） ---------- */
let store = { pairs: {}, uidToCode: {}, waitingPool: [], stomps: {} };
try {
  const raw = fs.readFileSync(BUDDY_FILE, 'utf8');
  const p = JSON.parse(raw);
  store = Object.assign(store, p);
} catch (e) { /* 首次启动无文件，用默认空结构 */ }

let saveTimer = null;
function saveBuddies() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(BUDDY_FILE, JSON.stringify(store), () => {});
  }, 300);
}

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

const POOL_TTL = 5 * 60 * 1000; // 等待者 5 分钟超时

function genCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return '神秘便友#' + n;
}
function sweepPool() {
  const t = Date.now();
  store.waitingPool = store.waitingPool.filter(w => t - w.ts <= POOL_TTL);
}
setInterval(sweepPool, 30000);

/* ---------- 工具 ---------- */
function sendJSON(res, code, obj, extra) {
  const head = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  };
  if (extra) Object.assign(head, extra);
  res.writeHead(code, head);
  res.end(JSON.stringify(obj));
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
function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return Math.floor(d / 86400000) + ' 天前';
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
    /* 健康检查 */
    if (url === '/healthz' && req.method === 'GET') {
      return sendJSON(res, 200, {
        ok: true,
        ts: Date.now(),
        uptime: Math.floor(process.uptime()),
        buddies: Object.keys(store.pairs).length
      });
    }

    /* 隐私埋点（仅匿名事件，无 PII） */
    if (url === '/e' && req.method === 'POST') {
      const b = await readBody(req);
      const events = Array.isArray(b.events) ? b.events : (b.ev ? [b] : []);
      for (const e of events) {
        if (e && e.ev) {
          fs.appendFile(EVENT_FILE, JSON.stringify({
            ts: Date.now(),
            id: String(e.id || '').slice(0, 64),
            ev: String(e.ev || '').slice(0, 48),
            props: (e.props && typeof e.props === 'object') ? e.props : {}
          }) + '\n', () => {});
        }
      }
      return sendJSON(res, 204, {});
    }

    /* 入池 / 配对（异步持久化） */
    if (url === '/api/match' && req.method === 'POST') {
      const b = await readBody(req);
      const uid = String(b.uid || '').slice(0, 64);
      if (!uid) return sendJSON(res, 400, { error: 'uid required' });
      sweepPool();

      // 已配对：返回现有搭子 + 刷新活跃时间
      if (store.uidToCode[uid]) {
        const { myCode, buddyCode } = store.uidToCode[uid];
        const bp = store.pairs[buddyCode];
        if (bp) bp.lastActive = Date.now();
        saveBuddies();
        return sendJSON(res, 200, {
          paired: true,
          buddy: bp ? { code: buddyCode, status: bp.status, lastActive: bp.lastActive } : null,
          myCode: myCode
        });
      }

      // 从等待池找另一个人配对
      const idx = store.waitingPool.findIndex(w => w.uid !== uid);
      if (idx >= 0) {
        const other = store.waitingPool.splice(idx, 1)[0];
        const myCode = genCode();
        const buddyCode = genCode();
        store.pairs[myCode] = { uid, status: sanitizeStatus(b.status), lastActive: Date.now() };
        store.pairs[buddyCode] = { uid: other.uid, status: sanitizeStatus(other.status), lastActive: Date.now() };
        store.uidToCode[uid] = { myCode, buddyCode };
        store.uidToCode[other.uid] = { myCode: buddyCode, buddyCode: myCode };
        saveBuddies();
        return sendJSON(res, 200, {
          paired: true,
          buddy: { code: buddyCode, status: other.status, lastActive: Date.now() },
          myCode: myCode
        });
      }

      // 暂无他人，进池等待（持久化）
      store.waitingPool.push({ uid, status: sanitizeStatus(b.status), ts: Date.now() });
      saveBuddies();
      return sendJSON(res, 200, { paired: false, message: 'waiting' });
    }

    /* 更新自己的公开状态 / 活跃时间 */
    if (url === '/api/status' && req.method === 'POST') {
      const b = await readBody(req);
      const uid = String(b.uid || '').slice(0, 64);
      if (store.uidToCode[uid]) {
        const { myCode } = store.uidToCode[uid];
        if (store.pairs[myCode]) {
          store.pairs[myCode].status = sanitizeStatus(b.status);
          store.pairs[myCode].lastActive = Date.now();
          saveBuddies();
        }
      }
      return sendJSON(res, 200, { ok: true });
    }

    /* 互踩：踩一脚转发给搭子（离线留言，持久化） */
    if (url === '/api/stomp' && req.method === 'POST') {
      const b = await readBody(req);
      const to = String(b.to || '').slice(0, 64);
      const text = String(b.text || '').slice(0, 120);
      if (!to || !text) return sendJSON(res, 400, { error: 'to/text required' });
      if (!store.stomps[to]) store.stomps[to] = [];
      store.stomps[to].push({ from: String(b.from || '').slice(0, 64), text, ts: Date.now() });
      if (store.stomps[to].length > 30) store.stomps[to].shift();
      saveBuddies();
      return sendJSON(res, 200, { ok: true });
    }

    /* 取别人踩我的吐槽（用我的 code 查） */
    if (url.startsWith('/api/stomp/') && req.method === 'GET') {
      const code = decodeURIComponent(url.slice('/api/stomp/'.length)).slice(0, 64);
      const arr = store.stomps[code] || [];
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
  if (url.startsWith('/api/') || url === '/healthz' || url === '/e') {
    await handleApi(req, res, url);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('🚽 今天你拉了吗？真搭子后端 v2 已启动： http://localhost:' + PORT);
});
