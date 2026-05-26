import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { env } from '../../config/env';
import { UnauthorizedError, NotFoundError } from '../../utils/errors';
import { sha256 } from '../../utils/crypto';

export class AdminAuthService {
  /**
   * Admin login with email + password (separate from user OTP flow).
   * Admin accounts are created manually in the admin_users table.
   */
  async login(email: string, password: string, ip: string, userAgent: string) {
    const { data: admin, error } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !admin) throw new UnauthorizedError('Invalid credentials');

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) throw new UnauthorizedError('Invalid credentials');

    // Issue admin-scoped JWT (isAdmin: true distinguishes from user tokens)
    const accessToken = jwt.sign(
      { sub: admin.id, email: admin.email, role: admin.role, isAdmin: true },
      env.JWT_SECRET,
      { expiresIn: '8h' as any }
    );

    const refreshToken = jwt.sign(
      { sub: admin.id, email: admin.email, role: admin.role, isAdmin: true },
      env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' as any }
    );

    // Store session
    await supabaseAdmin.from('admin_sessions').insert({
      id: uuidv4(),
      admin_id: admin.id,
      token_hash: sha256(refreshToken),
      ip_address: ip,
      user_agent: userAgent,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    // Update last login
    await supabaseAdmin
      .from('admin_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', admin.id);

    return {
      accessToken,
      refreshToken,
      admin: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role },
    };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; role: string; isAdmin: boolean };
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as typeof payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (!payload.isAdmin) throw new UnauthorizedError('Not an admin token');

    const { data: session } = await supabaseAdmin
      .from('admin_sessions')
      .select('expires_at')
      .eq('token_hash', sha256(refreshToken))
      .eq('admin_id', payload.sub)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedError('Session expired');
    }

    const accessToken = jwt.sign(
      { sub: payload.sub, email: payload.email, role: payload.role, isAdmin: true },
      env.JWT_SECRET,
      { expiresIn: '8h' as any }
    );
    return { accessToken };
  }

  async logout(adminId: string, refreshToken: string) {
    await supabaseAdmin
      .from('admin_sessions')
      .delete()
      .eq('token_hash', sha256(refreshToken))
      .eq('admin_id', adminId);
  }

  /** Create new admin — password hashed with bcrypt. Super admin only. */
  async createAdmin(payload: {
    email: string;
    password: string;
    full_name: string;
    role: string;
  }) {
    const hash = await bcrypt.hash(payload.password, 12);
    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .insert({
        id: uuidv4(),
        email: payload.email.toLowerCase(),
        password_hash: hash,
        full_name: payload.full_name,
        role: payload.role,
        is_active: true,
      })
      .select('id, email, full_name, role, created_at')
      .single();

    if (error) throw error;
    return data;
  }
}