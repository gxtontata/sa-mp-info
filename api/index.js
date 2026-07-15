const dgram = require('dgram');

function validateIP(ip) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

function doQuery(ip, port, opcode, timeout) {
  return new Promise((resolve, reject) => {
    if (!validateIP(ip)) return reject(new Error('Invalid IP'));
    const socket = dgram.createSocket('udp4');
    const pkt = Buffer.alloc(11);
    pkt.write('SAMP', 0, 4, 'ascii');
    const oct = ip.split('.').map(Number);
    pkt[4] = oct[0];
    pkt[5] = oct[1];
    pkt[6] = oct[2];
    pkt[7] = oct[3];
    pkt[8] = port & 0xff;
    pkt[9] = (port >> 8) & 0xff;
    pkt[10] = opcode.charCodeAt(0);
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        socket.close();
        reject(new Error('Timeout querying ' + ip + ':' + port));
      }
    }, timeout || 2000);
    socket.on('error', (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        socket.close();
        reject(e);
      }
    });
    socket.on('message', (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      if (msg.length < 12) return reject(new Error('Invalid response'));
      const b = msg.slice(11);
      try {
        if (opcode === 'i') {
          let p = 0;
          const passworded = !!b.readUInt8(p); p += 1;
          const players = b.readUInt16LE(p); p += 2;
          const maxplayers = b.readUInt16LE(p); p += 2;
          const hl = b.readUInt32LE(p); p += 4;
          const hostname = b.toString('utf8', p, p + hl); p += hl;
          const gl = b.readUInt32LE(p); p += 4;
          const gamemode = b.toString('utf8', p, p + gl); p += gl;
          const ll = b.readUInt32LE(p); p += 4;
          const language = b.toString('utf8', p, p + ll); p += ll;
          return resolve({ passworded, players, maxplayers, hostname, gamemode, language });
        }
        if (opcode === 'r') {
          let p = 0;
          const n = b.readUInt16LE(p); p += 2;
          const rules = {};
          for (let i = 0; i < n; i++) {
            const nl = b.readUInt8(p); p += 1;
            const name = b.toString('utf8', p, p + nl); p += nl;
            const vl = b.readUInt8(p); p += 1;
            const val = b.toString('utf8', p, p + vl); p += vl;
            rules[name] = val;
          }
          return resolve(rules);
        }
        if (opcode === 'c') {
          let p = 0;
          const n = b.readUInt16LE(p); p += 2;
          const list = [];
          for (let i = 0; i < n; i++) {
            const nl = b.readUInt8(p); p += 1;
            const name = b.toString('utf8', p, p + nl); p += nl;
            const score = b.readInt32LE(p); p += 4;
            list.push({ name, score });
          }
          return resolve(list);
        }
        if (opcode === 'd') {
          let p = 0;
          const n = b.readUInt16LE(p); p += 2;
          const list = [];
          for (let i = 0; i < n; i++) {
            const id = b.readUInt8(p); p += 1;
            const nl = b.readUInt8(p); p += 1;
            const name = b.toString('utf8', p, p + nl); p += nl;
            const score = b.readInt32LE(p); p += 4;
            const ping = b.readInt32LE(p); p += 4;
            list.push({ id, name, score, ping });
          }
          return resolve(list);
        }
        reject(new Error('Unknown opcode'));
      } catch (e) {
        reject(e);
      }
    });
    socket.send(pkt, 0, pkt.length, port, ip, (e) => {
      if (e && !done) {
        done = true;
        clearTimeout(timer);
        socket.close();
        reject(e);
      }
    });
  });
}

function send(data, status, res) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data, null, 2));
}

function parseInput(req, res) {
  const url = new URL(req.url, 'http://' + req.headers.host);
  let ip = (url.searchParams.get('ip') || '').trim();
  let port = parseInt(url.searchParams.get('port'), 10);
  const ipAddr = (url.searchParams.get('ip_addr') || '').trim();
  if (ipAddr) {
    const parts = ipAddr.split(':');
    ip = parts[0].replace(/^\$/, '').trim();
    if (parts[1]) port = parseInt(parts[1], 10);
  }
  if (!validateIP(ip)) {
    send({ ok: false, error: 'ip wajib format IPv4' }, 400, res);
    return null;
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    send({ ok: false, error: 'port wajib angka 1-65535' }, 400, res);
    return null;
  }
  return { ip, port, action: (url.searchParams.get('action') || 'server').trim() };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return send({ ok: false, error: 'GET only' }, 405, res);
  }
  const input = parseInput(req, res);
  if (!input) return;
  const { ip, port, action } = input;

  try {
    if (action === 'info') {
      const info = await doQuery(ip, port, 'i');
      return send({ ok: true, ip, port, info }, 200, res);
    }
    if (action === 'rules') {
      const rules = await doQuery(ip, port, 'r');
      return send({ ok: true, ip, port, rules }, 200, res);
    }
    if (action === 'players') {
      const info = await doQuery(ip, port, 'i');
      if (!Number.isFinite(info.players) || info.players > 100) {
        return send({ ok: false, error: 'Players > 100, query dibatasi SA-MP' }, 400, res);
      }
      const players = await doQuery(ip, port, 'd');
      return send({ ok: true, ip, port, players }, 200, res);
    }
    if (action === 'players-simple') {
      const info = await doQuery(ip, port, 'i');
      if (!Number.isFinite(info.players) || info.players > 100) {
        return send({ ok: false, error: 'Players > 100, query dibatasi SA-MP' }, 400, res);
      }
      const players = await doQuery(ip, port, 'c');
      return send({ ok: true, ip, port, players }, 200, res);
    }
    const info = await doQuery(ip, port, 'i');
    const rules = await doQuery(ip, port, 'r');
    const result = { ok: true, ip, port, info, rules, players: null };
    if (info.players > 0 && info.players <= 100) {
      try {
        result.players = await doQuery(ip, port, 'd');
      } catch (_) {}
    }
    return send(result, 200, res);
  } catch (e) {
    return send({ ok: false, error: e.message }, 502, res);
  }
};
