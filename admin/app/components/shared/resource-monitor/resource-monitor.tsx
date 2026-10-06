import { useEffect, useState } from 'react';

interface ProcessInfo {
  name: string;
  status: 'running' | 'idle' | 'not_running' | 'not_found' | 'error';
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
      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4">
        <div className="text-sm text-on-surface-variant">
          Loading resource data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4">
        <div className="text-sm text-error">{error}</div>
      </div>
    );
  }

  if (!resourceData) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-success';
      case 'not_running':
      case 'not_found':
      case 'error':
        return 'text-error';
      default:
        return 'text-on-surface-variant';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running':
        return 'Running';
      case 'idle':
        return 'Idle';
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
    <div className="grid grid-cols-1 gap-stack-md sm:grid-cols-2 md:grid-cols-3">
      {resourceData.processes.map((process) => (
        <div
          key={process.name}
          className="rounded-xl border border-outline-variant bg-surface-container-low p-stack-md"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold capitalize text-on-surface">
              {process.name.replace('-', ' ')}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${getStatusColor(process.status)}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {getStatusText(process.status)}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-on-surface-variant">RAM</span>
              <span className="font-mono text-on-surface">
                {process.ramMb} MB
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-on-surface-variant">CPU</span>
              <span className="font-mono text-on-surface">
                {process.cpuPercent.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
