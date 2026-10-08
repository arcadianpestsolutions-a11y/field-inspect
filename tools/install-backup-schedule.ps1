<#
.SYNOPSIS
  Sets up (or removes) the weekly automatic Scope backup in Windows Task Scheduler.

.DESCRIPTION
  Creates one scheduled task, "Scope weekly backup", that runs
  tools\backup-scope.ps1 -Unattended every Sunday at 10:00 as YOU (so it can read
  the password saved by  backup-scope.ps1 -SavePassword  and use your Supabase login).

  If the computer is off at 10:00 the task runs as soon as it is next on
  (StartWhenAvailable). It runs only while you are logged in, because that is what
  lets it unscramble the saved password; it will not run on a locked-out machine.

  Do these in order, once:
    1. powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -Check
    2. powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -SavePassword
    3. powershell -ExecutionPolicy Bypass -File tools\backup-scope.ps1 -Check -Unattended
    4. powershell -ExecutionPolicy Bypass -File tools\install-backup-schedule.ps1

  It changes one thing on this computer: that single scheduled task. It does not
  touch Supabase.

.PARAMETER Remove
  Delete the scheduled task.

.PARAMETER DryRun
  Show what would be created and create nothing.

.PARAMETER Day
  Day of the week. Default Sunday.

.PARAMETER At
  Time of day, 24-hour. Default 10:00.

.PARAMETER CopyTo
  Passed through to the backup: a second place to copy each backup to.

.NOTES
  Windows PowerShell 5.1. ASCII only.
#>
[CmdletBinding()]
param(
  [switch]$Remove,
  [switch]$DryRun,
  [string]$Day = 'Sunday',
  [string]$At = '10:00',
  [string]$CopyTo
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Scope weekly backup'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Script = Join-Path $Root 'tools\backup-scope.ps1'

if ($Remove) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $existing) { Write-Host 'There is no automatic backup scheduled. Nothing to remove.'; exit 0 }
  if ($DryRun) { Write-Host ('Would remove the scheduled task "' + $TaskName + '".'); exit 0 }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host ('Removed "' + $TaskName + '". Backups made so far are untouched.') -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $Script)) { throw ('Cannot find ' + $Script) }
$pwFile = Join-Path $env:LOCALAPPDATA 'Scope-Backup\db-password.dat'
if (-not (Test-Path $pwFile) -and -not $DryRun) {
  throw 'No saved database password yet. Run backup-scope.ps1 -SavePassword first (step 2 above), then try again.'
}

$argText = '-NoProfile -ExecutionPolicy Bypass -File "' + $Script + '" -Unattended'
if ($CopyTo) { $argText += ' -CopyTo "' + $CopyTo + '"' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argText -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

Write-Host ''
Write-Host 'Automatic backup schedule' -ForegroundColor Cyan
Write-Host ('  Task:     ' + $TaskName)
Write-Host ('  When:     every ' + $Day + ' at ' + $At + ' (or when the computer is next on)')
Write-Host ('  Runs as:  ' + $me + ' (only while logged in)')
Write-Host ('  Command:  powershell.exe ' + $argText)
Write-Host ''

if ($DryRun) { Write-Host 'Dry run: nothing was created.' -ForegroundColor Yellow; exit 0 }

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Weekly copy of Scope''s database and photos to this computer. See docs/BACKUP-RUNBOOK.md.' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ('Scheduled. Next run: ' + (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime) -ForegroundColor Green
Write-Host 'To check later: look for LAST-BACKUP-OK.txt (good) or BACKUP-FAILED.txt (bad) in Documents\Scope-Backups.'
Write-Host 'To remove it:   powershell -ExecutionPolicy Bypass -File tools\install-backup-schedule.ps1 -Remove'
