# ocr-worker.ps1 - persistent Windows OCR process (started once by the app).
#
# Reads one command per line from stdin and prints results to stdout:
#   C <X> <Y> <W> <H>   capture one frame of the given physical-pixel region
#   Q                   quit
#
# Response for every C command (each response ends with a flush):
#   @@OCR_BEGIN
#   <recognized text line>
#   ...
#   @@OCR_END
#
# On a capture error the block is:
#   @@OCR_BEGIN
#   @@OCR_ERROR <single-line message>
#   @@OCR_END

$ErrorActionPreference = 'Stop'

# Node writes/reads UTF-8; without this Windows PowerShell 5.1 would use the OEM
# code page on the pipes and corrupt non-ASCII OCR text.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# Make sure screen coordinates are physical pixels when the OS uses display scaling.
Add-Type -Namespace Win32 -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
[Win32.Native]::SetProcessDPIAware() | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Windows OCR runtime types
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

$global:OcrEngine = $null
try {
    $global:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
} catch {
    $global:OcrEngine = $null
}
if (-not $global:OcrEngine) {
    $global:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}

function Invoke-OcrCapture([int]$X, [int]$Y, [int]$Width, [int]$Height) {
    if ($Width -le 0 -or $Height -le 0) {
        throw 'Width and Height must be positive.'
    }
    if (-not $global:OcrEngine) {
        throw 'No OCR engine is available for the requested language.'
    }

    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($X, $Y, 0, 0, $bitmap.Size)
        } finally {
            $graphics.Dispose()
        }

        # Windows OCR reads images from StorageFile, so save to a temp PNG first.
        $tempPng = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "game-ocr-$PID.png")
        try {
            $bitmap.Save($tempPng, [System.Drawing.Imaging.ImageFormat]::Png)

            $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tempPng)) ([Windows.Storage.StorageFile])
            $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
            $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $softwareBitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

            $result = Await ($global:OcrEngine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
            foreach ($line in $result.Lines) {
                $text = $line.Text
                if ($text) {
                    Write-Output $text
                }
            }
        } finally {
            Remove-Item -LiteralPath $tempPng -ErrorAction SilentlyContinue
        }
    } finally {
        $bitmap.Dispose()
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $parts = ($line -split ' +' | Where-Object { $_ -ne '' })
    if ($parts.Count -eq 0) { continue }
    if ($parts[0] -eq 'Q') { break }
    if ($parts[0] -ne 'C' -or $parts.Count -lt 5) { continue }

    Write-Output '@@OCR_BEGIN'
    try {
        Invoke-OcrCapture -X ([int]$parts[1]) -Y ([int]$parts[2]) -Width ([int]$parts[3]) -Height ([int]$parts[4])
    } catch {
        $msg = ($_.Exception.Message -replace '\r?\n', ' ').Trim()
        Write-Output "@@OCR_ERROR $msg"
    }
    Write-Output '@@OCR_END'
    # The app consumes responses incrementally; make sure the block reaches it
    # immediately instead of sitting in the stdout buffer.
    [Console]::Out.Flush()
}
