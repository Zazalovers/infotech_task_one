// Single-page UI served at GET /. Kept as a string (not a static file) so it also works on
// Cloudflare Workers, which have no filesystem. It only calls the public JSON API.
export const composePageHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mail Queue</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #ffffff; --text: #1b1f24; --muted: #5f6b7a; --border: #d8dde3;
    --accent: #2f6fde; --accent-text: #ffffff; --ok: #1a7f37; --warn: #9a6700; --err: #c62828;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216; --card: #171b21; --text: #e6e9ed; --muted: #95a0ad; --border: #2c333c;
      --accent: #5b8ff0; --accent-text: #0f1216; --ok: #4ac26b; --warn: #d4a72c; --err: #f47067;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; justify-content: center; padding: 48px 16px;
  }
  main { width: 100%; max-width: 560px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; font-size: .95rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
  label { display: block; font-weight: 600; font-size: .9rem; margin: 0 0 6px; }
  input, textarea {
    width: 100%; font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin: 0 0 16px;
  }
  textarea { min-height: 160px; resize: vertical; }
  input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
  button {
    width: 100%; font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 12px;
    background: var(--accent); color: var(--accent-text); cursor: pointer;
  }
  button:disabled { opacity: .6; cursor: progress; }
  details { margin: 0 0 16px; color: var(--muted); font-size: .9rem; }
  details summary { cursor: pointer; margin-bottom: 8px; }
  #status { margin-top: 16px; font-size: .95rem; min-height: 1.5em; }
  .pending { color: var(--warn); } .sent { color: var(--ok); } .failed, .error { color: var(--err); }
  .meta { color: var(--muted); font-size: .85rem; word-break: break-all; }
  .health { font-size: .85rem; color: var(--muted); margin-top: 16px; text-align: center; }
</style>
</head>
<body>
<main>
  <h1>Send an email</h1>
  <p class="sub">Emails are queued and delivered by the background worker via Resend.</p>

  <form id="form" class="card" autocomplete="off">
    <label for="to">To</label>
    <input id="to" name="to" type="email" required value="delivered@resend.dev">

    <label for="subject">Subject</label>
    <input id="subject" name="subject" type="text" required maxlength="200" placeholder="Hello!">

    <label for="body">Body</label>
    <textarea id="body" name="body" required placeholder="Write your message…"></textarea>

    <details id="keyBox">
      <summary>API key</summary>
      <input id="apiKey" type="password" placeholder="x-api-key (saved in this browser)">
    </details>

    <button id="send" type="submit">Send</button>
    <div id="status" role="status" aria-live="polite"></div>
  </form>

  <p class="health" id="health">Checking service…</p>
</main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('form'), sendBtn = $('send'), status = $('status'), apiKey = $('apiKey');

  try { apiKey.value = localStorage.getItem('mailQueueApiKey') || ''; } catch {}
  if (!apiKey.value) $('keyBox').open = true;
  apiKey.addEventListener('change', () => {
    try { localStorage.setItem('mailQueueApiKey', apiKey.value); } catch {}
  });

  function show(text, cls, meta) {
    status.className = cls || '';
    status.textContent = text;
    if (meta) {
      const m = document.createElement('div');
      m.className = 'meta';
      m.textContent = meta;
      status.appendChild(m);
    }
  }

  async function api(path, options) {
    const res = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey.value, ...(options && options.headers) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = body.error || {};
      const details = (err.details || []).map((d) => d.path + ': ' + d.message).join('; ');
      throw new Error((err.message || 'Request failed (' + res.status + ')') + (details ? ' — ' + details : ''));
    }
    return body;
  }

  async function watch(id) {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api('/emails/' + id);
      if (job.status === 'sent') return show('Sent ✓', 'sent', 'Job ' + job.id + ' · Resend id ' + job.providerMessageId);
      if (job.status === 'failed') return show('Failed after ' + job.attempts + ' attempts', 'failed', job.lastError);
      const retry = job.attempts > 0 && job.lastError ? ' (attempt ' + job.attempts + ' failed, retrying…)' : '';
      show('Queued, waiting for the worker' + retry, 'pending', 'Job ' + job.id);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!apiKey.value) { $('keyBox').open = true; apiKey.focus(); return show('Enter the API key first.', 'error'); }
    sendBtn.disabled = true;
    show('Queuing…', 'pending');
    try {
      const job = await api('/emails', {
        method: 'POST',
        body: JSON.stringify({ to: $('to').value, subject: $('subject').value, text: $('body').value }),
      });
      show('Queued, waiting for the worker', 'pending', 'Job ' + job.id);
      $('subject').value = ''; $('body').value = '';
      await watch(job.id);
    } catch (err) {
      show(err.message, 'error');
    } finally {
      sendBtn.disabled = false;
    }
  });

  fetch('/health').then((r) => r.json()).then((h) => {
    $('health').textContent = 'Service ' + (h.status === 'ok' ? 'healthy' : 'degraded') +
      ' · database ' + h.database.status + ' · v' + h.app.version;
  }).catch(() => { $('health').textContent = 'Service unreachable'; });
})();
</script>
</body>
</html>
`;
