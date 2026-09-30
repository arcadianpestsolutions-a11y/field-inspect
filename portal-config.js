// The one thing portal.html needs to know: where to ask.
//
// Split out of the page so the page itself carries no project-specific URL,
// and so this is the only file to change if the backend ever moves. It holds
// no key and no secret — the endpoint is public by design, and the token in
// each client's own link is the only thing that unlocks anything.
window.PORTAL_ENDPOINT = (window.SUPABASE_URL || 'https://aleadvxqoqmfxtqpiikd.supabase.co')
  .replace(/\.supabase\.co\/?$/, '.supabase.co/functions/v1') + '/client-portal';
