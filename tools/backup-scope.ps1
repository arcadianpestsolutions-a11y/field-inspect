<#
.SYNOPSIS
  Makes a dated copy of Scope's cloud data (the database and the photo files) on
  THIS computer.

.DESCRIPTION
  Why this exists: Scope's cloud is on Supabase's free plan, which takes no
  automatic backups, and no Supabase plan backs up the photo files. See
  docs/BACKUP-RUNBOOK.md for the full explanation and how to restore.

  What it does, in order:
    1. Checks everything it needs is in place. With -Check it stops here.
    2. Downloads every file from the photo bucket.
    3. Dumps the database with pg_dump into one compressed file.
    4. Checks the dump can be read back (pg_restore --list).
    5. Writes a README.txt into the backup folder saying what it is.

  What it will NOT do:
    * It never changes anything online. It only downloads. There is no upload,
      delete, update or restore anywhere in this file.
    * It never writes outside the backup folder.
    * It never stores your database password. It asks for it, keeps it in memory
      while pg_dump runs, and clears it.
    * It never prints client data. It prints counts and sizes.

.PARAMETER Check
  Run the checks and stop. Downloads nothing. Safe to run any time.

.PARAMETER Folder
  Where backups go. Default: Documents\Scope-Backups. Each run makes its own
  dated sub-folder, so nothing is ever overwritten.

.PARAMETER SavePassword
  One-off setup for automatic backups. Asks for the database password (hidden) and
  saves it, scrambled so that only YOUR Windows login on THIS computer can unscramble
  it, in %LOCALAPPDATA%Scope-Backup. Never in the project folder, never in a backup.
  Run it again to change the password. Delete that folder to forget it.

.PARAMETER Unattended
  For the scheduled task: no questions asked. Uses the saved password, writes a log
  (backup.log), and on any failure leaves BACKUP-FAILED.txt in the backup folder so a
  failed night is visible instead of silent. On success writes LAST-BACKUP-OK.txt.

.PARAMETER Keep
  After a successful backup, keep this many finished backups and remove older ones.
  Default 8 (about two months of weekly backups). 0 keeps everything. Only folders
  this script made (named like 2026-10-08_1030, holding a README.txt) are ever removed,
  and the newest is never removed.

.PARAMETER CopyTo
  A second place to copy each finished backup to (a USB drive, or a Google Drive or
  OneDrive folder). A backup on one computer does not survive that computer failing.

.PARAMETER Cli
  Path to supabase.exe if it is not in .tools\ next to this folder or on PATH.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -Check

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1

.NOTES
  Written for Windows PowerShell 5.1 (the one that ships with Windows 10 and 11).
  Do not use syntax newer than that here: no ternary, no ??, no &&.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$SavePassword,
  [switch]$Unattended,
  [int]$Keep = 8,
  [string]$CopyTo,
  [string]$Folder = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Scope-Backups'),
  [string]$Cli
)

$ErrorActionPreference = 'Stop'

# The project root is the folder above tools\. The CLI finds the linked project
# through <root>\supabase\.temp, which is why it is passed as --workdir below.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Bucket = 'inspection-media'
$Problems = New-Object System.Collections.ArrayList

function Write-Ok($text)  { Write-Host ('  [OK]  ' + $text) -ForegroundColor Green }
function Write-Fix($text, $how) {
  Write-Host ('  [FIX] ' + $text) -ForegroundColor Yellow
  if ($how) { Write-Host ('        ' + $how) -ForegroundColor Yellow }
  [void]$Problems.Add($text)
}

# Where the saved password lives. DPAPI ties the scrambled text to this Windows
# user on this computer, so the file is useless if copied anywhere else.
$PwDir = Join-Path $env:LOCALAPPDATA 'Scope-Backup'
$PwFile = Join-Path $PwDir 'db-password.dat'
$LogFile = Join-Path $Folder 'backup.log'

function Write-Log($text) {
  # Only used for unattended runs, and only once the backup folder exists.
  try {
    if (-not (Test-Path $Folder)) { New-Item -ItemType Directory -Path $Folder -Force | Out-Null }
    Add-Content -Path $LogFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $text)
  } catch { }
}

function Stop-Failed($why) {
  # Unattended runs have nobody watching, so a failure must leave something a
  # person will notice. Never contains the password or any client data.
  Write-Log ('FAILED: ' + $why)
  try {
    if (-not (Test-Path $Folder)) { New-Item -ItemType Directory -Path $Folder -Force | Out-Null }
    Set-Content -Path (Join-Path $Folder 'BACKUP-FAILED.txt') -Value @(
      ('The automatic Scope backup failed on ' + (Get-Date -Format 'dddd d MMMM yyyy, h:mm tt') + '.'),
      '',
      $why,
      '',
      'No backup was made this time. See backup.log in this folder, or run the backup by hand:',
      '  powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -Check'
    )
  } catch { }
  exit 1
}

# One-off setup: remember the database password, scrambled, for the schedule.
if ($SavePassword) {
  Write-Host ''
  Write-Host 'Save the database password for automatic backups' -ForegroundColor Cyan
  Write-Host '  Find it: Supabase dashboard > Project Settings > Database.'
  Write-Host '  Typing is hidden. It is saved scrambled so only your Windows login on this'
  Write-Host ('  computer can read it, in ' + $PwDir + ' (outside the project).')
  $pw = Read-Host '  Database password' -AsSecureString
  if ($pw.Length -lt 1) { Write-Host 'Nothing typed. Nothing saved.' -ForegroundColor Yellow; exit 1 }
  New-Item -ItemType Directory -Path $PwDir -Force | Out-Null
  $pw | ConvertFrom-SecureString | Set-Content -Path $PwFile
  Write-Host ''
  Write-Host 'Saved. Next: run  tools\backup-scope.ps1 -Check -Unattended  to test it.' -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------------------
# 1. Pre-flight checks. Nothing here changes anything or reads client data.
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'Scope backup - checking everything is in place' -ForegroundColor Cyan
Write-Host ''

# The Supabase command-line tool.
if (-not $Cli) {
  $candidate = Join-Path $Root '.tools\supabase.exe'
  if (Test-Path $candidate) { $Cli = $candidate }
  else {
    $onPath = Get-Command supabase -ErrorAction SilentlyContinue
    if ($onPath) { $Cli = $onPath.Source }
  }
}
if ($Cli -and (Test-Path $Cli)) {
  $cliVersion = (& $Cli --version) 2>&1 | Select-Object -First 1
  Write-Ok ('Supabase tool found (version ' + $cliVersion + ')')
} else {
  Write-Fix 'The Supabase tool (supabase.exe) was not found.' 'Put it in the .tools folder, or pass -Cli "C:\path\to\supabase.exe".'
}

# Which project, from the link the CLI already holds.
$refFile = Join-Path $Root 'supabase\.temp\project-ref'
$pgVersionFile = Join-Path $Root 'supabase\.temp\postgres-version'
$poolerFile = Join-Path $Root 'supabase\.temp\pooler-url'
$ProjectRef = $null
if (Test-Path $refFile) {
  $ProjectRef = (Get-Content $refFile -Raw).Trim()
  Write-Ok ('Linked to project ' + $ProjectRef)
} else {
  Write-Fix 'This folder is not linked to a Supabase project.' 'Run:  .tools\supabase.exe link --project-ref <your project ref>'
}

# Logged in, and the photo bucket visible. Lists bucket NAMES only.
if ($Cli -and $ProjectRef) {
  try {
    $buckets = (& $Cli storage ls 'ss:///' --linked --experimental --workdir $Root) 2>&1 | Out-String
    if ($buckets -match [regex]::Escape($Bucket)) { Write-Ok ('Logged in, and the photo bucket "' + $Bucket + '" is visible') }
    else { Write-Fix 'Could not see the photo bucket.' 'Run:  .tools\supabase.exe login   (then run this again)' }
  } catch {
    Write-Fix 'Could not reach Supabase.' 'Check the internet connection, then run:  .tools\supabase.exe login'
  }
}

# pg_dump and pg_restore, and that pg_dump is new enough. pg_dump refuses to dump
# a server newer than itself, so an old copy fails with a confusing message.
$serverMajor = $null
if (Test-Path $pgVersionFile) {
  $serverMajor = [int]((Get-Content $pgVersionFile -Raw).Trim().Split('.')[0])
}
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if ($pgDump -and $pgRestore) {
  $localText = (& pg_dump --version) 2>&1 | Out-String
  $m = [regex]::Match($localText, '(\d+)(\.\d+)*')
  $localMajor = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
  if ($serverMajor -and $localMajor -lt $serverMajor) {
    # Both arguments parenthesised: unparenthesised, PowerShell reads each + as a
    # separate argument and the message comes out as a list of fragments.
    Write-Fix ('pg_dump is version ' + $localMajor + ' but the database is version ' + $serverMajor + '.') ('Install PostgreSQL ' + $serverMajor + ' or newer (command line tools only). See docs/BACKUP-RUNBOOK.md, step 1.')
  } else {
    Write-Ok ('pg_dump and pg_restore found (version ' + $localMajor + ', database is ' + $serverMajor + ')')
  }
} else {
  Write-Fix 'pg_dump / pg_restore are not installed.' 'See docs/BACKUP-RUNBOOK.md, step 1. It is a one-off install of the PostgreSQL command line tools.'
}

# Connection details, minus the password (which is never stored anywhere).
$DbHost = $null; $DbPort = '5432'; $DbUser = $null; $DbName = 'postgres'
if (Test-Path $poolerFile) {
  $url = (Get-Content $poolerFile -Raw).Trim()
  $um = [regex]::Match($url, '^postgres(?:ql)?://([^:@/]+)(?::[^@]*)?@([^:/]+)(?::(\d+))?/(.+)$')
  if ($um.Success) {
    $DbUser = $um.Groups[1].Value; $DbHost = $um.Groups[2].Value
    if ($um.Groups[3].Success) { $DbPort = $um.Groups[3].Value }
    $DbName = $um.Groups[4].Value
    Write-Ok ('Database address known (' + $DbHost + ')')
  }
}
if (-not $DbHost) { Write-Fix 'Could not work out the database address.' 'Re-link the project:  .tools\supabase.exe link --project-ref <ref>' }

# Somewhere to put it, with room. The whole backup is tens of megabytes today.
try {
  # Checking must not leave anything behind, so the folder is only CREATED when a
  # real backup runs. Here it is enough that the place it would go exists.
  $anchor = $Folder
  while ($anchor -and -not (Test-Path $anchor)) { $anchor = Split-Path -Parent $anchor }
  if (-not $anchor) { throw 'no such drive' }
  $freeGb = [math]::Round((Get-Item $anchor).PSDrive.Free / 1GB, 1)
  if ($freeGb -lt 1) { Write-Fix ('Only ' + $freeGb + ' GB free where backups go.') 'Choose another place with -Folder.' }
  else { Write-Ok ('Backups will go in ' + $Folder + ' (' + $freeGb + ' GB free)') }
} catch {
  Write-Fix ('Cannot use ' + $Folder) 'Choose another place with -Folder.'
}

# Automatic runs cannot ask for the password, so it must already be saved.
if ($Unattended) {
  if (Test-Path $PwFile) { Write-Ok 'A saved database password is in place' }
  else { Write-Fix 'No saved database password for automatic backups.' 'Run once:  powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -SavePassword' }
}

Write-Host ''
if ($Problems.Count -gt 0) {
  Write-Host ($Problems.Count.ToString() + ' thing(s) to sort out before a backup can run.') -ForegroundColor Yellow
  if ($Unattended -and -not $Check) { Stop-Failed ('Set-up problems: ' + ($Problems -join ' | ')) }
  exit 1
}
if ($Check) {
  Write-Host 'Everything is in place. Run without -Check to make a backup.' -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------------------
# 2. The backup. From here on, files are written, but only inside $dest.
# ---------------------------------------------------------------------------
# Local time, so the folder name matches the clock on the wall.
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$dest = Join-Path $Folder $stamp

try {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  $incomplete = Join-Path $dest 'INCOMPLETE.txt'
  Set-Content -Path $incomplete -Value 'This backup did not finish. Do not rely on it. Delete this folder and run the backup again.'
  if ($Unattended) { Write-Log ('Starting backup ' + $stamp) }

  Write-Host ('Making backup in ' + $dest) -ForegroundColor Cyan

  # --- Photo files ---------------------------------------------------------
  Write-Host '  Downloading photo files...'
  $mediaDir = Join-Path $dest $Bucket
  & $Cli storage cp -r ('ss:///' + $Bucket) $mediaDir --linked --experimental --workdir $Root
  if ($LASTEXITCODE -ne 0) { throw 'Downloading the photo files failed. Nothing was changed online. Run it again.' }
  $files = @(Get-ChildItem -Path $mediaDir -Recurse -File -ErrorAction SilentlyContinue)
  $mediaBytes = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $mediaBytes) { $mediaBytes = 0 }
  Write-Ok ('Photo files: ' + $files.Count + ' files, ' + [math]::Round($mediaBytes / 1MB, 1) + ' MB')

  # --- Database ------------------------------------------------------------
  $dumpFile = Join-Path $dest ('scope-database-' + $stamp + '.dump')
  if ($Unattended) {
    # The scrambled password saved by -SavePassword. Only this Windows user on
    # this computer can unscramble it.
    $secure = (Get-Content $PwFile -Raw).Trim() | ConvertTo-SecureString
  } else {
    Write-Host ''
    Write-Host '  The database needs its password (Supabase dashboard > Project Settings > Database).'
    Write-Host '  Typing is hidden, and it is not saved anywhere.'
    $secure = Read-Host '  Database password' -AsSecureString
  }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    Write-Host '  Dumping the database...'
    # -Fc: compressed, and readable by pg_restore. --no-owner / --no-privileges:
    # the dump holds the data and structure, not who owned what on the old server,
    # so it restores cleanly into a fresh project.
    & pg_dump -h $DbHost -p $DbPort -U $DbUser -d $DbName -Fc --no-owner --no-privileges -f $dumpFile
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed. The most common cause is a wrong or changed database password (run -SavePassword again). Nothing was changed online.' }
  } finally {
    # Gone from memory and from the environment whatever happened above.
    $env:PGPASSWORD = $null
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }

  # --- Does the dump actually read back? -----------------------------------
  if (-not (Test-Path $dumpFile) -or (Get-Item $dumpFile).Length -lt 1024) { throw 'The database dump is missing or empty.' }
  $entries = @(& pg_restore --list $dumpFile 2>$null | Where-Object { $_ -match '^\d+;' })
  if ($LASTEXITCODE -ne 0 -or $entries.Count -lt 10) { throw 'The database dump could not be read back. Do not rely on this backup.' }
  Write-Ok ('Database: ' + [math]::Round((Get-Item $dumpFile).Length / 1MB, 1) + ' MB, ' + $entries.Count + ' items, reads back correctly')

  # --- A note inside the folder, so it explains itself in two years --------
  $readme = @(
    'SCOPE BACKUP',
    ('Made: ' + (Get-Date -Format 'dddd d MMMM yyyy, h:mm tt') + ' (this computer''s clock)'),
    ('Project: ' + $ProjectRef),
    '',
    'What is in here:',
    ('  ' + (Split-Path -Leaf $dumpFile) + '   the whole database (jobs, reports, invoices, clients, enquiries,'),
    '                                  safety statements, and the user accounts), compressed.',
    ('  ' + $Bucket + '\          every photo and PDF file, in the same folders as online.'),
    '',
    'To restore: see docs/BACKUP-RUNBOOK.md, "Getting it back". In short, create a NEW Supabase',
    'project, restore the .dump file into it with pg_restore, and upload the files back.',
    '',
    'This folder holds your clients'' names, addresses and photos. Keep it private.',
    'A backup that lives only on this computer protects you from the cloud failing, not from',
    'this computer failing. Copy the whole folder somewhere else as well.'
  )
  Set-Content -Path (Join-Path $dest 'README.txt') -Value $readme
  Remove-Item $incomplete
} catch {
  $why = $_.Exception.Message
  if ($Unattended) { Stop-Failed $why }
  throw
}

# From here the backup itself is finished and good. Everything below is
# housekeeping, and a problem in it must not turn a good backup into a "failure".
$notes = New-Object System.Collections.ArrayList

# --- A second copy somewhere else -------------------------------------------
if ($CopyTo) {
  try {
    if (-not (Test-Path $CopyTo)) { New-Item -ItemType Directory -Path $CopyTo -Force | Out-Null }
    Copy-Item -Path $dest -Destination $CopyTo -Recurse -Force
    Write-Ok ('Second copy made in ' + $CopyTo)
  } catch {
    [void]$notes.Add('The second copy to ' + $CopyTo + ' failed: ' + $_.Exception.Message)
  }
}

# --- Tidy old backups -------------------------------------------------------
# Only folders THIS script made: dated name, with a README.txt, and no
# INCOMPLETE.txt. The newest is always kept. Anything else is left alone.
if ($Keep -gt 0) {
  try {
    $mine = @(Get-ChildItem -Path $Folder -Directory |
      Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' -and (Test-Path (Join-Path $_.FullName 'README.txt')) -and -not (Test-Path (Join-Path $_.FullName 'INCOMPLETE.txt')) } |
      Sort-Object Name -Descending)
    if ($mine.Count -gt $Keep) {
      $old = $mine | Select-Object -Skip $Keep
      foreach ($o in $old) { Remove-Item -Path $o.FullName -Recurse -Force }
      Write-Ok ('Removed ' + @($old).Count + ' old backup(s); keeping the newest ' + $Keep)
    }
  } catch {
    [void]$notes.Add('Tidying old backups failed: ' + $_.Exception.Message)
  }
}

# --- Leave a plain sign that it worked --------------------------------------
try {
  Remove-Item (Join-Path $Folder 'BACKUP-FAILED.txt') -ErrorAction SilentlyContinue
  $okLines = @(('Last good backup: ' + (Get-Date -Format 'dddd d MMMM yyyy, h:mm tt')), ('Folder: ' + $dest))
  foreach ($n in $notes) { $okLines += ('Note: ' + $n) }
  Set-Content -Path (Join-Path $Folder 'LAST-BACKUP-OK.txt') -Value $okLines
} catch { }
if ($Unattended) {
  Write-Log ('Backup complete: ' + $dest)
  foreach ($n in $notes) { Write-Log ('Note: ' + $n) }
}

Write-Host ''
Write-Host 'Backup complete.' -ForegroundColor Green
Write-Host ('  ' + $dest)
foreach ($n in $notes) { Write-Host ('  Note: ' + $n) -ForegroundColor Yellow }
if (-not $CopyTo) {
  Write-Host '  Now copy that folder somewhere else too (a USB stick, or Google Drive).' -ForegroundColor Yellow
}
exit 0
