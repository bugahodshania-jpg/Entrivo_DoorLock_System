$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PhpExe = 'C:\php\php.exe'
$NpmCmd = 'C:\Program Files\nodejs\npm.cmd'
$StartUrl = 'http://127.0.0.1:5173/'

if (-not (Test-Path -LiteralPath $PhpExe)) {
    Write-Host "PHP was not found at $PhpExe"
    Write-Host 'Please update $PhpExe in this file.'
    Read-Host 'Press Enter to exit'
    exit 1
}

if (-not (Test-Path -LiteralPath $NpmCmd)) {
    Write-Host "npm was not found at $NpmCmd"
    Write-Host 'Please install Node.js or update $NpmCmd in this file.'
    Read-Host 'Press Enter to exit'
    exit 1
}

$FrontendDir = Join-Path $ProjectDir 'frontend'
$NodeModulesDir = Join-Path $FrontendDir 'node_modules'

if (-not (Test-Path -LiteralPath $NodeModulesDir)) {
    Write-Host 'Installing frontend dependencies...'
    Push-Location $FrontendDir
    & $NpmCmd install
    Pop-Location
}

Write-Host 'Starting Entrivo Door Lock System...'
Write-Host 'Backend API: http://127.0.0.1:8000'
Write-Host "Frontend:    $StartUrl"
Write-Host ''
Write-Host 'Keep the two server windows open while using the system.'

Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', "cd /d `"$ProjectDir`" && `"$PhpExe`" -S 127.0.0.1:8000 -t backend")
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', "cd /d `"$FrontendDir`" && `"$NpmCmd`" run dev")

Start-Sleep -Seconds 3
Start-Process $StartUrl
