// netlify/functions/solve.js
//
// Reads Gemini API keys from Netlify environment variables:
//   GEMINI_KEY_1, GEMINI_KEY_2, GEMINI_KEY_3, GEMINI_KEY_4, GEMINI_KEY_5, GEMINI_KEY_6
// Add these in: Netlify dashboard -> Site settings -> Environment variables
// (Never put real key values in this file.)
//
// Tries each key in order. If a key is rate-limited (429) or rejected (403),
// it automatically moves to the next key. Only fails if every key is exhausted.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const keys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
  ].filter(Boolean);

  if (keys.length === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No Gemini API keys configured. Add GEMINI_KEY_1 (etc.) in Netlify environment variables.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { imageBase64, mediaType, grade } = payload;
  if (!imageBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No image provided.' }) };
  }

  const systemPrompt = `You are an expert English teacher. You are shown a photo of a question from a student's textbook or worksheet. The student is at: ${grade || 'Class 6-8 (middle school)'}.

Read the question(s) directly from the image yourself. Then give a complete, accurate, well-structured answer appropriate to that level, covering grammar rules, definitions, and examples as a knowledgeable teacher would. If there are multiple questions, answer each one clearly labeled.

Respond in EXACTLY this plain-text format, no markdown symbols like # or *:

EXTRACTED QUESTION(S):
<write out the question(s) as you read them from the image>

ANSWER:
<your detailed answer, using simple numbering and line breaks for structure>`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
        ],
      },
    ],
  };

  let lastError = 'Unknown error';

  async function tryKey(key, useHeader){
    const url = useHeader
      ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const headers = { 'Content-Type': 'application/json' };
    if(useHeader) headers['Authorization'] = `Bearer ${key}`;

    return fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    for (const useHeader of [false, true]) {
      try {
        const res = await tryKey(key, useHeader);

        if (res.status === 429) {
          lastError = `Key ${i + 1} rate-limited (HTTP 429). Trying next key...`;
          break;
        }

        if (res.status === 401 || res.status === 403) {
          lastError = `Key ${i + 1} rejected with ${useHeader ? 'Bearer header' : 'query param'} (HTTP ${res.status}).`;
          continue;
        }

        if (!res.ok) {
          lastError = `Key ${i + 1} error (HTTP ${res.status}).`;
          continue;
        }

        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .filter(Boolean)
          .join('\n')
          .trim();

        if (!text) {
          lastError = `Key ${i + 1} returned an empty response.`;
          continue;
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, keyUsed: i + 1, authMethod: useHeader ? 'bearer' : 'query' }),
        };
      } catch (err) {
        lastError = `Key ${i + 1} failed: ${err.message}`;
      }
    }
  }

  return {
    statusCode: 502,
    body: JSON.stringify({ error: 'All Gemini keys failed or are rate-limited. Try again shortly.', detail: lastError }),
  };
};
