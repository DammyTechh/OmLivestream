'use client';
import { useState } from 'react';
import { MonitorPlay, ExternalLink, ChevronDown, X, Sparkles } from 'lucide-react';
import {
  DESKTOP_CAMERA_TOOLS, OMLIVE_MULTICAM_URL, OMLIVE_MULTICAM_READY,
} from '@/lib/device';

/**
 * Shown only on desktop, where the ceiling on camera angles isn't the device —
 * it's the browser. A browser can open the cameras plugged into a machine, but
 * it can't switch between angles mid-broadcast, mix in a screen share, or drive
 * the kind of multi-camera setup a conference room or auditorium expects.
 *
 * Virtual-camera software does exactly that, and then presents the finished mix
 * to the browser as one ordinary webcam — so it needs no support from us. This
 * points creators at the good options rather than letting them discover the
 * limitation halfway through setting up an event.
 *
 * When our own tool ships, flipping OMLIVE_MULTICAM_READY in lib/device.ts
 * promotes it to the headline recommendation and nothing here needs editing.
 */
export function VirtualCameraTip({ onDismiss }: { onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] to-accent/[0.05] p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <MonitorPlay size={17} className="text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">Streaming from a computer?</div>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            For more than two angles — or to mix in slides, a screen share and live switching —
            use virtual camera software. It combines everything into one camera that you then
            pick here. Ideal for events and big-screen setups.
          </p>

          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:opacity-80 transition"
          >
            {open ? 'Hide options' : 'See recommended tools'}
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="mt-3 space-y-2">
              {OMLIVE_MULTICAM_READY && (
                <a
                  href={OMLIVE_MULTICAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-3 rounded-xl bg-primary/10 border border-primary/30 hover:border-primary/50 transition"
                >
                  <Sparkles size={15} className="text-primary mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      OmliveStream MultiCam <ExternalLink size={11} className="text-muted" />
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      Our own multi-camera tool, built to work with your OmliveStream account.
                    </div>
                  </div>
                </a>
              )}

              {DESKTOP_CAMERA_TOOLS.map((tool) => (
                <a
                  key={tool.name}
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-3 rounded-xl bg-veil/[0.04] border border-veil/10 hover:border-primary/40 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      {tool.name}
                      <ExternalLink size={11} className="text-muted" />
                      {tool.free && (
                        <span className="px-1.5 py-0.5 rounded-md bg-success/15 text-success text-[9px] font-bold uppercase tracking-wide">
                          Free
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{tool.blurb}</div>
                    <div className="text-[10px] text-muted/70 mt-1">{tool.platforms}</div>
                  </div>
                </a>
              ))}

              {!OMLIVE_MULTICAM_READY && (
                <p className="text-[11px] text-muted/80 pt-1">
                  <Sparkles size={11} className="inline mr-1 text-primary" />
                  We&apos;re building our own multi-camera tool — it&apos;ll appear here when it&apos;s ready.
                </p>
              )}
            </div>
          )}
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss tip"
            className="text-muted hover:text-text transition shrink-0"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
