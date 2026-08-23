<#
Environment preflight for local Windows development.

Usage:
  .\scripts\validate-env.ps1
#>

$requiredVariables = @(
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_MODE',
  'MOCK_MODE'
)

$fileVariables = @{}
$envFilePath = Join-Path (Get-Location) '.env'

if (Test-Path -LiteralPath $envFilePath) {
  Get-Content -LiteralPath $envFilePath | ForEach-Object {
    $entry = $_.Trim()
    if ($entry -and -not $entry.StartsWith('#') -and $entry.Contains('=')) {
      $key, $value = $entry.Split('=', 2)
      $fileVariables[$key.Trim()] = $value.Trim().Trim('"').Trim("'")
    }
  }
}

$missingVariables = @(
  $requiredVariables | Where-Object {
    $value = [Environment]::GetEnvironmentVariable($_)
    if ([string]::IsNullOrWhiteSpace($value)) { $value = $fileVariables[$_] }
    [string]::IsNullOrWhiteSpace($value)
  }
)

if ($missingVariables.Count -gt 0) {
  Write-Error "Environment validation failed. Set: $($missingVariables -join ', ')"
  exit 1
}

Write-Output 'Environment validation passed.'
