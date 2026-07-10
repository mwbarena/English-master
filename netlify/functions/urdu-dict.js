// netlify/functions/urdu-dict.js
//
// Merges two free data sources for Urdu lookups, both run server-side to
// avoid browser CORS issues:
//   1. compact-dictionaries (Wiktionary-based, hosted on GitLab) — deep definitions
//   2. MoizRauf trilingual dataset (hosted on GitHub) — adds Roman Urdu spelling
// Caches both in memory for the life of the function instance (warm starts).

let cachedDict = null;
let cachedAt = 0;
let cachedTri = null;
let cachedTriAt = 0;
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

async function loadTrilingual() {
  const now = Date.now();
  if (cachedTri && now - cachedTriAt < CACHE_TTL_MS) return cachedTri;

  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/MoizRauf/Urdu--Roman-Urdu--English--Dictionary/master/en_ur_rom.high.tsv'
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    // header: Urdu  Roman-Urdu  Ur-Rom Confidence Score  English  Ur-En Confidence Score
    cachedTri = lines.slice(1).map((line) => {
      const cols = line.split('\t');
      return { urdu: cols[0] || '', roman: cols[1] || '', english: cols[3] || '' };
    }).filter((e) => e.urdu && e.english);
  } catch (err) {
    cachedTri = []; // fail quietly, primary source still works
  }
  cachedTriAt = now;
  return cachedTri;
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  const mode = params.mode === 'enur' ? 'enur' : 'uren';

  if (!q) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing query.' }) };
  }

  try {
    const [dict, tri] = await Promise.all([loadDict(), loadTrilingual()]);
    const ql = q.toLowerCase();
    let matches = [];
    let triMatches = [];

    if (mode === 'uren') {
      matches = dict.filter((e) => e[''] === q).slice(0, 5);
      if (matches.length === 0) {
        matches = dict.filter((e) => e[''] && e[''].includes(q)).slice(0, 5);
      }
      triMatches = tri.filter((e) => e.urdu === q || e.roman.toLowerCase() === ql).slice(0, 4);
    } else {
      const escaped = ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wholeWordRe = new RegExp(`\\b${escaped}\\b`, 'i');

      function scoreEntry(e) {
        const defs = e.d || [];
        let best = 99;
        for (const def of defs) {
          const dl = def.toLowerCase().trim();
          if (dl === ql) return 0; // exact definition match, best possible
          if (wholeWordRe.test(def)) best = Math.min(best, 1); // whole-word match
          else if (dl.includes(ql)) best = Math.min(best, 2); // loose substring
        }
        return best;
      }

      matches = dict
        .map((e) => ({ e, score: scoreEntry(e) }))
        .filter((x) => x.score < 99)
        .sort((a, b) => a.score - b.score)
        .slice(0, 6)
        .map((x) => x.e);

      triMatches = tri.filter((e) => e.english.toLowerCase() === ql).slice(0, 4);
      if (triMatches.length === 0) {
        triMatches = tri.filter((e) => e.english.toLowerCase().includes(ql)).slice(0, 3);
      }
    }

    // Normalize trilingual matches into the same shape as the main dictionary entries
    const triFormatted = triMatches.map((e) => ({
      '': e.urdu,
      p: e.roman ? [`roman: ${e.roman}`] : [],
      d: [e.english],
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches: [...matches, ...triFormatted] }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Urdu dictionary lookup failed.', detail: err.message }),
    };
  }
};
