import React, { useState } from 'react';
import {
  ArrowDownTrayIcon,
  UsersIcon,
  PlayIcon,
  DocumentArrowDownIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
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
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className="h-8 w-8 text-primary-600" />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd className="text-lg font-medium text-gray-900">{description}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="bg-gray-50 px-6 py-3">
        <button
          onClick={onExport}
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center"
        >
          {isLoading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <>
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              Export {exportType}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export const AdminExport: React.FC = () => {
  const [exporting, setExporting] = useState<'users' | 'sessions' | null>(null);

  const handleExport = async (type: 'users' | 'sessions') => {
    try {
      setExporting(type);
      
      let data;
      let filename;
      
      if (type === 'users') {
        data = await apiClient.exportAdminUsers();
        filename = `users-export-${new Date().toISOString().split('T')[0]}.json`;
      } else {
        data = await apiClient.exportAdminSessions();
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
          <h1 className="text-2xl font-bold text-gray-900">Export Data</h1>
          <p className="mt-1 text-sm text-gray-500">
            Download platform data for analysis and reporting
          </p>
        </div>
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <DocumentArrowDownIcon className="h-4 w-4" />
          <span>JSON Format</span>
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
          description="Export all simulation session data including scores, durations, and user interactions"
          icon={PlayIcon}
          onExport={() => handleExport('sessions')}
          isLoading={exporting === 'sessions'}
          exportType="Sessions"
        />
      </div>

      {/* Export Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-blue-900 mb-4">Export Information</h3>
        <div className="space-y-3 text-sm text-blue-800">
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

      {/* Quick Stats */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Export Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="text-center p-4 border border-gray-200 rounded-lg">
            <UsersIcon className="h-8 w-8 text-primary-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">User data includes profile information, subscription details, and account status</p>
          </div>
          <div className="text-center p-4 border border-gray-200 rounded-lg">
            <PlayIcon className="h-8 w-8 text-primary-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Session data includes performance scores, completion status, and timing information</p>
          </div>
        </div>
      </div>
    </div>
  );
}; 