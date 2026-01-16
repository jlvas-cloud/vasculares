import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, userProfilesApi } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  // Load user profile (role, SAP credentials status)
  const loadProfile = useCallback(async () => {
    try {
      const res = await userProfilesApi.getMyProfile();
      setProfile(res.data);
      return res.data;
    } catch (err) {
      console.error('Error loading profile:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    // Check if user is logged in on mount
    if (token) {
      Promise.all([
        authApi.getMe(),
        userProfilesApi.getMyProfile().catch(() => ({ data: null }))
      ])
        .then(([authRes, profileRes]) => {
          setUser(authRes.data.user);
          setCompany(authRes.data.company);
          setProfile(profileRes.data);
        })
        .catch(() => {
          // Token invalid, clear it
          localStorage.removeItem('token');
          setToken(null);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email, password) => {
    const res = await authApi.login(email, password);
    const { token, user, company } = res.data;

    localStorage.setItem('token', token);
    setToken(token);
    setUser(user);
    setCompany(company);

    // Load profile after login
    try {
      const profileRes = await userProfilesApi.getMyProfile();
      setProfile(profileRes.data);
    } catch (err) {
      console.error('Error loading profile after login:', err);
    }

    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setCompany(null);
    setProfile(null);
  };

  // Permission helpers
  const hasPermission = useCallback((permission) => {
    if (!profile?.role) return false;
    const permissions = profile.userPermissions || [];
    // Also check from the role directly if userPermissions not included
    const rolePermissions = {
      admin: ['pedidos', 'goodsReceipts', 'consignments', 'viewInventory', 'editTargetStock', 'manageUsers'],
      almacen: ['pedidos', 'goodsReceipts', 'consignments', 'viewInventory'],
      sales: ['viewInventory', 'editTargetStock'],
      viewer: ['viewInventory']
    };
    return (rolePermissions[profile.role] || []).includes(permission);
  }, [profile]);

  const requiresSapCredentials = useCallback(() => {
    return ['admin', 'almacen'].includes(profile?.role);
  }, [profile]);

  const hasSapCredentials = useCallback(() => {
    return profile?.sapCredentials?.hasPassword === true;
  }, [profile]);

  const value = {
    user,
    company,
    profile,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    loadProfile,
    // Permission helpers
    hasPermission,
    requiresSapCredentials,
    hasSapCredentials,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
