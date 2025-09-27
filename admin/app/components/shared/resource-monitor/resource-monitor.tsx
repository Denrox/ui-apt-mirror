import { useEffect, useState } from 'react';

interface ProcessInfo {
  name: string;
  status: 'running' | 'not_running' | 'not_found' | 'error';
  ramMb: number;
  cpuPercent: number;
}

interface SystemInfo {
  totalRamMb: number;
  cpuPercent: number;
}

interface ResourceData {
  timestamp: string;
  system: SystemInfo;
  processes: ProcessInfo[];
}

export default function ResourceMonitor() {
  const [resourceData, setResourceData] = useState<ResourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResourceData = async () => {
    try {
      const response = await fetch('/api/resources');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setResourceData(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch resource data:', err);
      setError('Failed to load resource data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResourceData();

    const interval = setInterval(fetchResourceData, 5000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-4">
        <div className="text-sm text-gray-600">Loading resource data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-50 border border-gray-300 rounded-md p-4 mb-4">
        <div className="text-sm text-gray-700">{error}</div>
      </div>
    );
  }

  if (!resourceData) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-emerald-500';
      case 'not_running':
        return 'text-rose-400';
      case 'not_found':
      case 'error':
        return 'text-rose-500';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running':
        return 'Running';
      case 'not_running':
        return 'Stopped';
      case 'not_found':
        return 'Not Found';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md p-[0px] py-[12px]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px] md:gap-[32px]">
        {resourceData.processes.map((process) => (
          <div key={process.name} className="px-[12px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700 capitalize">
                {process.name.replace('-', ' ')}
              </span>
              <span
                className={`text-xs font-medium ${getStatusColor(process.status)}`}
              >
                {getStatusText(process.status)}
              </span>
            </div>

            <div className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">RAM:</span>
                <span className="font-medium">{process.ramMb} MB</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">CPU:</span>
                <span className="font-medium">
                  {process.cpuPercent.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
