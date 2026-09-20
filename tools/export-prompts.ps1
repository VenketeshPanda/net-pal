param(
	[string]$SessionRoot,
	[string]$OutFile
)

$md = New-Object System.Collections.Generic.List[string]
$md.Add('# Copilot Chat Prompt Archive')
$md.Add('')
$md.Add("Generated on: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')")
$md.Add('')
$md.Add("Source directory: $SessionRoot")
$md.Add('')

Get-ChildItem $SessionRoot -Filter *.jsonl | Sort-Object Name | ForEach-Object {
	$md.Add("## Session $($_.BaseName)")
	$md.Add('')
	$count = 0

	Get-Content $_.FullName | ForEach-Object {
		try {
			$obj = $_ | ConvertFrom-Json
		} catch {
			$obj = $null
		}

		if ($obj -and $obj.type -eq 'user.message') {
			$count++
			$content = [string]$obj.data.content
			if ([string]::IsNullOrWhiteSpace($content)) {
				$content = '(empty prompt)'
			}
			$content = $content -replace "`r`n", "`n"
			$content = $content -replace "`n{3,}", "`n`n"
			$content = $content.Trim()

			$md.Add("### Prompt $count")
			$md.Add("- Timestamp: $($obj.timestamp)")
			$md.Add('')
			$md.Add('```text')
			$content.Split("`n") | ForEach-Object { $md.Add($_) }
			$md.Add('```')
			$md.Add('')
		}
	}

	if ($count -eq 0) {
		$md.Add('No user prompts found.')
		$md.Add('')
	}
}

Set-Content -Path $OutFile -Value $md -Encoding UTF8
Write-Output "Wrote $OutFile"
