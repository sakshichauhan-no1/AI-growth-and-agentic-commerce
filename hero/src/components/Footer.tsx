export default function Footer() {
  return (
    <footer
      style={{
        background: '#0a5743',
        color: '#f1f5f9',
        padding: '48px 32px 24px',
        fontFamily: 'var(--vs-font-body)',
        fontSize: '14px',
      }}
    >
      <div className="max-w-[1280px] mx-auto">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '40px',
            marginBottom: '40px',
          }}
        >
          {/* Col 1 */}
          <div>
            <h4
              style={{
                color: 'white',
                fontSize: '18px',
                fontWeight: 700,
                marginBottom: '16px',
                fontFamily: 'var(--vs-font-heading)',
              }}
            >
              Agentic Commerce
            </h4>
            <p style={{ color: '#e2e8f0', lineHeight: 1.6 }}>
              Autonomous merchant growth powered by explainable, bounded, and
              gated agent-to-agent transactions.
            </p>
          </div>

          {/* Col 2 */}
          <div>
            <h4
              style={{
                color: 'white',
                fontSize: '14px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                marginBottom: '16px',
              }}
            >
              Architecture
            </h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {['Razorpay Test APIs', 'Spine Inspector', 'Audit Trail', 'NPCI UAP Standard'].map((item) => (
                <li key={item} style={{ marginBottom: '10px' }}>
                  <a
                    href="#"
                    style={{
                      color: '#f1f5f9',
                      textDecoration: 'none',
                      fontSize: '15px',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = 'white')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#f1f5f9')}
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3 */}
          <div>
            <h4
              style={{
                color: 'white',
                fontSize: '14px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                marginBottom: '16px',
              }}
            >
              Governance
            </h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {['Spending Limits (< ₹10k)', 'Signature Verification', 'Explainability Logs'].map((item) => (
                <li key={item} style={{ marginBottom: '10px' }}>
                  <a
                    href="#"
                    style={{
                      color: '#f1f5f9',
                      textDecoration: 'none',
                      fontSize: '15px',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = 'white')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#f1f5f9')}
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            paddingTop: '24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.25)',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            fontSize: '13px',
            color: '#e2e8f0',
          }}
        >
          <p>
            <strong>© {new Date().getFullYear()} Agentic Commerce</strong>
          </p>
          <p>Powered by Razorpay Test Mode &amp; React</p>
        </div>
      </div>
    </footer>
  );
}
