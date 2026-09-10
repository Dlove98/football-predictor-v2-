'use client';

import { useState } from 'react';
import { buildCoupon } from '../lib/couponEngine';
import { verifyCoupon } from '../lib/verification';
import { MARKET_GROUPS } from '../lib/markets';
import CouponResultCard from './CouponResultCard';

const GROUP_OPTIONS = Object.entries(MARKET_GROUPS).map(([key, group]) => ({
  key,
  label: group.label,
}));

export default function CouponGenerator({ predictions }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState(['BTTS', 'DOUBLE_CHANCE']);
  const [targetSuccessPct, setTargetSuccessPct] = useState(65);
  const [targetOdds, setTargetOdds] = useState('');
  const [matchCount, setMatchCount] = useState(5);
  const [result, setResult] = useState(null);

  function toggleGroup(key) {
    setSelectedGroups((prev) =>
      prev.includes(key) ? prev.filter((g) => g !== key) : [...prev, key]
    );
  }

  function handleGenerate() {
    if (!predictions || predictions.length === 0) {
      setResult({ coupon: null, verification: null });
      return;
    }
    const coupon = buildCoupon({
      matchPredictions: predictions,
      allowedGroupKeys: selectedGroups.length > 0 ? selectedGroups : undefined,
      targetOdds: targetOdds ? Number(targetOdds) : null,
      targetSuccessPct: Number(targetSuccessPct),
      targetCount: Number(matchCount),
    });
    setResult({ coupon, verification: verifyCoupon(coupon.selections) });
  }

  return (
    <section className="mb-8 rounded-xl2 border border-line bg-base-900/70 p-5">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-ink-100">Générateur de coupon personnalisé</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Choisissez le type de pronostic, la cote et le nombre de matchs.
          </p>
        </div>
        <span className="text-ink-500 text-lg">{isOpen ? '−' : '+'}</span>
      </button>

      {isOpen && (
        <div className="mt-5 space-y-5">
          <div>
            <p className="text-xs text-ink-500 mb-2">Type(s) de pronostic</p>
            <div className="flex flex-wrap gap-2">
              {GROUP_OPTIONS.map((option) => {
                const isSelected = selectedGroups.includes(option.key);
                return (
                  <button
                    key={option.key}
                    onClick={() => toggleGroup(option.key)}
                    className={[
                      'text-xs px-3 py-1.5 rounded-full border transition-colors',
                      isSelected
                        ? 'bg-signal-home/15 border-signal-home/40 text-signal-home'
                        : 'bg-base-800 border-line text-ink-500 hover:text-ink-100',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-ink-500 block mb-1.5">% de réussite visé</span>
              <input
                type="number"
                min={45}
                max={95}
                value={targetSuccessPct}
                onChange={(e) => setTargetSuccessPct(e.target.value)}
                className="w-full rounded-lg border border-line bg-base-800 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-signal-home/50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ink-500 block mb-1.5">Cote visée</span>
              <input
                type="number"
                min={1}
                step="0.1"
                placeholder="ex. 5.00"
                value={targetOdds}
                onChange={(e) => setTargetOdds(e.target.value)}
                className="w-full rounded-lg border border-line bg-base-800 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-signal-home/50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ink-500 block mb-1.5">Nombre de matchs</span>
              <input
                type="number"
                min={1}
                max={20}
                value={matchCount}
                onChange={(e) => setMatchCount(e.target.value)}
                className="w-full rounded-lg border border-line bg-base-800 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-signal-home/50"
              />
            </label>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!predictions || predictions.length === 0}
            className="w-full rounded-lg border border-signal-home/30 bg-signal-home/10 text-signal-home text-sm font-medium py-2.5 transition-colors hover:bg-signal-home/15 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Générer le coupon
          </button>

          {result && (
            <CouponResultCard
              coupon={result.coupon}
              verification={result.verification}
              emptyLabel="Aucune sélection ne correspond à ces critères pour cette date."
            />
          )}
        </div>
      )}
    </section>
  );
}
