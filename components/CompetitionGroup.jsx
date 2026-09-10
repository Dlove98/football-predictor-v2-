'use client';

import Image from 'next/image';

export default function CompetitionGroup({ competition, children }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2.5 mb-3 px-0.5">
        {competition?.emblem ? (
          <div className="w-5 h-5 relative shrink-0">
            <Image
              src={competition.emblem}
              alt=""
              fill
              sizes="20px"
              className="object-contain"
              unoptimized
            />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full bg-base-700 border border-line shrink-0" />
        )}
        <h2 className="text-sm font-semibold text-ink-100">{competition?.name || 'Compétition'}</h2>
        {competition?.tier && (
          <span className="text-[11px] text-ink-700 border border-line rounded-full px-2 py-0.5">
            {competition.tier}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}
