# ============================================================
# rename-tool.ps1 — personnalise le gabarit pour un nouvel outil.
# Usage (PowerShell, à la racine du repo fraîchement créé depuis le template) :
#   .\scripts\rename-tool.ps1 -Name "veille-ia" -DisplayName "Veille IA"
#
#   -Name        : identifiant kebab-case (repo, image Docker, domaines, service)
#   -DisplayName : nom affiché (interface, emails, titres)
#
# Remplace dans tous les fichiers texte :
#   small-app  -> <name>            small_app -> <name_snake>
#   SMALL_APP  -> <NAME_SNAKE>      SMALL App -> <DisplayName>
# Puis renomme les fichiers deploy/small-app.* et scripts en conséquence.
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DisplayName
)

if ($Name -cnotmatch '^[a-z][a-z0-9-]+$') {
    Write-Host "Le nom doit etre en kebab-case (minuscules, chiffres, tirets), ex. veille-ia" -ForegroundColor Red
    exit 1
}
$snake = $Name -replace '-', '_'
$envp  = $snake.ToUpper()

$exts = @("*.ts", "*.tsx", "*.js", "*.mjs", "*.json", "*.md", "*.yml", "*.yaml",
          "*.sql", "*.sh", "*.ps1", "*.prisma", "*.css", "*.example", ".env.example", ".gitignore")
$files = Get-ChildItem -Recurse -File -Include $exts |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\\.next\\' }

$count = 0
foreach ($f in $files) {
    $content = Get-Content $f.FullName -Raw
    $new = $content -creplace 'SMALL_APP', $envp `
                    -creplace 'small_app', $snake `
                    -creplace 'small-app', $Name `
                    -creplace 'SMALL App', $DisplayName
    if ($new -cne $content) {
        Set-Content -Path $f.FullName -Value $new -NoNewline
        $count++
    }
}

# Renommage des fichiers porteurs du nom
$renames = @(
    @{ From = "deploy\small-app.env.example";              To = "deploy\$Name.env.example" },
    @{ From = "deploy\small-app.preprod.env.example";      To = "deploy\$Name.preprod.env.example" },
    @{ From = "deploy\scripts\remote-deploy-small-app.sh"; To = "deploy\scripts\remote-deploy-$Name.sh" },
    @{ From = "deploy\scripts\remote-deploy-preprod-small-app.sh"; To = "deploy\scripts\remote-deploy-preprod-$Name.sh" },
    @{ From = "deploy\scripts\seed-personas-preprod.sql";  To = "deploy\scripts\seed-personas-$Name.sql" }
)
foreach ($r in $renames) {
    if (Test-Path $r.From) { Move-Item $r.From $r.To -Force }
}

Write-Host ""
Write-Host "Gabarit personnalise : $count fichier(s) modifie(s)." -ForegroundColor Green
Write-Host "  identifiant : $Name   (image ghcr.io/small-conseil/$Name)" -ForegroundColor Cyan
Write-Host "  affichage   : $DisplayName" -ForegroundColor Cyan
Write-Host ""
Write-Host "Etapes suivantes : commit + push, puis deploy/SETUP.md pour la mise en ligne." -ForegroundColor Yellow
Write-Host "Ce script peut etre supprime apres usage (scripts/rename-tool.ps1)." -ForegroundColor Yellow
