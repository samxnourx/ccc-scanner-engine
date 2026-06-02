param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath,

  [Parameter(Mandatory = $true)]
  [string]$DestinationPath,

  [string]$EntryName = "All_Records__File_1_of_1.csv",

  [string]$LogPath = "C:\Projects\ccc-scanner-engine\ca-sco-extract.log"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$destinationDir = Split-Path -Parent $DestinationPath
if (-not (Test-Path -LiteralPath $destinationDir)) {
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
}

$partialPath = "$DestinationPath.partial"
if (Test-Path -LiteralPath $partialPath) {
  Remove-Item -LiteralPath $partialPath -Force
}

function Write-ExtractLog([string]$Message) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $LogPath -Value "[$stamp] $Message"
}

Write-ExtractLog "Starting extraction"
Write-ExtractLog "Zip: $ZipPath"
Write-ExtractLog "Entry: $EntryName"
Write-ExtractLog "Destination: $DestinationPath"

$archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $entry = $archive.Entries | Where-Object { $_.FullName -eq $EntryName } | Select-Object -First 1
  if (-not $entry) {
    throw "CSV entry not found in zip: $EntryName"
  }

  $expectedBytes = [int64]$entry.Length
  Write-ExtractLog "Expected bytes: $expectedBytes"

  $inputStream = $entry.Open()
  $outputStream = [IO.File]::Open($partialPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $buffer = New-Object byte[] (8MB)
    $copied = [int64]0
    $nextLog = [int64](512MB)

    while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $outputStream.Write($buffer, 0, $read)
      $copied += $read

      if ($copied -ge $nextLog) {
        $pct = [math]::Round(($copied / $expectedBytes) * 100, 2)
        $gb = [math]::Round($copied / 1GB, 2)
        Write-ExtractLog "Progress: $gb GB ($pct%)"
        $nextLog += [int64](512MB)
      }
    }
  } finally {
    $outputStream.Dispose()
    $inputStream.Dispose()
  }

  $actualBytes = (Get-Item -LiteralPath $partialPath).Length
  if ($actualBytes -ne $expectedBytes) {
    throw "Extraction incomplete. Expected $expectedBytes bytes, got $actualBytes bytes."
  }

  if (Test-Path -LiteralPath $DestinationPath) {
    Remove-Item -LiteralPath $DestinationPath -Force
  }
  Move-Item -LiteralPath $partialPath -Destination $DestinationPath
  Write-ExtractLog "Complete. Wrote $actualBytes bytes."
} catch {
  Write-ExtractLog "FAILED: $($_.Exception.Message)"
  throw
} finally {
  $archive.Dispose()
}
