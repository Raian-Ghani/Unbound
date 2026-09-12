import http from 'node:http';
import crypto, { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createSession, createUser, deleteSession, deleteUser, findUserByEmail, getOverview, queueTargets, recordActivity, replaceTargets, savePipeline, userForToken } from './db.js';
import { discoverTargets } from './providers.js';

const scrypt = promisify(scryptCallback);
const port = Number(process.env.PORT || 8787);
const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function json(response, status, body, origin, extra = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', ...extra
  });
  response.end(JSON.stringify(body));
}
function readBody(request) { return new Promise((resolve, reject) => { let body = ''; request.on('data', chunk => { body += chunk; if (body.length > 100_000) reject(new Error('Request too large')); }); request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } }); request.on('error', reject); }); }
function sanitizeText(value, max = 500) { return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, max) : ''; }
function sessionToken(request) { return (request.headers.cookie || '').match(/(?:^|;\s*)oa_session=([^;]+)/)?.[1] || ''; }
function setSession(response, token) { response.setHeader('Set-Cookie', `oa_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); }
function clearSession(response) { response.setHeader('Set-Cookie', 'oa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }
function authUser(request) { return userForToken(sessionToken(request)); }
function requireUser(request, response, origin) { const user = authUser(request); if (!user) json(response, 401, { error: 'Authentication required.' }, origin); return user; }
function validEmail(email) { return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
async function hashPassword(password) { const salt = randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64); return `${salt}:${Buffer.from(derived).toString('hex')}`; }
async function verifyPassword(password, stored) { const [salt, hex] = String(stored).split(':'); if (!salt || !hex) return false; const derived = Buffer.from(await scrypt(typeof password === 'string' ? password : '', salt, 64)); const expected = Buffer.from(hex, 'hex'); return derived.length === expected.length && timingSafeEqual(derived, expected); }

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  if (request.method === 'OPTIONS') return json(response, 204, {}, origin);
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'POST' && (url.pathname === '/api/auth/signup' || url.pathname === '/api/signup')) {
      const body = await readBody(request); const email = sanitizeText(body.email, 254).toLowerCase(); const name = sanitizeText(body.name, 100); const password = typeof body.password === 'string' ? body.password : '';
      if (!validEmail(email) || name.length < 2 || password.length < 10) return json(response, 400, { error: 'Use a valid email, a name, and a password of at least 10 characters.' }, origin);
      if (findUserByEmail(email)) return json(response, 409, { error: 'An account with that email already exists.' }, origin);
      const user = createUser({ email, name, passwordHash: await hashPassword(password) }); const session = createSession(user.id); setSession(response, session.token); return json(response, 201, { user: { id: user.id, email: user.email, name: user.name } }, origin);
    }
    if (request.method === 'POST' && (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/signin' || url.pathname === '/api/login')) {
      const body = await readBody(request); const email = sanitizeText(body.email, 254).toLowerCase(); const password = typeof body.password === 'string' ? body.password : ''; const user = findUserByEmail(email);
      if (!user) {
        if (!validEmail(email) || password.length < 10) return json(response, 400, { error: 'Use a valid email and a password of at least 10 characters to create your account.' }, origin);
        const name = sanitizeText(body.name, 100) || email.split('@')[0];
        const newUser = createUser({ email, name, passwordHash: await hashPassword(password) }); const session = createSession(newUser.id); setSession(response, session.token); return json(response, 201, { user: { id: newUser.id, email: newUser.email, name: newUser.name }, created: true }, origin);
      }
      if (!(await verifyPassword(password, user.password_hash))) return json(response, 401, { error: 'Email or password is incorrect.' }, origin);
      const session = createSession(user.id); setSession(response, session.token); return json(response, 200, { user: { id: user.id, email: user.email, name: user.name }, created: false }, origin);
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') { deleteSession(sessionToken(request)); clearSession(response); return json(response, 200, { ok: true }, origin); }
    if (request.method === 'GET' && url.pathname === '/api/auth/me') return json(response, 200, { user: authUser(request) }, origin);
    if (request.method === 'DELETE' && url.pathname === '/api/account') { const user = requireUser(request, response, origin); if (!user) return; deleteUser(user.id); clearSession(response); return json(response, 200, { ok: true }, origin); }
    if (request.method === 'GET' && url.pathname === '/api/overview') { const user = requireUser(request, response, origin); if (!user) return; return json(response, 200, { user, ...getOverview(user.id) }, origin); }
    if (request.method === 'POST' && url.pathname === '/api/pipeline') { const user = requireUser(request, response, origin); if (!user) return; const body = await readBody(request); const fields = { keywords: sanitizeText(body.keywords, 300), industry: sanitizeText(body.industry, 120), jobTitles: sanitizeText(body.jobTitles, 300), template: sanitizeText(body.template, 1_000) }; if (Object.values(fields).some(value => !value)) return json(response, 400, { error: 'Every pipeline field is required.' }, origin); return json(response, 200, { pipeline: savePipeline(user.id, fields) }, origin); }
    if (request.method === 'POST' && url.pathname === '/api/discover') { const user = requireUser(request, response, origin); if (!user) return; const body = await readBody(request); const targets = await discoverTargets(body.provider || 'demo'); const pipeline = getOverview(user.id).pipeline; replaceTargets(user.id, pipeline.id, targets); recordActivity(user.id, 'pipeline_run'); targets.filter(target => target.match >= 85).forEach(() => recordActivity(user.id, 'qualified_lead')); return json(response, 200, { targets }, origin); }
    if (request.method === 'POST' && url.pathname === '/api/deploy') { const user = requireUser(request, response, origin); if (!user) return; const body = await readBody(request); const ids = Array.isArray(body.approvedIds) ? body.approvedIds.slice(0, 50) : []; const queued = queueTargets(user.id, ids); recordActivity(user.id, 'message_sent', queued); return json(response, 200, { queued }, origin); }
    if (request.method === 'POST' && url.pathname === '/api/public-link') { const user = requireUser(request, response, origin); if (!user) return; return json(response, 201, { token: crypto.randomBytes(12).toString('hex') }, origin); }
    return json(response, 404, { error: 'Not found' }, origin);
  } catch (error) { const status = error.message === 'Request too large' ? 413 : error.message.includes('requires an approved') ? 422 : 400; return json(response, status, { error: error.message }, origin); }
});

if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(port, () => console.log(`OutreachAutomator API listening on http://localhost:${port}`));
export { server, sanitizeText, hashPassword, verifyPassword };
