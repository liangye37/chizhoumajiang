$ErrorActionPreference = 'SilentlyContinue'
$projectDir = Split-Path -Parent $PSScriptRoot
$port = 5173
$url = "http://localhost:$port/"

function Test-PortOpen {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(250, $false)
    if ($ok) { $client.EndConnect($iar) }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

if (-not (Test-PortOpen)) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c pnpm dev' -WorkingDirectory $projectDir -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-PortOpen) { break }
  }
}

$edge = Get-Command 'msedge.exe' -ErrorAction SilentlyContinue
if ($edge) {
  Start-Process -FilePath $edge.Source -ArgumentList $url
} else {
  Start-Process $url
}
