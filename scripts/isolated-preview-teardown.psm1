Set-StrictMode -Version Latest

function Assert-IsolatedProcessIdentity {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][object]$Actual,
    [Parameter(Mandatory)][object]$Expected
  )

  $fields = @("ProcessId", "ExecutablePath", "CommandLine", "DataDirectory", "Port", "Address", "CreationDate", "Nonce")
  foreach ($field in $fields) {
    $actualValue = [string]$Actual.$field
    $expectedValue = [string]$Expected.$field
    if (-not [string]::Equals($actualValue, $expectedValue, [StringComparison]::OrdinalIgnoreCase)) {
      throw "A identidade do PostgreSQL diverge no campo $field; processo não será encerrado."
    }
  }
}

function Invoke-IsolatedClusterTeardown {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][scriptblock]$GetIdentity,
    [Parameter(Mandatory)][scriptblock]$RevalidateIdentity,
    [Parameter(Mandatory)][scriptblock]$GracefulStop,
    [Parameter(Mandatory)][scriptblock]$ConfirmStopped,
    [Parameter(Mandatory)][scriptblock]$TerminateOwnedJob,
    [Parameter(Mandatory)][scriptblock]$ValidateRemovalIdentity,
    [Parameter(Mandatory)][scriptblock]$RemoveRoot,
    [Parameter(Mandatory)][scriptblock]$Log
  )

  $identity = $null
  $identityConfirmed = $false
  $stopped = $false
  $removed = $false
  $messages = [Collections.Generic.List[string]]::new()

  try {
    $identity = & $GetIdentity
    if ($null -eq $identity) { throw "A identidade do PostgreSQL não foi comprovada." }
    $identityConfirmed = $true
  } catch {
    $messages.Add("Identidade não comprovada; pg_ctl não será chamado. $($_.Exception.Message)")
  }

  if ($identityConfirmed) {
    try {
      [void](& $RevalidateIdentity $identity)
      [void](& $GracefulStop $identity)
    } catch {
      $messages.Add("Parada graciosa falhou; será avaliado o Job Object desta execução. $($_.Exception.Message)")
    }
  }

  try { $stopped = [bool](& $ConfirmStopped $identity) }
  catch { $messages.Add("A confirmação de parada falhou: $($_.Exception.Message)") }

  if (-not $stopped) {
    try {
      # This callback must close/terminate only the Job Object created by this runner.
      # It is an ownership proof independent of a PID and cannot target a foreign PostgreSQL.
      [void](& $TerminateOwnedJob)
    } catch {
      $messages.Add("Encerramento do Job Object desta execução falhou: $($_.Exception.Message)")
    }
    try { $stopped = [bool](& $ConfirmStopped $identity) }
    catch { $messages.Add("A confirmação após o Job Object falhou: $($_.Exception.Message)") }
  }

  if ($stopped) {
    try {
      [void](& $ValidateRemovalIdentity)
      [void](& $RemoveRoot)
      $removed = $true
    } catch {
      $messages.Add("Cluster parado, mas a identidade/ACL da raiz não autorizou sua remoção: $($_.Exception.Message)")
    }
  } else {
    $messages.Add("Parada não comprovada; diretório preservado integralmente.")
  }

  foreach ($message in $messages) { & $Log $message }
  [pscustomobject]@{
    IdentityConfirmed = $identityConfirmed
    ClusterStopped = $stopped
    RootRemoved = $removed
    Messages = @($messages.ToArray())
  }
}

Export-ModuleMember -Function Invoke-IsolatedClusterTeardown, Assert-IsolatedProcessIdentity
