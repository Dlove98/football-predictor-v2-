'use client';

import { useEffect, useState } from 'react';
import { getCalibrationSummary } from '../lib/learningEngine';

export default function LearningBadge() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    // Lu uniquement côté client (localStorage) une fois le composant monté,
    // pour éviter tout écart de rendu serveur/client (SSR).
    setSummary(getCalibrationSummary());
  }, []);

  if (!summary || summary.totalVerified === 0) return null;

  return (
    <span
      className="text-[11px] text-ink-700 border border-line rounded-full px-2.5 py-1"
      title="Taux de réussite des pronostics de ce navigateur, mesuré sur les matchs vérifiés — sert à calibrer l'indice de confiance affiché."
    >
      Fiabilité apprise : {summary.overallHitRatePct}% sur {summary.totalVerified} pronostics
    </span>
  );
}
