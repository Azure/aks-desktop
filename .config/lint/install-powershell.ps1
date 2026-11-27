param(
    [string]$ArchivePath,
    [string]$ModuleRoot = (Join-Path $PSScriptRoot '../../node_modules/.cache/script-lint/modules')
)

$ErrorActionPreference = 'Stop'
$version = '1.25.0'
$expectedHash = '14e634c828eb98efb9f40b2918ba90f139ed5eccdf663a2a747736d996995d60'
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    $archive = Join-Path $temporaryDirectory 'PSScriptAnalyzer.zip'
    if ($ArchivePath) {
        Copy-Item -LiteralPath $ArchivePath -Destination $archive
    } else {
        Invoke-WebRequest -Uri "https://github.com/PowerShell/PSScriptAnalyzer/releases/download/$version/PSScriptAnalyzer.$version.nupkg" -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'PSScriptAnalyzer archive SHA-256 mismatch; refusing to extract or import it.'
    }
    $destination = Join-Path $ModuleRoot "PSScriptAnalyzer/$version"
    Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
    Write-Output "Verified PSScriptAnalyzer $version installed in $destination"
} finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
}
