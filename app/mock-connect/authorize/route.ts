import { claimsForEmail, signIdToken } from '../../../lib/mock-connect';

export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

function renderPage(params: URLSearchParams, error?: string): string {
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? '';
  const clientId = params.get('client_id') ?? '';
  const scope = params.get('scope') ?? 'openid email';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Null&rsquo;s Connect</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background: radial-gradient(700px 400px at 20% 0%, rgba(80,200,160,.14), transparent 60%), #08090d;
    color:#e9ebf1; font-family:'Inter',system-ui,-apple-system,sans-serif; }
  .card { width:min(420px,100% - 32px); background:#12141b; border:1px solid #232733; border-radius:22px;
    padding:28px; box-shadow:0 24px 60px rgba(0,0,0,.5); }
  .logo { width:44px; height:44px; border-radius:13px; display:grid; place-items:center; font-weight:800;
    color:#06120d; background:linear-gradient(140deg,#9ef0c8,#4fd1a5); margin-bottom:16px; }
  h1 { margin:0 0 4px; font-size:22px; letter-spacing:-.02em; }
  .sub { color:#98a0b3; font-size:14px; margin:0 0 20px; }
  label { display:block; font-size:13px; font-weight:600; color:#98a0b3; margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; padding:11px 13px; border-radius:10px; border:1px solid #2f3542;
    background:#0b0d12; color:#e9ebf1; font-size:14px; outline:none; }
  input:focus { border-color:#4fd1a5; box-shadow:0 0 0 3px rgba(79,209,165,.15); }
  button { width:100%; margin-top:16px; padding:12px; border:none; border-radius:10px; cursor:pointer;
    font-weight:700; font-size:14px; color:#06120d; background:linear-gradient(140deg,#9ef0c8,#4fd1a5); }
  .meta { margin-top:18px; font-size:11.5px; color:#6c7488; line-height:1.6; }
  .err { background:rgba(255,92,122,.1); border:1px solid rgba(255,92,122,.35); color:#ffb3c1;
    padding:9px 12px; border-radius:10px; font-size:13px; margin-bottom:14px; }
  code { font-family:ui-monospace,monospace; }
</style></head>
<body>
  <div class="card">
    <div class="logo">NC</div>
    <h1>Null&rsquo;s Connect</h1>
    <p class="sub">Sign in — enter your email address</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/mock-connect/authorize">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}"/>
      <input type="hidden" name="state" value="${escapeHtml(state)}"/>
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}"/>
      <input type="hidden" name="scope" value="${escapeHtml(scope)}"/>
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" placeholder="you@example.com" required autofocus/>
      <button type="submit">Proceed</button>
    </form>
    <p class="meta">
      This is the bundled local identity provider of the NT Scripting clone.
      It issues a real HS256 <code>id_token</code> and redirects to
      <code>${escapeHtml(redirectUri)}</code> with the token in the URL fragment,
      exactly like the upstream provider (<code>response_type=id_token</code>, <code>client_id=${escapeHtml(clientId)}</code>).
    </p>
  </div>
</body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return new Response(renderPage(url.searchParams), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) params.set(key, String(value));

  const email = String(form.get('email') ?? '').trim();
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const state = String(form.get('state') ?? '');
  const clientId = String(form.get('client_id') ?? '9');

  if (!email.includes('@')) {
    return new Response(renderPage(params, 'Enter a valid email address'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return new Response('Invalid redirect_uri', { status: 400 });
  }

  const issuer = new URL(request.url).origin;
  const token = signIdToken(claimsForEmail(email, clientId, issuer));
  target.hash = `id_token=${token}&state=${encodeURIComponent(state)}&token_type=bearer`;

  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
  });
}
