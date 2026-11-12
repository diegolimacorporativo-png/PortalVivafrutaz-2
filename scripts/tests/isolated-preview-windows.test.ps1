# This test loads only the helper declarations and injected fakes. It never
# launches PostgreSQL, the Portal API, or any child process through Win32.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$helper = Join-Path $PSScriptRoot "..\IsolatedPreviewWindows.cs"
$teardown = Join-Path $PSScriptRoot "..\isolated-preview-teardown.psm1"
Add-Type -Path @($helper, (Join-Path $PSScriptRoot "IsolatedPreviewTestFakes.cs"))
Import-Module -Name $teardown -Force



function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

$passed = 0
$failed = 0
function Invoke-Check([string]$Name, [scriptblock]$Action) {
  try { & $Action; $script:passed++; Write-Host "PASS $Name" }
  catch { $script:failed++; Write-Error "FAIL $Name — $($_.Exception.Message)" }
}

Invoke-Check "sintaxe do runner PowerShell" {
  $runnerPath = Join-Path $PSScriptRoot "..\start-isolated-preview.ps1"
  $tokens = $null
  $parseErrors = $null
  $script:runnerAst = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
}

$listenerFunction = $script:runnerAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-Listeners"
}, $true)
if (-not $listenerFunction) { throw "Get-Listeners não foi encontrado no runner" }
Invoke-Expression $listenerFunction.Extent.Text

Invoke-Check "Get-Listeners trata somente CIM sem correspondência como porta livre" {
  $script:listenerQuery = $null
  function Get-NetTCPConnection {
    param([string]$State, [int]$LocalPort, [string]$ErrorAction)
    $script:listenerQuery = [pscustomobject]@{ State=$State; LocalPort=$LocalPort }
    $record = [System.Management.Automation.ErrorRecord]::new(
      [InvalidOperationException]::new("No matching listener"),
      "CmdletizationQuery_NotFound,Get-NetTCPConnection",
      [System.Management.Automation.ErrorCategory]::ObjectNotFound,
      $null
    )
    throw $record
  }
  $listeners = @(Get-Listeners 55439)
  Assert-True ($listeners.Count -eq 0) "uma consulta sem listeners deve retornar coleção vazia"
  Assert-True ($script:listenerQuery.State -eq "Listen" -and $script:listenerQuery.LocalPort -eq 55439) "a consulta precisa restringir estado e porta"
}

Invoke-Check "Get-Listeners não mascara falhas reais de CIM" {
  function Get-NetTCPConnection {
    param([string]$State, [int]$LocalPort, [string]$ErrorAction)
    throw [InvalidOperationException]::new("CIM access denied")
  }
  try { [void](Get-Listeners 55439); throw "falha real do CIM deveria ser propagada" }
  catch { if ($_.Exception.Message -eq "falha real do CIM deveria ser propagada") { throw } }
}

$cleanProcessFunction = $script:runnerAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Invoke-CleanProcess"
}, $true)
if (-not $cleanProcessFunction) { throw "Invoke-CleanProcess não foi encontrado no runner" }
Invoke-Expression $cleanProcessFunction.Extent.Text

function New-CleanProcessInfo([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment) {
  return [pscustomobject]@{ FilePath=$FilePath; Arguments=$Arguments; Environment=$Environment }
}

function New-FakeCleanProcess([hashtable]$Options = @{}) {
  $events = [Collections.Generic.List[string]]::new()
  $fake = [pscustomobject]@{
    StartInfo=$null; Handle=[IntPtr]71; Id=7123; HasExited=[bool]($Options.ContainsKey("AlreadyExited") -and $Options.AlreadyExited)
    ExitCode=0; Events=$events; AssignThrows=$false; KillThrows=[bool]($Options.ContainsKey("KillThrows") -and $Options.KillThrows)
    WaitThrows=[bool]($Options.ContainsKey("WaitThrows") -and $Options.WaitThrows); ExitOnKill=[bool]($Options.ContainsKey("ExitOnKill") -and $Options.ExitOnKill)
    ExitOnWait=[bool]($Options.ContainsKey("ExitOnWait") -and $Options.ExitOnWait); TrackedAtWait=$false; Disposed=$false
  }
  $fake | Add-Member ScriptMethod Start {
    $this.Events.Add("start")
    return $true
  }
  $fake | Add-Member ScriptMethod Kill {
    param([bool]$Tree)
    $this.Events.Add("kill")
    if ($this.KillThrows) { throw "kill failure" }
    if ($this.ExitOnKill) { $this.HasExited = $true }
  }
  $fake | Add-Member ScriptMethod WaitForExit {
    param([int]$Milliseconds)
    $this.Events.Add("wait:$Milliseconds")
    $this.TrackedAtWait = $script:childProcesses.Contains($this)
    if ($this.WaitThrows) { throw "wait failure" }
    if ($this.ExitOnWait) { $this.HasExited = $true }
    return [bool]$this.HasExited
  }
  $fake | Add-Member ScriptMethod Dispose {
    $this.Events.Add("dispose")
    $this.Disposed = $true
  }
  return $fake
}

function Invoke-CleanProcessFakeCase([hashtable]$Options) {
  $script:childProcesses = [Collections.Generic.List[object]]::new()
  $script:preserveTempRoot = $false
  $script:activeFakeProcess = New-FakeCleanProcess $Options
  $script:processJob = [pscustomobject]@{ Events=$script:activeFakeProcess.Events; AssignThrows=[bool]($Options.ContainsKey("AssignThrows") -and $Options.AssignThrows) }
  $script:processJob | Add-Member ScriptMethod Assign {
    param($Handle)
    $this.Events.Add("assign")
    if ($this.AssignThrows) { throw "job assignment failure" }
  }
  $caught = $false
  try {
    Invoke-CleanProcess "C:\mock\initdb.exe" @() @{} 100 -ProcessFactory { $script:activeFakeProcess }
  } catch { $caught = $true }
  return [pscustomobject]@{
    Caught=$caught; Process=$script:activeFakeProcess; Preserve=$script:preserveTempRoot
    Tracked=$script:childProcesses.Contains($script:activeFakeProcess)
  }
}

Invoke-Check "Invoke-CleanProcess: associação bem-sucedida" {
  $result = Invoke-CleanProcessFakeCase @{ExitOnWait=$true}
  Assert-True (-not $result.Caught) "processo com associação válida deveria completar"
  Assert-True (-not $result.Preserve) "sucesso não deve preservar a raiz"
  Assert-True (-not $result.Tracked -and $result.Process.Disposed) "processo concluído deve ser removido e descartado"
  Assert-True (($result.Process.Events -join ',') -eq "start,assign,wait:250,dispose") "ordem de chamadas inesperada"
}

Invoke-Check "Invoke-CleanProcess: falha de associação e saída confirmada" {
  $result = Invoke-CleanProcessFakeCase @{AssignThrows=$true;ExitOnKill=$true}
  Assert-True $result.Caught "falha de associação deve ser propagada"
  Assert-True (-not $result.Preserve) "saída confirmada não deve marcar preservação"
  Assert-True (-not $result.Tracked -and $result.Process.Disposed) "referência só pode ser descartada após confirmação"
  Assert-True ($result.Process.TrackedAtWait) "referência deve permanecer rastreada durante a espera"
  Assert-True (($result.Process.Events -join ',') -eq "start,assign,kill,wait:10000,dispose") "encerramento confirmado não seguiu a ordem esperada"
}

Invoke-Check "Invoke-CleanProcess: timeout preserva raiz e referência" {
  $result = Invoke-CleanProcessFakeCase @{AssignThrows=$true}
  Assert-True $result.Caught "falha de associação deve ser propagada"
  Assert-True $result.Preserve "timeout precisa ativar preserveTempRoot"
  Assert-True ($result.Tracked -and -not $result.Process.Disposed) "processo ativo deve continuar referenciado"
  Assert-True ($result.Process.TrackedAtWait) "referência precisa sobreviver até a verificação de saída"
}

Invoke-Check "Invoke-CleanProcess: exceção durante espera preserva raiz e referência" {
  $result = Invoke-CleanProcessFakeCase @{AssignThrows=$true;WaitThrows=$true}
  Assert-True $result.Caught "falha de associação deve ser propagada"
  Assert-True $result.Preserve "erro na verificação precisa ativar preserveTempRoot"
  Assert-True ($result.Tracked -and -not $result.Process.Disposed) "referência deve ser mantida após erro de espera"
}

Invoke-Check "Invoke-CleanProcess: falha de Kill é verificada por WaitForExit" {
  $result = Invoke-CleanProcessFakeCase @{AssignThrows=$true;KillThrows=$true;ExitOnWait=$true}
  Assert-True $result.Caught "falha de associação deve ser propagada"
  Assert-True (-not $result.Preserve) "WaitForExit positivo comprova saída apesar da falha de Kill"
  Assert-True ($result.Process.Events -contains "wait:10000") "a saída não foi verificada depois da falha de Kill"
  Assert-True $result.Process.Disposed "só deve descartar depois de confirmar a saída"
}

Invoke-Check "Invoke-CleanProcess: processo já encerrado antes da verificação" {
  $result = Invoke-CleanProcessFakeCase @{AssignThrows=$true;AlreadyExited=$true}
  Assert-True $result.Caught "falha de associação deve ser propagada"
  Assert-True (-not $result.Preserve -and $result.Process.Disposed) "saída já confirmada deve permitir descarte"
  Assert-True ($result.Process.Events -notcontains "kill") "processo encerrado não deve receber Kill"
}

Invoke-Check "flag de preservação impede o callback de remoção do teardown" {
  $teardownCall = $script:runnerAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Invoke-IsolatedClusterTeardown"
  }, $true) | Select-Object -First 1
  if (-not $teardownCall) { throw "chamada de teardown não encontrada" }
  $elements = @($teardownCall.CommandElements)
  $validateIndex = -1
  for ($index = 0; $index -lt $elements.Count; $index++) {
    if ($elements[$index] -is [System.Management.Automation.Language.CommandParameterAst] -and $elements[$index].ParameterName -eq "ValidateRemovalIdentity") {
      $validateIndex = $index + 1
      break
    }
  }
  if ($validateIndex -lt 0 -or $elements[$validateIndex] -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
    throw "callback de validação da remoção não encontrado"
  }
  $validateRemoval = [scriptblock]::Create($elements[$validateIndex].ScriptBlock.Extent.Text)
  $script:preserveTempRoot = $true
  $script:rootRemovalCalls = 0
  $result = Invoke-IsolatedClusterTeardown `
    -GetIdentity { [pscustomobject]@{ ProcessId=7 } } `
    -RevalidateIdentity {} `
    -GracefulStop {} `
    -ConfirmStopped { $true } `
    -TerminateOwnedJob {} `
    -ValidateRemovalIdentity { & $script:validateRemoval } `
    -RemoveRoot { $script:rootRemovalCalls++ } `
    -Log {}
  Assert-True $result.ClusterStopped "caso simulado deveria confirmar parada"
  Assert-True (-not $result.RootRemoved -and $script:rootRemovalCalls -eq 0) "teardown tentou remover raiz com preserveTempRoot ativo"
}

Invoke-Check "Job Object fornecido antes da retomada do processo suspenso" {
  $api = [PortalVivafrutaz.Tests.FakeContainedProcessApi]::new(); $api.ExpectedJob = [IntPtr]42
  $process = [PortalVivafrutaz.ContainedProcessLauncher]::Start(
    $api, $api.ExpectedJob, "C:\test\pg_ctl.exe", '"C:\test\pg_ctl.exe" start', "C:\test", [Collections.Generic.Dictionary[string,string]]::new()
  )
  Assert-True (($api.Calls -join ',') -eq "create-suspended,resume") "a sequência deve criar suspenso no Job Object e só então retomar"
  $process.Dispose()
}

Invoke-Check "Falha de criação/associação atômica não libera processo" {
  $api = [PortalVivafrutaz.Tests.FakeContainedProcessApi]::new(); $api.ExpectedJob = [IntPtr]42; $api.FailCreate = $true
  try {
    [void][PortalVivafrutaz.ContainedProcessLauncher]::Start($api, $api.ExpectedJob, "C:\test\pg_ctl.exe", "pg_ctl", "C:\test", [Collections.Generic.Dictionary[string,string]]::new())
    throw "deveria rejeitar"
  } catch { if ($_.Exception.Message -eq "deveria rejeitar") { throw } }
  Assert-True (($api.Calls -join ',') -eq "create-suspended") "não pode retomar nem terminar PID que não foi criado"
}

Invoke-Check "Falha em ResumeThread termina somente o handle contido" {
  $api = [PortalVivafrutaz.Tests.FakeContainedProcessApi]::new(); $api.ExpectedJob = [IntPtr]42; $api.FailResume = $true
  try {
    [void][PortalVivafrutaz.ContainedProcessLauncher]::Start($api, $api.ExpectedJob, "C:\test\pg_ctl.exe", "pg_ctl", "C:\test", [Collections.Generic.Dictionary[string,string]]::new())
    throw "deveria rejeitar"
  } catch { if ($_.Exception.Message -eq "deveria rejeitar") { throw } }
  Assert-True (($api.Calls -join ',') -eq "create-suspended,resume,terminate-owned-handle,wait,close:102,close:101") "limpeza não corresponde ao processo recém-criado"
}

Invoke-Check "comparação da identidade rejeita PID, executável, comando, data-dir, porta e criação divergentes" {
  $identity = [pscustomobject]@{
    ProcessId=100; ExecutablePath="C:\pg\postgres.exe"; CommandLine='postgres -D "C:\temp\run\postgres"'
    DataDirectory="C:\temp\run\postgres"; Port=55439; Address="127.0.0.1"
    CreationDate="2026-11-11T10:00:00.000Z"; Nonce="0123456789abcdef0123456789abcdef"
  }
  Assert-IsolatedProcessIdentity -Actual $identity -Expected $identity
  foreach ($field in @("ProcessId", "ExecutablePath", "CommandLine", "DataDirectory", "Port", "Address", "CreationDate", "Nonce")) {
    $changed = $identity.PSObject.Copy()
    $changed.$field = "different-$field"
    try { Assert-IsolatedProcessIdentity -Actual $changed -Expected $identity; throw "campo $field deveria divergir" }
    catch { if ($_.Exception.Message -eq "campo $field deveria divergir") { throw } }
  }
}

Invoke-Check "runner não referencia callback removido e confirma PID do postmaster" {
  $runner = Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\start-isolated-preview.ps1") -Raw
  Assert-True ($runner -notmatch '(?m)^\s*Track-OwnedPostgresProcess\s') "runner ainda chama o callback removido"
  Assert-True ($runner.Contains('Join-Path $dataDirectory "postmaster.pid"')) "parada não examina o postmaster.pid"
  Assert-True ($runner.Contains('$pathPins[2].ReadUtf8Text()')) "marcador não é lido pelo handle fixado"
}

function Invoke-TeardownCase([string]$Name, [hashtable]$Options) {
  $state = [pscustomobject]@{
    Identity = [pscustomobject]@{ Pid = 70; Token = "run-owned" }
    IdentityAvailable = $true
    IdentityValid = $true
    Stopped = [bool]($Options.ContainsKey("InitiallyStopped") -and $Options.InitiallyStopped)
    StopFails = [bool]($Options.ContainsKey("StopFails") -and $Options.StopFails)
    JobFails = [bool]($Options.ContainsKey("JobFails") -and $Options.JobFails)
    MarkerValid = $true
    RemoveCalls = 0
    JobCalls = 0
    StopCalls = 0
    ForeignTerminated = $false
  }
  if ($Options.ContainsKey("IdentityUnavailable") -and $Options.IdentityUnavailable) { $state.IdentityAvailable = $false }
  if ($Options.ContainsKey("IdentityInvalid") -and $Options.IdentityInvalid) { $state.IdentityValid = $false }
  if ($Options.ContainsKey("MarkerInvalid") -and $Options.MarkerInvalid) { $state.MarkerValid = $false }
  $result = Invoke-IsolatedClusterTeardown `
    -GetIdentity { if (-not $state.IdentityAvailable -or -not $state.IdentityValid) { throw "identidade não corresponde" }; return $state.Identity } `
    -RevalidateIdentity { param($identity) if (-not $state.IdentityValid -or $identity.Token -ne "run-owned") { throw "PID reutilizado/identidade divergente" } } `
    -GracefulStop { param($identity) $state.StopCalls++; if ($state.StopFails) { throw "pg_ctl stop falhou" }; $state.Stopped = $true } `
    -ConfirmStopped { param($identity) return $state.Stopped } `
    -TerminateOwnedJob { $state.JobCalls++; if ($state.JobFails) { throw "job falhou" }; $state.Stopped = $true } `
    -ValidateRemovalIdentity { if (-not $state.MarkerValid) { throw "marcador adulterado" } } `
    -RemoveRoot { $state.RemoveCalls++ } `
    -Log { param($message) }
  if ($Options.ContainsKey("ExpectIdentity") -and $Options.ExpectIdentity -and -not $result.IdentityConfirmed) { throw "${Name}: identidade deveria ser confirmada" }
  if ($Options.ContainsKey("ExpectNoStop") -and $Options.ExpectNoStop -and $state.StopCalls -ne 0) { throw "${Name}: pg_ctl foi chamado sem identidade" }
  if ($Options.ContainsKey("ExpectJob") -and $Options.ExpectJob -and $state.JobCalls -eq 0) { throw "${Name}: Job Object próprio não foi tentado" }
  if ($Options.ContainsKey("ExpectNoRemove") -and $Options.ExpectNoRemove -and $state.RemoveCalls -ne 0) { throw "${Name}: diretório removido sem confirmação" }
  if ($Options.ContainsKey("ExpectRemoved") -and $Options.ExpectRemoved -and $state.RemoveCalls -ne 1) { throw "${Name}: remoção autorizada não aconteceu" }
  if ($state.ForeignTerminated) { throw "${Name}: processo estrangeiro foi encerrado" }
}

$teardownCases = @(
  @{ Name="parada graciosa; marcador válido"; Options=@{ExpectIdentity=$true;ExpectRemoved=$true} },
  @{ Name="falha de registro/associação seguida de parada segura"; Options=@{StopFails=$true;ExpectIdentity=$true;ExpectJob=$true;ExpectRemoved=$true} },
  @{ Name="marcador ausente/adulterado preserva raiz"; Options=@{MarkerInvalid=$true;ExpectIdentity=$true;ExpectNoRemove=$true} },
  @{ Name="PID reutilizado não recebe pg_ctl e só job próprio é encerrado"; Options=@{IdentityInvalid=$true;ExpectNoStop=$true;ExpectJob=$true;ExpectRemoved=$true} },
  @{ Name="processo já parado permite limpeza se listener está ausente"; Options=@{InitiallyStopped=$true;ExpectIdentity=$true;ExpectRemoved=$true} },
  @{ Name="falha do pg_ctl seguida de Job Object"; Options=@{StopFails=$true;ExpectJob=$true;ExpectRemoved=$true} },
  @{ Name="falha de confirmação e do Job preserva dados"; Options=@{StopFails=$true;JobFails=$true;ExpectJob=$true;ExpectNoRemove=$true} },
  @{ Name="identidade desconhecida não chama pg_ctl"; Options=@{IdentityUnavailable=$true;ExpectNoStop=$true;ExpectJob=$true;ExpectRemoved=$true} }
)
foreach ($case in $teardownCases) {
  Invoke-Check "teardown: $($case.Name)" { Invoke-TeardownCase $case.Name $case.Options }
}

Invoke-Check "ACL privada e handle detectam substituição da raiz antes de liberar uso" {
  if (-not $IsWindows) { throw "este teste exige Windows; execução real permanece pendente" }
  $root = Join-Path ([IO.Path]::GetTempPath()) ("portal-harness-unit." + [guid]::NewGuid().ToString("N"))
  try {
    [PortalVivafrutaz.PrivateDirectory]::CreateForCurrentUser($root)
    $pin = [PortalVivafrutaz.PinnedPath]::OpenDirectory($root)
    try {
      $renamed = "$root-renamed"
      try { [IO.Directory]::Move($root, $renamed) } catch { }
      if ([IO.Directory]::Exists($renamed)) {
        try { $pin.AssertSamePath($root); throw "substituição do caminho não foi detectada" }
        catch { if ($_.Exception.Message -eq "substituição do caminho não foi detectada") { throw } }
      } else {
        $pin.AssertSamePath($root)
      }
    } finally { $pin.Dispose() }
  } finally {
    if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root, $true) }
    if ([IO.Directory]::Exists("$root-renamed")) { [IO.Directory]::Delete("$root-renamed", $true) }
  }
}

Invoke-Check "marcador é lido pelo handle e nega nova abertura para escrita" {
  if (-not $IsWindows) { throw "este teste exige Windows; execução real permanece pendente" }
  $root = Join-Path ([IO.Path]::GetTempPath()) ("portal-marker-unit." + [guid]::NewGuid().ToString("N"))
  [IO.Directory]::CreateDirectory($root) | Out-Null
  $marker = Join-Path $root ".marker"
  [IO.File]::WriteAllText($marker, "nonce-test`n", [Text.UTF8Encoding]::new($false))
  try {
    $pin = [PortalVivafrutaz.PinnedPath]::OpenRegularFile($marker)
    try {
      Assert-True ($pin.ReadUtf8Text() -ceq "nonce-test`n") "conteúdo lido do handle não corresponde"
      $writeBlocked = $false
      try { [IO.File]::WriteAllText($marker, "changed") } catch { $writeBlocked = $true }
      Assert-True $writeBlocked "arquivo marcador aceitou nova abertura para escrita enquanto fixado"
      $pin.AssertSamePath($marker)
    } finally { $pin.Dispose() }
  } finally {
    if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root, $true) }
  }
}

Write-Host "isolated-preview-windows tests: $passed passed; $failed failed"
if ($failed -gt 0) { exit 1 }
