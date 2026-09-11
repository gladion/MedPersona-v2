// server/utils/store.js
//
// Persistent storage backend, backed by MongoDB Atlas (or any MongoDB
// instance). This replaces the earlier local-JSON-file version so that
// data survives Render's ephemeral filesystem (files written to disk are
// lost every time a Free web service spins down, restarts, or redeploys).
//
// Storage model: one document per logical "file" in a single collection
// ("kvstore"), e.g. { _id: 'doctors.json', data: [...] }. This keeps the
// exact same readJson(name, fallback) / writeJson(name, data) interface
// the rest of the app already uses - only now both are async, so callers
// must `await` them.
//
// Configuration: set the MONGODB_URI environment variable to your Atlas
// (or other MongoDB) connection string. See README.md "Database setup"
// for step-by-step instructions. MONGODB_DB_NAME is optional (defaults
// to "medsim_review").

const { MongoClient } = require('mongodb');

const COLLECTION = 'kvstore';
const DB_NAME = process.env.MONGODB_DB_NAME || 'medsim_review';

let clientPromise = null;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI environment variable is not set. Create a free MongoDB Atlas ' +
      'cluster and set MONGODB_URI (see README.md, "Database setup").'
    );
  }
  if (!clientPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    clientPromise = client.connect().then(
      (c) => {
        console.log('[store] Connected to MongoDB.');
        return c;
      },
      (err) => {
        clientPromise = null; // allow a retry on the next call instead of caching a failed connection
        throw err;
      }
    );
  }
  return clientPromise;
}

async function getCollection() {
  const client = await getClient();
  return client.db(DB_NAME).collection(COLLECTION);
}

// Call once at startup: verifies the connection works and fails fast with
// a clear error if MONGODB_URI is missing or unreachable, instead of the
// first request timing out with a confusing error later.
async function connect() {
  const col = await getCollection();
  await col.createIndex({ _id: 1 });
  return col;
}

async function readJson(name, fallback) {
  const col = await getCollection();
  const doc = await col.findOne({ _id: name });
  if (!doc) return fallback;
  return doc.data;
}

// Writes to the same document are queued in-process so rapid autosave
// calls for the same file are applied in the order they were made,
// instead of racing each other over the network.
const writeQueues = new Map();

function writeJson(name, data) {
  const prev = writeQueues.get(name) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const col = await getCollection();
    await col.updateOne(
      { _id: name },
      { $set: { data, updatedAt: new Date() } },
      { upsert: true }
    );
  });
  writeQueues.set(name, next);
  return next;
}

module.exports = { readJson, writeJson, connect };
