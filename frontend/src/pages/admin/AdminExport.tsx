import React, { useState } from 'react';
import {
  ArrowDownTrayIcon,
  UsersIcon,
  PlayIcon,
  DocumentArrowDownIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { Button } from '../../components/ui/Button.tsx';
import { RetroCheckbox } from '../../components/ui/RetroInput.tsx';
import toast from 'react-hot-toast';

interface ExportCardProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onExport: () => void;
  isLoading: boolean;
  exportType: string;
}

const ExportCard: React.FC<ExportCardProps> = ({
  title,
  description,
  icon: Icon,
  onExport,
  isLoading,
  exportType,
}) => {
  return (
    <div className="retro-card overflow-hidden">
      <div className="p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className="h-8 w-8" />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-semibold truncate">{title}</dt>
              <dd className="text-lg font-semibold">{description}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="px-6 py-3">
        <Button
          onClick={onExport}
          isLoading={isLoading}
          disabled={isLoading}
          variant="danger"
          size="md"
          className="w-full text-sm"
        >
          <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
          Export {exportType}
        </Button>
      </div>
    </div>
  );
};

export const AdminExport: React.FC = () => {
  const [exporting, setExporting] = useState<'users' | 'sessions' | null>(null);
  const [includeMessages, setIncludeMessages] = useState(true);
  const [includeAnalytics, setIncludeAnalytics] = useState(true);
  const [includeGoals, setIncludeGoals] = useState(true);

  const handleExport = async (type: 'users' | 'sessions') => {
    try {
      setExporting(type);
      
      let data;
      let filename;
      
      if (type === 'users') {
        data = await apiClient.exportAdminUsers();
        filename = `users-export-${new Date().toISOString().split('T')[0]}.json`;
      } else {
        data = await apiClient.exportAdminSessions({
          includeMessages,
          includeAnalytics,
          includeGoals,
        });
        filename = `sessions-export-${new Date().toISOString().split('T')[0]}.json`;
      }

      // Create and download file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`${type} data exported successfully`);
    } catch (error) {
      toast.error(`Failed to export ${type} data`);
      console.error('Export error:', error);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-retro tracking-wider2">EXPORT DATA</h1>
          <p className="mt-1 text-sm font-monoRetro">
            Download platform data for analysis and reporting
          </p>
        </div>
        <div className="flex items-center space-x-2 text-sm text-black">
          <DocumentArrowDownIcon className="h-4 w-4 text-black" />
          <span className="font-semibold">JSON Format</span>
        </div>
      </div>

      {/* Export Cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ExportCard
          title="User Data Export"
          description="Export all user information including profiles, roles, and subscription data"
          icon={UsersIcon}
          onExport={() => handleExport('users')}
          isLoading={exporting === 'users'}
          exportType="Users"
        />
        <ExportCard
          title="Session Data Export"
          description="Export simulation sessions with optional conversation logs, goal progress, and analytics"
          icon={PlayIcon}
          onExport={() => handleExport('sessions')}
          isLoading={exporting === 'sessions'}
          exportType="Sessions"
        />
      </div>

      {/* Session export options */}
      <div className="retro-card p-6">
        <h3 className="text-lg font-semibold mb-4">Session Export Options</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <RetroCheckbox
            label="Include Messages"
            checked={includeMessages}
            onChange={(e) => setIncludeMessages(e.target.checked)}
          />
          <RetroCheckbox
            label="Include Goals & Progress"
            checked={includeGoals}
            onChange={(e) => setIncludeGoals(e.target.checked)}
          />
          <RetroCheckbox
            label="Include Analytics"
            checked={includeAnalytics}
            onChange={(e) => setIncludeAnalytics(e.target.checked)}
          />
        </div>
      </div>

      {/* Export Information */}
      <div className="retro-card p-6">
        <h3 className="text-lg font-semibold mb-4">Export Information</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-start">
            <span className="font-medium mr-2">•</span>
            <span>All exports are generated in JSON format for easy parsing and analysis</span>
          </div>
          <div className="flex items-start">
            <span className="font-medium mr-2">•</span>
            <span>Files are named with the current date for easy organization</span>
          </div>
          <div className="flex items-start">
            <span className="font-medium mr-2">•</span>
            <span>Sensitive information like passwords are automatically excluded from exports</span>
          </div>
          <div className="flex items-start">
            <span className="font-medium mr-2">•</span>
            <span>Export data includes all records up to the current moment</span>
          </div>
        </div>
      </div>
    </div>
  );
}; 