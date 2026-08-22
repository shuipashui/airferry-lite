param(
    [Parameter(Mandatory = $true)][string]$CommitSha,
    [Parameter(Mandatory = $true)][string]$ParentSha,
    [string]$Repo = "shuipashui/airferry-lite"
)

$ErrorActionPreference = "Stop"
$parentTree = (git rev-parse "${ParentSha}^{tree}").Trim()
$changes = @(git diff-tree --no-commit-id --name-status -z -r $CommitSha | ForEach-Object { $_ })

$treeItems = @()
$i = 0
while ($i -lt $changes.Count) {
    $status = $changes[$i]
    if ($status.StartsWith("R")) {
        $oldPath = $changes[$i + 1]
        $newPath = $changes[$i + 2]
        $i += 3
        $treeItems += @{ path = $oldPath; sha = $null; delete = $true }
        $path = $newPath
        $mode = "100644"
    } elseif ($status.StartsWith("D")) {
        $path = $changes[$i + 1]
        $i += 2
        $treeItems += @{ path = $path; sha = $null; delete = $true }
        continue
    } else {
        $path = $changes[$i + 1]
        $i += 2
        $mode = "100644"
    }
    $tmp = [System.IO.Path]::GetTempFileName()
    git show "${CommitSha}:$path" > $tmp 2>$null
    if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes((git show "${CommitSha}:$path"))
        [System.IO.File]::WriteAllBytes($tmp, $bytes)
    }
    $content = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($tmp))
    Remove-Item $tmp -Force
    $blob = gh api "repos/$Repo/git/blobs" -f content=$content -f encoding=base64 --jq .sha
    $treeItems += @{ path = $path; mode = $mode; type = "blob"; sha = $blob }
}

$treeJson = @{ base_tree = $parentTree; tree = @() }
foreach ($item in $treeItems) {
    if ($item.delete) {
        $treeJson.tree += @{ path = $item.path; mode = "100644"; type = "blob"; sha = $null }
    } else {
        $treeJson.tree += @{ path = $item.path; mode = $item.mode; type = $item.type; sha = $item.sha }
    }
}
$treeJsonStr = $treeJson | ConvertTo-Json -Depth 5 -Compress
$treeSha = gh api "repos/$Repo/git/trees" --input - --jq .sha <<< $treeJsonStr
# PowerShell doesn't support <<< - use temp file
$treeFile = [System.IO.Path]::GetTempFileName()
Set-Content -Path $treeFile -Value $treeJsonStr -Encoding UTF8
$treeSha = gh api "repos/$Repo/git/trees" --input $treeFile --jq .sha
Remove-Item $treeFile -Force

$msg = (git log -1 --format=%B $CommitSha).Trim()
$commitFile = [System.IO.Path]::GetTempFileName()
@{ message = $msg; parents = @($ParentSha); tree = $treeSha } | ConvertTo-Json -Depth 3 | Set-Content $commitFile -Encoding UTF8
$newSha = gh api "repos/$Repo/git/commits" --input $commitFile --jq .sha
Remove-Item $commitFile -Force
Write-Output $newSha
