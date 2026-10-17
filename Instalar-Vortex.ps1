$ErrorActionPreference = 'Stop'
try {
    $source = Join-Path $PSScriptRoot 'vortex'
    $pluginsRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Vortex\plugins'
    $destination = [IO.Path]::GetFullPath((Join-Path $pluginsRoot 'vortex-background-assistant'))
    if ([IO.Path]::GetDirectoryName($destination) -ne [IO.Path]::GetFullPath($pluginsRoot)) { throw 'Pasta de instalacao inesperada.' }
    $names = @('index.js', 'core.js', 'config.json', 'info.json')
    foreach ($name in $names) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) { throw "Arquivo ausente: $name" }
    }
    if (Test-Path -LiteralPath $destination) {
        $existingInfo = Get-Content -LiteralPath (Join-Path $destination 'info.json') -Raw | ConvertFrom-Json
        if ($existingInfo.id -ne 'vortex-background-assistant') { throw 'A pasta de destino nao pertence a esta extensao.' }
    }
    # A chave publica identifica a extensao; o segredo local e criado por instalacao.
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'chrome\manifest.json') -Raw | ConvertFrom-Json
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = $sha.ComputeHash([Convert]::FromBase64String($manifest.key)) } finally { $sha.Dispose() }
    $extensionId = -join ($digest[0..15] | ForEach-Object {
        [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15))
    })
    $previous = Get-Content -LiteralPath (Join-Path $source 'config.json') -Raw | ConvertFrom-Json
    $localToken = $previous.token
    if ($localToken -notmatch '^[0-9a-f]{64}$') {
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = New-Object byte[] 32
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $localToken = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    }
    $localConfig = [ordered]@{port=48927;token=$localToken;extensionOrigin=('chrome-extension://' + $extensionId)}
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $source 'config.json'), ($localConfig | ConvertTo-Json) + [Environment]::NewLine, $utf8)
    $chromeConfig = [ordered]@{port=48927;token=$localToken} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'chrome\config.js'), ('globalThis.VBA_CONFIG = Object.freeze(' + $chromeConfig + ');') + [Environment]::NewLine, $utf8)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($name in $names) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $destination $name) -Force
    }
    $obsoleteBridge = Join-Path $destination 'accelerator-bridge.js'
    if (Test-Path -LiteralPath $obsoleteBridge -PathType Leaf) { Remove-Item -LiteralPath $obsoleteBridge -Force }
    Write-Host 'Instalado! Reinicie o Vortex e carregue ou recarregue a pasta chrome. Veja README.md.' -ForegroundColor Green
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
