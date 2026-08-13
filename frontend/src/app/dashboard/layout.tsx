'use client';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { TopBar } from '@/components/dashboard/TopBar';
import { WaitlistOfferPopup } from '@/components/dashboard/WaitlistOfferPopup';
import { DashboardTour } from '@/components/dashboard/DashboardTour';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen flex">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 p-6 lg:p-8">{children}</main>
        </div>
      </div>
      {/* Waitlist offer popup — shown once per session for waitlist members with unused codes */}
      <WaitlistOfferPopup />
      {/* First-run guided walkthrough — plays each page's steps once for new users */}
      <DashboardTour />
    </AuthGuard>
  );
}