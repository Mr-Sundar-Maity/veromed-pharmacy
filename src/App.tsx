/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  AppShell,
  getAdminNavItems,
  getPatientNavItems,
  getPharmacyNavItems,
} from './components/AppShell';
import { PortalGateway } from './components/PortalGateway';
import { PatientDashboard } from './components/patient/PatientDashboard';
import { MedicinesView } from './components/patient/MedicinesView';
import { PrescriptionsOcrView } from './components/patient/PrescriptionsOcrView';
import { RecordsAppointmentsView } from './components/patient/RecordsAppointmentsView';
import { InteractionsCaregiverView } from './components/patient/InteractionsCaregiverView';
import { PharmacyLocatorView } from './components/patient/PharmacyLocatorView';
import { PatientAnalyticsView } from './components/patient/PatientAnalyticsView';
import { PharmacyOverview } from './components/pharmacy/PharmacyOverview';
import { PharmacyInventoryView } from './components/pharmacy/PharmacyInventoryView';
import { PharmacyTransactionsView } from './components/pharmacy/PharmacyTransactionsView';
import { PharmacyAnalyticsView } from './components/pharmacy/PharmacyAnalyticsView';
import { AdminConsoleView } from './components/admin/AdminConsoleView';
import { isSessionExpired } from './lib/session';
import {
  apiFetch,
  type AuthUser,
  getAuthToken,
  getStoredRememberMe,
  getStoredSessionExpiry,
  type SessionInfo,
  setAuthToken,
  setUnauthorizedHandler,
} from './types/api';

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [sessionRememberMe, setSessionRememberMe] = useState<boolean>(() => getStoredRememberMe());
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState<boolean>(() => Boolean(getAuthToken()));
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [openRxCameraOnNav, setOpenRxCameraOnNav] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [caregiverPatientId, setCaregiverPatientId] = useState<string>('me');

  async function loadNotifications() {
    try {
      const res = await apiFetch<{ notifications: NotificationRow[] }>('/notifications');
      setNotifications(res.notifications);
    } catch {
      // Ignore transient notification fetch issues
    }
  }

  function handleAuthenticated(authedUser: AuthUser, expiresAt?: string, rememberMe?: boolean) {
    setSessionNotice(null);
    setUser(authedUser);
    setSessionExpiresAt(expiresAt ?? getStoredSessionExpiry());
    setSessionRememberMe(rememberMe !== undefined ? rememberMe : getStoredRememberMe());
    if (authedUser.role === 'pharmacist') {
      setActiveTab('pharma-overview');
    } else if (authedUser.role === 'admin') {
      setActiveTab('admin-audit');
    } else {
      setActiveTab('dashboard');
    }

    if (authedUser.role === 'caregiver') {
      apiFetch<{ linkedPatients: Array<{ patient_id: string }> }>('/patients/me')
        .then((res) => {
          if (res.linkedPatients?.[0]) {
            setCaregiverPatientId(res.linkedPatients[0].patient_id);
          }
        })
        .catch(() => {});
    } else {
      setCaregiverPatientId('me');
    }

    void loadNotifications();
  }

  useEffect(() => {
    setUnauthorizedHandler((reason) => {
      const wasRemembered = getStoredRememberMe();
      setUser(null);
      setSessionExpiresAt(null);
      setSessionRememberMe(false);
      setNotifications([]);
      setSessionNotice(
        reason ||
          (wasRemembered
            ? 'Your 30-day session has expired. Please sign in again to continue.'
            : 'Your 24-hour session has expired. Please sign in again to continue.')
      );
    });

    const existingToken = getAuthToken();
    if (!existingToken) {
      setRestoringSession(false);
      return;
    }

    apiFetch<{ user: AuthUser; session?: SessionInfo }>('/auth/me')
      .then((res) => {
        const nextRemember = Boolean(res.session?.rememberMe);
        if (res.session?.expiresAt) {
          setAuthToken(existingToken, res.session.expiresAt, nextRemember);
        }
        handleAuthenticated(res.user, res.session?.expiresAt, nextRemember);
      })
      .catch(() => {
        setAuthToken(null);
      })
      .finally(() => {
        setRestoringSession(false);
      });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!user || !sessionExpiresAt) return;
    const checkExpiry = () => {
      if (isSessionExpired(sessionExpiresAt)) {
        setAuthToken(null);
        setUser(null);
        setSessionExpiresAt(null);
        setNotifications([]);
        setSessionNotice(
          sessionRememberMe
            ? 'Your 30-day session has expired. Please sign in again to continue.'
            : 'Your 24-hour session has expired. Please sign in again to continue.'
        );
      }
    };
    const timer = window.setInterval(checkExpiry, 60_000);
    window.addEventListener('focus', checkExpiry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkExpiry);
    };
  }, [user, sessionExpiresAt, sessionRememberMe]);

  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session regardless
    }
    setAuthToken(null);
    setUser(null);
    setSessionExpiresAt(null);
    setSessionRememberMe(false);
    setSessionNotice(null);
    setNotifications([]);
  }

  async function handleMarkNotificationRead(id: string) {
    try {
      await apiFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      await loadNotifications();
    } catch {
      // Ignore
    }
  }

  async function handleRunScheduler() {
    try {
      await apiFetch('/notifications/run-scheduler', { method: 'POST' });
      await loadNotifications();
    } catch {
      // Ignore
    }
  }

  if (restoringSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 text-sm text-slate-600">
          Restoring your workspace session...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <PortalGateway
        onAuthenticated={handleAuthenticated}
        sessionNotice={sessionNotice}
      />
    );
  }

  const isPharmacy = user.role === 'pharmacist';
  const isAdmin = user.role === 'admin';
  const isCaregiver = user.role === 'caregiver';

  const navItems = isPharmacy
    ? getPharmacyNavItems()
    : isAdmin
    ? getAdminNavItems()
    : getPatientNavItems(isCaregiver);

  const platformTitle = isPharmacy
    ? 'Pharmacy Management Platform'
    : isAdmin
    ? 'Administration & Audit'
    : isCaregiver
    ? 'Caregiver Shared Portal'
    : 'Patient Healthcare Platform';

  const accent = isPharmacy ? 'blue' : isAdmin ? 'slate' : 'teal';

  return (
    <AppShell
      user={user}
      sessionExpiresAt={sessionExpiresAt}
      sessionRememberMe={sessionRememberMe}
      platformTitle={platformTitle}
      accent={accent}
      navItems={navItems}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      onLogout={() => void handleLogout()}
      notifications={notifications}
      onMarkNotificationRead={(id) => void handleMarkNotificationRead(id)}
      onRunScheduler={() => void handleRunScheduler()}
    >
      {/* Patient & Caregiver Platform Views */}
      {!isPharmacy && !isAdmin && (
        <>
          {activeTab === 'dashboard' && (
            <PatientDashboard
              patientId={caregiverPatientId}
              isCaregiver={isCaregiver}
              onNavigate={setActiveTab}
              onOpenRxCamera={() => {
                setOpenRxCameraOnNav(true);
                setActiveTab('prescriptions');
              }}
            />
          )}
          {activeTab === 'medicines' && (
            <MedicinesView patientId={caregiverPatientId} isCaregiver={isCaregiver} />
          )}
          {activeTab === 'pharmacy-locator' && (
            <PharmacyLocatorView
              patientId={caregiverPatientId}
              isCaregiver={isCaregiver}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'prescriptions' && !isCaregiver && (
            <PrescriptionsOcrView
              onScheduleActivated={() => void loadNotifications()}
              autoOpenCamera={openRxCameraOnNav}
              onCameraHandled={() => setOpenRxCameraOnNav(false)}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'records' && (
            <RecordsAppointmentsView patientId={caregiverPatientId} isCaregiver={isCaregiver} />
          )}
          {activeTab === 'interactions' && (
            <InteractionsCaregiverView
              patientId={caregiverPatientId}
              isCaregiver={isCaregiver}
            />
          )}
          {activeTab === 'analytics' && (
            <PatientAnalyticsView patientId={caregiverPatientId} />
          )}
        </>
      )}

      {/* Pharmacy Management Platform Views */}
      {isPharmacy && (
        <>
          {activeTab === 'pharma-overview' && <PharmacyOverview onNavigate={setActiveTab} />}
          {activeTab === 'pharma-inventory' && <PharmacyInventoryView />}
          {activeTab === 'pharma-transactions' && <PharmacyTransactionsView />}
          {activeTab === 'pharma-analytics' && <PharmacyAnalyticsView />}
        </>
      )}

      {/* Admin Governance Views */}
      {isAdmin && <AdminConsoleView activeTab={activeTab} />}
    </AppShell>
  );
}
