param(
    [int]$Port = 8080
)

# Raw TcpListener instead of HttpListener: HttpListener refuses to bind any
# prefix other than localhost/127.0.0.1 without an admin-only URL ACL
# reservation (netsh http add urlacl) or running elevated. TcpListener has no
# such restriction, so this can listen on all interfaces as a normal user —
# needed so a phone on the same LAN can actually reach it.
$root = $PSScriptRoot
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
$listener.Start()
Write-Host "Serving $root on 0.0.0.0:$Port (reachable from this machine and other devices on the LAN)"

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
    '.webmanifest' = 'application/manifest+json'
}

function Send-Response {
    param($stream, [int]$statusCode, [string]$statusText, [string]$contentType, [byte[]]$body, [bool]$includeBody)

    $header = "HTTP/1.1 $statusCode $statusText`r`n"
    if ($contentType) { $header += "Content-Type: $contentType`r`n" }
    $header += "Content-Length: $($body.Length)`r`n"
    $header += "Cache-Control: no-cache`r`n"
    $header += "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($includeBody -and $body.Length -gt 0) {
        $stream.Write($body, 0, $body.Length)
    }
    $stream.Flush()
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        # Without these, a client that opens a connection and then stalls (or a
        # keep-alive request this single-threaded loop never answers) blocks
        # ReadLine() forever and wedges the *entire* server — every future
        # request, from any device, just hangs. This is what happened above.
        $client.ReceiveTimeout = 10000
        $client.SendTimeout = 10000
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue } # client disconnected before sending anything
            while (($headerLine = $reader.ReadLine()) -and $headerLine -ne '') { } # drain headers, ignore body

            if ($requestLine -match '^(GET|HEAD)\s+(\S+)\s+HTTP') {
                $method = $matches[1]
                $rawPath = $matches[2].Split('?')[0]
                $decodedPath = [System.Uri]::UnescapeDataString($rawPath)
                if ($decodedPath -eq '/') { $decodedPath = '/index.html' }
                $filePath = Join-Path $root ($decodedPath.TrimStart('/'))
                $filePath = [System.IO.Path]::GetFullPath($filePath)

                if (-not $filePath.StartsWith($root)) {
                    $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                    Send-Response $stream 403 'Forbidden' 'text/plain' $body ($method -eq 'GET')
                } elseif (Test-Path $filePath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $mime = $mimeMap[$ext]
                    if (-not $mime) { $mime = 'application/octet-stream' }
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    Send-Response $stream 200 'OK' $mime $bytes ($method -eq 'GET')
                } else {
                    $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $decodedPath")
                    Send-Response $stream 404 'Not Found' 'text/plain' $body ($method -eq 'GET')
                }
            }
        } catch {
            # Malformed request or client disconnect mid-read — drop it and move on.
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
