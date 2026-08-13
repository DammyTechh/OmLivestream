// =====================================================================
// OmliveStream — Complete Supabase Database Types (all migrations)
// =====================================================================

export type Platform       = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'twitch' | 'twitter' | 'linkedin' | 'kick';
export type Plan           = 'free_trial' | 'free' | 'premium';
export type StreamStatus   = 'scheduled' | 'live' | 'ended';
export type RecordingStatus = 'processing' | 'ready' | 'failed';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due';
export type OtpType        = 'register' | 'login' | 'reset';
export type EditType       = 'manual' | 'ai';
export type EditStatus     = 'pending' | 'processing' | 'done' | 'failed';
export type PublishStatus  = 'pending' | 'published' | 'failed';
export type PlatformStatus = 'connected' | 'error' | 'disconnected';
export type RtmpPushStatus = 'pending' | 'active' | 'failed' | 'ended';
export type BillingCycle   = 'monthly' | 'annual';
export type InvoiceStatus  = 'paid' | 'pending' | 'failed';
export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';
export type StreamQuality  = '480p' | '720p' | '1080p';
export type AdminRole      = 'super_admin' | 'admin' | 'support';
export type UserStatus     = 'active' | 'flagged' | 'suspended' | 'banned';
export type LoginRisk      = 'low' | 'medium' | 'high';
export type BroadcastSegment = 'all' | 'free_trial' | 'free' | 'premium' | 'waitlist_members' | 'inactive';
export type BroadcastStatus  = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
export type DeliveryStatus   = 'pending' | 'sent' | 'failed' | 'skipped';
export type DiscountType     = 'first_month_free' | 'six_month_pct';
export type ContactStatus    = 'unread' | 'read' | 'replied';

type TableDef<Row extends Record<string, unknown>> = {
  Row:    Row;
  Insert: Partial<Row> & Pick<Row, { [K in keyof Row]-?: undefined extends Row[K] ? never : K }[keyof Row]>;
  Update: Partial<Row>;
};

export interface Database {
  public: {
    PostgrestVersion: "12";
    Tables: {

      // ── users ──────────────────────────────────────────────────
      users: {
        Row: {
          id:                      string;
          email:                   string;
          full_name:               string | null;
          dob:                     string | null;
          location:                string | null;
          avatar_url:              string | null;
          plan:                    Plan;
          status:                  UserStatus;
          is_verified:             boolean;
          trial_started_at:        string | null;
          trial_expires_at:        string | null;
          waitlist_member:         boolean;
          waitlist_reward_claimed: boolean;
          last_stream_ended_at:    string | null;
          re_engagement_sent_at:   string | null;
          birthday_wished_at:      string | null;
          tour_views:              number;
          created_at:              string;
          updated_at:              string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at' | 'updated_at' | 'tour_views'> & { created_at?: string; updated_at?: string; tour_views?: number };
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };

      // ── sessions ───────────────────────────────────────────────
      sessions: {
        Row: {
          id:           string;
          user_id:      string;
          token_hash:   string;
          ip_address:   string | null;
          user_agent:   string | null;
          last_seen_at: string;
          expires_at:   string;
          created_at:   string;
        };
        Insert: Omit<Database['public']['Tables']['sessions']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['sessions']['Insert']>;
      };

      // ── otp_codes ──────────────────────────────────────────────
      otp_codes: {
        Row: {
          id:         string;
          user_id:    string;
          code_hash:  string;
          type:       OtpType;
          attempts:   number;
          expires_at: string;
          used_at:    string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['otp_codes']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['otp_codes']['Insert']>;
      };

      // ── onboarding_responses ───────────────────────────────────
      onboarding_responses: {
        Row: { user_id: string; heard_from: string[]; use_case: string[]; completed_at: string };
        Insert: Database['public']['Tables']['onboarding_responses']['Row'];
        Update: Partial<Database['public']['Tables']['onboarding_responses']['Row']>;
      };

      // ── platform_connections ───────────────────────────────────
      platform_connections: {
        Row: {
          id:                      string;
          user_id:                 string;
          platform:                Platform;
          access_token_encrypted:  string | null;
          refresh_token_encrypted: string | null;
          rtmp_url:                string | null;
          stream_key_encrypted:    string | null;
          platform_user_id:        string | null;
          platform_username:       string | null;
          status:                  PlatformStatus;
          connected_at:            string;
          updated_at:              string;
        };
        Insert: Omit<Database['public']['Tables']['platform_connections']['Row'], 'connected_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['platform_connections']['Insert']>;
      };

      // ── streams ────────────────────────────────────────────────
      streams: {
        Row: {
          id:                  string;
          user_id:             string;
          title:               string;
          description:         string | null;
          thumbnail_url:       string | null;
          status:              StreamStatus;
          mediasoup_router_id: string | null;
          started_at:          string | null;
          ended_at:            string | null;
          created_at:          string;
        };
        Insert: Omit<Database['public']['Tables']['streams']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['streams']['Insert']>;
      };

      // ── stream_platforms ───────────────────────────────────────
      stream_platforms: {
        Row: {
          id:               string;
          stream_id:        string;
          platform:         Platform;
          rtmp_push_status: RtmpPushStatus;
          viewers_peak:     number;
          impressions:      number;
          total_comments:   number;
          created_at:       string;
        };
        Insert: Omit<Database['public']['Tables']['stream_platforms']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['stream_platforms']['Insert']>;
      };

      // ── recordings ─────────────────────────────────────────────
      recordings: {
        Row: {
          id:               string;
          stream_id:        string;
          user_id:          string;
          file_url:         string | null;
          duration_seconds: number | null;
          size_bytes:       number | null;
          quality:          StreamQuality | null;
          status:           RecordingStatus;
          created_at:       string;
          updated_at:       string;
        };
        Insert: Omit<Database['public']['Tables']['recordings']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['recordings']['Insert']>;
      };

      // ── stream_metrics ─────────────────────────────────────────
      stream_metrics: {
        Row: { id: string; stream_id: string; platform: Platform; timestamp: string; viewers: number; impressions: number; comments_count: number; bitrate_kbps: number };
        Insert: Omit<Database['public']['Tables']['stream_metrics']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['stream_metrics']['Insert']>;
      };

      // ── platform_analytics ─────────────────────────────────────
      platform_analytics: {
        Row: { id: string; user_id: string; platform: Platform; period: AnalyticsPeriod; total_views: number; total_impressions: number; total_engagement: number; recorded_at: string };
        Insert: Omit<Database['public']['Tables']['platform_analytics']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['platform_analytics']['Insert']>;
      };

      // ── video_edits ────────────────────────────────────────────
      video_edits: {
        Row: { id: string; recording_id: string; user_id: string; edit_type: EditType; ai_prompt: string | null; status: EditStatus; output_url: string | null; created_at: string; updated_at: string };
        Insert: Omit<Database['public']['Tables']['video_edits']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['video_edits']['Insert']>;
      };

      // ── video_publishes ────────────────────────────────────────
      video_publishes: {
        Row: { id: string; recording_id: string; user_id: string; platform: Platform; caption: string | null; status: PublishStatus; scheduled_at: string | null; published_at: string | null };
        Insert: Database['public']['Tables']['video_publishes']['Row'];
        Update: Partial<Database['public']['Tables']['video_publishes']['Row']>;
      };

      // ── subscriptions ──────────────────────────────────────────
      subscriptions: {
        Row: {
          id:                         string;
          user_id:                    string;
          plan:                       Plan;
          billing_cycle:              BillingCycle;
          status:                     SubscriptionStatus;
          paystack_subscription_code: string | null;
          paystack_customer_code:     string | null;
          current_period_start:       string;
          current_period_end:         string;
          created_at:                 string;
          updated_at:                 string;
          /** Billing cycles still owed the waitlist discount — decremented per charge (v10). */
          discount_cycles_remaining:  number;
          discount_pct:               number | null;
          discount_code:              string | null;
        };
        Insert: Omit<Database['public']['Tables']['subscriptions']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['subscriptions']['Insert']>;
      };

      // ── invoices ───────────────────────────────────────────────
      invoices: {
        Row: { id: string; user_id: string; subscription_id: string | null; amount: number; currency: string; status: InvoiceStatus; paystack_reference: string | null; receipt_url: string | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['invoices']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>;
      };

      // ── feedback ───────────────────────────────────────────────
      feedback: {
        Row: { id: string; user_id: string; message: string; rating: 1 | 2 | 3 | 4 | 5; created_at: string };
        Insert: Omit<Database['public']['Tables']['feedback']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['feedback']['Insert']>;
      };

      // ── feature_updates ────────────────────────────────────────
      feature_updates: {
        Row: { id: string; title: string; description: string; published_at: string; notify_users: boolean };
        Insert: Database['public']['Tables']['feature_updates']['Row'];
        Update: Partial<Database['public']['Tables']['feature_updates']['Row']>;
      };

      // ── user_feature_reads ─────────────────────────────────────
      user_feature_reads: {
        Row: { user_id: string; feature_update_id: string; read_at: string };
        Insert: Database['public']['Tables']['user_feature_reads']['Row'];
        Update: Partial<Database['public']['Tables']['user_feature_reads']['Row']>;
      };

      // ── login_logs (v2) ────────────────────────────────────────
      login_logs: {
        Row: {
          id:                 string;
          user_id:            string;
          ip_address:         string;
          user_agent:         string;
          device_fingerprint: string | null;
          country:            string | null;
          city:               string | null;
          is_new_device:      boolean;
          risk_level:         LoginRisk;
          created_at:         string;
        };
        Insert: Omit<Database['public']['Tables']['login_logs']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['login_logs']['Insert']>;
      };

      // ── admin_users (v2) ───────────────────────────────────────
      admin_users: {
        Row: {
          id:            string;
          email:         string;
          password_hash: string;
          full_name:     string;
          role:          AdminRole;
          is_active:     boolean;
          last_login_at: string | null;
          created_at:    string;
          updated_at:    string;
        };
        Insert: Omit<Database['public']['Tables']['admin_users']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['admin_users']['Insert']>;
      };

      // ── admin_sessions (v2) ────────────────────────────────────
      admin_sessions: {
        Row: { id: string; admin_id: string; token_hash: string; ip_address: string | null; user_agent: string | null; expires_at: string; created_at: string };
        Insert: Omit<Database['public']['Tables']['admin_sessions']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['admin_sessions']['Insert']>;
      };

      // ── admin_audit_logs (v2) ──────────────────────────────────
      admin_audit_logs: {
        Row: { id: string; admin_id: string; action: string; target_user_id: string | null; notes: string | null; metadata: Record<string, unknown> | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['admin_audit_logs']['Row'], 'id'>;
        Update: Partial<Database['public']['Tables']['admin_audit_logs']['Insert']>;
      };

      // ── waitlist (v3) ──────────────────────────────────────────
      waitlist: {
        Row: {
          id:                string;
          email:             string;
          source:            string | null;
          converted_user_id: string | null;
          reward_granted:    boolean;
          reward_granted_at: string | null;
          ip_address:        string | null;
          metadata:          Record<string, unknown> | null;
          created_at:        string;
        };
        Insert: Omit<Database['public']['Tables']['waitlist']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['waitlist']['Insert']>;
      };

      // ── discount_codes (v3) ────────────────────────────────────
      discount_codes: {
        Row: {
          id:            string;
          code:          string;
          user_id:       string | null;
          waitlist_id:   string | null;
          discount_type: DiscountType;
          discount_pct:  number | null;
          free_months:   number | null;
          is_used:       boolean;
          used_at:       string | null;
          expires_at:    string;
          created_at:    string;
          /** Paystack reference that consumed this code — makes redemption idempotent (v10). */
          redeemed_by_reference: string | null;
        };
        Insert: Omit<Database['public']['Tables']['discount_codes']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['discount_codes']['Insert']>;
      };

      // ── plan_limits (v3) ───────────────────────────────────────
      plan_limits: {
        Row: { plan: string; max_stream_platforms: number; can_reply_comments: boolean; max_streams_per_day: number; recording_days: number; show_upgrade_popup: boolean; label: string; description: string };
        Insert: Database['public']['Tables']['plan_limits']['Row'];
        Update: Partial<Database['public']['Tables']['plan_limits']['Row']>;
      };


      admin_broadcasts: {
        Row: {
          id:               string;
          admin_id:         string;
          subject:          string;
          body_html:        string;
          body_text:        string | null;
          preview_text:     string | null;
          internal_notes:   string | null;
          segment:          BroadcastSegment;
          status:           BroadcastStatus;
          scheduled_at:     string | null;
          sent_at:          string | null;
          recipient_count:  number;
          sent_count:       number;
          failed_count:     number;
          tags:             string[];
          created_at:       string;
          updated_at:       string;
        };
        Insert: Omit<Database['public']['Tables']['admin_broadcasts']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['admin_broadcasts']['Insert']>;
      };

      broadcast_logs: {
        Row: { id: string; broadcast_id: string; user_id: string; email: string; status: DeliveryStatus; error: string | null; sent_at: string | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['broadcast_logs']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['broadcast_logs']['Insert']>;
      };

      contact_submissions: {
        Row: {
          id:         string;
          name:       string;
          email:      string;
          message:    string;
          status:     ContactStatus;
          ip_address: string | null;
          read_at:    string | null;
          replied_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['contact_submissions']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['contact_submissions']['Insert']>;
      };
    };
  };
}


export interface JwtPayload {
  sub:   string;
  email: string;
  plan:  Plan;
  iat:   number;
  exp:   number;
}

export interface TokenPair {
  accessToken:  string;
  refreshToken: string;
}

export interface AuthUser {
  id:    string;
  email: string;
  plan:  Plan;
}