import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const dataDir = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'outreach.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keywords TEXT NOT NULL, industry TEXT NOT NULL, job_titles TEXT NOT NULL,
    template TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS targets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL, role TEXT NOT NULL, company TEXT NOT NULL, platform TEXT NOT NULL,
    match_score INTEGER NOT NULL, status TEXT NOT NULL, initials TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const digest = token => crypto.createHash('sha256').update(token).digest('hex');

export function createUser({ email, name, passwordHash }) {
  const user = { id: id('user'), email: email.toLowerCase(), name, passwordHash, createdAt: now() };
  db.prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)').run(user.id, user.email, user.name, user.passwordHash, user.createdAt);
  return user;
}
export function findUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()); }
export function findUserById(userId) { return db.prepare('SELECT id,email,name,created_at AS createdAt FROM users WHERE id = ?').get(userId); }
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(digest(token), userId, expiresAt, now());
  return { token, expiresAt };
}
export function userForToken(token) {
  if (!token) return null;
  return db.prepare('SELECT u.id,u.email,u.name,u.created_at AS createdAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > ?').get(digest(token), now()) || null;
}
export function deleteSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }
export function deleteUser(userId) { return db.prepare('DELETE FROM users WHERE id=?').run(userId).changes > 0; }

function defaultPipeline(userId) {
  const timestamp = now();
  const pipeline = { id: id('pipeline'), userId, keywords: 'founder, operator, growth', industry: 'B2B SaaS', jobTitles: 'Founder, VP Growth', template: 'Hi {{firstName}}, I noticed your work in {{industry}}. Would a short exchange about growth systems be useful?', createdAt: timestamp, updatedAt: timestamp };
  db.prepare('INSERT INTO pipelines (id,user_id,keywords,industry,job_titles,template,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(pipeline.id, userId, pipeline.keywords, pipeline.industry, pipeline.jobTitles, pipeline.template, timestamp, timestamp);
  return pipeline;
}
export function getOverview(userId) {
  let pipeline = db.prepare('SELECT id,keywords,industry,job_titles AS jobTitles,template FROM pipelines WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').get(userId);
  if (!pipeline) pipeline = defaultPipeline(userId);
  const targets = db.prepare('SELECT id,name,role,company,platform,match_score AS match,status,initials FROM targets WHERE user_id=? ORDER BY created_at DESC').all(userId);
  const count = type => db.prepare('SELECT COALESCE(SUM(value),0) AS total FROM activity WHERE user_id=? AND type=?').get(userId, type).total;
  return { pipeline, targets, stats: { pipelinesRun: count('pipeline_run'), messagesSent: count('message_sent'), qualifiedLeads: count('qualified_lead'), replyRate: 18.4 } };
}
export function savePipeline(userId, fields) {
  const current = db.prepare('SELECT id FROM pipelines WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').get(userId) || { id: defaultPipeline(userId).id };
  db.prepare('UPDATE pipelines SET keywords=?,industry=?,job_titles=?,template=?,updated_at=? WHERE id=?').run(fields.keywords, fields.industry, fields.jobTitles, fields.template, now(), current.id);
  return getOverview(userId).pipeline;
}
export function recordActivity(userId, type, value = 1) { db.prepare('INSERT INTO activity (id,user_id,type,value,created_at) VALUES (?,?,?,?,?)').run(id('activity'), userId, type, value, now()); }
export function replaceTargets(userId, pipelineId, targets) {
  const insert = db.prepare('INSERT OR REPLACE INTO targets (id,user_id,pipeline_id,name,role,company,platform,match_score,status,initials,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const transaction = db.transaction(items => items.forEach(target => insert.run(target.id, userId, pipelineId, target.name, target.role, target.company, target.platform, target.match, target.status, target.initials, now())));
  transaction(targets);
}
export function queueTargets(userId, targetIds) {
  const statement = db.prepare("UPDATE targets SET status='Queued' WHERE user_id=? AND id=? AND status IN ('Ready','Review')");
  let queued = 0;
  const transaction = db.transaction(ids => ids.forEach(targetId => { queued += statement.run(userId, targetId).changes; }));
  transaction(targetIds);
  return queued;
}

export { db };
