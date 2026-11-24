#Requires -Version 5.1
<#
.SYNOPSIS
    Controls this project's local dev stack.

.DESCRIPTION
    Dev runs natively on Windows - no Docker, no WSL. `start` opens one
    Windows Terminal window split into four panes side by side, each owning
    one process so you can read its logs and Ctrl-C it independently:

        api       http://127.0.0.1:<portBase>        (Hono)
        www       http://127.0.0.1:<portBase + 1>    (Next.js)
        postgres  127.0.0.1:<portBase + 9>  (portable binaries in .tools\pgsql)
        caddy     https://<domain>  (+ api.)

    portBase, domain, name, database and postgresMajor come from project.json.
    The Node version is pinned in .node-version; start warns on a mismatch.

.EXAMPLE
    pnpm db:init          # once: create the local Postgres cluster
    pnpm dev              # start   (preferred - no path to type)
    pnpm stop             # stop
    pnpm status           # what is running
    pnpm dev:restart

.EXAMPLE
    .\dev.ps1 start -HeightFraction 0.7
    .\dev.ps1 stop -KeepWindow
#>

[CmdletBinding()]
param(
    # start | run | up   -  stop | kill | down   -  restart | status | db-init
    [Parameter(Position = 0)]
    [ValidateSet('start', 'run', 'up', 'stop', 'kill', 'down', 'restart', 'status', 'db-init')]
    [string] $Action = 'start',

    # Fraction of the screen's working height the window should occupy.
    [ValidateRange(0.2, 1.0)]
    [double] $HeightFraction = 0.5,

    # Launch even if a port is held by something that is not node/caddy.
    [switch] $Force,

    # With stop: leave the terminal window open. Default is to close it, so
    # dead windows do not accumulate across start/stop cycles.
    [switch] $KeepWindow
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Every project made from this repo owns a block of ten ports so several can
# run side by side: api is portBase, clients +1..+8, postgres +9.
$projectFile = Join-Path $root 'project.json'
if (-not (Test-Path $projectFile)) { throw "project.json not found at the repo root." }
$project = Get-Content $projectFile -Raw | ConvertFrom-Json
$portBase = [int]$project.portBase
$apiPort = $portBase
$wwwPort = $portBase + 1

# Postgres, portable: bin/lib/share copied out of EDB's
# postgresql-*-windows-x64-binaries.zip into .tools\pgsql. No installer, no
# Windows service - it runs only while the stack does. Not 5432, so it can
# never collide with a WSL Postgres forwarding onto localhost. The port is
# passed on every start, overriding the one initdb wrote into .pgdata, so a
# new portBase needs no new cluster.
$pgBin = Join-Path $root '.tools\pgsql\bin'
$pgData = Join-Path $root '.pgdata'
$pgPort = $portBase + 9

$ports = $apiPort, $wwwPort, $pgPort, 80, 443

# Pane titles carry the project name, so `stop` in one project can never
# close another project's window.
$panePrefix = "$($project.name):"

# Caddy needs 80/443, which no port block covers - only one project's Caddy
# can run at a time. Only ever stop the one that is this repo's caddy.exe.
$caddyExe = Join-Path $root 'caddy.exe'

# Accept the synonyms people actually type.
$verb = switch ($Action) {
    { $_ -in 'start', 'run', 'up' } { 'start'; break }
    { $_ -in 'stop', 'kill', 'down' } { 'stop'; break }
    default { $Action }
}

# ------------------------------------------------------------------ helpers --

function Get-PortOwner {
    param([int] $Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
}

# Ours to stop: node on this project's ports, or this repo's own caddy.exe.
# Another project's Caddy on 80/443 is never touched.
function Test-OwnProcess {
    param($Process)
    if ($Process.ProcessName -eq 'node') { return $true }
    return $Process.ProcessName -eq 'caddy' -and $Process.Path -eq $caddyExe
}

# Always a clean shutdown through pg_ctl. Stop-Process on the postmaster would
# leave its backends behind and force crash recovery on the next start.
function Stop-Db {
    if (-not (Test-Path (Join-Path $pgData 'postmaster.pid'))) { return $false }
    & (Join-Path $pgBin 'pg_ctl.exe') stop -D $pgData -m fast -w | Out-Null
    Write-Host "  stopped postgres (pg_ctl, fast shutdown)" -ForegroundColor DarkYellow
    return $true
}

# One-off: create the local cluster, the app role and its database. Settings
# here are the ones prod must match.
function Initialize-Db {
    if (-not (Test-Path (Join-Path $pgBin 'initdb.exe'))) {
        throw "Postgres binaries not found in $pgBin - copy bin, lib and share from EDB's PostgreSQL $($project.postgresMajor) Windows x86-64 binaries archive there (https://www.enterprisedb.com/download-postgresql-binaries)."
    }
    $pgMajor = Get-PgMajor
    if ($pgMajor -ne [int]$project.postgresMajor) {
        throw "Postgres in $pgBin is major $pgMajor, project.json pins $($project.postgresMajor)."
    }
    if (Test-Path $pgData) {
        throw "$pgData already exists. Delete it to start over (this wipes the local database)."
    }

    # Dev-only credentials, loopback-only cluster. Must match DATABASE_URL
    # (app role) and DATABASE_ADMIN_URL (superuser) in apps/api/.env.
    $superPassword = 'postgres'
    $appRole = $project.database
    $appPassword = 'devpassword'

    $pwFile = New-TemporaryFile
    Set-Content -Path $pwFile -Value $superPassword -NoNewline -Encoding ascii

    # UTF8 is explicit because initdb on Windows otherwise picks the console
    # codepage (WIN1252). The builtin C.UTF-8 provider makes sorting identical
    # on Windows and Linux; --locale=C keeps every libc category OS-neutral too.
    # The database always runs in UTC - clients convert to local.
    & (Join-Path $pgBin 'initdb.exe') -D $pgData -U postgres "--pwfile=$pwFile" `
        --auth=scram-sha-256 --encoding=UTF8 --locale=C `
        --locale-provider=builtin --builtin-locale=C.UTF-8 `
        -c "port=$pgPort" -c "listen_addresses=127.0.0.1" `
        -c "timezone=UTC" -c "log_timezone=UTC"
    $initExit = $LASTEXITCODE
    Remove-Item $pwFile
    if ($initExit -ne 0) { throw "initdb failed ($initExit)." }

    # Never pipe this: the server pg_ctl spawns inherits the pipe, so the
    # pipeline would wait for postgres itself to exit and hang forever.
    & (Join-Path $pgBin 'pg_ctl.exe') start -D $pgData -w -o "-p $pgPort" -l (Join-Path $pgData 'init.log')
    if ($LASTEXITCODE -ne 0) { throw "postgres did not start - see $pgData\init.log" }

    # Not a superuser, cannot create roles or databases: the same shape the
    # app gets in prod, so a permission error shows up here first.
    $env:PGPASSWORD = $superPassword
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -q `
        -c "CREATE ROLE $appRole LOGIN PASSWORD '$appPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE" `
        -c "CREATE DATABASE $appRole OWNER $appRole"
    $sqlExit = $LASTEXITCODE
    Remove-Item Env:\PGPASSWORD

    & (Join-Path $pgBin 'pg_ctl.exe') stop -D $pgData -m fast -w | Out-Null
    if ($sqlExit -ne 0) { throw "creating role/database failed ($sqlExit)." }

    # Write DATABASE_URL into apps/api/.env, keeping any other lines there.
    $databaseUrl = "postgres://${appRole}:${appPassword}@127.0.0.1:${pgPort}/${appRole}"
    $envFile = Join-Path $root 'apps\api\.env'
    $lines = @()
    if (Test-Path $envFile) {
        $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*DATABASE_URL=' })
    }
    $lines += "DATABASE_URL=$databaseUrl"
    Set-Content -Path $envFile -Value $lines -Encoding ascii

    Write-Host ""
    Write-Host "  postgres $pgMajor cluster ready in .pgdata (role/database '$appRole')" -ForegroundColor Green
    Write-Host "  wrote DATABASE_URL to apps\api\.env" -ForegroundColor Green
    Write-Host "  superuser (dev only): postgres://postgres:${superPassword}@127.0.0.1:${pgPort}/${appRole}" -ForegroundColor DarkGray
}

function Get-PgMajor {
    $out = & (Join-Path $pgBin 'postgres.exe') --version
    if ($out -match '(\d+)\.\d+') { return [int]$Matches[1] }
    return -1
}

# Warnings only: a mismatch should be visible, not block the stack.
function Test-Environment {
    $want = (Get-Content (Join-Path $root '.node-version') -Raw).Trim()
    $have = (& node --version).TrimStart('v')
    if ($have -ne $want) {
        Write-Warning "Node is $have, .node-version pins $want (prod runs the pinned one)."
    }
    if (Test-Path (Join-Path $pgBin 'postgres.exe')) {
        $pgMajor = Get-PgMajor
        if ($pgMajor -ne [int]$project.postgresMajor) {
            Write-Warning "Postgres in .tools\pgsql is major $pgMajor, project.json pins $($project.postgresMajor)."
        }
    }
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        Write-Warning "node_modules missing - run 'pnpm install' first. The api and www panes will fail."
    }
    if (-not (Test-Path (Join-Path $root 'apps\api\.env'))) {
        Write-Warning "apps\api\.env missing - run 'pnpm db:init'. The api will run without a database."
    }
}

function Stop-Stack {
    $killed = 0

    if (Stop-Db) { $killed++ }

    foreach ($port in $ports) {
        $p = Get-PortOwner -Port $port
        if (-not $p) { continue }

        if (Test-OwnProcess $p) {
            Write-Host "  stopped $($p.ProcessName) (pid $($p.Id)) on port $port" -ForegroundColor DarkYellow
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            $killed++
        }
        elseif ($p.ProcessName -eq 'caddy') {
            Write-Host "  port $port is another project's Caddy ($($p.Path)) - left alone" -ForegroundColor DarkGray
        }
        else {
            Write-Warning "Port $port held by $($p.ProcessName) (pid $($p.Id)) - left alone."
        }
    }

    # Watchers outlive their children: a `tsx watch` whose child died holds no
    # port at all, so the loop above never sees it, and it silently eats file
    # handles until you notice three of them. Match on command line against
    # this repo's path so nothing else on the machine is ever touched.
    $rootPattern = [regex]::Escape($root)
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'caddy.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $rootPattern } |
        ForEach-Object {
            Write-Host "  stopped orphaned $($_.Name) (pid $($_.ProcessId))" -ForegroundColor DarkYellow
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            $killed++
        }

    Start-Sleep -Milliseconds 500

    $stuck = foreach ($port in $ports) {
        $p = Get-PortOwner -Port $port
        if ($p -and (Test-OwnProcess $p)) { $port }
    }
    if ($stuck) { Write-Warning "Still listening: $($stuck -join ', ')" }
    elseif ($killed -eq 0) { Write-Host "  nothing was running" -ForegroundColor DarkGray }
    else { Write-Host "  all ports free" -ForegroundColor Green }

    # Panes use -NoExit so a crash stays readable, which means the window
    # outlives the processes. Close it here or they stack up over a session.
    # Pane titles are prefixed with the project name precisely so this match
    # cannot hit an unrelated terminal, or another project's stack.
    if (-not $KeepWindow) {
        $windows = @(Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowTitle.StartsWith($panePrefix) })
        foreach ($w in $windows) {
            $w.CloseMainWindow() | Out-Null
        }
        if ($windows.Count -gt 0) {
            Write-Host "  closed $($windows.Count) stack window(s)" -ForegroundColor DarkGray
        }
    }
}

function Show-Status {
    $names = @{ $apiPort = 'api'; $wwwPort = 'www'; $pgPort = 'postgres'; 80 = 'caddy:http'; 443 = 'caddy:https' }
    $any = $false

    foreach ($port in $ports) {
        $p = Get-PortOwner -Port $port
        $label = "{0,-11} {1,-5}" -f $names[$port], $port
        if ($p) {
            $any = $true
            Write-Host "  $label  up    $($p.ProcessName) (pid $($p.Id))" -ForegroundColor Green
        }
        else {
            Write-Host "  $label  down" -ForegroundColor DarkGray
        }
    }

    if (-not $any) { Write-Host "`n  stack is not running - pnpm dev" -ForegroundColor DarkGray }
}

function Start-Stack {
    # Idempotent. Without this, repeatedly running `start` on an already-running
    # stack opens a new terminal window every time and they pile up unnoticed.
    $up = @($ports | Where-Object { Get-PortOwner -Port $_ })
    if ($up.Count -eq $ports.Count -and -not $Force) {
        Write-Host "  stack is already running - not opening another window" -ForegroundColor Green
        Write-Host ""
        Show-Status
        Write-Host ""
        Write-Host "  pnpm dev:restart   to recycle it" -ForegroundColor DarkGray
        return
    }

    Test-Environment

    if (-not (Get-Command wt.exe -ErrorAction SilentlyContinue)) {
        throw "Windows Terminal (wt.exe) not found. Install it from the Microsoft Store."
    }
    if (-not (Test-Path $caddyExe)) {
        Write-Warning "caddy.exe not found in $root - that pane will fail."
    }
    if (-not (Test-Path $pgData)) {
        Write-Warning "No local Postgres cluster - run 'pnpm db:init' first. The postgres pane will fail."
    }

    # Closing the window kills the shell but routinely leaves its node child
    # holding a port, which fails the next start with EADDRINUSE.
    if (-not $Force) {
        foreach ($port in $ports) {
            $p = Get-PortOwner -Port $port
            if (-not $p) { continue }
            if ($port -eq $pgPort -and $p.ProcessName -eq 'postgres' -and (Stop-Db)) { continue }
            if (Test-OwnProcess $p) {
                Write-Host "  clearing stale $($p.ProcessName) (pid $($p.Id)) on port $port" -ForegroundColor DarkYellow
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
            elseif ($p.ProcessName -eq 'caddy') {
                Write-Warning "Port $port is another project's Caddy ($($p.Path)). Only one Caddy can run at a time - this project's caddy pane will fail; the rest of the stack is fine."
            }
            else {
                throw "Port $port is held by $($p.ProcessName) (pid $($p.Id)). Use -Force to launch anyway."
            }
        }
        Start-Sleep -Milliseconds 400
    }

    $shell = if (Get-Command pwsh.exe -ErrorAction SilentlyContinue) { 'pwsh.exe' } else { 'powershell.exe' }

    # Fresh window name per run. With a fixed name, `wt -w <name>` reuses an
    # existing window and stacks another three panes onto it - panes linger
    # after stop because of -NoExit.
    $windowName = "$($project.name)-$(Get-Date -Format 'HHmmss')"

    # Four equal columns. Each --size is a fraction of the pane being split,
    # not of the window, so 0.75 -> 0.666 -> 0.5 lands on exact quarters.
    # Splitting without --size would give 50/25/12.5/12.5.
    # Titles carry the project-name prefix so `stop` can identify this window
    # without risking a match on some unrelated terminal called "api".
    # postgres runs in the foreground so its log is the pane; Ctrl-C there is
    # a fast (clean) shutdown.
    # The Caddyfile has no domain or ports of its own; they come from
    # project.json as {$ZFS_*} environment variables, written to a git-ignored
    # env file that caddy loads with --envfile. Never put ';' in a pane
    # command: wt.exe treats it as its own command separator and splits there.
    $caddyEnvFile = Join-Path $root '.tools\caddy.env'
    New-Item -ItemType Directory -Force (Split-Path $caddyEnvFile) | Out-Null
    Set-Content -Path $caddyEnvFile -Encoding ascii -Value @(
        "ZFS_DOMAIN=$($project.domain)"
        "ZFS_API_PORT=$apiPort"
        "ZFS_WWW_PORT=$wwwPort"
    )
    $panes = @(
        @{ Title = "${panePrefix}www"; Size = $null; Cmd = 'pnpm --filter @zfs/www dev' }
        @{ Title = "${panePrefix}api"; Size = 0.75; Cmd = 'pnpm --filter @zfs/api dev' }
        @{ Title = "${panePrefix}postgres"; Size = 0.666; Cmd = ".\.tools\pgsql\bin\postgres.exe -D .pgdata -p $pgPort" }
        @{ Title = "${panePrefix}caddy"; Size = 0.5; Cmd = '.\caddy.exe run --config Caddyfile --adapter caddyfile --envfile .tools\caddy.env' }
    )

    Write-Host "starting $($project.name) dev stack..." -ForegroundColor Cyan

    $first = $panes[0]
    & wt.exe -w $windowName new-tab --title $first.Title -d $root $shell -NoExit -Command $first.Cmd

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 250
        $wtProc = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    } until ($wtProc -or (Get-Date) -gt $deadline)

    if (-not $wtProc) { throw "Windows Terminal did not open within 15s." }

    foreach ($pane in $panes[1..($panes.Count - 1)]) {
        & wt.exe -w $windowName split-pane --vertical --size $pane.Size --title $pane.Title -d $root $shell -NoExit -Command $pane.Cmd
        Start-Sleep -Milliseconds 350
    }

    # wt's own --size is in character cells, which cannot express "full width,
    # half height". Resize in pixels through Win32 instead.
    if (-not ('Zfs.Native' -as [type])) {
        Add-Type -Namespace 'Zfs' -Name 'Native' -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();

[DllImport("user32.dll", SetLastError = true)]
public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
'@
    }

    Add-Type -AssemblyName System.Windows.Forms
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    Start-Sleep -Milliseconds 600

    # Only resize if the foreground window really is Windows Terminal, so a
    # stray click during startup cannot make us resize something else.
    $hwnd = [Zfs.Native]::GetForegroundWindow()
    $fgPid = 0
    [void][Zfs.Native]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
    $fgProc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue

    if ($fgProc -and $fgProc.ProcessName -eq 'WindowsTerminal') {
        $h = [int]($area.Height * $HeightFraction)
        [void][Zfs.Native]::MoveWindow($hwnd, $area.X, $area.Y, $area.Width, $h, $true)
        Write-Host "  window sized to $($area.Width) x $h" -ForegroundColor DarkGray
    }
    else {
        Write-Warning "Foreground window is not Windows Terminal - skipped resize."
    }

    Write-Host ""
    Write-Host "  www       http://127.0.0.1:$wwwPort" -ForegroundColor Green
    Write-Host "  api       http://127.0.0.1:$apiPort" -ForegroundColor Green
    Write-Host "  postgres  127.0.0.1:$pgPort" -ForegroundColor Green
    Write-Host "  caddy     https://$($project.domain)" -ForegroundColor Green
    Write-Host ""
    Write-Host "  pnpm stop   to kill it" -ForegroundColor DarkGray
}

# ----------------------------------------------------------------- dispatch --

switch ($verb) {
    'start' { Start-Stack }
    'stop' { Stop-Stack }
    'status' { Show-Status }
    'db-init' { Initialize-Db }
    'restart' {
        Stop-Stack
        Start-Sleep -Milliseconds 600
        Start-Stack
    }
}
