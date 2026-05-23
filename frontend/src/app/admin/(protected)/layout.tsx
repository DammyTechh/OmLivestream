'use client';
import { AdminGuard } from '@/components/admin/AdminGuard';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-screen flex">
        <AdminSidebar />
        <main className="flex-1 p-6 lg:p-8 min-w-0">{children}</main>
      </div>
    </AdminGuard>
  );
}
