import React, { useState, useEffect } from 'react';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { User, UserRole, SubscriptionTier, AdminUserUpdate } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import { RetroPagination } from '../../components/ui/RetroTable.tsx';
import toast from 'react-hot-toast';

interface UsersTableProps {
  users: User[];
  onUserUpdate: (user: User) => void;
}

interface EditingUser {
  id: string;
  role: UserRole;
  subscriptionTier: SubscriptionTier;
  isActive: boolean;
}

const UsersTable: React.FC<UsersTableProps> = ({ users, onUserUpdate }) => {
  const [editingUser, setEditingUser] = useState<EditingUser | null>(null);
  const [saving, setSaving] = useState(false);

  const handleEdit = (user: User) => {
    setEditingUser({
      id: user.id,
      role: user.role,
      subscriptionTier: user.subscriptionTier,
      isActive: user.isActive,
    });
  };

  const handleSave = async () => {
    if (!editingUser) return;

    try {
      setSaving(true);
      const updateData: AdminUserUpdate = {
        role: editingUser.role,
        subscriptionTier: editingUser.subscriptionTier,
        isActive: editingUser.isActive,
      };

      const response = await apiClient.updateAdminUser(editingUser.id, updateData);
      onUserUpdate(response.user);
      setEditingUser(null);
      toast.success('User updated successfully');
    } catch (error) {
      toast.error('Failed to update user');
      console.error('Update user error:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingUser(null);
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="text-left px-4 py-2 border-b-2 border-black bg-yellow-200 font-semibold">User</th>
            <th className="text-left px-4 py-2 border-b-2 border-black bg-yellow-200 font-semibold">Role</th>
            <th className="text-left px-4 py-2 border-b-2 border-black bg-yellow-200 font-semibold">Subscription</th>
            <th className="text-left px-4 py-2 border-b-2 border-black bg-yellow-200 font-semibold">Status</th>
            <th className="text-left px-4 py-2 border-b-2 border-black bg-yellow-200 font-semibold">Joined</th>
            <th className="text-right px-4 py-2 border-b-2 border-black bg-yellow-200 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isEditing = editingUser?.id === user.id;
            
            return (
              <tr key={user.id} className="odd:bg-white even:bg-neutral-50">
                <td className="px-4 py-2 whitespace-nowrap border-b border-neutral-300">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                      <div className="h-10 w-10 border-2 border-black flex items-center justify-center shadow-[2px_2px_0_#111827]">
                        <span className="font-bold">
                          {user.firstName?.[0]}{user.lastName?.[0]}
                        </span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-semibold">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="text-sm font-monoRetro">
                        {user.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 whitespace-nowrap border-b border-neutral-300">
                  {isEditing ? (
                    <select
                      value={editingUser.role}
                      onChange={(e) => setEditingUser({
                        ...editingUser,
                        role: e.target.value as UserRole
                      })}
                      className="retro-input text-sm"
                    >
                      <option value={UserRole.USER}>User</option>
                      <option value={UserRole.ADMIN}>Admin</option>
                    </select>
                  ) : (
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold border-2 border-black shadow-[2px_2px_0_#111827]`}>
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap border-b border-neutral-300">
                  {isEditing ? (
                    <select
                      value={editingUser.subscriptionTier}
                      onChange={(e) => setEditingUser({
                        ...editingUser,
                        subscriptionTier: e.target.value as SubscriptionTier
                      })}
                      className="retro-input text-sm"
                    >
                      <option value={SubscriptionTier.FREEMIUM}>Freemium</option>
                      <option value={SubscriptionTier.PRO}>Pro</option>
                      <option value={SubscriptionTier.PREMIUM}>Premium</option>
                    </select>
                  ) : (
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold border-2 border-black shadow-[2px_2px_0_#111827]`}>
                      {user.subscriptionTier.charAt(0).toUpperCase() + user.subscriptionTier.slice(1).toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap border-b border-neutral-300">
                  {isEditing ? (
                    <select
                      value={editingUser.isActive ? 'active' : 'inactive'}
                      onChange={(e) => setEditingUser({
                        ...editingUser,
                        isActive: e.target.value === 'active'
                      })}
                      className="retro-input text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  ) : (
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold border-2 border-black shadow-[2px_2px_0_#111827]`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm font-monoRetro border-b border-neutral-300">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right text-sm font-medium border-b border-neutral-300">
                  {isEditing ? (
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="retro-btn-base bg-white px-2 py-1 disabled:opacity-50"
                      >
                        {saving ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <CheckIcon className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={saving}
                        className="retro-btn-base bg-white px-2 py-1 disabled:opacity-50"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEdit(user)}
                      className="retro-btn-base bg-white px-2 py-1"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    tier: '',
    status: '',
    page: 1,
    limit: 20,
  });
  const [pagination, setPagination] = useState({
    current: 1,
    total: 1,
    count: 0,
    limit: 20,
  });

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const params = {
          ...filters,
          search: filters.search || undefined,
          tier: filters.tier || undefined,
          status: filters.status || undefined,
        };

        const response = await apiClient.getAdminUsers(params);
        setUsers(response.users);
        setPagination(response.pagination);
      } catch (error) {
        toast.error('Failed to load users');
        console.error('Fetch users error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [filters]);

  const handleUserUpdate = (updatedUser: User) => {
    setUsers(users.map(user => 
      user.id === updatedUser.id ? updatedUser : user
    ));
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1, // Reset to first page when filtering
    }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-retro tracking-wider2">USER MANAGEMENT</h1>
          <p className="mt-1 text-sm font-monoRetro">
            Manage user accounts, roles, and subscriptions
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="retro-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search users..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="retro-input pl-10 pr-4 py-2 w-full"
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>
          <select
            value={filters.tier}
            onChange={(e) => handleFilterChange('tier', e.target.value)}
            className="retro-input"
          >
            <option value="">All Tiers</option>
            <option value={SubscriptionTier.FREEMIUM}>Freemium</option>
            <option value={SubscriptionTier.PRO}>Pro</option>
            <option value={SubscriptionTier.PREMIUM}>Premium</option>
          </select>
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="retro-input"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="flex items-center text-sm">
            <FunnelIcon className="h-4 w-4 mr-2" />
            {pagination.count} total users
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="retro-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : users.length > 0 ? (
          <UsersTable users={users} onUserUpdate={handleUserUpdate} />
        ) : (
          <div className="text-center py-12">
            <p>No users found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.total > 1 && (
        <div>
          <RetroPagination
            page={pagination.current}
            pageCount={pagination.total}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}; 