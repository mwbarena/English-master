// netlify/functions/urdu-dict.js
//
// Proxies lookups against the compact-dictionaries Urdu dataset (hosted on GitLab).
// Runs server-side so there's no browser CORS issue. Caches the parsed
// dictionary in memory for the life of the function instance (warm starts).

let cachedDict = null;
let cachedAt = 0;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

async function loadDict() {
  const now = Date.now();
  if (cachedDict && now - cachedAt < CACHE_TTL_MS) return cachedDict;

  const res = await fetch(
    'https://gitlab.com/tdulcet/compact-dictionary/-/raw/main/wiktionary/dictionary-ur.json?inline=false'
  );
  if (!res.ok) throw new Error('Could not fetch Urdu dictionary (HTTP ' + res.status + ')');
  const text = await res.text();
  const lines = text.split('\n').filter(Boolean);
  cachedDict = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
  cachedAt = now;
  return cachedDict;
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  const mode = params.mode === 'enur' ? 'enur' : 'uren';

  if (!q) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing query.' }) };
  }

  try {
    const dict = await loadDict();
    const ql = q.toLowerCase();
    let matches = [];

    if (mode === 'uren') {
      matches = dict.filter((e) => e[''] === q).slice(0, 5);
      if (matches.length === 0) {
        matches = dict.filter((e) => e[''] && e[''].includes(q)).slice(0, 5);
      }
    } else {
      matches = dict
        .filter((e) => (e.d || []).some((def) => def.toLowerCase().includes(ql)))
        .slice(0, 6);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Urdu dictionary lookup failed.', detail: err.message }),
    };
  }
};
