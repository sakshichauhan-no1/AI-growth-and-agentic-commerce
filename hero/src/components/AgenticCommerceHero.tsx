import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRightCircle,
  Bot,
  ShieldCheck,
  Zap,
  Menu,
  X,
} from 'lucide-react';

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface AgenticCommerceHeroProps {
  onSignIn: () => void;
  onLaunchDemo: () => void;
}

/* ─────────────────────────────────────────────
   Animation Variants
───────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.15,
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  }),
};

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.2, delay: 0.15 } },
};

const sheetVariants = {
  hidden: { x: '100%' },
  visible: {
    x: 0,
    transition: {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  },
  exit: {
    x: '100%',
    transition: {
      duration: 0.35,
      ease: [0.64, 0, 0.78, 0] as [number, number, number, number],
    },
  },
};

/* ─────────────────────────────────────────────
   Nav Links
───────────────────────────────────────────── */
const NAV_LINKS = ['Catalog', 'Agent Flow', 'Razorpay Integration', 'Audit Logs', 'Docs'];

/* ─────────────────────────────────────────────
   Logo SVG
───────────────────────────────────────────── */
function LogoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      fill="none"
      overflow="visible"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path
        d="M 64 128 L 64.5 128 L 32 95 L 0 64 L 0 0 L 64 0 L 128 64 L 128 64.5 L 161 32 L 192 0 L 256 0 L 256 64 L 192 128 L 128 128 L 128 192 L 96 223 L 63.5 256 L 0 256 L 0 192 Z M 256 192 L 224 223 L 191.5 256 L 128 256 L 128 192 L 192 128 L 256 128 Z"
        fill="#0a5743"
      />
    </svg>
  );
}

/* ─────────────────────────────────────────────
   Navbar
───────────────────────────────────────────── */
function Navbar({ onSignIn, onLaunchDemo }: { onSignIn: () => void; onLaunchDemo: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <nav className="relative z-20 w-full" role="navigation" aria-label="Main navigation">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between px-5 sm:px-8 py-4 sm:py-5">

          {/* Logo */}
          <a
            href="#"
            className="flex items-center gap-2.5"
            style={{ textDecoration: 'none' }}
          >
            <LogoIcon />
            <span
              style={{
                fontFamily: 'var(--vs-font-heading)',
                fontSize: '17px',
                color: 'var(--vs-color-text)',
                letterSpacing: '-0.01em',
              }}
            >
              Agentic Commerce
            </span>
          </a>

          {/* Desktop nav links — center */}
          <ul className="hidden md:flex items-center gap-7 list-none m-0 p-0" aria-label="Site links">
            {NAV_LINKS.map((link) => (
              <li key={link}>
                <a
                  href="#"
                  className="text-sm font-medium transition-opacity duration-200"
                  style={{
                    fontFamily: 'var(--vs-font-body)',
                    color: 'var(--vs-color-text)',
                    textDecoration: 'none',
                    opacity: 0.75,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.75'; }}
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>

          {/* Desktop action buttons */}
          <div className="hidden md:flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onLaunchDemo}
              style={{
                background: '#0a5743',
                color: 'white',
                borderRadius: '50px',
                padding: '0.625rem 1.25rem',
                fontFamily: 'var(--vs-font-body)',
                fontWeight: 600,
                fontSize: '0.875rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Launch Demo
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onSignIn}
              style={{
                background: '#F2F2EE',
                color: 'var(--vs-color-text)',
                borderRadius: '50px',
                padding: '0.625rem 1.25rem',
                fontFamily: 'var(--vs-font-body)',
                fontWeight: 600,
                fontSize: '0.875rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign In
            </motion.button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex items-center justify-center w-9 h-9"
            style={{
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: '8px',
              backdropFilter: 'blur(8px)',
              cursor: 'pointer',
              color: 'var(--vs-color-text)',
            }}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {/* ── Mobile Slide-in Sheet ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed inset-0 z-30"
              style={{
                background: 'rgba(25, 40, 55, 0.35)',
                backdropFilter: 'blur(4px)',
              }}
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed top-0 right-0 z-40 flex flex-col"
              style={{
                width: 'min(88vw, 360px)',
                height: '100dvh',
                background: '#CFC8C5',
                boxShadow: '-12px 0 48px rgba(25,40,55,0.18)',
              }}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="flex items-center justify-between px-6 py-5"
                style={{ borderBottom: '1px solid rgba(25,40,55,0.12)' }}
              >
                <a href="#" className="flex items-center gap-2.5" style={{ textDecoration: 'none' }}>
                  <LogoIcon />
                  <span
                    style={{
                      fontFamily: 'var(--vs-font-heading)',
                      fontSize: '16px',
                      color: 'var(--vs-color-text)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Agentic Commerce
                  </span>
                </a>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center w-8 h-8"
                  style={{
                    background: 'rgba(25,40,55,0.1)',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: 'var(--vs-color-text)',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <ul className="flex flex-col gap-1 px-4 py-4 list-none m-0 flex-1">
                {NAV_LINKS.map((link, i) => (
                  <motion.li
                    key={link}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.18 + i * 0.07, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <a
                      href="#"
                      className="block px-4 py-3 rounded-xl text-sm font-medium transition-all"
                      style={{
                        fontFamily: 'var(--vs-font-body)',
                        color: 'var(--vs-color-text)',
                        textDecoration: 'none',
                        opacity: 0.8,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(10,87,67,0.1)';
                        (e.currentTarget as HTMLAnchorElement).style.color = '#0a5743';
                        (e.currentTarget as HTMLAnchorElement).style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                        (e.currentTarget as HTMLAnchorElement).style.color = 'var(--vs-color-text)';
                        (e.currentTarget as HTMLAnchorElement).style.opacity = '0.8';
                      }}
                      onClick={() => setMobileOpen(false)}
                    >
                      {link}
                    </a>
                  </motion.li>
                ))}
              </ul>
              <motion.div
                className="px-4 pb-8 flex flex-col gap-2.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.3 }}
              >
                <button
                  onClick={() => { setMobileOpen(false); onLaunchDemo(); }}
                  className="w-full font-semibold text-sm"
                  style={{
                    background: '#0a5743',
                    color: 'white',
                    borderRadius: '50px',
                    padding: '0.75rem 1.25rem',
                    fontFamily: 'var(--vs-font-body)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Launch Demo
                </button>
                <button
                  onClick={() => { setMobileOpen(false); onSignIn(); }}
                  className="w-full font-semibold text-sm"
                  style={{
                    background: '#F2F2EE',
                    color: 'var(--vs-color-text)',
                    borderRadius: '50px',
                    padding: '0.75rem 1.25rem',
                    fontFamily: 'var(--vs-font-body)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Sign In
                </button>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─────────────────────────────────────────────
   Hero Section
───────────────────────────────────────────── */
export default function AgenticCommerceHero({ onSignIn, onLaunchDemo }: AgenticCommerceHeroProps) {
  return (
    <section
      className="relative w-full overflow-hidden"
      style={{ fontFamily: 'var(--vs-font-body)', color: 'var(--vs-color-text)', minHeight: 'calc(100vh - 300px)' }}
    >
      {/* ── Background Video ── */}
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.28 }}
        aria-hidden="true"
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260518_003132_8b7edcb6-c64d-4a52-a9ca-879942e122ad.mp4"
          type="video/mp4"
        />
      </video>
      <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px]" aria-hidden="true"></div>

      {/* ── Navbar ── */}
      <Navbar onSignIn={onSignIn} onLaunchDemo={onLaunchDemo} />

      {/* ── Hero Content ── */}
      <div className="relative z-10 max-w-[1280px] mx-auto px-5 sm:px-8 pb-20">
        <div style={{ paddingTop: 'clamp(40px, 8vw, 72px)' }}>
          <div style={{ maxWidth: '620px' }}>
            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              custom={0}
              style={{
                fontFamily: 'var(--vs-font-heading)',
                fontSize: 'clamp(1.65rem, 5vw, 3rem)',
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
                color: '#192837',
                marginBottom: '32px',
              }}
            >
              <Bot size={24} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', position: 'relative', top: '-2px', color: '#0a5743', marginRight: '6px' }} />
              Scale Merchant Revenue{' '}
              <ShieldCheck size={24} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', position: 'relative', top: '-2px', color: '#0a5743', margin: '0 4px' }} />
              {' '}with Autonomous Commerce Agents{' '}
              <Zap size={24} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', position: 'relative', top: '-2px', color: '#0a5743', marginLeft: '4px' }} />
            </motion.h1>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              custom={1}
              style={{
                fontFamily: 'var(--vs-font-body)',
                fontSize: 'clamp(0.9rem, 2.5vw, 1.1rem)',
                lineHeight: 1.65,
                opacity: 0.8,
                color: 'var(--vs-color-text)',
                maxWidth: '580px',
              }}
            >
              Make merchants transactable by AI buyers end-to-end. Bounded
              spending limits, explainable execution steps, verified Razorpay
              test-mode payments, and continuous audit trails.
            </motion.p>

            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              custom={2}
              style={{ marginTop: '2.5rem' }}
            >
              <motion.button
                whileHover={{ scale: 1.04, filter: 'brightness(1.1)' }}
                whileTap={{ scale: 0.96 }}
                onClick={onLaunchDemo}
                className="inline-flex items-center justify-between"
                style={{
                  background: '#0a5743',
                  color: 'white',
                  borderRadius: '50px',
                  padding: '17px 24px',
                  fontFamily: 'var(--vs-font-body)',
                  fontWeight: 600,
                  fontSize: 'clamp(0.9rem, 2vw, 1rem)',
                  boxShadow: '0 4px 24px rgba(10,87,67,0.28)',
                  minWidth: '230px',
                  gap: '32px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span>Try Conversational Checkout</span>
                <ArrowRightCircle size={20} aria-hidden="true" />
              </motion.button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
