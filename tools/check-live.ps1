# Asks the LIVE site for every file the app needs, and says which are missing.
# Run it after each release:
#
#   powershell -ExecutionPolicy Bypass -File tools\check-live.ps1 -Version v168
#
# Why this exists: the test suite (on this PC and in GitHub Actions) is served
# straight from the folder. GitHub Pages is a different server with rules of
# its own. v166 went live with the subcontractor sign-up page unable to load
# one of its files (Pages leaves out folders that start with an underscore
# unless .nojekyll is present) and every test was green. Only the real site
# can answer whether the real site works.
#
# It reads the list of files from the live site itself (the sw.js shell, and
# whatever join.html and portal.html load), so it never complains about work
# that has not been released yet.
#
# Read only: ordinary page requests, nothing is sent, no login is used.
# Exit code 0 = everything is served, 1 = something is missing or wrong.
param(
    [string]$Version = '',
    [string]$Site = 'https://arcadianpestsolutions-a11y.github.io/field-inspect'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$bust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$problems = New-Object System.Collections.Generic.List[string]
$seen = @{}
$script:checked = 0

function Get-LiveText([string]$path) {
    $url = "$Site/$path"
    if ($url.Contains('?')) { $url += "&cb=$bust" } else { $url += "?cb=$bust" }
    $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30
    if ($r.Content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($r.Content) }
    return [string]$r.Content
}

function Test-Live([string]$path) {
    if ($seen.ContainsKey($path)) { return }
    $seen[$path] = $true
    $script:checked++
    $url = "$Site/$path"
    if ($url.Contains('?')) { $url += "&cb=$bust" } else { $url += "?cb=$bust" }
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30
        $type = [string]$r.Headers['Content-Type']
        # A browser refuses to run a script that is not labelled as one.
        if ($path -match '\.js$' -and $type -notmatch 'javascript') { $problems.Add("WRONG TYPE  $path  ($type)") }
    } catch {
        $code = 'no answer'
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $problems.Add("NOT SERVED  $path  ($code)")
    }
}

# 1. The version that is live.
$live = ''
try {
    $m = [regex]::Match((Get-LiveText 'version.js'), "APP_VERSION = '([^']+)'")
    if ($m.Success) { $live = $m.Groups[1].Value }
} catch { }
if (-not $live) { $problems.Add('NOT SERVED  version.js') }
elseif ($Version -and $live -ne $Version) { $problems.Add("WRONG VERSION  live is $live, expected $Version") }

# 2. Every file in the offline shell. If one is missing, a phone cannot
#    install the update at all.
try {
    $sw = Get-LiveText 'sw.js'
    foreach ($m in [regex]::Matches($sw, "'\./([^']*)'")) { Test-Live $m.Groups[1].Value }
} catch { $problems.Add('NOT SERVED  sw.js') }

# 3. Every file the standalone pages load (they are not in the shell).
foreach ($page in @('join.html', 'portal.html')) {
    Test-Live $page
    try {
        $html = Get-LiveText $page
        foreach ($m in [regex]::Matches($html, '<script[^>]*\ssrc="([^"]+)"')) {
            if ($m.Groups[1].Value -notmatch '^(https?:|//|data:)') { Test-Live $m.Groups[1].Value }
        }
        foreach ($m in [regex]::Matches($html, "\bfrom\s+'\./([^']+)'")) { Test-Live $m.Groups[1].Value }
    } catch { }
}

Write-Output "live version: $live"
Write-Output "checked $($script:checked) files"
if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Output $p }
    Write-Output "$($problems.Count) problem(s)"
    exit 1
}
Write-Output 'all served'
exit 0
