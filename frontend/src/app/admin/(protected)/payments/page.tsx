'use client';
import { useEffect, useState } from 'react';
import { CreditCard, TrendingUp, DollarSign } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

interface Payment {
  id: string;
  user_id: string;
  user_email?: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

function PaymentsContent() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/admin/payments?limit=100');
        setPayments(res.data?.data || []);
      } finally { setLoading(false); }
    })();
  }, []);

  const totalPaid    = payments.filter(p => p.status === 'paid').reduce((a, p) => a + p.amount, 0);
  const totalPending = payments.filter(p => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
  const totalFailed  = payments.filter(p => p.status === 'failed').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Payments</h1>
        <p className="text-muted mt-1">All transactions across your user base.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <DollarSign size={18} className="text-success mb-3" />
          <div className="font-display text-3xl font-semibold">{formatCurrency(totalPaid)}</div>
          <div className="text-xs text-muted mt-1">Total paid</div>
        </Card>
        <Card className="p-5">
          <TrendingUp size={18} className="text-warning mb-3" />
          <div className="font-display text-3xl font-semibold">{formatCurrency(totalPending)}</div>
          <div className="text-xs text-muted mt-1">Pending</div>
        </Card>
        <Card className="p-5">
          <CreditCard size={18} className="text-danger mb-3" />
          <div className="font-display text-3xl font-semibold">{totalFailed}</div>
          <div className="text-xs text-muted mt-1">Failed transactions</div>
        </Card>
      </div>

      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : payments.length === 0 ? (
        <Card className="py-14 text-center">
          <CreditCard size={40} className="text-muted mx-auto mb-4" />
          <h3 className="font-display text-xl">No payments yet</h3>
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-white/[0.03]">
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-3 px-5">User</th>
                <th className="py-3 px-5">Amount</th>
                <th className="py-3 px-5">Status</th>
                <th className="py-3 px-5">Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-white/[0.02] transition">
                  <td className="py-3 px-5 text-sm">{p.user_email ?? p.user_id.slice(0, 10)}</td>
                  <td className="py-3 px-5 font-medium">{formatCurrency(p.amount)}</td>
                  <td className="py-3 px-5">
                    <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${
                      p.status === 'paid'    ? 'bg-success/15 text-success' :
                      p.status === 'pending' ? 'bg-warning/15 text-warning' :
                                                'bg-danger/15 text-danger'
                    }`}>{p.status}</span>
                  </td>
                  <td className="py-3 px-5 text-xs text-muted">{formatDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export default function Page() { return <PaymentsContent />; }
