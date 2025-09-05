import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiClient } from '../utils/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import toast from 'react-hot-toast';

export const Profile: React.FC = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    bio: user?.bio || '',
    jobTitle: user?.jobTitle || '',
    company: user?.company || '',
    industry: user?.industry || '',
    profileImageUrl: user?.profileImageUrl || '',
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiClient.updateUserProfile(formData);
      toast.success('Profile updated successfully!');
      
      // Note: The user data will be refreshed on next page load or auth check
      // For real-time updates, you could add a refresh method to AuthContext
    } catch (error) {
      toast.error('Failed to update profile. Please try again.');
      console.error('Profile update error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="retro-card">
        {/* Header */}
        <div className="px-6 py-4 border-b-2 border-black">
          <h1 className="text-2xl font-retro tracking-wider2">PROFILE SETTINGS</h1>
          <p className="font-monoRetro mt-1">
            Update your profile information and preferences
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Information */}
          <div>
            <h2 className="text-lg font-medium text-secondary-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-semibold mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  className="retro-input w-full"
                  placeholder="Enter your first name"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-semibold mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  className="retro-input w-full"
                  placeholder="Enter your last name"
                />
              </div>
            </div>
          </div>

          {/* Professional Information */}
          <div>
            <h2 className="text-lg font-medium text-secondary-900 mb-4">Professional Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="jobTitle" className="block text-sm font-semibold mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  id="jobTitle"
                  name="jobTitle"
                  value={formData.jobTitle}
                  onChange={handleInputChange}
                  className="retro-input w-full"
                  placeholder="e.g., Senior Software Engineer"
                />
              </div>
              <div>
                <label htmlFor="company" className="block text-sm font-semibold mb-1">
                  Company
                </label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  value={formData.company}
                  onChange={handleInputChange}
                  className="retro-input w-full"
                  placeholder="e.g., Tech Corp"
                />
              </div>
              <div>
                <label htmlFor="industry" className="block text-sm font-semibold mb-1">
                  Industry
                </label>
                <input
                  type="text"
                  id="industry"
                  name="industry"
                  value={formData.industry}
                  onChange={handleInputChange}
                  className="retro-input w-full"
                  placeholder="e.g., Technology, Healthcare, Finance"
                />
              </div>
            </div>
          </div>

          {/* Bio */}
          <div>
            <label htmlFor="bio" className="block text-sm font-semibold mb-1">
              Bio
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={4}
              value={formData.bio}
              onChange={handleInputChange}
              className="retro-input w-full"
              placeholder="Tell us about yourself, your experience, and your career goals..."
            />
          </div>

          {/* Profile Image URL */}
          <div>
            <label htmlFor="profileImageUrl" className="block text-sm font-semibold mb-1">
              Profile Image URL
            </label>
            <input
              type="url"
              id="profileImageUrl"
              name="profileImageUrl"
              value={formData.profileImageUrl}
              onChange={handleInputChange}
              className="retro-input w-full"
              placeholder="https://example.com/profile-image.jpg"
            />
            <p className="text-sm mt-1 font-monoRetro">
              Enter a URL to an image that represents you professionally
            </p>
          </div>

          {/* Account Information (Read-only) */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Account Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-3 py-2 border-2 border-black bg-white text-black"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Subscription Tier
                </label>
                <input
                  type="text"
                  value={user.subscriptionTier}
                  disabled
                  className="w-full px-3 py-2 border-2 border-black bg-white text-black capitalize"
                />
              </div>
            </div>
          </div>

          {/* Statistics (Read-only) */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Statistics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Total Simulations Completed
                </label>
                <input
                  type="number"
                  value={user.totalSimulationsCompleted || 0}
                  disabled
                  className="w-full px-3 py-2 border-2 border-black bg-white text-black"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  This Month's Usage
                </label>
                <input
                  type="number"
                  value={user.monthlySimulationsUsed || 0}
                  disabled
                  className="w-full px-3 py-2 border-2 border-black bg-white text-black"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-6 border-t-2 border-black">
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={isLoading}
            >
              {isLoading ? 'Updating...' : 'Update Profile'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}; 