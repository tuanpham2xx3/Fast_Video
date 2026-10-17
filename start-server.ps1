$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$appDir = $PSScriptRoot
$toolsDir = Join-Path $appDir '.tools'

function Find-Tool([string]$Name, [string]$VersionArg) {
    $candidates = @((Join-Path $toolsDir "$Name.exe"))
    $command = Get-Command "$Name.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $candidates += $command.Source }
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            & $candidate $VersionArg *> $null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    return $null
}

function Install-Archive([string]$Url, [string]$ChecksumUrl, [string]$FileName, [string[]]$Executables) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    $stage = Join-Path $toolsDir ([guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $archive = Join-Path $stage $FileName
        Write-Host "Downloading $FileName (first run only)..."
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $archive -TimeoutSec 600
        $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $ChecksumUrl -TimeoutSec 60).Content
        $expected = $null
        foreach ($line in ($checksums -split "`n")) {
            if ($line.Trim() -match ('^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($FileName) + '$')) { $expected = $Matches[1]; break }
        }
        if (-not $expected -and $checksums.Trim() -match '^[a-fA-F0-9]{64}$') { $expected = $checksums.Trim() }
        if (-not $expected) { throw "Cannot find SHA256 checksum for $FileName." }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch for $FileName. Please run again." }
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $stage 'unpacked')
        foreach ($exe in $Executables) {
            $source = Get-ChildItem -LiteralPath (Join-Path $stage 'unpacked') -Filter $exe -Recurse -File | Select-Object -First 1
            if (-not $source) { throw "$exe is missing from the download." }
            Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $toolsDir $exe) -Force
        }
    } finally {
        # Only delete the unique staging directory directly inside this project's .tools.
        if ((Split-Path -Parent $stage) -eq $toolsDir -and (Test-Path -LiteralPath $stage)) {
            Remove-Item -LiteralPath $stage -Recurse -Force
        }
    }
}

try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Fast Video requires 64-bit Windows 10 or newer.' }
    $node = Find-Tool 'node' '--version'
    if (-not $node) {
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
        $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
        $release = $releases | Where-Object { $_.lts -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
        if (-not $release -or $release.version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Cannot resolve the Node.js LTS download.' }
        $base = "https://nodejs.org/dist/$($release.version)"
        $archiveName = "node-$($release.version)-win-$arch.zip"
        Install-Archive "$base/$archiveName" "$base/SHASUMS256.txt" $archiveName @('node.exe')
        $node = Find-Tool 'node' '--version'
    }
    $ffmpeg = Find-Tool 'ffmpeg' '-version'
    $ffprobe = Find-Tool 'ffprobe' '-version'
    if (-not $ffmpeg -or -not $ffprobe) {
        $downloadUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
        Install-Archive $downloadUrl "$downloadUrl.sha256" 'ffmpeg-release-essentials.zip' @('ffmpeg.exe', 'ffprobe.exe')
        $ffmpeg = Find-Tool 'ffmpeg' '-version'
        $ffprobe = Find-Tool 'ffprobe' '-version'
    }
    if (-not $node -or -not $ffmpeg -or -not $ffprobe) { throw 'Node.js, FFmpeg or FFprobe could not run on this computer.' }
    $env:PATH = "$(Split-Path -Parent $ffmpeg);$(Split-Path -Parent $ffprobe);$env:PATH"
    $env:PORT = '3636'
    $url = 'http://localhost:3636'
    $alreadyRunning = $false
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/templates" -TimeoutSec 2
        $alreadyRunning = $response.StatusCode -eq 200 -and $response.Headers['Content-Type'] -match 'application/json'
    } catch { }
    if (-not $alreadyRunning) {
        $process = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appDir 'server.log') -RedirectStandardError (Join-Path $appDir 'server-error.log') -PassThru
        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            $process.Refresh()
            if ($process.HasExited) { throw 'Server exited. See server-error.log.' }
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/templates" -TimeoutSec 1
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
            Start-Sleep -Milliseconds 300
        }
        if (-not $ready) { throw 'Server did not become ready. See server-error.log.' }
    }
    Start-Process $url
    Write-Host "Fast Video is ready: $url"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

