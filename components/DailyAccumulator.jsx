'use client';

import { useMemo } from 'react';
import { buildDailyAccumulator } from '../lib/couponEngine';
import { verifyCoupon } from '../lib/verification';
import CouponResultCard from './CouponResultCard';

export default function DailyAccumulator({ predictions, isLoading }) {
  const { coupon, verification } = useMemo(() => {
    if (!predictions || predictions.length === 0) return { coupon: null, verification: null };
    const built = buildDailyAccumulator(predictions, 13, 60);
    return { coupon: built, verification: verifyCoupon(built.selections) };
  }, [predictions]);

  return (
    <section className="mb-8 rounded-xl2 border border-signal-draw/25 bg-signal-draw/5 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-100">Le Combiné DTech du Jour</h2>
        <span className="text-[11px] text-ink-700">Objectif : 13 sélections</span>
      </div>
      <p className="text-xs text-ink-500 mb-4">
        Sélection automatique, priorité au marché "Les deux équipes marquent" (BTTS).
      </p>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-base-700/60 rounded-lg" />
          ))}
        </div>
      ) : (
        <CouponResultCard
          coupon={coupon}
          verification={verification}
          emptyLabel="Calendrier trop restreint aujourd'hui pour composer un combiné exploitable."
        />
      )}
    </section>
  );
}
