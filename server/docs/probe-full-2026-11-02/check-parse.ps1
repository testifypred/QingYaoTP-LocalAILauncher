$e=$null; $t=$null
$f='D:\LocalModels\server\docs\probe-full-2026-11-02\run-full.ps1'
[System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$t,[ref]$e) | Out-Null
if($e -and $e.Count){ $e | ForEach-Object { $_.Message } } else { 'parse-ok' }
$b=[System.IO.File]::ReadAllBytes($f)
'BOM=' + ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)