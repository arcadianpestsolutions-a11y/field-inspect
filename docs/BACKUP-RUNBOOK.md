# Backing up Scope's cloud data

Read this once. After the one-off setup, a backup is one command and takes about a
minute.

## Why you need to do this yourself

Your data lives in two places: each phone, and the cloud (Supabase). **Neither is a
backup.** If the cloud is lost or damaged, or someone deletes the project, the phones
are all that is left, and phones get lost too.

I checked Supabase's own documentation on 8 October 2026:

* Your cloud is on the **free plan, which takes no automatic backups at all.** Supabase
  tell free-plan users to export their data regularly and keep copies somewhere else.
* **Photographs are never backed up, on any plan, even paid ones.** Their database
  backups do not include stored files, and every inspection photo is a stored file.
* If a project is deleted, its data and any backups of it are removed permanently.

So the only backup of your photos that will ever exist is the one you make.

**How big is it?** Today: a 13 MB database and 41 files totalling 31 MB. A whole backup
is roughly 45 MB and takes about a minute.

## One-off setup (about 15 minutes)

### 1. Install the PostgreSQL command line tools

The database copy is made by a program called `pg_dump`. This computer does not have it.

1. Go to **postgresql.org/download/windows** and download the installer.
2. Run it. When it asks which components to install, **untick everything except
   "Command Line Tools"**. (You do not need the database server itself.)
3. Choose version **17 or newer**. Your database is version 17; an older `pg_dump` will
   refuse to copy it.
4. Add it to the Windows PATH so the script can find it. The usual folder is
   `C:\Program Files\PostgreSQL\17\bin` (the number may differ):
   Start menu, type **environment variables**, open **Edit the system environment
   variables**, click **Environment Variables**, select **Path** under your user,
   click **Edit**, **New**, and paste that folder.
5. Close and reopen PowerShell, then check:

```powershell
pg_dump --version
```

It should print a version number of 17 or more.

### 2. Get your database password

1. Open the Supabase dashboard, then your project, then **Project Settings**, then
   **Database**.
2. You cannot read the existing password. Click **Reset database password** and save the
   new one in your password manager.

Resetting it is safe. I searched all of Scope's code: nothing uses the database password.
The app and its functions all connect with API keys instead.

### 3. Check everything is in place

From the Scope folder:

```powershell
powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -Check
```

You want every line to say `[OK]`. A line that says `[FIX]` tells you what to do. This
check downloads nothing and changes nothing.

## Making a backup

```powershell
powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1
```

It will:

1. Download every photo and PDF.
2. Ask for your database password. Typing is hidden and it is **not saved anywhere**.
3. Copy the database, then check the copy can be read back.
4. Tell you where the folder is, for example
   `Documents\Scope-Backups\2026-10-09_0930`.

**Then copy that whole folder somewhere else** (a USB stick, or Google Drive). A backup
that only lives on this computer protects you from the cloud failing, not from this
computer failing.

The script only ever downloads. It cannot change, delete or upload anything online.

### How often

* **Weekly**, on a day you will remember. Put a repeating reminder in your calendar.
* **Before** any change to the database (a migration).
* **After** a very big day of work.

Scope's Archive screen also shows "Last backup: N days ago". That is for the **Export**
button, which is a different, smaller backup (see below). It does not know about this one.

### How to tell it worked

Open the new folder. You should see:

* a file ending `.dump` (a few megabytes),
* a folder `inspection-media` with the photos in it,
* a `README.txt`.

If there is a file called `INCOMPLETE.txt`, the backup did not finish. Delete that
folder and run it again.

## Making it automatic (weekly)

Do the three set-up steps above first, and make one backup by hand to prove it works.
Then, once:

1. Save the database password for the schedule. It asks you to type it (hidden). It is
   saved scrambled so that only **your Windows login on this computer** can unscramble
   it, in `%LOCALAPPDATA%\Scope-Backup`, outside the project and never inside a backup:

   `powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -SavePassword`

2. Test that the automatic version has everything it needs:

   `powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -Check -Unattended`

3. Switch on the weekly schedule (Sundays 10:00; if the computer is off it runs when
   next on). Add `-DryRun` first to see what it would do:

   `powershell -ExecutionPolicy Bypass -File tools\install-backup-schedule.ps1`

   Add `-CopyTo "D:\Backups"` (or a Google Drive / OneDrive folder) to also put a second
   copy somewhere else. **Do this**: a backup that only lives on this computer does not
   survive this computer failing.

What it does by itself:
* Runs only while you are logged in (that is what lets it unscramble the password).
* Keeps the newest 8 finished backups and removes older ones (`-Keep 0` keeps all).
  It only ever removes folders it made itself, and never the newest.
* Writes `backup.log`, and leaves **`LAST-BACKUP-OK.txt`** after a good run or
  **`BACKUP-FAILED.txt`** (with the reason) after a bad one, in `Documents\Scope-Backups`.
  **Look for these once a week**; nothing else tells you. A missing `LAST-BACKUP-OK.txt`
  date more than 8 days old means it is not running.
* If you change the database password in Supabase, run step 1 again.
* To stop it: `powershell -ExecutionPolicy Bypass -File tools\install-backup-schedule.ps1 -Remove`
  (to forget the password too, delete the `Scope-Backup` folder in `%LOCALAPPDATA%`).


## Getting it back

**Do not wait until there is an emergency to find out whether this works.** A backup
nobody has restored is a hope, not a backup. Have a professional do a practice restore
into a spare free Supabase project once, and keep the notes.

What the backup contains: the whole database (jobs, reports, invoices, clients,
enquiries, safety statements, and the user accounts) and every photo and PDF.

What it does **not** contain, and must be re-created by hand:

* **Secrets.** The API keys set in Supabase (the AI keys, the email key, the text
  message keys, the inbound-text token). Keep these in your password manager.
* **Edge Function code.** That lives in the code repository, not the backup. Redeploy
  with `supabase functions deploy <name>`.
* **Supabase's own settings**, such as sign-in options and email templates.
* **Which Edge Functions have sign-in checking turned off.** That is recorded in
  `supabase/config.toml`, and applies when you deploy.

The shape of a restore, for whoever does it:

1. Create a new Supabase project.
2. Restore the dump into it with `pg_restore --no-owner --clean --if-exists -d <new
   connection string> <file>.dump`. It will print some warnings about Supabase's
   built-in parts; they are expected.
3. Upload the `inspection-media` folder back into a bucket of the same name.
4. Point the app at the new project: change the address and key in
   `supabase-config.js`, and the address in `portal-config.js`.
5. Set the secrets and redeploy the Edge Functions.

Step 3 is the fiddly one, because the restored database already lists the files. That is
the other reason to practise it once.

## About the Export button

The Archive screen's **Export All Data** button makes a quick text copy of jobs, reports,
invoices, clients, enquiries and safety statements, without photos. It is handy before a
risky edit, and on an iPhone it saves through the share sheet. **It is not a substitute
for this backup**, and nothing in the app can read it back in.

## Your other options

| Option | What you get | What it costs |
| --- | --- | --- |
| This runbook | A full copy including photos, whenever you run it | Free, and you have to remember |
| Supabase **Pro** plan | Daily automatic database backups kept for 7 days, and no project pausing | Paid monthly (check current pricing). **Still nothing for photos** |
| Both | Daily database backups, plus your own copy of the photos | Paid, plus the weekly job |

If you ever go on Pro, keep making the photo copy.

## Keep it private

The backup folder holds your clients' names, addresses, phone numbers and photographs
of the inside of their homes. Treat it as carefully as the app itself: do not email it,
and do not leave it on a shared computer.
