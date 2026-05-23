'use client';
import { useEffect, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { User as UserIcon, Save, Upload, Sparkles, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, getApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';

const HEARD_FROM = [
  { value: 'social_media',     label: 'Social Media'    },
  { value: 'friend_referral',  label: 'A Friend'        },
  { value: 'google_search',    label: 'Google Search'   },
  { value: 'content_creator',  label: 'Content Creator' },
  { value: 'youtube_ad',       label: 'YouTube Ad'      },
  { value: 'other',            label: 'Other'           },
];

const USE_CASES = [
  { value: 'entertainment',      label: 'Entertainment'       },
  { value: 'gaming',             label: 'Gaming'              },
  { value: 'music_performance',  label: 'Music & DJ Sets'     },
  { value: 'education',          label: 'Tutorials & Courses' },
  { value: 'business_brand',     label: 'Business / Brand'    },
  { value: 'fitness_wellness',   label: 'Fitness & Wellness'  },
  { value: 'events_concerts',    label: 'Events & Concerts'   },
  { value: 'news_commentary',    label: 'News & Commentary'   },
];

export default function SettingsPage() {
  const { user, refreshProfile } = useAuth();
  const [profile, setProfile] = useState({
    full_name: '',
    dob: '',
    location: '',
    avatar_url: '',
  });
  const [heardFrom, setHeardFrom] = useState<string[]>([]);
  const [useCase, setUseCase] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/users/onboarding/status');
        const data = res.data?.data;
        if (data?.profile) {
          setProfile({
            full_name:  data.profile.full_name ?? '',
            dob:        data.profile.dob ?? '',
            location:   data.profile.location ?? '',
            avatar_url: data.profile.avatar_url ?? '',
          });
        }
        if (data?.survey) {
          setHeardFrom(data.survey.heard_from || []);
          setUseCase(data.survey.use_case || []);
        }
      } catch { /* silent */ } finally { setLoading(false); }
    })();
  }, []);

  const toggle = (arr: string[], setter: (v: string[]) => void, v: string) => {
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  const handleAvatarChoose = () => fileInputRef.current?.click();

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    if (!file.type.match(/^image\/(png|jpe?g|webp)$/)) {
      toast.error('Please choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB.');
      return;
    }

    setUploading(true);
    try {
      // Convert to base64 data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });

      const res = await api.post('/users/me/avatar', { dataUrl });
      const url = res.data?.data?.avatar_url;
      if (url) {
        setProfile((p) => ({ ...p, avatar_url: url }));
        await refreshProfile();
        toast.success('Profile picture updated');
      }
    } catch (err) {
      toast.error(getApiError(err, 'Could not upload photo'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAvatar = async () => {
    if (!confirm('Remove your profile picture?')) return;
    try {
      await api.patch('/users/me', { avatar_url: '' });
      setProfile((p) => ({ ...p, avatar_url: '' }));
      await refreshProfile();
      toast.success('Profile picture removed');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const saveProfile = async () => {
    if (!profile.full_name.trim()) return toast.error('Please enter your name');
    setSavingProfile(true);
    try {
      await api.patch('/users/me', {
        full_name: profile.full_name,
        dob:       profile.dob || undefined,
        location:  profile.location || undefined,
      });
      await refreshProfile();
      toast.success('Profile updated');
    } catch (err) {
      toast.error(getApiError(err, 'Could not save profile'));
    } finally { setSavingProfile(false); }
  };

  const saveSurvey = async () => {
    if (heardFrom.length === 0) return toast.error('Please pick at least one option for "How did you find us?"');
    if (useCase.length === 0)   return toast.error('Please pick at least one option for "What will you stream?"');
    setSavingSurvey(true);
    try {
      await api.post('/users/onboarding/survey', { heard_from: heardFrom, use_case: useCase });
      toast.success('Survey updated');
    } catch (err) {
      toast.error(getApiError(err, 'Could not save survey'));
    } finally { setSavingSurvey(false); }
  };

  const deleteAccount = async () => {
    const txt = window.prompt('Type DELETE to confirm account deletion. This cannot be undone.');
    if (txt !== 'DELETE') return;
    try {
      await api.delete('/users/me');
      toast.success('Account deleted');
      window.location.href = '/';
    } catch (err) { toast.error(getApiError(err)); }
  };

  if (loading) {
    return <Card className="h-40 flex items-center justify-center text-muted">Loading your profile…</Card>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted mt-1">Manage your account, profile, and preferences.</p>
      </div>

      {/* PROFILE */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <UserIcon size={16} className="text-primary" />
            <h2 className="font-display text-xl font-semibold">Profile</h2>
          </div>

          {/* Avatar upload */}
          <div className="flex items-center gap-5 pb-5 border-b border-white/5">
            <div className="relative group">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} className="w-24 h-24 rounded-full object-cover border-2 border-primary/30" alt="" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-3xl font-semibold border-2 border-primary/30">
                  {(profile.full_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
                </div>
              )}
              {profile.avatar_url && (
                <button
                  onClick={removeAvatar}
                  className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-danger text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-lg"
                  aria-label="Remove photo"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarFile}
                className="hidden"
              />
              <Button onClick={handleAvatarChoose} loading={uploading} variant="secondary" icon={<Upload size={14} />}>
                {profile.avatar_url ? 'Change photo' : 'Upload photo'}
              </Button>
              <p className="text-xs text-muted mt-2">PNG, JPEG or WebP. Max 5 MB.</p>
            </div>
          </div>

          <Input
            label="Full Name"
            value={profile.full_name}
            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
            placeholder="Alex Johnson"
          />
          <Input label="Email" value={user?.email ?? ''} disabled />
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="Date of Birth"
              type="date"
              value={profile.dob}
              onChange={(e) => setProfile({ ...profile, dob: e.target.value })}
            />
            <Input
              label="Location"
              value={profile.location}
              onChange={(e) => setProfile({ ...profile, location: e.target.value })}
              placeholder="Lagos, Nigeria"
            />
          </div>

          <div className="flex justify-end pt-2 border-t border-white/5">
            <Button onClick={saveProfile} loading={savingProfile} icon={<Save size={16} />}>
              Save Profile
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* SURVEY */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-primary" />
            <h2 className="font-display text-xl font-semibold">Tell us about you</h2>
          </div>

          <div>
            <label className="label">How did you hear about us?</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {HEARD_FROM.map((item) => (
                <button
                  key={item.value}
                  onClick={() => toggle(heardFrom, setHeardFrom, item.value)}
                  className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                    heardFrom.includes(item.value)
                      ? 'border-primary bg-primary/10 text-text'
                      : 'border-white/10 bg-white/[0.02] text-muted hover:border-white/20'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">What will you stream?</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {USE_CASES.map((item) => (
                <button
                  key={item.value}
                  onClick={() => toggle(useCase, setUseCase, item.value)}
                  className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                    useCase.includes(item.value)
                      ? 'border-primary bg-primary/10 text-text'
                      : 'border-white/10 bg-white/[0.02] text-muted hover:border-white/20'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-white/5">
            <Button onClick={saveSurvey} loading={savingSurvey} icon={<Save size={16} />}>
              Save Preferences
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* DANGER ZONE */}
      <Card className="p-6 border-danger/30">
        <h2 className="font-display text-xl font-semibold text-danger mb-2">Danger zone</h2>
        <p className="text-sm text-muted mb-4">Delete your account and all associated data. This action cannot be undone.</p>
        <Button variant="danger" onClick={deleteAccount}>Delete Account</Button>
      </Card>
    </div>
  );
}
