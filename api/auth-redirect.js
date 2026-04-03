// Handles Supabase auth email links (password reset, magic links)
// Redirects to the cyrano:// deep link so the app can handle the token
export default function handler(req, res) {
  const { access_token, refresh_token, type, token_hash, next } = req.query;

  // Build the deep link with all params passed through
  const params = new URLSearchParams();
  if (access_token) params.set('access_token', access_token);
  if (refresh_token) params.set('refresh_token', refresh_token);
  if (type) params.set('type', type);
  if (token_hash) params.set('token_hash', token_hash);
  if (next) params.set('next', next);

  const deepLink = `cyrano://auth-callback?${params.toString()}`;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Opening Cyrano...</title>
        <meta http-equiv="refresh" content="0; url=${deepLink}" />
        <style>
          body { background: #0F0F13; color: #fff; font-family: -apple-system, sans-serif;
                 display: flex; flex-direction: column; align-items: center; justify-content: center;
                 height: 100vh; margin: 0; }
          p { color: #888; font-size: 14px; margin-top: 16px; }
          a { color: #8B5CF6; }
        </style>
      </head>
      <body>
        <h2>🎭 Opening Cyrano...</h2>
        <p>If the app doesn't open, <a href="${deepLink}">tap here</a>.</p>
        <script>window.location.href = "${deepLink}";</script>
      </body>
    </html>
  `);
}
