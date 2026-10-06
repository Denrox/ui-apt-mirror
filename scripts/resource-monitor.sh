#!/bin/bash

# Resource usage of apt-mirror, nginx and the admin app, as JSON for /api/resources.
# CPU is measured over a short sample (100% = one core); RAM is the resident set.

export LC_ALL=C
SAMPLE_SECONDS="${SAMPLE_SECONDS:-0.5}"

# All PIDs of a service, so nginx counts its master and workers.
service_pids() {
    case $1 in
        apt-mirror) pgrep -f "^\S*python\S* .*apt-mirror" ;;
        nginx) pgrep -x nginx ;;
        admin-app) pgrep -f "node.*react-router-serve" ;;
    esac
}

# utime + stime of the given PIDs, in clock ticks.
proc_ticks() {
    local pid stat fields total=0
    for pid in "$@"; do
        stat=$(cat "/proc/$pid/stat" 2>/dev/null) || continue
        read -ra fields <<< "${stat##*) }"
        total=$((total + fields[11] + fields[12]))
    done
    echo "$total"
}

# "<total> <idle>" ticks of all CPUs.
system_ticks() {
    local _ user nice system idle iowait irq softirq steal
    read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat
    echo "$((user + nice + system + idle + iowait + irq + softirq + steal)) $((idle + iowait))"
}

# Resident memory of the given PIDs, in MB.
rss_mb() {
    local pid kb total=0
    for pid in "$@"; do
        kb=$(awk '/^VmRSS:/ {print $2}' "/proc/$pid/status" 2>/dev/null)
        total=$((total + ${kb:-0}))
    done
    echo $((total / 1024))
}

main() {
    local services=(apt-mirror nginx admin-app)
    local -A pids before
    local name
    for name in "${services[@]}"; do
        pids[$name]=$(service_pids "$name" | tr '\n' ' ')
        before[$name]=$(proc_ticks ${pids[$name]})
    done
    local sys_before sys_after
    sys_before=$(system_ticks)
    sleep "$SAMPLE_SECONDS"
    sys_after=$(system_ticks)

    local total_before idle_before total_after idle_after
    read -r total_before idle_before <<< "$sys_before"
    read -r total_after idle_after <<< "$sys_after"
    local dtotal=$((total_after - total_before)) didle=$((idle_after - idle_before))
    [ "$dtotal" -gt 0 ] || dtotal=1
    local ncpu
    ncpu=$(nproc)

    local processes=() status cpu
    for name in "${services[@]}"; do
        if [ -z "${pids[$name]// /}" ]; then
            status=not_running
            # Between runs only the sync loop is alive.
            if [ "$name" = apt-mirror ] && pgrep -f "mirror-sync\.sh" > /dev/null; then
                status=idle
            fi
            processes+=("{\"name\":\"$name\",\"status\":\"$status\",\"ramMb\":0,\"cpuPercent\":0}")
            continue
        fi
        cpu=$(awk -v d="$(( $(proc_ticks ${pids[$name]}) - before[$name] ))" -v t="$dtotal" -v n="$ncpu" \
            'BEGIN { v = d * n * 100 / t; printf "%.1f", v < 0 ? 0 : v }')
        processes+=("{\"name\":\"$name\",\"status\":\"running\",\"ramMb\":$(rss_mb ${pids[$name]}),\"cpuPercent\":$cpu}")
    done

    local system_cpu total_ram
    system_cpu=$(awk -v i="$didle" -v t="$dtotal" 'BEGIN { printf "%.1f", (t - i) * 100 / t }')
    total_ram=$(free -m | awk 'NR==2{print $2}')

    cat << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "system": {
    "totalRamMb": $total_ram,
    "cpuPercent": $system_cpu
  },
  "processes": [
    $(IFS=,; echo "${processes[*]}")
  ]
}
EOF
}

main
