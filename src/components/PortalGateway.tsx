import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileText,
  HeartPulse,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import { apiFetch, type AuthUser, setAuthToken, type UserRole } from '../types/api';

interface PortalGatewayProps {
  onAuthenticated: (user: AuthUser, sessionExpiresAt?: string, rememberMe?: boolean) => void;
  sessionNotice?: string | null;
}

export const PortalGateway: React.FC<PortalGatewayProps> = ({
  onAuthenticated,
  sessionNotice,
}) => {
  const [selectedPortal, setSelectedPortal] = useState<'patient' | 'pharmacy' | 'admin'>('patient');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [fullName, setFullName] = useState('');
  const [registerRole, setRegisterRole] = useState<UserRole>('patient');
  const [pharmacyName, setPharmacyName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [checkingCredentials, setCheckingCredentials] = useState(false);
  const [verifiedPreview, setVerifiedPreview] = useState<{
    email: string;
    fullName: string;
    role: UserRole;
  } | null>(null);
  const verifySeqRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    const trimmedEmail = email.trim();
    const seq = ++verifySeqRef.current;

    if (mode !== 'login' || !trimmedEmail.includes('@') || password.length < 8) {
      setCheckingCredentials(false);
      setVerifiedPreview(null);
      return;
    }

    setVerifiedPreview(null);
    const debounceId = window.setTimeout(async () => {
      if (verifySeqRef.current !== seq) return;
      setCheckingCredentials(true);
      const startedAt = Date.now();
      try {
        const res = await apiFetch<{ valid: boolean; fullName?: string; role?: UserRole }>(
          '/auth/verify-credentials',
          {
            method: 'POST',
            body: JSON.stringify({ email: trimmedEmail, password }),
          }
        );
        if (verifySeqRef.current !== seq) return;
        if (res.valid && res.fullName) {
          const elapsed = Date.now() - startedAt;
          if (elapsed < 360) {
            await new Promise((resolve) => window.setTimeout(resolve, 360 - elapsed));
          }
          if (verifySeqRef.current !== seq) return;
          setVerifiedPreview({
            email: trimmedEmail.toLowerCase(),
            fullName: res.fullName,
            role: res.role ?? 'patient',
          });
        } else {
          setVerifiedPreview(null);
        }
      } catch {
        if (verifySeqRef.current === seq) {
          setVerifiedPreview(null);
        }
      } finally {
        if (verifySeqRef.current === seq) {
          setCheckingCredentials(false);
        }
      }
    }, 180);

    return () => {
      window.clearTimeout(debounceId);
    };
  }, [mode, email, password]);

  async function loginWithCredentials(targetEmail: string, targetPassword: string) {
    setLoading(true);
    setError(null);
    setResetMessage(null);
    try {
      const data = await apiFetch<{
        token: string;
        expiresAt?: string;
        rememberMe?: boolean;
        user: AuthUser;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: targetEmail,
          password: targetPassword,
          rememberMe,
        }),
      });
      const effectiveRemember = data.rememberMe ?? rememberMe;
      setAuthToken(data.token, data.expiresAt, effectiveRemember);
      onAuthenticated(data.user, data.expiresAt, effectiveRemember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'login') {
      await loginWithCredentials(email, password);
      return;
    }

    if (!termsAccepted) {
      setError('Please read and accept the Terms & Conditions before creating an account.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{
        token: string;
        expiresAt?: string;
        rememberMe?: boolean;
        user: AuthUser;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          fullName,
          role: registerRole,
          pharmacyName: registerRole === 'pharmacist' ? pharmacyName : undefined,
          termsAccepted: true,
          rememberMe: false,
        }),
      });
      const effectiveRemember = Boolean(data.rememberMe);
      setAuthToken(data.token, data.expiresAt, effectiveRemember);
      onAuthenticated(data.user, data.expiresAt, effectiveRemember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResetMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request password reset.');
    }
  }

  function selectPortalTab(portal: 'patient' | 'pharmacy' | 'admin') {
    setSelectedPortal(portal);
    setError(null);
    setResetMessage(null);
    if (portal === 'admin') {
      setMode('login');
    } else if (mode === 'register') {
      setRegisterRole(portal === 'patient' ? 'patient' : 'pharmacist');
    }
  }

  const portalHeading =
    selectedPortal === 'pharmacy'
      ? 'Sign in to Pharmacy Management Platform'
      : selectedPortal === 'admin'
      ? 'Sign in to Administration & Audit Console'
      : 'Sign in to Patient Healthcare Platform';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a href="#top" className="focus-visible:outline-2 focus-visible:outline-teal-700 rounded">
            <BrandLogo />
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#platforms" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Platforms
            </a>
            <a href="#safety" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Clinical Safety
            </a>
            <a href="#auth-panel" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Account Access
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                selectPortalTab('admin');
                document.getElementById('auth-email')?.focus();
              }}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Admin Sign In
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 lg:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Dual Platform Architecture Overview */}
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-4">
              <p className="text-xs font-semibold tracking-wider uppercase text-teal-700">
                Smart Medicine &amp; Healthcare Assistance System
              </p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance leading-tight">
                Two dedicated healthcare platforms connected by verified safety controls.
              </h1>
              <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
                VeroMed unites patient medication adherence, AI-assisted prescription review, medical record organization, and pharmacy batch inventory forecasting under strict role-based boundaries.
              </p>
            </div>

            {/* Platform Cards */}
            <div id="platforms" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <button
                type="button"
                onClick={() => selectPortalTab('patient')}
                className={`text-left p-6 rounded-xl border transition-colors cursor-pointer ${
                  selectedPortal === 'patient'
                    ? 'bg-white border-teal-600 ring-1 ring-teal-600'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 text-teal-700">
                    <HeartPulse className="w-5 h-5" />
                  </span>
                  <span className="text-xs font-medium text-teal-700">
                    {selectedPortal === 'patient' ? 'Selected Site' : 'Select Site'}
                  </span>
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Patient Healthcare Platform
                </h2>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  VeroMed Care · Medication schedules, push dose reminders, refill requests, OCR review, medical timeline, appointments, and caregiver consent.
                </p>
              </button>

              <button
                type="button"
                onClick={() => selectPortalTab('pharmacy')}
                className={`text-left p-6 rounded-xl border transition-colors cursor-pointer ${
                  selectedPortal === 'pharmacy'
                    ? 'bg-white border-blue-700 ring-1 ring-blue-700'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-700">
                    <Building2 className="w-5 h-5" />
                  </span>
                  <span className="text-xs font-medium text-blue-700">
                    {selectedPortal === 'pharmacy' ? 'Selected Site' : 'Select Site'}
                  </span>
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Pharmacy Management Platform
                </h2>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  VeroMed Pharma · Batch/lot expiry alerts, expired stock dispensing block, atomic stock ledger, patient refills, and ML demand forecasting.
                </p>
              </button>
            </div>

            {/* Admin Portal Selection Bar */}
            <button
              type="button"
              onClick={() => {
                selectPortalTab('admin');
                document.getElementById('auth-email')?.focus();
              }}
              className={`w-full text-left p-5 rounded-xl border transition-colors cursor-pointer flex items-center justify-between gap-4 ${
                selectedPortal === 'admin'
                  ? 'bg-white border-slate-800 ring-1 ring-slate-800'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-100 text-slate-800 shrink-0">
                  <ClipboardCheck className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Administration &amp; Audit Console
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Protected governance portal for user credential management, security audit logs, and notification monitors.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0">
                {selectedPortal === 'admin' ? 'Selected Portal' : 'Select Portal'}
              </span>
            </button>

            {/* Clinical Safety & Governance Notice */}
            <div id="safety" className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-slate-900 font-display font-semibold text-base">
                <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0" />
                <span>Safety-First Clinical Boundaries</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-slate-600">
                <div>
                  <p className="font-semibold text-slate-900 mb-1">Human OCR Gate</p>
                  <p>AI-extracted prescriptions remain unverified drafts until reviewed and approved by the patient.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 mb-1">Source Provenance</p>
                  <p>Drug interactions display verified reference version, update date, limitations, and unknown states.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 mb-1">Expiry &amp; Tenant Guard</p>
                  <p>Expired pharmacy batches are blocked from dispensing; tenants and patient records are strictly isolated.</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                Safety statement: VeroMed is a healthcare-support and information-management system. It is not a diagnostic tool, does not replace a licensed healthcare professional, and must not independently change or recommend treatment.
              </p>
            </div>
          </div>

          {/* Right Column: Authentication Card */}
          <div id="auth-panel" className="lg:col-span-5">
            <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setShowPassword(false);
                  }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                    mode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  disabled={selectedPortal === 'admin'}
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setEmail('');
                    setPassword('');
                    setShowPassword(false);
                  }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    mode === 'register'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>

              <div className="mb-6">
                <h2 className="font-display text-xl font-bold text-slate-900">
                  {mode === 'login' ? portalHeading : 'Register a VeroMed Account'}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  {mode === 'login'
                    ? 'Enter your provisioned email and password. Sessions last 24 hours by default, or 30 days with Remember me.'
                    : 'Choose your role to provision an isolated workspace. Administrator accounts are provisioned internally.'}
                </p>
              </div>

              {sessionNotice && (
                <div
                  role="status"
                  className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900"
                >
                  {sessionNotice}
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
                >
                  {error}
                </div>
              )}

              {resetMessage && (
                <div
                  role="status"
                  className="mb-4 p-3 rounded-lg bg-teal-50 border border-teal-200 text-sm text-teal-900"
                >
                  {resetMessage}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <>
                    <div>
                      <label htmlFor="auth-fullname" className="block text-sm font-medium text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        id="auth-fullname"
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Dr. Ananya Rao"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                      />
                    </div>

                    <div>
                      <label htmlFor="auth-role" className="block text-sm font-medium text-slate-700 mb-1">
                        Account Role
                      </label>
                      <select
                        id="auth-role"
                        value={registerRole}
                        onChange={(e) => setRegisterRole(e.target.value as UserRole)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        <option value="patient">Patient (VeroMed Care)</option>
                        <option value="caregiver">Caregiver (Shared Care)</option>
                        <option value="pharmacist">Pharmacist (VeroMed Pharma)</option>
                      </select>
                    </div>

                    {registerRole === 'pharmacist' && (
                      <div>
                        <label htmlFor="auth-pharmacy" className="block text-sm font-medium text-slate-700 mb-1">
                          Pharmacy Organization Name
                        </label>
                        <input
                          id="auth-pharmacy"
                          type="text"
                          required
                          value={pharmacyName}
                          onChange={(e) => setPharmacyName(e.target.value)}
                          placeholder="Wellness Square Pharmacy"
                          className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    )}
                  </>
                )}

                <div>
                  <label htmlFor="auth-email" className="block text-sm font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@veromed.care"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full pl-3.5 pr-11 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded-r-lg cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {mode === 'login' && (
                  <div className="flex items-start gap-2.5 pt-0.5">
                    <input
                      id="auth-remember"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer shrink-0"
                    />
                    <label
                      htmlFor="auth-remember"
                      className="text-xs text-slate-600 leading-snug cursor-pointer select-none"
                    >
                      <span className="font-medium text-slate-800">Remember me</span> — Keep me signed in for 30 days (otherwise expires after 24 hours).
                    </label>
                  </div>
                )}

                {mode === 'register' && (
                  <div className="flex items-start gap-2.5 pt-0.5">
                    <input
                      id="auth-terms"
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => {
                        setTermsAccepted(e.target.checked);
                        if (e.target.checked && error?.includes('Terms')) {
                          setError(null);
                        }
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer shrink-0"
                    />
                    <label htmlFor="auth-terms" className="text-xs text-slate-600 leading-snug cursor-pointer">
                      I agree to the{' '}
                      <button
                        type="button"
                        onClick={() => setTermsModalOpen(true)}
                        className="font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-2 cursor-pointer"
                      >
                        Terms &amp; Conditions
                      </button>{' '}
                      for medication tracking, OCR verification, and workspace security.
                    </label>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading || checkingCredentials}
                  data-testid="auth-submit-button"
                  className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                    selectedPortal === 'pharmacy' && mode === 'login'
                      ? 'bg-blue-700 hover:bg-blue-800'
                      : selectedPortal === 'admin' && mode === 'login'
                      ? 'bg-slate-800 hover:bg-slate-900'
                      : 'bg-teal-700 hover:bg-teal-800'
                  }`}
                >
                  {loading || checkingCredentials ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {loading
                      ? 'Authenticating...'
                      : mode === 'login' && checkingCredentials
                      ? 'Loading account...'
                      : mode === 'login' && verifiedPreview
                      ? `Sign In To ${verifiedPreview.fullName}`
                      : mode === 'login'
                      ? 'Sign In to Workspace'
                      : 'Create Account'}
                  </span>
                  {!loading && !checkingCredentials && <ArrowRight className="w-4 h-4 shrink-0" />}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>VeroMed · Smart Medicine &amp; Healthcare Assistance System</span>
          <span>Role-Isolated Healthcare Workspace · Non-Diagnostic Support Platform</span>
        </div>
      </footer>

      {termsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 text-teal-700 shrink-0">
                  <FileText className="w-4 h-4" />
                </span>
                <div>
                  <h3 id="terms-modal-title" className="font-display text-base font-bold text-slate-900">
                    VeroMed Terms &amp; Conditions
                  </h3>
                  <p className="text-xs text-slate-500">Effective Platform Policy · Updated 2026</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close Terms and Conditions"
                onClick={() => setTermsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto space-y-4 text-sm text-slate-600 leading-relaxed">
              <section>
                <h4 className="font-display font-semibold text-slate-900 mb-1">
                  1. Informational Support &amp; Clinical Disclaimer
                </h4>
                <p>
                  VeroMed provides medication schedule tracking, document organization, adherence analytics, and pharmacy stock coordination. It is not a diagnostic system and does not replace consultation with a licensed physician or pharmacist.
                </p>
              </section>

              <section>
                <h4 className="font-display font-semibold text-slate-900 mb-1">
                  2. Prescription OCR &amp; Human Review Gate
                </h4>
                <p>
                  Uploaded prescription images and camera captures produce unverified drafts extracted by AI. You must verify medicine names, strengths, dosages, and schedules against the original paper prescription before activating any reminder.
                </p>
              </section>

              <section>
                <h4 className="font-display font-semibold text-slate-900 mb-1">
                  3. Account Security &amp; Session Lifecycle
                </h4>
                <p>
                  Standard sign-in sessions expire after 24 hours unless you explicitly select Remember me (which extends your session to 30 days). You are responsible for safeguarding credentials and signing out on shared devices.
                </p>
              </section>

              <section>
                <h4 className="font-display font-semibold text-slate-900 mb-1">
                  4. Tenant &amp; Caregiver Consent Isolation
                </h4>
                <p>
                  Patient health records and pharmacy batch ledgers remain strictly separated by role and tenant boundaries. Caregivers access only the scopes explicitly approved by the linked patient and may have access revoked at any time.
                </p>
              </section>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setTermsModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setTermsAccepted(true);
                  setTermsModalOpen(false);
                  if (error?.includes('Terms')) {
                    setError(null);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Accept Terms &amp; Conditions</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
