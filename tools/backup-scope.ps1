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

Write-Host ''
if ($Problems.Count -gt 0) {
  Write-Host ($Problems.Count.ToString() + ' thing(s) to sort out before a backup can run.') -ForegroundColor Yellow
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
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$incomplete = Join-Path $dest 'INCOMPLETE.txt'
Set-Content -Path $incomplete -Value 'This backup did not finish. Do not rely on it. Delete this folder and run the backup again.'

Write-Host ('Making backup in ' + $dest) -ForegroundColor Cyan

# --- Photo files -----------------------------------------------------------
Write-Host '  Downloading photo files...'
$mediaDir = Join-Path $dest $Bucket
& $Cli storage cp -r ('ss:///' + $Bucket) $mediaDir --linked --experimental --workdir $Root
if ($LASTEXITCODE -ne 0) { throw 'Downloading the photo files failed. Nothing was changed online. Run it again.' }
$files = @(Get-ChildItem -Path $mediaDir -Recurse -File -ErrorAction SilentlyContinue)
$mediaBytes = ($files | Measure-Object -Property Length -Sum).Sum
if ($null -eq $mediaBytes) { $mediaBytes = 0 }
Write-Ok ('Photo files: ' + $files.Count + ' files, ' + [math]::Round($mediaBytes / 1MB, 1) + ' MB')

# --- Database --------------------------------------------------------------
Write-Host ''
Write-Host '  The database needs its password (Supabase dashboard > Project Settings > Database).'
Write-Host '  Typing is hidden, and it is not saved anywhere.'
$secure = Read-Host '  Database password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$dumpFile = Join-Path $dest ('scope-database-' + $stamp + '.dump')
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  Write-Host '  Dumping the database...'
  # -Fc: compressed, and readable by pg_restore. --no-owner / --no-privileges:
  # the dump holds the data and structure, not who owned what on the old server,
  # so it restores cleanly into a fresh project.
  & pg_dump -h $DbHost -p $DbPort -U $DbUser -d $DbName -Fc --no-owner --no-privileges -f $dumpFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed. The most common cause is a wrong database password. Nothing was changed online.' }
} finally {
  # Gone from memory and from the environment whatever happened above.
  $env:PGPASSWORD = $null
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# --- Does the dump actually read back? -------------------------------------
if (-not (Test-Path $dumpFile) -or (Get-Item $dumpFile).Length -lt 1024) { throw 'The database dump is missing or empty.' }
$entries = @(& pg_restore --list $dumpFile 2>$null | Where-Object { $_ -match '^\d+;' })
if ($LASTEXITCODE -ne 0 -or $entries.Count -lt 10) { throw 'The database dump could not be read back. Do not rely on this backup.' }
Write-Ok ('Database: ' + [math]::Round((Get-Item $dumpFile).Length / 1MB, 1) + ' MB, ' + $entries.Count + ' items, reads back correctly')

# --- A note inside the folder, so it explains itself in two years ----------
$readme = @(
  'SCOPE BACKUP',
  'Made: ' + (Get-Date -Format 'dddd d MMMM yyyy, h:mm tt') + ' (this computer''s clock)',
  'Project: ' + $ProjectRef,
  '',
  'What is in here:',
  '  ' + (Split-Path -Leaf $dumpFile) + '   the whole database (jobs, reports, invoices, clients, enquiries,',
  '                                  safety statements, and the user accounts), compressed.',
  '  ' + $Bucket + '\          every photo and PDF file, in the same folders as online.',
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

Write-Host ''
Write-Host 'Backup complete.' -ForegroundColor Green
Write-Host ('  ' + $dest)
Write-Host '  Now copy that folder somewhere else too (a USB stick, or Google Drive).' -ForegroundColor Yellow
exit 0
