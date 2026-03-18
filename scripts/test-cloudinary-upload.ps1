param(
  [string]$ApiUrl = "http://localhost:4000",
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ImagePath)) {
  throw "No se encontro la imagen: $ImagePath"
}

$timestamp = [int64](Get-Date -UFormat %s)
$tenantSlug = "tenant-$timestamp"
$email = "admin$timestamp@tenant.com"
$password = "Admin1234"

Write-Host "1) Creando tenant..."
$tenantBody = @{
  name = "Tenant $timestamp"
  slug = $tenantSlug
} | ConvertTo-Json

$tenant = Invoke-RestMethod -Uri "$ApiUrl/tenants" -Method Post -ContentType "application/json" -Body $tenantBody

Write-Host "2) Registrando usuario admin..."
$registerBody = @{
  email = $email
  fullName = "Admin Tenant"
  password = $password
  tenantId = $tenant.id
  role = "tenant_admin"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$ApiUrl/auth/register" -Method Post -ContentType "application/json" -Body $registerBody | Out-Null

Write-Host "3) Login..."
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{
  email = $email
  password = $password
} | ConvertTo-Json

$login = Invoke-RestMethod -Uri "$ApiUrl/auth/login" -Method Post -ContentType "application/json" -Body $loginBody -WebSession $session
$accessToken = $login.accessToken

if (-not $accessToken) {
  throw "No se obtuvo access token en login"
}

Write-Host "4) Subiendo imagen a Cloudinary via API..."
$headers = @{
  Authorization = "Bearer $accessToken"
}
$form = @{
  tenantId = $tenant.id
  file = Get-Item $ImagePath
}

$upload = Invoke-RestMethod -Uri "$ApiUrl/catalog/uploads/image" -Method Post -Headers $headers -Form $form

Write-Host ""
Write-Host "Upload completado:"
Write-Host ("provider: " + $upload.provider)
Write-Host ("key: " + $upload.key)
Write-Host ("url: " + $upload.url)
