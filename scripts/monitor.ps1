# ═══════════════════════════════════════════════════════════════════
# QuantumClaw — Windows Performance Monitor
# ═══════════════════════════════════════════════════════════════════
# Collects CPU, memory, and disk I/O metrics using PowerShell.
# Prints a single JSON object and exits (suitable for polling by Node.js).
#
# Usage:
#   powershell -NoProfile -File scripts\monitor.ps1
# ═══════════════════════════════════════════════════════════════════

$ErrorActionPreference = "SilentlyContinue"

# ── Helper: safely call Get-Counter with null-filtered paths ────────
function Invoke-SafeCounter {
    param([string[]]$Paths, [int]$Samples = 1)

    # Filter out any $null or empty strings — passing $null to -Counter
    # triggers PositionalParameterNotFound (ParameterBindingException).
    $valid = @($Paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($valid.Count -eq 0) { return $null }

    try {
        return Get-Counter -Counter $valid -SampleInterval 1 -MaxSamples $Samples -ErrorAction Stop
    } catch {
        return $null
    }
}

# ── CPU ────────────────────────────────────────────────────────────
$cpuPct = $null
$cpuResult = Invoke-SafeCounter -Paths @('\Processor(_Total)\% Processor Time')
if ($cpuResult -ne $null) {
    $cpuPct = [math]::Round($cpuResult.CounterSamples[0].CookedValue, 1)
}

# Fallback to WMI if performance counters are unavailable
if ($cpuPct -eq $null) {
    $wmiCpu = Get-WmiObject -Class Win32_Processor -ErrorAction SilentlyContinue |
              Measure-Object -Property LoadPercentage -Average
    if ($wmiCpu -ne $null) { $cpuPct = [math]::Round($wmiCpu.Average, 1) }
}

# ── Memory ─────────────────────────────────────────────────────────
$memFreeMb  = $null
$memTotalMb = $null
$os = Get-WmiObject -Class Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os -ne $null) {
    $memFreeMb  = [math]::Round($os.FreePhysicalMemory  / 1024, 0)
    $memTotalMb = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
}

# ── Disk I/O ───────────────────────────────────────────────────────
# Build counter paths only for physical disks that actually exist so
# we never pass a $null entry to Get-Counter.
$diskCounterPaths = @(
    '\PhysicalDisk(_Total)\Avg. Disk Queue Length',
    '\PhysicalDisk(_Total)\Disk Reads/sec',
    '\PhysicalDisk(_Total)\Disk Writes/sec'
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$diskQueueLen = $null
$diskReadsPs  = $null
$diskWritesPs = $null

$diskResult = Invoke-SafeCounter -Paths $diskCounterPaths
if ($diskResult -ne $null) {
    foreach ($sample in $diskResult.CounterSamples) {
        switch -Wildcard ($sample.Path) {
            '*Avg. Disk Queue Length' { $diskQueueLen = [math]::Round($sample.CookedValue, 2) }
            '*Disk Reads/sec'         { $diskReadsPs  = [math]::Round($sample.CookedValue, 1) }
            '*Disk Writes/sec'        { $diskWritesPs = [math]::Round($sample.CookedValue, 1) }
        }
    }
}

# ── Free disk space (C: drive) ─────────────────────────────────────
$diskFreeGb = $null
$psDrive = Get-PSDrive -Name 'C' -ErrorAction SilentlyContinue
if ($psDrive -ne $null) {
    $diskFreeGb = [math]::Round($psDrive.Free / 1GB, 1)
}

# ── Output as JSON ─────────────────────────────────────────────────
$result = [ordered]@{
    timestamp   = (Get-Date).ToString('o')
    cpu_pct     = $cpuPct
    mem_free_mb = $memFreeMb
    mem_total_mb = $memTotalMb
    disk_queue  = $diskQueueLen
    disk_reads_ps  = $diskReadsPs
    disk_writes_ps = $diskWritesPs
    disk_free_gb   = $diskFreeGb
}

$result | ConvertTo-Json -Compress
