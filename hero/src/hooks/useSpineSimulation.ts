import { useState, useEffect, useCallback } from 'react';

export type StepStatus = 'idle' | 'active' | 'approved' | 'failed';

export interface SpineStep {
  id: string;
  label: string;
  subtext: string;
  approvedText: string;
  status: StepStatus;
}

const STEPS_INITIAL: SpineStep[] = [
  {
    id: 'propose',
    label: 'Propose',
    subtext: 'Waiting for a request...',
    approvedText: 'Approved',
    status: 'idle',
  },
  {
    id: 'explain',
    label: 'Explain',
    subtext: 'Intent parsing queued',
    approvedText: 'Intent Parsed',
    status: 'idle',
  },
  {
    id: 'gate',
    label: 'Gate',
    subtext: 'Limit check: ₹10k ceiling',
    approvedText: 'Passed (Limit < ₹10k)',
    status: 'idle',
  },
  {
    id: 'execute',
    label: 'Execute',
    subtext: 'Awaiting gate clearance',
    approvedText: 'Razorpay Signature Verified',
    status: 'idle',
  },
  {
    id: 'audit',
    label: 'Audit Log',
    subtext: 'Awaiting execution result',
    approvedText: 'Transaction Persisted',
    status: 'idle',
  },
];

const STEP_DURATION = 1200; // ms per step
const RESET_DELAY = 2000;   // ms before restarting cycle

export function useSpineSimulation() {
  const [steps, setSteps] = useState<SpineStep[]>(STEPS_INITIAL);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [running, setRunning] = useState(false);

  const reset = useCallback(() => {
    setSteps(STEPS_INITIAL.map(s => ({ ...s, status: 'idle' })));
    setCurrentIndex(-1);
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    setRunning(true);
    setCurrentIndex(0);
  }, []);

  // Kick off after mount with a slight delay
  useEffect(() => {
    const t = setTimeout(start, 800);
    return () => clearTimeout(t);
  }, [start]);

  useEffect(() => {
    if (!running || currentIndex < 0) return;

    if (currentIndex >= STEPS_INITIAL.length) {
      // All steps done — pause then restart
      const t = setTimeout(() => {
        reset();
        setTimeout(start, 400);
      }, RESET_DELAY);
      return () => clearTimeout(t);
    }

    // Mark current as active
    setSteps(prev =>
      prev.map((s, i) =>
        i === currentIndex
          ? { ...s, status: 'active' }
          : i < currentIndex
          ? { ...s, status: 'approved' }
          : s
      )
    );

    // After step duration, approve it and move on
    const t = setTimeout(() => {
      setSteps(prev =>
        prev.map((s, i) =>
          i === currentIndex ? { ...s, status: 'approved' } : s
        )
      );
      setCurrentIndex(ci => ci + 1);
    }, STEP_DURATION);

    return () => clearTimeout(t);
  }, [running, currentIndex, reset, start]);

  return steps;
}
