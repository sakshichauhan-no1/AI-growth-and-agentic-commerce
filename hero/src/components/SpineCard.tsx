import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Loader2, Circle, ShieldCheck, Terminal, Cpu, Zap, Lock } from 'lucide-react';
import { useSpineSimulation, type SpineStep } from '../hooks/useSpineSimulation';

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] },
  }),
};

const stepIcons: Record<string, React.FC<{ size?: number; className?: string }>> = {
  propose: ShieldCheck,
  explain: Terminal,
  gate: Lock,
  execute: Zap,
  audit: Cpu,
};

function StepRow({ step, index }: { step: SpineStep; index: number }) {
  const Icon = stepIcons[step.id] ?? Circle;

  const statusColors = {
    idle: 'bg-gray-100 border-gray-200 text-gray-400',
    active: 'bg-accent/5 border-accent text-accent',
    approved: 'bg-green-50 border-green-300 text-green-700',
    failed: 'bg-red-50 border-red-300 text-red-700',
  };

  const badgeStyle = {
    idle: 'bg-gray-100 text-gray-400',
    active: 'bg-accent/15 text-accent pulse-ring',
    approved: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  const statusLabel = {
    idle: '—',
    active: '...',
    approved: step.approvedText,
    failed: 'Failed',
  };

  return (
    <motion.li
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-500
        ${statusColors[step.status]}
      `}
    >
      {/* Step icon badge */}
      <span
        className={`
          flex-none w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500
          ${badgeStyle[step.status]}
          ${step.status === 'active' ? 'pulse-ring' : ''}
        `}
      >
        <AnimatePresence mode="wait">
          {step.status === 'active' ? (
            <motion.span
              key="loading"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <Loader2 size={14} className="animate-spin" />
            </motion.span>
          ) : step.status === 'approved' ? (
            <motion.span
              key="check"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              <CheckCircle size={14} />
            </motion.span>
          ) : (
            <motion.span key="icon" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>
              <Icon size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>

      {/* Label + subtext */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">{step.label}</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={step.status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="text-xs mt-0.5 leading-tight opacity-75"
          >
            {step.status === 'idle' ? step.subtext : statusLabel[step.status]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Status dot */}
      <span
        className={`
          flex-none w-2 h-2 rounded-full transition-all duration-500
          ${step.status === 'idle' ? 'bg-gray-300'
            : step.status === 'active' ? 'bg-accent animate-pulse'
            : step.status === 'approved' ? 'bg-green-500'
            : 'bg-red-500'}
        `}
      />
    </motion.li>
  );
}

export default function SpineCard() {
  const steps = useSpineSimulation();
  const approvedCount = steps.filter(s => s.status === 'approved').length;
  const isRunning = steps.some(s => s.status === 'active');

  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={4}
      className="relative"
    >
      {/* Glow effect behind card */}
      <div
        className="absolute -inset-4 rounded-3xl opacity-30 blur-2xl pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 60% 40%, rgba(10,87,67,0.35) 0%, transparent 70%)' }}
      />

      <div
        className="relative rounded-2xl p-5 border border-white/40 shadow-card overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      >
        {/* Card header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-ink font-heading">Spine Inspector</h3>
            <p className="text-xs text-gray-500 mt-0.5">Live agent reasoning trace</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Live badge */}
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-accent/10 text-accent border border-accent/20 rounded-full px-2.5 py-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-accent animate-pulse' : 'bg-green-500'}`}
              />
              {isRunning ? 'Running' : 'Live'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-light"
            initial={{ width: '0%' }}
            animate={{ width: `${(approvedCount / steps.length) * 100}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>

        {/* Steps list */}
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </ol>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-medium">
            NPCI UAP + Razorpay Test Mode
          </span>
          <span className="text-[11px] font-bold text-accent">
            {approvedCount}/{steps.length} steps
          </span>
        </div>

        {/* Decorative corner shimmer */}
        <div
          className="absolute top-0 right-0 w-32 h-32 pointer-events-none opacity-20"
          style={{
            background: 'radial-gradient(circle at top right, rgba(10,87,67,0.4), transparent 60%)',
          }}
        />
      </div>
    </motion.div>
  );
}
