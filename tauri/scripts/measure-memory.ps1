# Sums the memory of an app's whole process tree (the app itself plus every
# browser-engine child process), so the Electron and Tauri versions can be
# compared on the same footing.
#
#   pwsh tauri/scripts/measure-memory.ps1              # both versions
#   pwsh tauri/scripts/measure-memory.ps1 -Name xdeck-tauri
param([string[]]$Name = @('xdeck-tauri', 'electron', 'XDeck'))

$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$byParent = $all | Group-Object ParentProcessId -AsHashTable -AsString

function Get-Tree([int]$id) {
    $id
    if ($byParent -and $byParent.ContainsKey("$id")) {
        foreach ($child in $byParent["$id"]) { Get-Tree $child.ProcessId }
    }
}

foreach ($n in $Name) {
    $roots = $all | Where-Object { $_.Name -ieq "$n.exe" } |
        Where-Object { $p = $_.ParentProcessId; -not ($all | Where-Object { $_.ProcessId -eq $p -and $_.Name -ieq "$n.exe" }) }
    foreach ($root in $roots) {
        $ids = Get-Tree $root.ProcessId | Select-Object -Unique
        $procs = Get-Process -Id $ids -ErrorAction SilentlyContinue
        $private = ($procs | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB
        $ws = ($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB
        [pscustomobject]@{
            App          = $n
            RootPid      = $root.ProcessId
            Processes    = $procs.Count
            'Private(MB)' = [math]::Round($private)
            'WorkingSet(MB)' = [math]::Round($ws)
        }
    }
}
