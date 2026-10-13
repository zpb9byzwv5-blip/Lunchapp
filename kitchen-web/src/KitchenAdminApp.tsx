import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface ScanResult {
  scanId?: number;
  scanStatus: 'COLLECTED_NOW' | 'ALREADY_COLLECTED' | 'NO_ORDER' | 'UNKNOWN_CARD' | 'ERROR';
  studentName?: string;
  yearGroup?: string;
  summaryText?: string;
  collectedTime?: string;
}

interface TallyItem {
  id: string;
  course_type: 'MAIN' | 'DRINK';
  dish_name: string;
  price_pence: number;
  stock_remaining: number;
  ordered_count: number;
}

export default function KitchenAdminApp() {
  const [activeTab, setActiveTab] = useState<'KIOSK' | 'ADMIN'>('KIOSK');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [manualUid, setManualUid] = useState('');
  const [tally, setTally] = useState<TallyItem[]>([]);

  const [dishName, setDishName] = useState('');
  const [courseType, setCourseType] = useState<'MAIN' | 'DRINK'>('MAIN');
  const [stock, setStock] = useState('150');
  const [adminMessage, setAdminMessage] = useState('');

  const nfcBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const lastSeenScanIdRef = useRef<number>(0);

  const triggerNfcLookup = async (uid: string) => {
    try {
      const res = await fetch(`${API_URL}/api/kitchen/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nfcUid: uid }),
      });
      const data: ScanResult = await res.json();
      if (data.scanId) lastSeenScanIdRef.current = data.scanId;
      setScanResult(data);
    } catch {
      setScanResult({
        scanStatus: 'ERROR',
        studentName: 'Network Error',
        summaryText: 'Check connection to backend server',
      });
    }
  };

  useEffect(() => {
    if (activeTab !== 'KIOSK') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const now = Date.now();
      if (now - lastKeyTimeRef.current > 150) {
        nfcBufferRef.current = '';
      }
      lastKeyTimeRef.current = now;
      if (e.key === 'Enter') {
        const capturedUid = nfcBufferRef.current.trim();
        nfcBufferRef.current = '';
        if (capturedUid.length >= 4) {
          triggerNfcLookup(capturedUid);
        }
      } else if (e.key.length === 1) {
        nfcBufferRef.current += e.key;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'KIOSK') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/kitchen/latest-scan`);
        if (!res.ok) return;
        const data: ScanResult = await res.json();
        if (data?.scanId && data.scanId > lastSeenScanIdRef.current) {
          lastSeenScanIdRef.current = data.scanId;
          setScanResult(data);
        }
      } catch {
        // Ignore background polling glitches
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [activeTab]);

  const loadTally = async () => {
    try {
      const res = await fetch(`${API_URL}/api/kitchen/tally`);
      const data = await res.json();
      setTally(Array.isArray(data.items) ? data.items : []);
    } catch {
      setTally([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'ADMIN') loadTally();
  }, [activeTab]);

  const handleAddMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dishName.trim()) return;
    const res = await fetch(`${API_URL}/api/admin/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dishName, courseType, stock: Number(stock) }),
    });
    if (res.ok) {
      setDishName('');
      setAdminMessage(`Added "${dishName}" at automatic price ${courseType === 'MAIN' ? '£2.65' : '£1.00'}`);
      loadTally();
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ fontSize: '20px', fontWeight: 700 }}>School Lunch System — Kitchen & Admin</div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => setActiveTab('KIOSK')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeTab === 'KIOSK' ? '#2563eb' : '#334155',
              color: '#fff',
            }}
          >
            Live NFC Counter Scanner
          </button>
          <button
            onClick={() => setActiveTab('ADMIN')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeTab === 'ADMIN' ? '#2563eb' : '#334155',
              color: '#fff',
            }}
          >
            Menu Setup & Prep Tally
          </button>
        </div>
      </header>

      {activeTab === 'KIOSK' && (
        <main style={{ maxWidth: '860px', margin: '40px auto', padding: '0 20px', textAlign: 'center' }}>
          <div style={{ marginBottom: '24px', color: '#94a3b8', fontSize: '18px' }}>
            Omnikey USB NFC Reader Active — Tap Student Card to Display Order
          </div>

          {!scanResult ? (
            <div style={{ padding: '80px 30px', borderRadius: '20px', backgroundColor: '#1e293b', border: '2px dashed #475569' }}>
              <h1 style={{ fontSize: '36px', margin: '0 0 12px 0' }}>Ready to Scan</h1>
              <p style={{ color: '#94a3b8', fontSize: '20px' }}>Waiting for student NFC tap...</p>
            </div>
          ) : (
            <div
              style={{
                padding: '56px 32px',
                borderRadius: '24px',
                backgroundColor:
                  scanResult.scanStatus === 'COLLECTED_NOW'
                    ? '#15803d'
                    : scanResult.scanStatus === 'ALREADY_COLLECTED'
                    ? '#b91c1c'
                    : '#b45309',
                boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px' }}>
                {scanResult.scanStatus === 'COLLECTED_NOW' && 'PRE-ORDER VERIFIED — HAND OVER MEAL'}
                {scanResult.scanStatus === 'ALREADY_COLLECTED' && `STOP — ALREADY COLLECTED AT ${scanResult.collectedTime}`}
                {scanResult.scanStatus === 'NO_ORDER' && 'NO PRE-ORDER FOUND FOR TODAY'}
                {scanResult.scanStatus === 'UNKNOWN_CARD' && 'UNREGISTERED NFC CARD'}
              </div>

              <h1 style={{ fontSize: '48px', margin: '12px 0' }}>
                {scanResult.studentName} ({scanResult.yearGroup})
              </h1>

              <div style={{ fontSize: '34px', fontWeight: 800, backgroundColor: 'rgba(0,0,0,0.25)', padding: '24px', borderRadius: '16px', marginTop: '20px' }}>
                {scanResult.summaryText}
              </div>
            </div>
          )}

          <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'center', gap: '10px' }}>
            <input
              type="text"
              placeholder="Test UID (e.g. 04A25F8B12)"
              value={manualUid}
              onChange={(e) => setManualUid(e.target.value)}
              style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#fff', width: '260px' }}
            />
            <button
              onClick={() => triggerNfcLookup(manualUid)}
              style={{ padding: '12px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#475569', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
            >
              Simulate Card Tap
            </button>
          </div>
        </main>
      )}

      {activeTab === 'ADMIN' && (
        <main style={{ maxWidth: '1000px', margin: '32px auto', padding: '0 20px', display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '28px' }}>
          <section style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '16px' }}>
            <h2 style={{ marginTop: 0 }}>Add Dish to Today's Menu</h2>
            <p style={{ color: '#94a3b8', fontSize: '14px' }}>
              Prices lock automatically: Mains = £2.65, Drinks = £1.00.
            </p>
            <form onSubmit={handleAddMenu} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>Course Type</label>
                <select
                  value={courseType}
                  onChange={(e) => setCourseType(e.target.value as 'MAIN' | 'DRINK')}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155' }}
                >
                  <option value="MAIN">Main Meal (Auto-priced at £2.65)</option>
                  <option value="DRINK">Drink (Auto-priced at £1.00)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>Dish / Drink Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chicken Tikka & Rice"
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>Max Portions Available</label>
                <input
                  type="number"
                  required
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #334155', boxSizing: 'border-box' }}
                />
              </div>

              <button
                type="submit"
                style={{ padding: '14px', borderRadius: '8px', border: 'none', backgroundColor: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '16px' }}
              >
                Add to Menu ({courseType === 'MAIN' ? '£2.65' : '£1.00'})
              </button>

              {adminMessage && <div style={{ color: '#4ade80', fontSize: '14px', marginTop: '6px' }}>{adminMessage}</div>}
            </form>
          </section>

          <section style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '16px' }}>
            <h2 style={{ marginTop: 0 }}>Today's Kitchen Production Tally</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', textAlign: 'left', color: '#94a3b8' }}>
                  <th style={{ padding: '10px 0' }}>Course</th>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Pre-Ordered</th>
                  <th>Left</th>
                </tr>
              </thead>
              <tbody>
                {tally.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '12px 0', fontWeight: 600 }}>{item.course_type}</td>
                    <td>{item.dish_name}</td>
                    <td>£{(item.price_pence / 100).toFixed(2)}</td>
                    <td style={{ fontWeight: 800, color: '#38bdf8', fontSize: '18px' }}>{item.ordered_count}</td>
                    <td style={{ color: '#94a3b8' }}>{item.stock_remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      )}
    </div>
  );
}
