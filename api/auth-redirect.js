// Handles Supabase auth email links (password reset, magic links)
// Supabase sends tokens in the URL fragment (#), which never reaches the server.
// This page uses client-side JS to read the fragment and redirect to cyrano://
export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Opening Cyrano...</title>
        <style>
          body { background: #0F0F13; color: #fff; font-family: -apple-system, sans-serif;
                 display: flex; flex-direction: column; align-items: center; justify-content: center;
                 height: 100vh; margin: 0; text-align: center; padding: 24px; box-sizing: border-box; }
          h2 { margin-bottom: 8px; }
          p { color: #888; font-size: 14px; margin-top: 16px; }
          a { color: #8B5CF6; }
        </style>
      </head>
      <body>
        <h2>🎭 Opening Cyrano...</h2>
        <p id="msg">Redirecting to the app...</p>
        <script>
          // Tokens are in the fragment (#), not query string
          var fragment = window.location.hash.substring(1); // strip leading #
          var deepLink = 'cyrano://auth-callback?' + fragment;
          document.getElementById('msg').innerHTML =
            'If the app doesn\\'t open automatically, <a href="' + deepLink + '">tap here</a>.';
          window.location.href = deepLink;
        </script>
      </body>
    </html>
  `);
}
