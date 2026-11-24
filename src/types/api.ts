import { isSessionExpired } from '../lib/session';

export type UserRole = 'patient' | 'caregiver' | 'pharmacist' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  pharmacyId?: string | null;
}

export interface SessionInfo {
  expiresAt: string;
  createdAt?: string;
  rememberMe?: boolean;
  durationDays: number;
  durationHours?: number;
  remainingDays?: number;
  remainingHours?: number;
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

const SESSION_STORAGE_KEY = 'veromed_session_v1';

interface StoredSession {
  token: string;
  expiresAt: string | null;
  rememberMe?: boolean;
}

let inMemorySession: StoredSession | null = null;
let unauthorizedHandler: ((reason?: string) => void) | null = null;

function readSessionFromStorage(): StoredSession | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return inMemorySession;
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.token) return null;
    if (parsed.expiresAt && isSessionExpired(parsed.expiresAt)) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt ?? null,
      rememberMe: Boolean(parsed.rememberMe),
    };
  } catch {
    return inMemorySession;
  }
}

export function setAuthToken(
  token: string | null,
  expiresAt?: string | null,
  rememberMe?: boolean
): void {
  if (!token) {
    inMemorySession = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage access errors
    }
    return;
  }

  inMemorySession = {
    token,
    expiresAt: expiresAt ?? null,
    rememberMe: Boolean(rememberMe),
  };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(inMemorySession));
    }
  } catch {
    // Ignore storage quota/access errors
  }
}

export function getAuthToken(): string | null {
  if (!inMemorySession) {
    inMemorySession = readSessionFromStorage();
  }
  if (inMemorySession?.expiresAt && isSessionExpired(inMemorySession.expiresAt)) {
    setAuthToken(null);
    return null;
  }
  return inMemorySession?.token ?? null;
}

export function getStoredSessionExpiry(): string | null {
  if (!inMemorySession) {
    inMemorySession = readSessionFromStorage();
  }
  return inMemorySession?.expiresAt ?? null;
}

export function getStoredRememberMe(): boolean {
  if (!inMemorySession) {
    inMemorySession = readSessionFromStorage();
  }
  return Boolean(inMemorySession?.rememberMe);
}

export function setUnauthorizedHandler(handler: ((reason?: string) => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1${path}`, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    const code =
      typeof data === 'object' && data !== null && 'code' in data
        ? String((data as { code: unknown }).code)
        : undefined;

    if (
      res.status === 401 &&
      token &&
      path !== '/auth/login' &&
      path !== '/auth/register'
    ) {
      setAuthToken(null);
      unauthorizedHandler?.(message);
    }

    const err = new Error(message) as ApiError;
    err.status = res.status;
    err.code = code;
    throw err;
  }

  return data as T;
}
