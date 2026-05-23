'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ArrowRight, ArrowLeft, User, Target, Sparkles as SparklesIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { WavyBackground } from '@/components/ui/WavyBackground';
import { Spinner } from '@/components/ui/Spinner';
import { api, getApiError, TOKEN_KEYS } from '@/lib/api';
import { useAuth } from '@/store/auth';

// ⚠ Values MUST match backend enum exactly
const HEARD_FROM: { value: string; label: string }[] = [
  { value: 'social_media',     label: 'Social Media'       },
  { value: 'friend_referral',  label: 'A Friend'           },
  { value: 'google_search',    label: 'Google Search'      },
  { value: 'content_creator',  label: 'Content Creator'    },
  { value: 'youtube_ad',       label: 'YouTube Ad'         },
  { value: 'other',            label: 'Other'              },
];

const USE_CASES: { value: string; label: string }[] = [
  { value: 'entertainment',      label: 'Entertainment'       },
  { value: 'gaming',             label: 'Gaming'              },
  { value: 'music_performance',  label: 'Music & DJ Sets'     },
  { value: 'education',          label: 'Tutorials & Courses' },
  { value: 'business_brand',     label: 'Business / Brand'    },
  { value: 'fitness_wellness',   label: 'Fitness & Wellness'  },
  { value: 'events_concerts',    label: 'Events & Concerts'   },
  { value: 'news_commentary',    label: 'News & Commentary'   },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { hydrate } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState({ full_name: '', dob: '', location: '' });
  const [heardFrom, setHeardFrom] = useState<string[]>([]);
  const [useCase, setUseCase] = useState<string[]>([]);

  useEffect(() => {
    hydrate();
    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEYS.ACCESS) : null;
    if (!token) {
      router.replace('/auth/signup');
      return;
    }
    setAuthChecked(true);
  }, [hydrate, router]);

  const toggle = (arr: string[], setter: (v: string[]) => void, v: string) => {
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  const next = async () => {
    if (step === 0) {
      if (!profile.full_name.trim()) return toast.error('Please enter your name');
      setLoading(true);
      try {
        await api.post('/users/onboarding/profile', profile);
      } catch (err) {
        toast.error(getApiError(err, 'Could not save profile'));
        setLoading(false);
        return;
      }
      setLoading(false);
    } else if (step === 1) {
      if (heardFrom.length === 0) return toast.error('Please pick at least one');
    } else if (step === 2) {
      if (useCase.length === 0) return toast.error('Please pick at least one');
      setLoading(true);
      try {
        await api.post('/users/onboarding/survey', { heard_from: heardFrom, use_case: useCase });
        // Also mark onboarding complete for the dashboard prompt
        localStorage.setItem('omlive_onboarded', '1');
        toast.success("Welcome! Your account is ready.");
        router.push('/dashboard');
      } catch (err) {
        toast.error(getApiError(err, 'Could not save survey'));
        setLoading(false);
      }
      return;
    }
    setStep(step + 1);
  };

  const prev = () => step > 0 && setStep(step - 1);

  const stepTitles = [
    { num: 1, title: 'Tell us about you',    icon: User        },
    { num: 2, title: 'How did you find us?', icon: SparklesIcon },
    { num: 3, title: 'What will you stream?', icon: Target      },
  ];

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner size={32} /></div>;
  }

  return (
    <div className="min-h-screen flex flex-col relative">
      <WavyBackground />
      <header className="relative p-6 flex items-center justify-between z-10">
        <Logo size="sm" />
        <span className="text-sm text-muted">Step {step + 1} / 3</span>
      </header>

      <div className="relative flex-1 flex items-center justify-center p-6 z-10">
        <motion.div layout className="w-full max-w-2xl">
          {/* Progress */}
          <div className="flex items-center justify-between mb-12 max-w-md mx-auto">
            {stepTitles.map((s, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-initial">
                <div className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                  step >= i ? 'bg-primary border-primary text-white' : 'border-white/20 text-muted'
                }`}>
                  {step > i ? <Check size={18} /> : <s.icon size={16} />}
                </div>
                {i < 2 && <div className={`flex-1 h-0.5 mx-2 transition-all ${step > i ? 'bg-primary' : 'bg-white/10'}`} />}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.3 }}
            >
              <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-2 text-center">
                {stepTitles[step].title}
              </h1>
              <p className="text-muted text-center mb-10">
                {step === 0 && "A bit of info — so we can personalise your experience."}
                {step === 1 && "Help us understand how creators hear about us."}
                {step === 2 && "So we can tune recommendations for your niche."}
              </p>

              {step === 0 && (
                <div className="space-y-4 max-w-md mx-auto">
                  <Input label="Full Name" value={profile.full_name}
                    onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                    placeholder="Alex Johnson" />
                  <Input label="Date of Birth (optional)" type="date"
                    value={profile.dob}
                    onChange={(e) => setProfile({ ...profile, dob: e.target.value })} />
                  <Input label="Location (optional)" value={profile.location}
                    onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                    placeholder="Lagos, Nigeria" />
                </div>
              )}

              {step === 1 && (
                <div className="grid grid-cols-2 gap-3 max-w-xl mx-auto">
                  {HEARD_FROM.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => toggle(heardFrom, setHeardFrom, item.value)}
                      className={`p-4 rounded-2xl border text-sm font-medium transition-all ${
                        heardFrom.includes(item.value)
                          ? 'border-primary bg-primary/10 text-text'
                          : 'border-white/10 bg-white/[0.02] text-muted hover:border-white/20 hover:text-text'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-2 gap-3 max-w-xl mx-auto">
                  {USE_CASES.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => toggle(useCase, setUseCase, item.value)}
                      className={`p-4 rounded-2xl border text-sm font-medium transition-all ${
                        useCase.includes(item.value)
                          ? 'border-primary bg-primary/10 text-text'
                          : 'border-white/10 bg-white/[0.02] text-muted hover:border-white/20 hover:text-text'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex gap-3 justify-between mt-10 max-w-md mx-auto">
            <Button variant="secondary" onClick={prev} disabled={step === 0 || loading} icon={<ArrowLeft size={16} />}>
              Back
            </Button>
            <Button onClick={next} loading={loading} icon={step === 2 ? <Check size={16} /> : <ArrowRight size={16} />}>
              {step === 2 ? 'Finish' : 'Continue'}
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
