import { Navigate } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import AccessDenied from './AccessDenied';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/domain';

export default function ProtectedRoute({ children, requireRole }: PropsWithChildren<{ requireRole?: UserRole }>) {
  const { session, loading, roleLoading, role } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading authentication...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (requireRole && roleLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading access...</div>;
  }

  if (requireRole && role !== requireRole) {
    return <AccessDenied reason={`This page requires the ${requireRole} role.`} />;
  }

  return <>{children}</>;
}
