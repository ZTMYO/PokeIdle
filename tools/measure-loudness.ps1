$ffmpeg = 'D:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe'
$audioDir = 'D:\zc\PokemonIdle\src\audio'

$files = Get-ChildItem -Path $audioDir -Recurse -Filter *.mp3 | Sort-Object FullName
$results = @{}

foreach ($f in $files) {
  $out = & $ffmpeg -i $f.FullName -af volumedetect -f null - 2>&1 | Out-String
  if ($out -match 'mean_volume: ([-0-9.]+) dB') {
    $results[$f.FullName] = [double]$Matches[1]
  } else {
    Write-Warning "no mean_volume: $($f.FullName)"
  }
}

$baseKey = Join-Path $audioDir 'hoenn\hoenn1.mp3'
if (-not $results.ContainsKey($baseKey)) { throw 'hoenn1 未测到 mean_volume' }
$base = $results[$baseKey]

foreach ($f in $files) {
  $rel = $f.FullName.Substring($audioDir.Length + 1) -replace '\\', '/'
  $mv = $results[$f.FullName]
  $gain = [math]::Round($base - $mv, 2)
  Write-Output ("{0}`t{1}`t(mean {2})" -f $rel, $gain, $mv)
}
