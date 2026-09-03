import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export default function AgenticCheckoutModal() {

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#F2F2EE] w-full h-full flex"
    >
        <iframe 
            src="http://localhost:3000/checkout.html" 
            className="w-full h-full border-none"
            title="Agentic Checkout"
        />
    </motion.div>
  );
}
