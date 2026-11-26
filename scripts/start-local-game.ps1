$ErrorActionPreference = 'SilentlyContinue'
$projectDir = Split-Path -Parent $PSScriptRoot
$port = 5173

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

function Get-BestLanIp {
  $entries = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' -and
      $_.PrefixOrigin -ne 'WellKnown' -and
      $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|VMware|VirtualBox|Mihomo|Clash'
    }
  $hotspot = $entries | Where-Object { $_.IPAddress -like '192.168.137.*' } | Select-Object -First 1 -ExpandProperty IPAddress
  if ($hotspot) { return $hotspot }
  $wifi = $entries | Where-Object { $_.InterfaceAlias -match 'WLAN|Wi-Fi|WiFi|Wireless|无线' } | Select-Object -First 1 -ExpandProperty IPAddress
  if ($wifi) { return $wifi }
  $lan = $entries | Select-Object -First 1 -ExpandProperty IPAddress
  if ($lan) { return $lan }
  return $null
}

if (-not (Test-PortOpen)) {
  Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/lan-server.mjs' -WorkingDirectory $projectDir -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-PortOpen) { break }
  }
}

$lanIp = Get-BestLanIp
$url = if ($lanIp) { "http://${lanIp}:${port}/" } else { "http://localhost:${port}/?selfHost=ws://127.0.0.1:${port}/signal" }

$edge = Get-Command 'msedge.exe' -ErrorAction SilentlyContinue
if ($edge) {
  Start-Process -FilePath $edge.Source -ArgumentList $url
} else {
  Start-Process $url
}
