# Generate the Ed25519 key for MCP Registry DNS authentication.
# Requires Windows PowerShell 5.1. Prefers OpenSSL 3 from Git for Windows.
# If that openssl is missing or cannot do Ed25519, falls back to Node.js.
#
# Writes the 64-character hex seed to $HOME\.mcp-registry\ignacioventura.key
# and prints the TXT value for the apex of ignacioventura.com.ar plus the
# GitHub secret command. The TXT name in the ignacioventura.com.ar zone is
# @ (the apex). Do not use _mcp-auth or any other selector. This script
# never prints the private key. It refuses to overwrite an existing
# ignacioventura.key.
#
# It does not read or write $HOME\.mcp-registry\argentina-mcp.key. That file
# is the nachthelad.com.ar seed and is still required to deprecate
# ar.com.nachthelad/argentina-mcp 0.2.0.
#
# This gh build has no --body-file flag, and PowerShell does not treat "<"
# as input redirection. Set the secret with:
#   gh secret set MCP_REGISTRY_PRIVATE_KEY --body (Get-Content "$HOME\.mcp-registry\ignacioventura.key" -Raw).Trim()

#Requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$KeyDirectory = Join-Path $HOME '.mcp-registry'
# argentina-mcp.key is the nachthelad.com.ar seed. Leave that file alone.
$KeyFile = Join-Path $KeyDirectory 'ignacioventura.key'

function Resolve-OpenSsl {
    $candidates = @()
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe')
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Git\usr\bin\openssl.exe')
    }
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }
    $command = Get-Command openssl -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        return $command.Source
    }
    return $null
}

function Get-PrivateHexFromOpenSslText {
    param($Text)
    $lines = @(
        $Text | ForEach-Object { "$_" -split '\r?\n' }
    )
    $collect = $false
    $builder = New-Object System.Text.StringBuilder
    foreach ($line in $lines) {
        if ($line -match 'priv:\s*$') {
            $collect = $true
            continue
        }
        if ($collect -and $line -match 'pub:') {
            break
        }
        if (-not $collect) {
            continue
        }
        $clean = [regex]::Replace([string]$line, '[^0-9a-fA-F]', '')
        if ($clean) {
            [void]$builder.Append($clean.ToLowerInvariant())
        }
    }
    $hex = $builder.ToString()
    if ($hex -notmatch '^[0-9a-f]{64}$') {
        return $null
    }
    return $hex
}

function Get-Ed25519FromOpenSsl {
    param([Parameter(Mandatory = $true)][string]$OpenSsl)
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('mcp-registry-' + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        $pem = Join-Path $work 'key.pem'
        $der = Join-Path $work 'pub.der'
        & $OpenSsl genpkey -algorithm Ed25519 -out $pem 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pem)) {
            return $null
        }
        & $OpenSsl pkey -in $pem -pubout -outform DER -out $der 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $der)) {
            return $null
        }
        $derBytes = [System.IO.File]::ReadAllBytes($der)
        if ($derBytes.Length -lt 32) {
            return $null
        }
        $raw = New-Object byte[] 32
        [Array]::Copy($derBytes, $derBytes.Length - 32, $raw, 0, 32)
        $publicKey = [Convert]::ToBase64String($raw)
        $text = & $OpenSsl pkey -in $pem -noout -text 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $text) {
            return $null
        }
        $hex = Get-PrivateHexFromOpenSslText -Text $text
        if (-not $hex -or $publicKey -notmatch '^[A-Za-z0-9+/]{43}=$') {
            return $null
        }
        return @{ Hex = $hex; Public = $publicKey }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Get-Ed25519FromNode {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        return $null
    }
    $js = 'const {generateKeyPairSync}=require("crypto");const pair=generateKeyPairSync("ed25519");const pub=pair.publicKey.export({type:"spki",format:"der"}).slice(-32).toString("base64");const seed=pair.privateKey.export({type:"pkcs8",format:"der"}).slice(-32).toString("hex");process.stdout.write(seed+"\n"+pub+"\n");'
    $lines = @(& node -e $js | Where-Object { $_ -ne '' })
    if ($LASTEXITCODE -ne 0 -or $lines.Count -lt 2) {
        return $null
    }
    $hex = ([string]$lines[0]).Trim().ToLowerInvariant()
    $publicKey = ([string]$lines[1]).Trim()
    if ($hex -notmatch '^[0-9a-f]{64}$' -or $publicKey -notmatch '^[A-Za-z0-9+/]{43}=$') {
        return $null
    }
    return @{ Hex = $hex; Public = $publicKey }
}

if (Test-Path -LiteralPath $KeyFile) {
    throw "Refusing to overwrite $KeyFile. Delete that file yourself before generating another key."
}

$pair = $null
$openssl = Resolve-OpenSsl
if ($openssl) {
    $pair = Get-Ed25519FromOpenSsl -OpenSsl $openssl
}
if (-not $pair) {
    $pair = Get-Ed25519FromNode
}
if (-not $pair) {
    throw 'Could not generate an Ed25519 key. Install OpenSSL 3 (Git for Windows includes it) or Node.js, then run this script again.'
}

New-Item -ItemType Directory -Path $KeyDirectory -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($KeyFile, $pair.Hex, $utf8)

try {
    $acl = Get-Acl -LiteralPath $KeyFile
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $KeyFile -AclObject $acl
} catch {
    # The seed is already outside the repo. ACL tightening is best-effort.
}

Write-Output 'Add this TXT record at @ (the apex of ignacioventura.com.ar):'
Write-Output ('v=MCPv1; k=ed25519; p=' + $pair.Public)
Write-Output 'gh secret set MCP_REGISTRY_PRIVATE_KEY --body (Get-Content "$HOME\.mcp-registry\ignacioventura.key" -Raw).Trim()'
