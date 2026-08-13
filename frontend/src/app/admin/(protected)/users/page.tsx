'use client';
import { useEffect, useState } from 'react';
import { Users, Search, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { api, getApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  plan: string;
  status: string;
  created_at: string;
}

function UsersContent() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchUsers(); }, []);

  /**
   * This used to be try/finally with no catch. A failed request therefore left
   * `users` as its initial empty array and rendered the ordinary "No users
   * found" card — so a server error, an expired admin session and a genuinely
   * empty table all looked identical, and the only clue was in the console.
   * The failure is now caught and shown, with a way to retry.
   */
  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/users?limit=50${q ? `&search=${encodeURIComponent(q)}` : ''}`);
      // Defensive about shape: the list may arrive bare or wrapped depending
      // on which helper the route used.
      const payload = res.data?.data ?? res.data;
      setUsers(Array.isArray(payload) ? payload : payload?.data ?? []);
    } catch (err) {
      setError(getApiError(err, 'Could not load users.'));
      setUsers([]);
    } finally { setLoading(false); }
  }

  const action = async (id: string, action: 'flag' | 'suspend' | 'ban' | 'restore') => {
    try {
      await api.post(`/admin/users/${id}/${action}`);
      await fetchUsers();
      toast.success(`User ${action}ned`);
    } catch (err) { toast.error(getApiError(err)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Users</h1>
          <p className="text-muted mt-1">Manage user accounts and permissions.</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); fetchUsers(); }}>
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email or name…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-veil/[0.03] border border-veil/10 text-sm focus:border-primary/60 focus:outline-none placeholder:text-muted"
          />
        </div>
      </form>

      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : error ? (
        <Card className="py-14 text-center">
          <AlertCircle size={40} className="text-danger mx-auto mb-4" />
          <h3 className="font-display text-xl mb-1">Couldn&apos;t load users</h3>
          <p className="text-muted text-sm mb-4">{error}</p>
          <button
            onClick={fetchUsers}
            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition"
          >
            Try again
          </button>
        </Card>
      ) : users.length === 0 ? (
        <Card className="py-14 text-center">
          <Users size={40} className="text-muted mx-auto mb-4" />
          <h3 className="font-display text-xl">No users found</h3>
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-veil/[0.03]">
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-3 px-5">Name</th>
                <th className="py-3 px-5">Email</th>
                <th className="py-3 px-5">Plan</th>
                <th className="py-3 px-5">Status</th>
                <th className="py-3 px-5">Joined</th>
                <th className="py-3 px-5"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-veil/[0.02] transition">
                  <td className="py-3 px-5 font-medium">{u.full_name || '—'}</td>
                  <td className="py-3 px-5 text-muted">{u.email}</td>
                  <td className="py-3 px-5">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary capitalize">{(u.plan ?? 'free_trial').replace('_', ' ')}</span>
                  </td>
                  <td className="py-3 px-5">
                    <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${
                      u.status === 'active'    ? 'bg-success/15 text-success' :
                      u.status === 'flagged'   ? 'bg-warning/15 text-warning' :
                      u.status === 'suspended' ? 'bg-orange-500/15 text-orange-400' :
                                                  'bg-danger/15 text-danger'
                    }`}>{u.status}</span>
                  </td>
                  <td className="py-3 px-5 text-xs text-muted">{formatDate(u.created_at)}</td>
                  <td className="py-3 px-5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => action(u.id, 'flag')}    className="px-2 py-1 rounded-lg bg-warning/10 hover:bg-warning/20 text-warning text-xs">Flag</button>
                      <button onClick={() => action(u.id, 'suspend')} className="px-2 py-1 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs">Suspend</button>
                      <button onClick={() => action(u.id, 'ban')}     className="px-2 py-1 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger text-xs">Ban</button>
                      <button onClick={() => action(u.id, 'restore')} className="px-2 py-1 rounded-lg bg-success/10 hover:bg-success/20 text-success text-xs">Restore</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export default function Page() { return <UsersContent />; }
