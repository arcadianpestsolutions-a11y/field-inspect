# UI review - where Scope is strong, where it is weak

Reviewed 8 Oct 2026 on build v106/v107, in the demo app at phone sizes (320, 375
and 390 px wide) in an emulated browser, plus a 2,400-step random-tapping run.

**How to read this.** Two limits, stated first:
* It was **not** tested on a real phone, in sunlight, or with gloves. Those are
  the conditions the design is for, and they are the biggest unknown.
* The comparisons are from general knowledge of the apps named (Jobber,
  ServiceM8, SafetyCulture/iAuditor, Apple Calendar/Fantastical, Things, Linear).
  No side-by-side was done. Treat them as "what people expect from good apps",
  not as measurements.

## Where it is genuinely good
| Strength | Why it counts |
|---|---|
| **The report checklist.** A list of sections with a clear done / not-done mark each, one tap to open | Same pattern as SafetyCulture's inspection list, which is the standard for field checklists. Scope's is easy to read at a glance |
| **One obvious primary action.** The glowing "Start Inspection" button | Matches ServiceM8 and Jobber: the next step is never hidden |
| **Colour means something.** Green = fine, amber = look at this, red = wrong | Used consistently on badges, due dates, and errors. Few apps are this disciplined |
| **Honest, plain messages.** "Not sent. There is no mobile number on this job. Add one..." | Better than most commercial apps, which show codes or "Something went wrong" |
| **Big, forgiving controls.** 44-48 px targets, 16 px text in inputs (stops iOS zooming) | Right for gloves and moving hands |
| **Proactive nudges.** "2 clients booked tomorrow haven't had a reminder yet" | Few small-business tools do this; it turns a forgotten chore into one tap |
| **Safe by design.** Confirm before deleting, and before any mass send, with the exact count | Prevents the expensive mistakes |
| **Held up under abuse.** 14 out-of-order scenarios and ~2,400 random taps with no crash, no unreachable controls, no sideways scrolling at 320 px, long and hostile text contained | The layout is robust |

## Where it was lacklustre, and what was done this round
| Problem seen | Compared with good apps | Fix (v107) |
|---|---|---|
| **A job's name, phone, email and address could never be edited after creation.** A typo meant reminders to the wrong person | Every job app lets you edit the client | New "Job details" card with Edit |
| **No tap-to-call, no directions** on a job | Jobber/ServiceM8: Call, Text, Navigate on the job card | Call, Email and Directions links on the card |
| **Screen titles cut off after ~12 characters** because of wide-spaced capitals ("WHITMORE COTT...") | A title should show the name. The client's name is the title | Normal-case titles, up to two lines |
| **Dangling "·" separators** wrapping onto their own lines in job cards | Looks unfinished | Separators removed; items wrap whole |
| **The "+ New Job" button covered the last card and the form fields** | Floating buttons need scroll room and should step aside | Extra bottom space; hidden while the form is open |
| **Blank cards for jobs with no name**; a leftover search made jobs seem lost, with no way back | Search shows what is filtered and offers "clear" | Falls back to the address; "Show all jobs" button; search also matches phone numbers |
| **Tapping "New enquiry / New client" and backing out left a blank record** | Nothing should be saved until something is typed | Blank ones are removed on Back |
| **Double tap on Create Job made two jobs and two clients** (same for enquiry, client, safety statement) | Buttons disable while working | One at a time |
| **A failed photo save was silent.** The shutter clicked, nothing said it had not kept the picture | iPhone Camera never loses a photo without saying | Plain message ("That photo was NOT saved. This phone is out of storage...") |

## Still lacklustre (not fixed; ranked by how much they matter)
1. **No "Today" view.** The first screen is a list of every job. ServiceM8, Jobber,
   and calendar apps open on *today's jobs, in order, with travel*. For a person
   driving between properties this is the screen that matters most. (The scheduler
   exists but is a menu away.)
2. **Navigation is hidden behind "..."**. Clients, Business/invoices, Archive, SWMS,
   and Assets are two taps away; the top bar has two emoji icons. Good apps use a
   bottom tab bar (Today, Jobs, Clients, More). The emoji icons also clash with the
   instrument-panel look.
3. **The job screen buries the next step.** Cards for "Automated messages" and
   "standing plan" sit above the main action, and the document-type chooser takes
   half the screen on a job that already knows its document. "Open Report" looks
   quieter than "Start Inspection" even when it is the next thing to do.
4. **No sense of progress.** The report list does not say "5 of 11 done" and the
   "Finalise" step is not always in view. SafetyCulture shows a progress bar and a
   pinned "Complete" action.
5. **The job card shows its creation date**, not the appointment, next to the
   address. It reads like the booking date and is not.
6. **Dark-only theme is an untested assumption.** The design notes argue a white
   screen is a mirror in the sun. In practice many phones are *easier* to read in
   direct sunlight with a light, high-contrast theme, and dark helps battery. Only a
   real phone, outdoors, can settle it; offering both is the safe answer.
7. **No undo.** Deleting a job asks first, but there is no "Undo" afterwards (Gmail,
   Things). Combined with no in-app restore, a wrong "yes" is permanent.
8. **Sync state is a small text line with a "Sync now" link** (shown when signed in;
   not visible in the demo, so not judged here). There is no progress indicator,
   pull-to-refresh, or skeleton/loading state, so on weak signal the app may look
   frozen rather than "working".
9. **Status bar colour is navy**, not the app's near-black green (a one-line fix).
10. **Accessibility not measured**: contrast ratios, screen-reader order and large-text
    behaviour have not been checked.

## Suggested order
1. A real half-day outdoors with the app on a real phone (settles items 6 and the
   whole "does it work in a subfloor" question).
2. A Today screen as the first screen (item 1).
3. A bottom tab bar (item 2).
4. Job screen: details, then next step; progress on the report list (items 3 and 4).
5. Undo for delete (item 7).
