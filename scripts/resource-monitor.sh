#!/bin/bash

# Resource monitoring script for apt-mirror, nginx, and admin app
# Returns JSON with process resource usage

# Function to get process info by name
get_process_info() {
    local process_name=$1
    local display_name=$2
    
    # Find process by name
    local pid=$(pgrep -f "$process_name" | head -1)
    
    if [ -z "$pid" ]; then
        echo "{\"name\":\"$display_name\",\"status\":\"not_running\",\"ramMb\":0,\"cpuPercent\":0}"
        return
    fi
    
    # Get process stats using ps
    local stats=$(ps -p "$pid" -o pid,ppid,pcpu,pmem,comm --no-headers 2>/dev/null)
    
    if [ -z "$stats" ]; then
        echo "{\"name\":\"$display_name\",\"status\":\"not_found\",\"ramMb\":0,\"cpuPercent\":0}"
        return
    fi
    
    # Parse stats (format: PID PPID %CPU %MEM COMMAND)
    local cpu_percent=$(echo "$stats" | awk '{print $3}')
    local ram_percent=$(echo "$stats" | awk '{print $4}')
    
    # Convert RAM percentage to MB (assuming total RAM is available)
    local total_ram_mb=$(free -m | awk 'NR==2{print $2}')
    # Set locale to C to ensure decimal points instead of commas
    export LC_NUMERIC=C
    local ram_mb=$(echo "$ram_percent * $total_ram_mb / 100" | bc -l 2>/dev/null | cut -d. -f1)
    
    # Ensure we have valid numbers
    if [ -z "$ram_mb" ] || [ "$ram_mb" = "0" ]; then
        ram_mb=0
    fi
    
    if [ -z "$cpu_percent" ]; then
        cpu_percent=0
    fi
    
    echo "{\"name\":\"$display_name\",\"status\":\"running\",\"ramMb\":$ram_mb,\"cpuPercent\":$cpu_percent}"
}

# Function to get system total RAM
get_system_ram() {
    local total_ram_mb=$(free -m | awk 'NR==2{print $2}')
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