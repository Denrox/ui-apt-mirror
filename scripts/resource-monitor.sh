#!/bin/bash

# Resource monitoring script for apt-mirror, nginx, and admin app
# Returns JSON with process resource usage

# Function to get process info by name
get_process_info() {
    local process_name=$1
    local display_name=$2
    
    # Find process by name with more specific patterns for Docker
    local pid=""
    case $process_name in
        "apt-mirror")
            # Look for the actual Python apt-mirror process
            pid=$(pgrep -f "/usr/bin/python3.*apt-mirror" | head -1)
            if [ -z "$pid" ]; then
                pid=$(pgrep -f "python3.*apt-mirror" | head -1)
            fi
            if [ -z "$pid" ]; then
                pid=$(pgrep -f "python.*apt-mirror" | head -1)
            fi
            ;;
        "nginx")
            # Look for nginx worker process
            pid=$(pgrep -f "nginx.*worker process" | head -1)
            if [ -z "$pid" ]; then
                # If no worker found, use master process
                pid=$(pgrep -f "nginx.*master" | head -1)
            fi
            if [ -z "$pid" ]; then
                pid=$(pgrep -f "nginx" | head -1)
            fi
            ;;
        "react-router-serve")
            # Look for actual node process running react-router-serve
            pid=$(pgrep -f "node.*react-router-serve" | head -1)
            if [ -z "$pid" ]; then
                pid=$(pgrep -f "react-router-serve.*index.js" | head -1)
            fi
            if [ -z "$pid" ]; then
                pid=$(pgrep -f "node.*admin" | head -1)
            fi
            ;;
        *)
            pid=$(pgrep -f "$process_name" | head -1)
            ;;
    esac
    
    if [ -z "$pid" ]; then
        echo "{\"name\":\"$display_name\",\"status\":\"not_running\",\"ramMb\":0,\"cpuPercent\":0}"
        return
    fi
    
    # Debug: Show what process we found
    echo "Debug: Found process $display_name with PID $pid" >&2
    ps -p "$pid" -o pid,ppid,pcpu,pmem,comm,args --no-headers >&2
    
    # Get process stats using ps with more reliable options for containers
    local stats=$(ps -p "$pid" -o pid,ppid,pcpu,pmem,comm --no-headers 2>/dev/null)
    
    if [ -z "$stats" ]; then
        echo "{\"name\":\"$display_name\",\"status\":\"not_found\",\"ramMb\":0,\"cpuPercent\":0}"
        return
    fi
    
    # Parse stats (format: PID PPID %CPU %MEM COMMAND)
    local cpu_percent=$(echo "$stats" | awk '{print $3}')
    local ram_percent=$(echo "$stats" | awk '{print $4}')
    
    # Debug: Show parsed values
    echo "Debug: $display_name - CPU: $cpu_percent%, RAM: $ram_percent%" >&2
    
    # If ps doesn't work well in container, try alternative methods
    if [ -z "$cpu_percent" ] || [ "$cpu_percent" = "0.0" ] || [ "$cpu_percent" = "0" ]; then
        # Set locale to C for consistent decimal formatting
        export LC_NUMERIC=C
        # Try using top for more accurate CPU stats
        local top_cpu=$(top -bn1 -p "$pid" 2>/dev/null | tail -1 | awk '{print $9}')
        if [ -n "$top_cpu" ] && [ "$top_cpu" != "0.0" ] && [ "$top_cpu" != "0,0" ]; then
            cpu_percent=$top_cpu
        else
            # Use a simple approach - if process is running, give it a small CPU value
            cpu_percent=0.1
        fi
    fi
    
    if [ -z "$ram_percent" ] || [ "$ram_percent" = "0.0" ] || [ "$ram_percent" = "0" ]; then
        # Try using /proc for memory stats
        if [ -f "/proc/$pid/status" ]; then
            # Try VmSize first (total virtual memory), then VmRSS (resident set)
            local vm_size=$(grep "VmSize:" "/proc/$pid/status" | awk '{print $2}')
            local vm_rss=$(grep "VmRSS:" "/proc/$pid/status" | awk '{print $2}')
            
            echo "Debug: $display_name - VmSize: $vm_size KB, VmRSS: $vm_rss KB" >&2
            
            if [ -n "$vm_size" ] && [ "$vm_size" -gt 0 ]; then
                # Convert KB to MB for VmSize
                ram_mb=$((vm_size / 1024))
            elif [ -n "$vm_rss" ] && [ "$vm_rss" -gt 0 ]; then
                # Convert KB to MB for VmRSS
                ram_mb=$((vm_rss / 1024))
            fi
            
            # If we got a reasonable RAM value, calculate percentage
            if [ -n "$ram_mb" ] && [ "$ram_mb" -gt 0 ]; then
                local total_ram_mb=$(free -m | awk 'NR==2{print $2}')
                if [ "$total_ram_mb" -gt 0 ]; then
                    ram_percent=$(echo "scale=2; $ram_mb * 100 / $total_ram_mb" | bc -l 2>/dev/null)
                fi
            fi
        fi
    fi
    
    # Convert RAM percentage to MB (assuming total RAM is available)
    local total_ram_kb=$(free | awk 'NR==2{print $2}')
    local total_ram_mb=$((total_ram_kb / 1024))
    # Set locale to C to ensure decimal points instead of commas
    export LC_NUMERIC=C
    local ram_mb_calc=$(echo "$ram_percent * $total_ram_mb / 100" | bc -l 2>/dev/null | cut -d. -f1)
    
    # Use calculated RAM if we have it, otherwise use direct measurement
    if [ -n "$ram_mb" ] && [ "$ram_mb" -gt 0 ]; then
        # Use the direct measurement from /proc
        :
    else
        ram_mb=$ram_mb_calc
    fi
    
    # Ensure we have valid numbers
    if [ -z "$ram_mb" ] || [ "$ram_mb" = "0" ]; then
        ram_mb=0
    fi
    
    if [ -z "$cpu_percent" ]; then
        cpu_percent=0
    fi
    
    echo "Debug: $display_name - Final RAM: $ram_mb MB, CPU: $cpu_percent%" >&2
    
    echo "{\"name\":\"$display_name\",\"status\":\"running\",\"ramMb\":$ram_mb,\"cpuPercent\":$cpu_percent}"
}

# Function to get system total RAM
get_system_ram() {
    local total_ram_kb=$(free | awk 'NR==2{print $2}')
    local total_ram_mb=$((total_ram_kb / 1024))
    echo "$total_ram_mb"
}

# Function to get system total CPU usage
get_system_cpu() {
    # Set locale to C to ensure decimal points instead of commas
    export LC_NUMERIC=C
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
    echo "$cpu_usage"
}

# Main execution
main() {
    # Get system info
    local total_ram=$(get_system_ram)
    local system_cpu=$(get_system_cpu)
    
    # Get process info for each service
    local apt_mirror_info=$(get_process_info "apt-mirror" "apt-mirror")
    local nginx_info=$(get_process_info "nginx" "nginx")
    local admin_info=$(get_process_info "react-router-serve" "admin-app")
    
    # Create JSON response
    cat << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "system": {
    "totalRamMb": $total_ram,
    "cpuPercent": $system_cpu
  },
  "processes": [
    $apt_mirror_info,
    $nginx_info,
    $admin_info
  ]
}
EOF
}

# Run main function
main 