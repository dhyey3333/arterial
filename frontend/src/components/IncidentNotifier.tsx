import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Toaster, toast } from 'sonner';
import { ArrowRight, X } from 'lucide-react';
import { useLive } from '../data/store';
import type { Incident } from '../lib/contract';
import { INCIDENT_TYPE_LABEL, SEVERITY_RANK, fmtTime } from '../lib/format';
import { SeverityBadge } from './ui/primitives';

type Seen = Map<string, { status: Incident['status']; severity: Incident['severity'] }>;

const seenFrom = (incidents: Record<string, Incident>): Seen =>
  new Map(Object.values(incidents).map((i) => [i.incident_id, { status: i.status, severity: i.severity }]));

function IncidentToast({
  incident,
  road,
  escalated,
  onView,
  onClose,
}: {
  incident: Incident;
  road: string;
  escalated: boolean;
  onView: () => void;
  onClose: () => void;
}) {
  return (
    <div className={`toast toast--${incident.severity}`}>
      <div className="toast__head">
        <SeverityBadge severity={incident.severity} size="sm" />
        <span className="toast__kind">{escalated ? 'Escalated' : 'New incident'}</span>
        <span className="toast__time num">{fmtTime(incident.updated_at)}</span>
        <button type="button" className="toast__close" onClick={onClose} aria-label="Dismiss">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="toast__title">
        {INCIDENT_TYPE_LABEL[incident.type]} <span className="toast__road">on {road}</span>
      </p>
      <p className="toast__reason">{incident.reason}</p>
      <div className="toast__foot">
        <span className="toast__note">Simulated anomaly</span>
        <button type="button" className="link toast__view" onClick={onView}>
          View incident <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Announces incidents as they open or escalate, never the ones already open
 * when the app loads. Sonner provides the stack, swipe to dismiss, pause on
 * hover and the live region; its 400ms `ease` motion is left as designed.
 */
export function IncidentNotifier() {
  const navigate = useNavigate();

  useEffect(() => {
    let seen: Seen | null = null;
    const start = useLive.getState();
    if (start.bootstrap.status === 'ready') seen = seenFrom(start.incidents);
    return useLive.subscribe((s, prev) => {
      if (s.incidents === prev.incidents || s.bootstrap.status !== 'ready') return;
      if (!seen) {
        seen = seenFrom(s.incidents);
        return;
      }
      for (const i of Object.values(s.incidents)) {
        const was = seen.get(i.incident_id);
        if (i.status !== 'active') continue;
        const opened = !was || was.status !== 'active';
        const escalated = !opened && !!was && SEVERITY_RANK[i.severity] > SEVERITY_RANK[was.severity];
        if (!opened && !escalated) continue;
        const road = s.segIndex[i.segment_id]?.name ?? i.segment_id;
        toast.custom(
          (id) => (
            <IncidentToast
              incident={i}
              road={road}
              escalated={escalated}
              onClose={() => toast.dismiss(id)}
              onView={() => {
                toast.dismiss(id);
                navigate(`/incidents/${i.incident_id}`);
              }}
            />
          ),
          { id: `${i.incident_id}:${i.updated_at}`, duration: 8000 },
        );
      }
      seen = seenFrom(s.incidents);
    });
  }, [navigate]);

  return (
    <Toaster
      position="bottom-center"
      offset={24}
      mobileOffset={16}
      gap={10}
      visibleToasts={3}
      theme="dark"
      toastOptions={{ unstyled: true }}
      style={{ '--width': '400px' } as React.CSSProperties}
    />
  );
}
