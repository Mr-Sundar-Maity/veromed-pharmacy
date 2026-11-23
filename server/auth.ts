import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import {
  computeSessionExpiry,
  getSessionDurationHours,
  isSessionExpired,
  SESSION_DURATION_DAYS,
} from '../src/lib/session';

export type UserRole = 'patient' | 'caregiver' | 'pharmacist' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  pharmacyId?: string | null;
}

export interface SessionMetadata {
  expiresAt: string;
  createdAt: string;
  rememberMe: boolean;
  durationDays: number;
  durationHours: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  session?: SessionMetadata;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(
  userId: string,
  rememberMe: boolean = false
): {
  token: string;
  expiresAt: string;
  rememberMe: boolean;
  durationDays: number;
  durationHours: number;
} {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const nowMs = Date.now();
  const expiresAt = computeSessionExpiry(nowMs, rememberMe);
  const now = new Date(nowMs).toISOString();
  const durationHours = getSessionDurationHours(rememberMe);
  const durationDays = rememberMe ? SESSION_DURATION_DAYS : 1;

  // Prune expired sessions and persist the new 24-hour or 30-day session
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, remember_me) VALUES (?, ?, ?, ?, ?)'
  ).run(tokenHash, userId, expiresAt, now, rememberMe ? 1 : 0);

  return { token, expiresAt, rememberMe, durationDays, durationHours };
}

export function revokeSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function logAudit(
  actor: Partial<AuthUser> | null,
  action: string,
  resource: string,
  outcome: 'success' | 'denied' | 'error',
  metadata?: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_email, actor_role, action, resource, outcome, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `aud-${crypto.randomUUID()}`,
    actor?.id ?? null,
    actor?.email ?? null,
    actor?.role ?? null,
    action,
    resource,
    outcome,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString()
  );
}

export function authenticateRequest(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Invalid authorization header.' });
    return;
  }

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.status, s.expires_at, s.created_at, s.remember_me, pm.pharmacy_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN pharmacy_members pm ON pm.user_id = u.id AND pm.status = 'active'
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        id: string;
        email: string;
        full_name: string;
        role: UserRole;
        status: string;
        expires_at: string;
        created_at: string;
        remember_me: number;
        pharmacy_id: string | null;
      }
    | undefined;

  if (!row || row.status !== 'active') {
    res.status(401).json({ error: 'Session invalid. Please sign in again.', code: 'SESSION_INVALID' });
    return;
  }

  const rememberMe = Boolean(row.remember_me);

  if (isSessionExpired(row.expires_at)) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    logAudit(
      { id: row.id, email: row.email, role: row.role },
      'auth.session_expired',
      'session',
      'denied',
      { expiredAt: row.expires_at, rememberMe }
    );
    res.status(401).json({
      error: rememberMe
        ? `Your ${SESSION_DURATION_DAYS}-day session has expired. Please sign in again.`
        : 'Your 24-hour session has expired. Please sign in again.',
      code: 'SESSION_EXPIRED',
    });
    return;
  }

  req.user = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    pharmacyId: row.pharmacy_id,
  };
  req.session = {
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    rememberMe,
    durationDays: rememberMe ? SESSION_DURATION_DAYS : 1,
    durationHours: getSessionDurationHours(rememberMe),
  };
  next();
}

export type CaregiverPermissionKey =
  | 'schedules'
  | 'dose_history'
  | 'appointments'
  | 'documents'
  | 'medical_history'
  | 'emergency_info';

/**
 * Resolves the authorized target patient ID for a request.
 * - Patients may only access their own patientId.
 * - Caregivers may access a linked patientId ONLY if consent_status = 'active' AND the specific permission is true.
 * - Pharmacists cannot access patient clinical records unless explicitly permitted (denied here).
 */
export function resolveAuthorizedPatientId(
  user: AuthUser,
  requestedPatientId: string | undefined,
  requiredPermission: CaregiverPermissionKey
): { ok: true; patientId: string; isCaregiver: boolean } | { ok: false; status: number; error: string } {
  if (user.role === 'patient') {
    if (requestedPatientId && requestedPatientId !== user.id && requestedPatientId !== 'me') {
      logAudit(user, 'access.patient_record', `patient:${requestedPatientId}`, 'denied', {
        reason: 'cross_patient_access',
      });
      return { ok: false, status: 403, error: 'Cross-patient access is denied.' };
    }
    return { ok: true, patientId: user.id, isCaregiver: false };
  }

  if (user.role === 'caregiver') {
    const targetId = requestedPatientId && requestedPatientId !== 'me' ? requestedPatientId : undefined;
    const rel = targetId
      ? (db
          .prepare(
            `SELECT patient_id, consent_status, permissions_json FROM caregiver_relationships
             WHERE caregiver_user_id = ? AND patient_id = ?`
          )
          .get(user.id, targetId) as
          | { patient_id: string; consent_status: string; permissions_json: string }
          | undefined)
      : (db
          .prepare(
            `SELECT patient_id, consent_status, permissions_json FROM caregiver_relationships
             WHERE caregiver_user_id = ? AND consent_status = 'active' LIMIT 1`
          )
          .get(user.id) as
          | { patient_id: string; consent_status: string; permissions_json: string }
          | undefined);

    if (!rel || rel.consent_status !== 'active') {
      logAudit(user, 'access.caregiver_record', `patient:${targetId ?? 'unknown'}`, 'denied', {
        reason: 'no_active_consent',
      });
      return {
        ok: false,
        status: 403,
        error: 'Caregiver access has not been granted or has been revoked by the patient.',
      };
    }

    const perms = JSON.parse(rel.permissions_json) as Record<string, boolean>;
    if (!perms[requiredPermission]) {
      logAudit(user, 'access.caregiver_record', `patient:${rel.patient_id}:${requiredPermission}`, 'denied', {
        reason: 'granular_permission_denied',
      });
      return {
        ok: false,
        status: 403,
        error: `Patient has not granted "${requiredPermission.replace('_', ' ')}" permission to this caregiver.`,
      };
    }

    return { ok: true, patientId: rel.patient_id, isCaregiver: true };
  }

  logAudit(user, 'access.patient_record', `patient:${requestedPatientId ?? 'me'}`, 'denied', {
    reason: 'role_not_authorized',
  });
  return { ok: false, status: 403, error: 'Current role is not authorized for patient clinical records.' };
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      logAudit(req.user ?? null, 'access.role_check', req.originalUrl, 'denied', {
        requiredRoles: roles,
      });
      res.status(403).json({ error: 'Insufficient role permissions for this resource.' });
      return;
    }
    next();
  };
}

// Simple in-memory sliding-window rate limiter for auth, upload, and AI routes
const rateBuckets = new Map<string, number[]>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const actorKey = `${keyPrefix}:${req.user?.id ?? req.ip ?? 'anon'}`;
    const now = Date.now();
    const history = (rateBuckets.get(actorKey) ?? []).filter((ts) => now - ts < windowMs);
    if (history.length >= maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait briefly before retrying.',
      });
      return;
    }
    history.push(now);
    rateBuckets.set(actorKey, history);
    next();
  };
}
