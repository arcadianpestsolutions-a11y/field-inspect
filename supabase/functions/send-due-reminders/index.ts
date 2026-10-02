// RETIRED. This function no longer does anything, on purpose.
//
// It used to find jobs whose annual re-inspection was three months out and
// email the client. send-client-message does that now, under
// `{"sweep": "due_reminder"}`, and this endpoint answers 410 Gone.
//
// ---------------------------------------------------------------------------
// WHY IT WAS RETIRED RATHER THAN FIXED.
//
// It had no org filter. It authenticated the caller — any signed-in
// technician of any business — and then ran every query on the service_role
// key, which bypasses row-level security completely. So one request from any
// account would:
//
//   * read every business's jobs, including client names and email addresses,
//     and return them in the response body;
//   * email every one of those clients, from this business's sending address
//     and signed with this business's name;
//   * stamp reminder_sent_for_due_at on another business's jobs, so the real
//     owner's own reminder would then be silently skipped as already sent.
//
// It also did not check comms_opt_out, so a client who had asked not to be
// contacted would have been emailed anyway.
//
// Meanwhile send-client-message had the org filter, the opt-out check, the
// email validation and the send log — and no timing rules at all: its
// due_reminder sweep selected every job with a due date set, and would have
// emailed a client whose inspection was eleven months away.
//
// Each had the half the other was missing. Patching this one would have left
// two functions emailing the same clients from two copies of the same rules,
// which is how one of them quietly goes stale. So the timing rules moved to
// _shared/due-reminder.js, where send-client-message now reads them and where
// the test suite can cover them, and this is a tombstone.
//
// THE DEPLOYED FUNCTION IS LEFT IN PLACE rather than deleted, so that anything
// still pointed at this URL — a cron entry, a bookmark, a note — gets a clear
// answer instead of a 404 that reads like a broken deployment. Nothing in the
// app ever called it.
//
// The replacement, as a dry run first (it always defaults to one):
//
//   POST /functions/v1/send-client-message  {"sweep": "due_reminder"}
//
// Signed in, that sweeps the caller's own business. Called with the
// service-role key, as a schedule does, it sweeps each business separately.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  return new Response(JSON.stringify({
    error: 'gone',
    message: 'send-due-reminders has been retired. Use send-client-message with '
      + '{"sweep": "due_reminder"} — it is scoped to one business, honours '
      + 'comms_opt_out, and logs what it sends.',
    replacement: 'send-client-message',
  }), {
    status: 410,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
