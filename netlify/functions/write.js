// netlify/functions/write.js
//
// Powers Essay & Letter Writer + Sentence Builder modules.
// Reads Gemini API keys from Netlify environment variables (GEMINI_KEY_1..6),
// same rotation/fallback pattern as solve.js.

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
      body: JSON.stringify({ error: 'No Gemini API keys configured.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { task, input, grade } = payload;
  if (!task || !input) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing task or input.' }) };
  }

  const gradeText = grade || 'Class 6-8 (middle school)';

  const prompts = {
    essay: `Write a well-structured essay suitable for a student at ${gradeText} on the topic: "${input}". Use clear paragraphs (introduction, body, conclusion), age-appropriate vocabulary, and good grammar. Plain text only, no markdown symbols.`,
    letter: `Write a complete letter suitable for a student at ${gradeText} about: "${input}". Determine from the request whether it should be formal or informal, and use proper letter format (sender's address, date, salutation, body, closing). Plain text only, no markdown symbols.`,
    application: `Write a formal application/request letter suitable for a student at ${gradeText} for: "${input}". Use proper formal application format (addressed to the relevant authority, subject line, respectful body, signature block). Plain text only, no markdown symbols.`,
    story: `Write an engaging short story suitable for a student at ${gradeText} based on: "${input}". Include a clear beginning, middle, and end, with simple descriptive language appropriate for the level. Plain text only, no markdown symbols.`,
    poem: `Write an original short poem suitable for a student at ${gradeText} about: "${input}". Plain text only, no markdown symbols.`,
    sentence: `Using these word(s): "${input}", write 5 different grammatically correct example sentences suitable for a student at ${gradeText}. Number them 1-5. Plain text only, no markdown symbols.`,
    narration: `Convert the following sentence between direct and indirect (reported) speech — if it's in direct speech (with quotation marks), convert it to indirect; if it's already indirect, convert it to direct. Explain the pronoun, tense, and time/place word changes briefly afterward in simple terms suitable for a student at ${gradeText}. Sentence: "${input}". Plain text only, no markdown symbols.`,
    plural: `For the word "${input}": give its plural form if singular (or singular form if plural), briefly note the pluralization rule that applies, and give one example sentence using each form. Keep it appropriate for a student at ${gradeText}. Plain text only, no markdown symbols.`,
  };

  const systemPrompt = prompts[task];
  if (!systemPrompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown task type: ' + task }) };
  }

  const requestBody = {
    contents: [{ parts: [{ text: systemPrompt }] }],
  };

  let lastError = 'Unknown error';
  const models = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

  async function tryKey(key, model) {
    const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(requestBody),
    });
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    for (const model of models) {
      try {
        const res = await tryKey(key, model);

        if (res.status === 429) {
          lastError = `Key ${i + 1} rate-limited on ${model} (HTTP 429). Trying next key...`;
          break;
        }

        if (res.status === 401 || res.status === 403) {
          lastError = `Key ${i + 1} rejected on ${model} (HTTP ${res.status}).`;
          continue;
        }

        if (res.status === 503) {
          lastError = `Key ${i + 1}: ${model} overloaded (HTTP 503). Trying next model...`;
          continue;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `Key ${i + 1} error on ${model} (HTTP ${res.status}): ${errText.slice(0, 200)}`;
          continue;
        }

        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .filter(Boolean)
          .join('\n')
          .trim();

        if (!text) {
          lastError = `Key ${i + 1} returned an empty response from ${model}.`;
          continue;
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, keyUsed: i + 1, model }),
        };
      } catch (err) {
        lastError = `Key ${i + 1} failed on ${model}: ${err.message}`;
      }
    }
  }

  return {
    statusCode: 502,
    body: JSON.stringify({ error: 'All Gemini keys failed or are rate-limited. Try again shortly.', detail: lastError }),
  };
};
