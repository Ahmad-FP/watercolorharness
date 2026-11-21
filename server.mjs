import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const folder = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnv(join(folder, '.env'));
loadEnv(join(homedir(), '.openclaw', '.env'));

const painterPrompt = readFileSync(join(folder, 'PAINTER.md'), 'utf8');
const port = Number(process.env.PORT || 8787);
let gpuExtra = {};
try {
  gpuExtra = JSON.parse(process.env.GPU_EXTRA_BODY || '{}');
} catch (error) {
  console.error(`GPU_EXTRA_BODY must be valid JSON: ${error.message}`);
  process.exit(1);
}

const lanes = [
  {
    id: 'cerebras',
    label: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    key: process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_MODEL || 'moonshotai-kimi-k3.1-pro-trial',
    extra: {},
  },
  {
    id: 'gpu',
    label: process.env.GPU_LABEL || 'GPU provider',
    base: process.env.GPU_BASE_URL,
    key: process.env.GPU_API_KEY,
    model: process.env.GPU_MODEL,
    extra: gpuExtra,
  },
].filter(lane => lane.key);

if (!lanes.length) {
  console.error('No paint lanes have API keys. Set CEREBRAS_API_KEY and/or GPU_API_KEY (with GPU_BASE_URL and GPU_MODEL) in the environment, .env, or ~/.openclaw/.env.');
  process.exit(1);
}

mkdirSync(join(folder, 'out'), { recursive: true });
const clients = new Set();
const pending = new Map();
let busy = false;

function broadcast(message) {
  const packet = `data: ${JSON.stringify(message)}\n\n`;
  for (const response of clients) response.write(packet);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendFile(response, path, type) {
  const body = readFileSync(path);
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function runLane(lane, prompt, stamp) {
  const started = Date.now();
  let firstToken = null;
  let text = '';
  let usage = null;
  broadcast({ lane: lane.id, type: 'start' });

  try {
    const response = await fetch(`${lane.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lane.key}`,
      },
      body: JSON.stringify({
        model: lane.model,
        stream: true,
        temperature: 0.7,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: painterPrompt },
          { role: 'user', content: prompt },
        ],
        ...lane.extra,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 1000)}` : ''}`);
    }
    if (!response.body) throw new Error('The provider returned no response body');

    const decoder = new TextDecoder();
    let buffered = '';
    const consumeLine = line => {
      line = line.replace(/\r$/, '');
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trimStart();
      if (!data || data === '[DONE]') return;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      usage = json.usage || json.choices?.[0]?.usage || usage;
      const content = json.choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content) {
        if (firstToken === null) firstToken = Date.now();
        text += content;
        broadcast({ lane: lane.id, type: 'text', text: content });
      }
    };

    for await (const chunk of response.body) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) consumeLine(line);
    }
    buffered += decoder.decode();
    if (buffered) consumeLine(buffered);

    const ended = Date.now();
    const estimated = typeof usage?.completion_tokens !== 'number';
    const tokens = estimated ? text.length / 4 : usage.completion_tokens;
    const tokenDuration = firstToken === null ? 0 : (ended - firstToken) / 1000;
    const stats = {
      lane: lane.id,
      label: lane.label,
      model: lane.model,
      tokens,
      estimated,
      seconds: (ended - started) / 1000,
      firstTokenSeconds: firstToken === null ? null : (firstToken - started) / 1000,
      tps: tokenDuration > 0 ? tokens / tokenDuration : 0,
    };
    writeFileSync(join(folder, 'out', `${stamp}-${lane.id}.txt`), text);
    broadcast({ lane: lane.id, type: 'done', stats });
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      writeFileSync(join(folder, 'out', `${stamp}-${lane.id}.txt`), text);
    } catch {}
    broadcast({ lane: lane.id, type: 'error', error: message });
    return { lane: lane.id, label: lane.label, model: lane.model, error: message };
  }
}

async function paint(request, response) {
  if (busy) {
    sendJson(response, 409, { error: 'A paint is already running.' });
    return;
  }
  let prompt;
  try {
    const body = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('prompt is required');
    prompt = body.prompt;
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  busy = true;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    const results = await Promise.all(lanes.map(lane => runLane(lane, prompt, stamp)));
    const images = {};
    if (clients.size) {
      let finish;
      const completion = new Promise(resolve => { finish = resolve; });
      const entry = { images, expected: new Set(lanes.map(lane => lane.id)), finish };
      pending.set(stamp, entry);
      const timer = setTimeout(finish, 5000);
      broadcast({ type: 'snapshot', stamp });
      await completion;
      clearTimeout(timer);
      pending.delete(stamp);
    }
    sendJson(response, 200, { prompt, results, images });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/') {
      sendFile(response, join(folder, 'index.html'), 'text/html; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/renderer.js') {
      sendFile(response, join(folder, 'renderer.js'), 'text/javascript; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/lanes') {
      sendJson(response, 200, lanes.map(({ id, label, model }) => ({ id, label, model })));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/status') {
      sendJson(response, 200, { pages: clients.size, busy });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      response.write(': connected\n\n');
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/paint') {
      await paint(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/snapshot') {
      const stamp = url.searchParams.get('stamp');
      const lane = url.searchParams.get('lane') || '';
      const entry = pending.get(stamp);
      if (!entry || !/^[a-z0-9]+$/.test(lane) || !entry.expected.has(lane)) {
        sendJson(response, 400, { error: 'Unknown stamp or invalid lane.' });
        return;
      }
      const body = await readBody(request);
      const filename = `${stamp}-${lane}.png`;
      const path = join('out', filename);
      writeFileSync(join(folder, 'out', filename), body);
      entry.images[lane] = path;
      if (Object.keys(entry.images).length === entry.expected.size) entry.finish();
      sendJson(response, 200, { ok: true, path });
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    else response.end();
  }
});

server.listen(port, () => {
  console.log(`Watercolor Harness listening on http://localhost:${port} (${lanes.map(lane => lane.label).join(', ')})`);
});
