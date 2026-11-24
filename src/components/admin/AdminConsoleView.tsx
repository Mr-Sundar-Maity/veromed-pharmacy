import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, RefreshCw, Shield, UserCheck, UserX } from 'lucide-react';
import { apiFetch, type UserRole } from '../../types/api';

interface AuditRow {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource: string;
  outcome: 'success' | 'denied' | 'error';
  created_at: string;
}

interface JobRow {
  id: string;
  recipient_email: string;
  kind: string;
  title: string;
  status: string;
  attempts: number;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  pharmacy_name?: string | null;
  created_at: string;
}

interface PharmacyOption {
  id: string;
  tenant_name: string;
  license_number: string;
}

export const AdminConsoleView: React.FC<{ activeTab: string }> = ({ activeTab }) => {
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pharmacies, setPharmacies] = useState<PharmacyOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Provision new user form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('pharmacist');
  const [newPharmacyId, setNewPharmacyId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCreatePw, setShowCreatePw] = useState(false);

  // Per-user password reset state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [showResetPw, setShowResetPw] = useState(false);

  async function loadAdminData() {
    setError(null);
    try {
      const [audRes, jobRes, usrRes] = await Promise.all([
        apiFetch<{ logs: AuditRow[] }>('/admin/audit-logs'),
        apiFetch<{ jobs: JobRow[] }>('/admin/notifications-monitor'),
        apiFetch<{ users: UserRow[]; pharmacies: PharmacyOption[] }>('/admin/users'),
      ]);
      setAuditLogs(audRes.logs);
      setJobs(jobRes.jobs);
      setUsers(usrRes.users);
      setPharmacies(usrRes.pharmacies ?? []);
      if (usrRes.pharmacies?.[0] && !newPharmacyId) {
        setNewPharmacyId(usrRes.pharmacies[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console.');
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, [activeTab]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          fullName: newName,
          email: newEmail,
          role: newRole,
          pharmacyId: newRole === 'pharmacist' ? newPharmacyId : undefined,
          password: newPassword,
        }),
      });
      setNotice(`Account provisioned for ${newEmail} (${newRole}).`);
      setShowCreateForm(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setShowCreatePw(false);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to provision user account.');
    }
  }

  async function handleRotatePassword(e: React.FormEvent, userId: string) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });
      setNotice('Password updated and existing user sessions revoked.');
      setResetUserId(null);
      setResetPasswordVal('');
      setShowResetPw(false);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user password.');
    }
  }

  async function handleToggleUserStatus(user: UserRow) {
    setError(null);
    setNotice(null);
    const nextStatus = user.status === 'active' ? 'deactivated' : 'active';
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setNotice(`${user.email} is now ${nextStatus}.`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change user status.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {activeTab === 'admin-users' ? 'Users, Roles & Tenants' : 'Audit Trail & Notification Jobs'}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Protected administrative governance console · All privileged reads and credential updates are logged
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeTab === 'admin-users' && (
            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Provision Account</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadAdminData()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-sm text-teal-900">
          {notice}
        </div>
      )}

      {activeTab === 'admin-users' ? (
        <div className="space-y-6">
          {showCreateForm && (
            <form
              onSubmit={handleCreateUser}
              className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
            >
              <div>
                <label htmlFor="admin-new-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="admin-new-name"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Dr. Kavita Rao"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="admin-new-email" className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  id="admin-new-email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="kavita.rao@veromed.care"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="admin-new-role" className="block text-xs font-semibold text-slate-700 mb-1">
                  Role
                </label>
                <select
                  id="admin-new-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="patient">Patient</option>
                  <option value="caregiver">Caregiver</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {newRole === 'pharmacist' && (
                <div>
                  <label htmlFor="admin-new-pharm" className="block text-xs font-semibold text-slate-700 mb-1">
                    Assigned Pharmacy
                  </label>
                  <select
                    id="admin-new-pharm"
                    value={newPharmacyId}
                    onChange={(e) => setNewPharmacyId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {pharmacies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.tenant_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="admin-new-password" className="block text-xs font-semibold text-slate-700 mb-1">
                  Initial Password
                </label>
                <div className="relative">
                  <input
                    id="admin-new-password"
                    type={showCreatePw ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 8 chars"
                    className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePw((prev) => !prev)}
                    aria-label={showCreatePw ? 'Hide initial password' : 'Show initial password'}
                    aria-pressed={showCreatePw}
                    className="absolute inset-y-0 right-0 px-2.5 flex items-center text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    {showCreatePw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2 lg:col-span-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer"
                >
                  Create Account
                </button>
              </div>
            </form>
          )}

          {resetUserId && (
            <form
              onSubmit={(e) => void handleRotatePassword(e, resetUserId)}
              className="bg-white border border-slate-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-end gap-3"
            >
              <div className="flex-1">
                <label htmlFor="admin-reset-password" className="block text-xs font-semibold text-slate-700 mb-1">
                  Set New Password for {users.find((u) => u.id === resetUserId)?.email}
                </label>
                <div className="relative">
                  <input
                    id="admin-reset-password"
                    type={showResetPw ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={resetPasswordVal}
                    onChange={(e) => setResetPasswordVal(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPw((prev) => !prev)}
                    aria-label={showResetPw ? 'Hide new password' : 'Show new password'}
                    aria-pressed={showResetPw}
                    className="absolute inset-y-0 right-0 px-2.5 flex items-center text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    {showResetPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setResetUserId(null);
                    setResetPasswordVal('');
                  }}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer"
                >
                  Save Password
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role / Tenant</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{u.full_name}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{u.email}</td>
                    <td className="py-2.5 px-4 capitalize font-medium text-slate-700">
                      {u.role}
                      {u.pharmacy_name ? ` · ${u.pharmacy_name}` : ''}
                    </td>
                    <td
                      className={`py-2.5 px-4 capitalize font-semibold ${
                        u.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {u.status}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">
                      {u.created_at.slice(0, 10)}
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserId(u.id);
                          setResetPasswordVal('');
                          setShowResetPw(false);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Reset Password</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleUserStatus(u)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer"
                      >
                        {u.status === 'active' ? (
                          <>
                            <UserX className="w-3 h-3 text-red-600" />
                            <span>Suspend</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-3 h-3 text-emerald-700" />
                            <span>Activate</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Immutable Security &amp; Operation Audit Log
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Resource</th>
                    <th className="py-2.5 px-4">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.slice(0, 35).map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {log.created_at.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2 px-4 text-slate-700">
                        {log.actor_email || 'anonymous'} ({log.actor_role || 'none'})
                      </td>
                      <td className="py-2 px-4 font-mono text-slate-900">{log.action}</td>
                      <td className="py-2 px-4 font-mono text-slate-600">{log.resource}</td>
                      <td className="py-2 px-4">
                        <span
                          className={`font-semibold capitalize ${
                            log.outcome === 'success'
                              ? 'text-emerald-700'
                              : log.outcome === 'denied'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {log.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="font-display text-base font-bold text-slate-900">
                Notification Dispatch Queue
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                    <th className="py-2.5 px-4">Created</th>
                    <th className="py-2.5 px-4">Recipient</th>
                    <th className="py-2.5 px-4">Kind</th>
                    <th className="py-2.5 px-4">Title</th>
                    <th className="py-2.5 px-4 text-right">Attempts</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jobs.slice(0, 25).map((j) => (
                    <tr key={j.id}>
                      <td className="py-2 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {j.created_at.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2 px-4 text-slate-700">{j.recipient_email}</td>
                      <td className="py-2 px-4 font-mono text-slate-600">{j.kind}</td>
                      <td className="py-2 px-4 font-medium text-slate-900">{j.title}</td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums">{j.attempts}</td>
                      <td className="py-2 px-4 capitalize text-teal-700 font-semibold">{j.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
