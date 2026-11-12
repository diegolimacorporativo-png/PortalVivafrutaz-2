#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateSet(5000, 5001)]
  [int]$HttpPort = 5000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$postgresBin = Join-Path $env:LOCALAPPDATA "PortalVivafrutaz-Homologacao\postgres-bin\pgsql\bin"
$initdb = Join-Path $postgresBin "initdb.exe"
$pgCtl = Join-Path $postgresBin "pg_ctl.exe"
$createdb = Join-Path $postgresBin "createdb.exe"
$postgres = Join-Path $postgresBin "postgres.exe"
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$node = $nodeCommand.Source
$tsx = Join-Path $repositoryRoot "node_modules\tsx\dist\cli.mjs"
$prepareScript = Join-Path $repositoryRoot "scripts\prepare-isolated-preview-db.ts"
$serverEntry = Join-Path $repositoryRoot "server\index.ts"
$windowsProcessHelper = Join-Path $PSScriptRoot "IsolatedPreviewWindows.cs"
$teardownModule = Join-Path $PSScriptRoot "isolated-preview-teardown.psm1"
$databasePort = 55439
$databaseName = "vivafrutaz_preview"
$databaseUser = "preview"
$rootPrefix = "vivafrutaz-isolated-preview."
$markerPrefix = "vivafrutaz-isolated-preview-v1:"
$tempRoot = $null
$dataDirectory = $null
$markerPath = $null
$clusterStartAttempted = $false
$serverProcess = $null
$preserveTempRoot = $false
$ownedClusterIdentity = $null
$childProcesses = [Collections.Generic.List[Diagnostics.Process]]::new()

$processApiPath = Join-Path $PSScriptRoot "IsolatedPreviewWindows.cs"
if (-not (Test-Path -LiteralPath $processApiPath -PathType Leaf)) { throw "Componente Windows do harness ausente: $processApiPath" }
if (-not ("PortalVivafrutaz.IsolatedProcessJob" -as [type])) { Add-Type -Path $processApiPath }
if (-not (Test-Path -LiteralPath $teardownModule -PathType Leaf)) { throw "Módulo de teardown ausente: $teardownModule" }
Import-Module -Name $teardownModule -Force
$processJob = [PortalVivafrutaz.IsolatedProcessJob]::new()
$processApi = [PortalVivafrutaz.NativeContainedProcessApi]::new()
$pathPins = [Collections.Generic.List[IDisposable]]::new()

function ConvertTo-WindowsArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes++
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (2 * $backslashes + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes))
      $backslashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * (2 * $backslashes))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function New-CleanEnvironment([hashtable]$Additional) {
  $systemRoot = [Environment]::GetEnvironmentVariable("SystemRoot", "Machine")
  if (-not $systemRoot) { $systemRoot = $env:SystemRoot }
  if (-not $systemRoot) { throw "SystemRoot não foi encontrado; o processo filho não será iniciado." }
  $safe = @{
    SystemRoot = $systemRoot
    WINDIR = $systemRoot
    PATH = "$postgresBin;$([IO.Path]::GetDirectoryName($node));$systemRoot\System32"
    TEMP = [IO.Path]::GetTempPath()
    TMP = [IO.Path]::GetTempPath()
    HOME = if ($tempRoot) { $tempRoot } else { [IO.Path]::GetTempPath() }
  }
  foreach ($key in $Additional.Keys) { $safe[$key] = [string]$Additional[$key] }
  return $safe
}

function New-CleanProcessInfo(
  [string]$FilePath,
  [string[]]$Arguments,
  [hashtable]$Environment
) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FilePath
  $info.WorkingDirectory = $repositoryRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $false
  $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join " ")
  $info.EnvironmentVariables.Clear()
  foreach ($key in $Environment.Keys) {
    $info.EnvironmentVariables[$key] = [string]$Environment[$key]
  }
  return $info
}

function Invoke-CleanProcess(
  [string]$FilePath,
  [string[]]$Arguments,
  [hashtable]$Environment,
  [int]$TimeoutMilliseconds = 180000,
  [scriptblock]$ProcessFactory = { [Diagnostics.Process]::new() }
) {
  $info = New-CleanProcessInfo $FilePath $Arguments $Environment
  $process = & $ProcessFactory
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Não foi possível iniciar o binário PostgreSQL solicitado." }
  $childProcesses.Add($process)
  try {
    $processJob.Assign($process.Handle)
  } catch {
    $associationError = $_
    $exitConfirmed = $false
    try {
      if ($process.HasExited) {
        $exitConfirmed = $true
        Write-Host "[ISOLATED_PREVIEW_CHILD_EXIT_CONFIRMED] PID=$($process.Id) já estava encerrado após falha de associação."
      } else {
        try { $process.Kill($true) }
        catch { Write-Warning "Falha ao solicitar encerramento do filho PID=$($process.Id): $($_.Exception.Message)" }

        # Kill is asynchronous. Keep the process reference tracked until the OS
        # confirms termination; a timeout/error permanently blocks temp cleanup.
        $exitConfirmed = [bool]$process.WaitForExit(10000)
        if ($exitConfirmed) {
          Write-Host "[ISOLATED_PREVIEW_CHILD_EXIT_CONFIRMED] PID=$($process.Id) encerrou após falha de associação."
        }
      }
    } catch {
      Write-Warning "Não foi possível confirmar a saída do filho PID=$($process.Id): $($_.Exception.Message)"
    }

    if ($exitConfirmed) {
      [void]$childProcesses.Remove($process)
      try { $process.Dispose() }
      catch {
        $script:preserveTempRoot = $true
        Write-Warning "O filho PID=$($process.Id) encerrou, mas seu handle não pôde ser descartado: $($_.Exception.Message)"
      }
    } else {
      $script:preserveTempRoot = $true
      Write-Warning "[ISOLATED_PREVIEW_CHILD_UNCONFIRMED] PID=$($process.Id) continua sem saída confirmada; a raiz temporária será preservada."
    }
    throw $associationError
  }

  try {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while (-not $process.WaitForExit(250)) {
      if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        throw "Timeout aguardando processo isolado: $FilePath"
      }
    }
    if ($process.ExitCode -ne 0) {
      throw "Processo isolado terminou com código $($process.ExitCode): $FilePath"
    }
  } catch {
    if (-not $process.HasExited) {
      try { $process.Kill($true); $process.WaitForExit(10000) } catch { $script:preserveTempRoot = $true }
    }
    throw
  } finally {
    [void]$childProcesses.Remove($process)
    $process.Dispose()
  }
}

function Invoke-ContainedProcess(
  [string]$FilePath,
  [string[]]$Arguments,
  [hashtable]$Environment,
  [int]$TimeoutMilliseconds = 180000
) {
  $resolvedExecutable = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $FilePath -ErrorAction Stop).Path)
  $commandLine = (@($resolvedExecutable) + @($Arguments) | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join " "
  $cleanEnvironment = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($key in $Environment.Keys) { $cleanEnvironment[[string]$key] = [string]$Environment[$key] }

  # CreateProcess receives PROC_THREAD_ATTRIBUTE_JOB_LIST. The pg_ctl process
  # is born suspended and already inside this runner's Job Object; only then is
  # its primary thread resumed. Its postmaster descendants inherit membership.
  $process = [PortalVivafrutaz.ContainedProcessLauncher]::Start(
    $processApi, $processJob.Handle, $resolvedExecutable, $commandLine,
    $repositoryRoot, $cleanEnvironment
  )
  try {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while (-not $process.WaitForExit(250)) {
      if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        $process.Kill(1)
        throw "Timeout aguardando processo contido: $resolvedExecutable"
      }
    }
    if ($process.ExitCode -ne 0) {
      throw "Processo contido terminou com código $($process.ExitCode): $resolvedExecutable"
    }
  } finally {
    $process.Dispose()
  }
}

function Stop-TrackedChildren {
  foreach ($process in @($childProcesses.ToArray())) {
    $exitConfirmed = $false
    try {
      if ($process.HasExited) {
        $exitConfirmed = $true
      } else {
        try { $process.Kill($true) }
        catch { Write-Warning "Falha ao solicitar encerramento do filho PID=$($process.Id): $($_.Exception.Message)" }
        $exitConfirmed = [bool]$process.WaitForExit(10000)
      }
    } catch {
      $script:preserveTempRoot = $true
      Write-Warning "Não foi possível confirmar a saída do filho iniciado nesta execução (PID $($process.Id)): $($_.Exception.Message)"
    }
    if ($exitConfirmed) {
      [void]$childProcesses.Remove($process)
      try { $process.Dispose() }
      catch {
        $script:preserveTempRoot = $true
        Write-Warning "Não foi possível descartar o handle do filho encerrado PID=$($process.Id): $($_.Exception.Message)"
      }
    } else {
      $script:preserveTempRoot = $true
      Write-Warning "O filho PID=$($process.Id) não encerrou no prazo; a raiz temporária será preservada."
    }
  }
}

function Get-Listeners([int]$Port) {
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    throw "Get-NetTCPConnection não está disponível; a porta não pode ser validada com segurança."
  }
  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
  } catch {
    # Windows PowerShell emits this specific CIM error when the query succeeds
    # but the requested port has no listeners. Treat only that result as free;
    # provider/permission/query failures must still stop the runner.
    if ($_.FullyQualifiedErrorId -like "CmdletizationQuery_NotFound,Get-NetTCPConnection*") {
      return @()
    }
    throw
  }
}

function Assert-OwnedClusterIdentity([object]$ExpectedIdentity = $null) {
  Assert-OwnedDataPath
  $pidFile = Join-Path $dataDirectory "postmaster.pid"
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
    throw "O postmaster.pid do cluster criado nesta execução não existe. Diretório será preservado."
  }
  $pidLines = @(Get-Content -LiteralPath $pidFile)
  if ($pidLines.Count -lt 5 -or $pidLines[0] -notmatch '^\d+$') {
    throw "O postmaster.pid não contém a identidade esperada. Diretório será preservado."
  }
  $recordedDataDirectory = [IO.Path]::GetFullPath($pidLines[1].Trim())
  $expectedDataDirectory = [IO.Path]::GetFullPath($dataDirectory)
  # PostgreSQL's Windows postmaster.pid stores the socket directory (blank
  # for this TCP-only cluster) on line 5 and listen_addresses on line 6.
  if (
    -not [string]::Equals($recordedDataDirectory, $expectedDataDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    [int]$pidLines[3] -ne $databasePort -or
    $pidLines[5].Trim() -ne "127.0.0.1"
  ) {
    throw "A identidade do cluster em execução diverge; nenhum processo será encerrado."
  }

  $serverPid = [int]$pidLines[0]
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
  if (-not $processInfo) { throw "O PID registrado não está ativo; diretório será preservado." }
  $expectedExecutable = [IO.Path]::GetFullPath($postgres)
  if (-not [string]::Equals([IO.Path]::GetFullPath($processInfo.ExecutablePath), $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "O PID registrado não pertence ao postgres.exe isolado esperado; processo não será encerrado."
  }
  $normalizedCommandLine = $processInfo.CommandLine.Replace('/', '\')
  if ($normalizedCommandLine.IndexOf($expectedDataDirectory, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "A linha de comando não confirma o diretório do cluster; processo não será encerrado."
  }
  $current = [pscustomobject]@{
    ProcessId = $serverPid
    ExecutablePath = [IO.Path]::GetFullPath($processInfo.ExecutablePath)
    CommandLine = $normalizedCommandLine
    DataDirectory = $expectedDataDirectory
    Port = $databasePort
    Address = "127.0.0.1"
    CreationDate = [string]$processInfo.CreationDate
    Nonce = [IO.Path]::GetFileName([IO.Path]::GetFullPath($tempRoot))
  }
  if ($ExpectedIdentity) {
    Assert-IsolatedProcessIdentity -Actual $current -Expected $ExpectedIdentity
  }
  return $current
}

function Assert-OwnedDataPath {
  if (-not $tempRoot -or -not $dataDirectory) { throw "Identidade do diretório do cluster ausente." }
  $rootItem = Get-Item -LiteralPath $tempRoot -Force -ErrorAction Stop
  $dataItem = Get-Item -LiteralPath $dataDirectory -Force -ErrorAction Stop
  if (
    -not $rootItem.PSIsContainer -or -not $dataItem.PSIsContainer -or
    ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    ($dataItem.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) { throw "Raiz ou diretório de dados é link, junction ou reparse point." }
  $rootResolved = (Resolve-Path -LiteralPath $tempRoot -ErrorAction Stop).Path
  $dataResolved = (Resolve-Path -LiteralPath $dataDirectory -ErrorAction Stop).Path
  if (-not [string]::Equals([IO.Path]::GetDirectoryName($dataResolved), $rootResolved, [StringComparison]::OrdinalIgnoreCase)) {
    throw "O diretório real do cluster não está diretamente contido na raiz temporária."
  }
  if ($pathPins.Count -ge 2) {
    $pathPins[0].AssertSamePath($tempRoot)
    $pathPins[1].AssertSamePath($dataDirectory)
  }
}

function Assert-OwnedTempRoot {
  if (-not $tempRoot -or -not (Test-Path -LiteralPath $tempRoot -PathType Container)) {
    throw "O temporário criado por esta execução não está disponível."
  }
  $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $rootFull = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\')
  $tempBaseItem = Get-Item -LiteralPath $tempBase -Force -ErrorAction Stop
  $rootItem = Get-Item -LiteralPath $rootFull -Force -ErrorAction Stop
  if (
    -not $tempBaseItem.PSIsContainer -or -not $rootItem.PSIsContainer -or
    ($tempBaseItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw "A raiz do TEMP ou o cluster é link, junction ou reparse point; diretório será preservado."
  }
  $tempBaseResolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $tempBase -ErrorAction Stop).Path).TrimEnd('\')
  $rootResolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $rootFull -ErrorAction Stop).Path).TrimEnd('\')
  if (-not [string]::Equals([IO.Path]::GetDirectoryName($rootResolved), $tempBaseResolved, [StringComparison]::OrdinalIgnoreCase)) {
    throw "O caminho real do cluster não é filho direto do TEMP validado."
  }
  $baseUri = [Uri]::new($tempBase.TrimEnd('\') + '\')
  $rootUri = [Uri]::new($rootResolved.TrimEnd('\') + '\')
  $relative = [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($rootUri).ToString()).Replace('/', '\').TrimEnd('\')
  $nonce = [IO.Path]::GetFileName($rootFull).Substring($rootPrefix.Length)
  if (
    [IO.Path]::IsPathRooted($relative) -or
    $relative -notmatch ('^' + [regex]::Escape($rootPrefix) + '[a-f0-9]{32}$') -or
    [IO.Path]::GetFileName($rootFull) -notmatch ('^' + [regex]::Escape($rootPrefix) + '[a-f0-9]{32}$') -or
    $nonce -notmatch '^[a-f0-9]{32}$' -or
    [IO.Path]::GetFullPath($dataDirectory) -ne [IO.Path]::GetFullPath((Join-Path $rootFull "postgres"))
  ) {
    throw "O caminho temporário não corresponde ao diretório nonce desta execução."
  }
  $markerItem = Get-Item -LiteralPath $markerPath -Force -ErrorAction Stop
  if ($markerItem.PSIsContainer -or ($markerItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "O marcador não é arquivo regular; diretório será preservado."
  }
  Assert-OwnedDataPath
  if ($pathPins.Count -ge 3) { $pathPins[2].AssertSamePath($markerPath) }
  Assert-PrivateTempAcl
  if ($pathPins.Count -lt 3) { throw "O handle fixado do marcador não está disponível." }
  $marker = $pathPins[2].ReadUtf8Text()
  if ($marker -cne "$markerPrefix$nonce`n") {
    throw "O marcador não corresponde ao nonce desta execução; diretório será preservado."
  }
}

function Assert-NoReparsePointsInTree([string]$Root) {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($rootFull)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($entry in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Reparse point encontrado no diretório temporário; remoção bloqueada: $($entry.FullName)"
      }
      if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
      $entryFull = [IO.Path]::GetFullPath($entry.FullName)
      $relative = [IO.Path]::GetRelativePath($rootFull, $entryFull)
      if ([IO.Path]::IsPathRooted($relative) -or $relative -eq '..' -or $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)")) {
        throw "Conteúdo escapou da raiz temporária; remoção bloqueada: $entryFull"
      }
    }
  }
}

function Release-PathPins {
  $errors = [Collections.Generic.List[Exception]]::new()
  for ($index = $pathPins.Count - 1; $index -ge 0; $index--) {
    try { $pathPins[$index].Dispose() } catch { $errors.Add($_.Exception) }
  }
  $pathPins.Clear()
  if ($errors.Count -gt 0) { throw [AggregateException]::new("Um ou mais handles de caminho não puderam ser fechados.", $errors) }
}

function Test-OwnedClusterStopped([object]$Identity) {
  $deadline = [Diagnostics.Stopwatch]::StartNew()
  while ($deadline.ElapsedMilliseconds -lt 10000) {
    $listeners = Get-Listeners $databasePort
    $activeOwnedProcesses = $processJob.ActiveProcessCount
    $ownedProcessStillActive = $false
    $pidFile = Join-Path $dataDirectory "postmaster.pid"
    if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
      try {
        $pidLines = @(Get-Content -LiteralPath $pidFile -ErrorAction Stop)
        if ($pidLines.Count -lt 5 -or $pidLines[0] -notmatch '^\d+$') {
          $ownedProcessStillActive = $true
        } else {
          $pidFileProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$pidLines[0])" -ErrorAction SilentlyContinue
          if ($pidFileProcess) { $ownedProcessStillActive = $true }
        }
      } catch {
        # An unreadable or malformed PID file is not proof that shutdown completed.
        $ownedProcessStillActive = $true
      }
    }
    if ($Identity) {
      $current = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Identity.ProcessId)" -ErrorAction SilentlyContinue
      if ($current -and [string]::Equals([string]$current.CreationDate, [string]$Identity.CreationDate, [StringComparison]::OrdinalIgnoreCase)) {
        $ownedProcessStillActive = $true
      }
    }
    if ($listeners.Count -eq 0 -and $activeOwnedProcesses -eq 0 -and -not $ownedProcessStillActive) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Assert-PrivateTempAcl {
  $acl = Get-Acl -LiteralPath $tempRoot -ErrorAction Stop
  if (-not $acl.AreAccessRulesProtected) { throw "A ACL da raiz temporária ainda herda permissões externas." }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, "S-1-5-18")
  $ownerSid = $acl.Owner
  try { $ownerSid = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
  if ($ownerSid -ne $currentSid) { throw "A raiz temporária não pertence à identidade atual." }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin $allowedSids) {
      throw "A ACL da raiz concede acesso a uma identidade não autorizada: $($rule.IdentityReference.Value)"
    }
  }
}

function Get-BinaryVersion([string]$BinaryPath) {
  $resolvedPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $BinaryPath -ErrorAction Stop).Path)
  $resolvedBin = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $postgresBin -ErrorAction Stop).Path)
  if (-not [string]::Equals([IO.Path]::GetDirectoryName($resolvedPath), $resolvedBin, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Executável PostgreSQL fora da instalação configurada: $resolvedPath"
  }

  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $resolvedPath
  $info.Arguments = "--version"
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables.Clear()
  $safeEnvironment = New-CleanEnvironment @{}
  foreach ($key in $safeEnvironment.Keys) { $info.EnvironmentVariables[$key] = [string]$safeEnvironment[$key] }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Não foi possível verificar $resolvedPath" }
  try { $processJob.Assign($process.Handle) } catch { try { $process.Kill($true) } catch {}; $process.Dispose(); throw }
  $childProcesses.Add($process)
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(15000)) {
      $process.Kill($true)
      throw "Timeout verificando versão de $resolvedPath"
    }
    $versionOutput = $stdoutTask.GetAwaiter().GetResult() + $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0 -or $versionOutput -notmatch 'PostgreSQL\) 18\.6(?:\s|$)') {
      throw "O executável não confirmou PostgreSQL 18.6: $resolvedPath"
    }
    return [pscustomobject]@{
      Path = $resolvedPath
      Version = $versionOutput.Trim()
      Sha256 = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash
    }
  } finally {
    [void]$childProcesses.Remove($process)
    $process.Dispose()
  }
}

try {
  foreach ($binary in @($initdb, $pgCtl, $createdb, $postgres, $tsx, $prepareScript, $serverEntry, $windowsProcessHelper, $teardownModule)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
      throw "Dependência local ausente: $binary. Nenhuma instalação será tentada."
    }
  }
  if (Get-Listeners $databasePort | Select-Object -First 1) {
    throw "A porta 55439 está ocupada. O runner não encerrará o listener existente."
  }
  if (Get-Listeners $HttpPort | Select-Object -First 1) {
    throw "A porta HTTP $HttpPort está ocupada. O runner não encerrará o listener existente."
  }

  $binaryVersions = @(
    Get-BinaryVersion $postgres
    Get-BinaryVersion $initdb
    Get-BinaryVersion $pgCtl
    Get-BinaryVersion $createdb
  )
  if (@($binaryVersions.Path | Select-Object -Unique).Count -ne 4) {
    throw "Os binários PostgreSQL não pertencem a quatro executáveis distintos da mesma instalação."
  }
  Write-Host "[ISOLATED_PREVIEW_BINARIES] Versões e SHA-256 dos quatro executáveis confirmados:"
  $binaryVersions | ForEach-Object { Write-Host ("{0} | {1} | SHA256={2}" -f $_.Path, $_.Version, $_.Sha256) }

  $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $nonce = [guid]::NewGuid().ToString("N")
  $tempRoot = Join-Path $tempBase "$rootPrefix$nonce"
  if (Test-Path -LiteralPath $tempRoot) { throw "Colisão no nome temporário; nenhuma pasta será reutilizada." }
  [PortalVivafrutaz.PrivateDirectory]::CreateForCurrentUser($tempRoot)
  $tempRoot = (Resolve-Path -LiteralPath $tempRoot).Path
  $dataDirectory = Join-Path $tempRoot "postgres"
  $markerPath = Join-Path $tempRoot ".isolated-preview-marker"
  $pathPins.Add([PortalVivafrutaz.PinnedPath]::OpenDirectory($tempRoot))
  Assert-PrivateTempAcl
  [IO.Directory]::CreateDirectory($dataDirectory) | Out-Null
  $pathPins.Add([PortalVivafrutaz.PinnedPath]::OpenDirectory($dataDirectory))
  [IO.File]::WriteAllText($markerPath, "$markerPrefix$nonce`n", [Text.UTF8Encoding]::new($false))
  $pathPins.Add([PortalVivafrutaz.PinnedPath]::OpenRegularFile($markerPath))
  Assert-OwnedTempRoot

  $commonEnvironment = New-CleanEnvironment @{}
  Invoke-CleanProcess $initdb @(
    "-D", $dataDirectory, "--auth-local=trust", "--auth-host=trust",
    "--username=$databaseUser", "--encoding=UTF8", "--no-locale", "--no-sync"
  ) $commonEnvironment 300000

  $clusterStartAttempted = $true
  $postgresOptions = "-h 127.0.0.1 -p $databasePort -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off"
  Invoke-ContainedProcess $pgCtl @(
    "-D", $dataDirectory, "-l", (Join-Path $tempRoot "postgres.log"),
    "-o", $postgresOptions, "-w", "start"
  ) (New-CleanEnvironment @{
    PGHOST = "127.0.0.1"; PGPORT = [string]$databasePort; PGUSER = $databaseUser
  }) 120000
  $ownedClusterIdentity = Assert-OwnedClusterIdentity
  Write-Host "[ISOLATED_PREVIEW_CLUSTER_OWNED] PID=$($ownedClusterIdentity.ProcessId) DataDir=$($ownedClusterIdentity.DataDirectory) Port=$($ownedClusterIdentity.Port) Nonce=$($ownedClusterIdentity.Nonce)"

  Invoke-CleanProcess $createdb @(
    "-h", "127.0.0.1", "-p", [string]$databasePort, "-U", $databaseUser, $databaseName
  ) (New-CleanEnvironment @{
    PGHOST = "127.0.0.1"; PGPORT = [string]$databasePort; PGUSER = $databaseUser
  }) 60000

  $databaseUrl = "postgresql://${databaseUser}@127.0.0.1:${databasePort}/${databaseName}"
  $sessionSecret = "local-isolated-preview-$nonce"
  $runtimeEnvironment = New-CleanEnvironment @{
    NODE_ENV = "development"
    ISOLATED_PREVIEW_MODE = "1"
    ISOLATED_PREVIEW_DATABASE_URL = $databaseUrl
    ISOLATED_PREVIEW_DATA_DIR = $tempRoot
    ISOLATED_PREVIEW_API_URL = "http://127.0.0.1:$HttpPort/"
    PORT = [string]$HttpPort
    HOST = "127.0.0.1"
    SESSION_SECRET = $sessionSecret
    DOTENV_CONFIG_PATH = "NUL"
  }
  Invoke-CleanProcess $node @($tsx, $prepareScript) $runtimeEnvironment 600000

  Write-Host "[ISOLATED_PREVIEW] Banco temporário validado e schema preparado."
  Write-Host "[ISOLATED_PREVIEW] API local: http://127.0.0.1:$HttpPort/"
  Write-Host "[ISOLATED_PREVIEW] Em outro PowerShell, definir ISOLATED_PREVIEW_API_URL para essa URL e executar npm run test:integration:isolated."
  Write-Host "[ISOLATED_PREVIEW] Ctrl+C encerra a API e remove somente o cluster nonce desta execução."

  $serverInfo = New-CleanProcessInfo $node @($tsx, $serverEntry) $runtimeEnvironment
  $serverProcess = [Diagnostics.Process]::new()
  $serverProcess.StartInfo = $serverInfo
  if (-not $serverProcess.Start()) { throw "O servidor isolado não iniciou." }
  try { $processJob.Assign($serverProcess.Handle) } catch { try { $serverProcess.Kill($true) } catch {}; throw }
  $childProcesses.Add($serverProcess)
  while (-not $serverProcess.WaitForExit(250)) { }
  [void]$childProcesses.Remove($serverProcess)
  if ($serverProcess.ExitCode -ne 0) {
    throw "O servidor isolado encerrou com código $($serverProcess.ExitCode)."
  }
}
finally {
  if ($serverProcess) {
    try {
      if (-not $serverProcess.HasExited) {
        try { $serverProcess.Kill($true) }
        catch { Write-Warning "Falha ao solicitar encerramento do servidor PID=$($serverProcess.Id): $($_.Exception.Message)" }
        if (-not $serverProcess.WaitForExit(10000)) {
          $preserveTempRoot = $true
          Write-Warning "O servidor isolado PID=$($serverProcess.Id) não encerrou no prazo; a raiz temporária será preservada."
        }
      }
    } catch {
      $preserveTempRoot = $true
      Write-Warning "Não foi possível confirmar a saída do servidor isolado PID=$($serverProcess.Id): $($_.Exception.Message)"
    }
  }
  Stop-TrackedChildren

  try {
    if ($tempRoot -and (Test-Path -LiteralPath $tempRoot -PathType Container)) {
      $teardown = Invoke-IsolatedClusterTeardown `
        -GetIdentity {
          if ($ownedClusterIdentity) { [void](Assert-OwnedClusterIdentity $ownedClusterIdentity); return $ownedClusterIdentity }
          $captured = Assert-OwnedClusterIdentity
          $script:ownedClusterIdentity = $captured
          return $captured
        } `
        -RevalidateIdentity { param($identity) [void](Assert-OwnedClusterIdentity $identity) } `
        -GracefulStop {
          param($identity)
          [void](Assert-OwnedClusterIdentity $identity)
          Invoke-CleanProcess $pgCtl @("-D", $dataDirectory, "-m", "fast", "-w", "stop") (New-CleanEnvironment @{}) 120000
        } `
        -ConfirmStopped { param($identity) Test-OwnedClusterStopped $identity } `
        -TerminateOwnedJob { $processJob.Terminate(1) } `
        -ValidateRemovalIdentity {
        if ($script:preserveTempRoot) {
          throw "A raiz foi marcada para preservação porque a saída de um processo não pôde ser comprovada."
        }
          Assert-OwnedTempRoot
          Assert-PrivateTempAcl
          Assert-NoReparsePointsInTree $tempRoot
        } `
        -RemoveRoot {
        if ($script:preserveTempRoot) {
          throw "A exclusão está bloqueada pela flag de preservação do temporário."
        }
          Release-PathPins
          Assert-OwnedTempRoot
          Assert-PrivateTempAcl
          Assert-NoReparsePointsInTree $tempRoot
        if ($script:preserveTempRoot) {
          throw "A exclusão foi bloqueada porque a raiz passou a exigir preservação."
        }
          Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction Stop
        } `
        -Log { param($message) Write-Warning $message }
      if (-not $teardown.ClusterStopped -or -not $teardown.RootRemoved) { $preserveTempRoot = $true }
      if ($teardown.ClusterStopped) { Write-Host "[ISOLATED_PREVIEW_CLUSTER_STOPPED] Encerramento e ausência de listener confirmados." }
      if ($teardown.RootRemoved) { Write-Host "[ISOLATED_PREVIEW_CLEANUP] Diretório temporário privado desta execução removido." }
      elseif (Test-Path -LiteralPath $tempRoot) { Write-Warning "Diretório preservado para recuperação segura: $tempRoot" }
    }
  } catch {
    $preserveTempRoot = $true
    Write-Warning "O teardown não concluiu todas as verificações. Dados preservados quando ainda presentes: $($_.Exception.Message)"
  }

  if ($serverProcess) {
    try {
      if ($serverProcess.HasExited) {
        [void]$childProcesses.Remove($serverProcess)
        $serverProcess.Dispose()
      } else {
        $preserveTempRoot = $true
        Write-Warning "A referência ao servidor isolado PID=$($serverProcess.Id) foi mantida; a saída não foi confirmada."
      }
    } catch {
      $preserveTempRoot = $true
      Write-Warning "A referência ao servidor isolado não pôde ser descartada com segurança: $($_.Exception.Message)"
    }
  }
  if ($processJob) {
    # Closing this execution-owned job kills only its contained children.
    try { $processJob.Dispose() }
    catch { $preserveTempRoot = $true; Write-Warning "O Job Object não fechou normalmente; nenhum dado será removido por consequência." }
  }
}
