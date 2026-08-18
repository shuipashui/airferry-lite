param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $GradleArgs = @("assembleDebug")
)

$root = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $root ".tools\android-sdk"
$gradle = Join-Path $root ".tools\gradle\gradle-8.9\bin\gradle.bat"
if (!(Test-Path -LiteralPath $sdk)) { throw "Android SDK not found: $sdk" }
if (!(Test-Path -LiteralPath $gradle)) { throw "Gradle 8.9 not found: $gradle" }

$env:GRADLE_USER_HOME = Join-Path $root ".tools\gradle-home"
$env:ANDROID_USER_HOME = Join-Path $root ".tools\android-home"
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:ANDROID_USER_HOME | Out-Null
$javaHomeOption = "-Duser.home=$env:ANDROID_USER_HOME"
$env:JAVA_TOOL_OPTIONS = if ($env:JAVA_TOOL_OPTIONS) { "$javaHomeOption $env:JAVA_TOOL_OPTIONS" } else { $javaHomeOption }

& $gradle --no-daemon @GradleArgs
exit $LASTEXITCODE
