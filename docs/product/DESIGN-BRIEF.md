# Design Brief - Scope

## 1. Who and where
A technician, often alone, in a roof void, subfloor, or full Australian sun,
wearing gloves, with a scratched screen protector and no signal. They are
looking at the screen for two seconds at a time. The interface is a **tool**, not
a consumer app. Reference point: cockpit instrument panel.

## 2. Principles
1. **Glanceable.** Status is readable in one look, from colour and a short word.
2. **Colour is meaning, never decoration.**
   * Green: nominal, primary action, it worked.
   * Amber: caution, due soon, needs a look.
   * Red: warning, overdue, destructive, it failed.
   If amber appears, it wants attention; do not spend it on style.
3. **Never lose work, and say so.** Every error message states what was saved
   before what went wrong.
4. **One question at a time.** Dialogs ask a single thing with a clear safe default.
5. **Big, forgiving targets.** Minimum 44 px; primary actions 48 px; no
   precision gestures required for essential actions.
6. **Plain words.** Written for a tired person, not a developer. No codes, no
   "undefined", no jargon. The owner's standard: "like talking to a child".
7. **Honest AI.** AI output is labelled as a suggestion with its reason, and
   always asks to be confirmed. It is never styled like a finding.
8. **Calm failure.** An opt-out is a choice, not a fault; "not sent" is stated
   neutrally with the next step.

## 3. Visual language (as built, from `styles.css`)
| Token | Value | Use |
|---|---|---|
| `--bg` | #080b0a (gunmetal, faint green) | App background |
| `--bg-elev` / `--card` | #101614 / #161e1b | Surfaces |
| `--border` | #2a3a34 | Dividers |
| `--text` / `--text-dim` | #e6f1ea / #7f978c | Body / secondary |
| `--accent` | #3dff88 (ink #032012) | Primary action, nominal |
| `--accent-2` / `--warning` | #ffb000 (ink #2a1b00) | Caution, informational |
| `--danger` | #ff4d4d (ink #330505) | Destructive, failed, overdue |
| Glows | 0.26-0.28 alpha halos | Make active controls read as lit, not painted |

* **Type:** system sans (San Francisco / Roboto / Segoe) for prose; the system
  monospace stack for *readouts*: times, dates, counts, IDs, money.
* **Theme:** dark by design for outdoor glare-with-low-reflectance and battery.
  There is no light theme; this is deliberate, not an omission.
* **Layout:** single column, full-width cards, bottom-reachable actions, safe-area
  insets respected (notch and home indicator).
* **Motion:** minimal. Feedback is haptic (vibration) and a short click sound on
  shutter and record start/stop, so the user need not look.

## 4. Components
| Component | Rule |
|---|---|
| Status badge | Short word + semantic colour: New, Inspection In Progress, Report Review, Completed |
| Toast | Short, non-blocking, never intercepts taps (`pointer-events: none`); longer text lasts longer |
| Dialog | In-app (native confirm/prompt do not render on iOS home-screen apps); one question; Back answers "no" |
| Banner | The 14:00 reminder nudge; dismissible for the day; stays when something needs reading |
| Pre-flight list | States exactly what blocks finalising, one line each, tap to jump |
| Field types | text, choice cards, product table, signature pad, sketch, photo slots |
| Gallery | Grid by zone; long-press multi-select; pinch-zoom/pan/swipe on detail |
| Sync indicator | Plain sentence; "your work is safe on this device" when offline |

## 5. Content and tone
* Say what happened, what was saved, what to do next. Example:
  *"Not sent. There is no mobile number on this job. Add one in the job details
  and the reminder will go out the day before."*
* Legal wording is fixed: "No live termites found" framing must never be
  paraphrased or inverted by the interface.
* Currency AUD with GST shown; dates in `d MMM yyyy`, local (NSW) time.
* Australian spelling.

## 6. Print and client-facing design
* Report/PDF: white page, black text, the business's name, ABN, licence, phone,
  email from the database (never hard-coded); clear section headings; photos with
  captions; signature and date; page breaks that never split a signature or table row.
* Client portal and messages: simple, mobile-first, light, no login, no jargon;
  one obvious action (read, or accept).
* SMS: short, business name first, "Reply STOP to opt out".

## 7. Accessibility
* Contrast: text should meet WCAG AA against `--bg`/`--card` (not formally measured); verify any new
  amber-on-dark pair.
* Do not rely on colour alone: status is always also a word.
* Touch targets at least 44 px; no hover-only controls.
* Works with browser text size increases; avoid fixed-height text containers.

## 8. Known design debt
* `<meta name="theme-color">` is #0f172a (navy), not the gunmetal background;
  the status bar colour does not match the panel.
* No light theme or user setting for contrast.
* No formal icon set; some icon-only buttons rely on emoji (e.g. the reminder
  bell) with `aria-label`s.
* No visual regression tests; layout is checked by hand and by element-hit tests.
* `[DECISION]` If the product is ever offered to other businesses, the green
  "radar" identity needs a decision: keep as Scope's brand or make per-business.
