import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import AgenticCommerceHero from './components/AgenticCommerceHero';
import AgenticCheckoutModal from './components/AgenticCheckoutModal';
import Footer from './components/Footer';

export default function App() {
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data === 'close-checkout') setShowCheckout(false);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <main className="min-h-screen flex flex-col bg-[#F2F2EE]">
      <div className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {!showCheckout ? (
            <AgenticCommerceHero 
              key="home"
              onSignIn={() => setShowCheckout(true)} 
              onLaunchDemo={() => setShowCheckout(true)} 
            />
          ) : (
            <AgenticCheckoutModal key="checkout" />
          )}
        </AnimatePresence>
      </div>

      <Footer />
    </main>
  );
}
