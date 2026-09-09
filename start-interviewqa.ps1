$ErrorActionPreference = 'Stop'

# 从脚本位置定位项目，启动前先检查依赖。
$adminPath = Join-Path $PSScriptRoot 'admin'
$nextPath = Join-Path $adminPath 'node_modules\next\dist\bin\next'
$url = 'http://localhost:3333'
$startupMutex = New-Object System.Threading.Mutex($false, 'Local\InterviewQA-Startup-3333')
$locked = $false

function Get-PortOwners {
    # 查询失败时直接报错，不能把查询失败当成端口空闲。
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object LocalPort -eq 3333 |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-ProjectProcess([int]$processId) {
    # 只认可本项目 Next.js 的绝对路径；兼容监听进程的父级是 Next.js 启动器。
    $childCreated = $null
    for ($depth = 0; $depth -lt 8 -and $processId -gt 0; $depth++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
        if (-not $process) { return $false }
        if ($childCreated -and $process.CreationDate -gt $childCreated) { return $false }
        $command = ([string]$process.CommandLine).Replace('/', '\')
        $nextRoot = Join-Path $adminPath 'node_modules\next\'
        $pattern = '(?i)(?:^|[\s"''])' + [regex]::Escape($nextRoot)
        if ($process.Name -eq 'node.exe' -and $command -match $pattern) { return $true }
        $childCreated = $process.CreationDate
        $processId = $process.ParentProcessId
    }
    return $false
}

try {
    # 同一时间只允许一个启动流程释放端口、启动服务。
    try { $locked = $startupMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) {
        Write-Host 'InterviewQA 正在启动，请稍候。'
        return
    }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath $nextPath)) {
        throw '缺少项目依赖，请在 admin 目录运行 npm install 后重试。'
    }

    Write-Host '正在检查 3333 端口...'
    $owners = @(Get-PortOwners)
    # 先检查所有监听者，存在其他项目或无法识别的进程时不终止任何进程。
    foreach ($owner in $owners) {
        if (-not (Test-ProjectProcess $owner)) {
            throw "3333 端口被其他程序或无法确认归属的进程占用（PID $owner）。请手动关闭占用程序后重试。"
        }
    }
    foreach ($owner in $owners) {
        if (-not (Test-ProjectProcess $owner)) { throw '端口进程发生变化，请重新启动。' }
        Write-Host "正在结束本项目旧服务（PID $owner）..."
        & "$env:SystemRoot\System32\taskkill.exe" /PID $owner /T /F
        if ($LASTEXITCODE -ne 0) { throw '旧服务结束失败，请检查进程权限。' }
    }
    $releaseDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (@(Get-PortOwners).Count -gt 0) {
        if ([DateTime]::UtcNow -ge $releaseDeadline) { throw '3333 端口未能释放，请稍后重试。' }
        Start-Sleep -Milliseconds 300
    }

    # 日志文件名记录北京时间；服务在后台运行，不依赖启动窗口存活。
    $beijingNow = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time')
    $logDir = Join-Path $env:LOCALAPPDATA 'InterviewQA\logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $logPrefix = Join-Path $logDir $beijingNow.ToString('yyyyMMdd-HHmmss-fff')
    Write-Host '正在启动 InterviewQA...'
    $server = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $nextPath + '"'), 'dev', '-p', '3333') -WorkingDirectory $adminPath -WindowStyle Hidden -RedirectStandardOutput "$logPrefix.log" -RedirectStandardError "$logPrefix.error.log" -PassThru

    # 等待首页就绪，并确认提供页面的监听者仍属于本项目。
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $server.Refresh()
        if ($server.HasExited) { throw "服务已退出，查看日志：$logPrefix.error.log" }
        $listeners = @(Get-PortOwners)
        foreach ($listener in $listeners) {
            if (-not (Test-ProjectProcess $listener)) { throw '启动期间 3333 被其他程序占用。' }
        }
        if ($listeners.Count -gt 0) {
            try {
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "服务未在 90 秒内就绪，查看日志：$logPrefix.error.log" }
    Start-Process $url
    Write-Host '启动成功。'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host '按回车关闭此窗口'
    exit 1
} finally {
    if ($locked) { $startupMutex.ReleaseMutex() }
    $startupMutex.Dispose()
}
