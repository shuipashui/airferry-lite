param(
    [string]$Repo = "shuipashui/airferry-lite",
    [string]$Branch = "apk/0.8.25-dual-relock",
    [string]$ParentSha = "ba4f2eb07d1a921088f55a3a5ddaa5ff841fda1c",
    [string[]]$CommitShas = @("709e8bb", "9376884")
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-JsonFile($path, $obj) {
    $json = $obj | ConvertTo-Json -Depth 10 -Compress
    [System.IO.File]::WriteAllText($path, $json, $Utf8NoBom)
}

function Read-BlobBytes($blobId) {
    $tmp = Join-Path $env:TEMP "ghblob_$([guid]::NewGuid().ToString('N'))"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "cat-file blob $blobId"
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $ms = New-Object System.IO.MemoryStream
    $p.StandardOutput.BaseStream.CopyTo($ms)
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "git cat-file failed" }
    return $ms.ToArray()
}

function Get-TreeSha($commitSha) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $tree = git rev-parse "${commitSha}^{tree}" 2>$null
    $ok = $?
    $ErrorActionPreference = $prev
    if ($ok -and $tree) { return $tree.Trim() }
    return (gh api "repos/$Repo/git/commits/$commitSha" --jq .tree.sha).Trim()
}

function Push-Commit($commitSha, $parentSha) {
    $parentTree = Get-TreeSha $parentSha
    $names = @(git diff-tree --no-commit-id --name-only -r $commitSha)
    $tree = @()
    foreach ($path in $names) {
        $blobId = (git rev-parse "${commitSha}:$path").Trim()
        $bytes = Read-BlobBytes $blobId
        $b64 = [Convert]::ToBase64String($bytes)
        $blobFile = Join-Path $env:TEMP "blob.json"
        Write-JsonFile $blobFile @{ content = $b64; encoding = "base64" }
        $newBlob = gh api "repos/$Repo/git/blobs" --input $blobFile --jq .sha
        Remove-Item $blobFile -Force
        $tree += @{ path = $path; mode = "100644"; type = "blob"; sha = $newBlob }
    }
    $treeFile = Join-Path $env:TEMP "tree.json"
    Write-JsonFile $treeFile @{ base_tree = $parentTree; tree = $tree }
    $newTree = gh api "repos/$Repo/git/trees" --input $treeFile --jq .sha
    Remove-Item $treeFile -Force
    $msg = (git log -1 --format=%B $commitSha | Out-String).Trim()
    $commitFile = Join-Path $env:TEMP "commit.json"
    Write-JsonFile $commitFile @{ message = $msg; parents = @($parentSha); tree = $newTree }
    $newSha = gh api "repos/$Repo/git/commits" --input $commitFile --jq .sha
    Remove-Item $commitFile -Force
    return $newSha
}

$head = $ParentSha
foreach ($c in $CommitShas) {
    $full = (git rev-parse $c).Trim()
    Write-Host "Pushing $full..."
    $head = Push-Commit $full $head
    Write-Host "OK -> $head"
}

$refFile = Join-Path $env:TEMP "ref.json"
Write-JsonFile $refFile @{ sha = $head; force = $false }
gh api "repos/$Repo/git/refs/heads/$Branch" -X PATCH --input $refFile
Remove-Item $refFile -Force
Write-Host "Branch $Branch -> $head"
