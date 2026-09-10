'use client';

import Image from 'next/image';

export default function Header() {
  return (
    <header className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 relative shrink-0 rounded-lg overflow-hidden border border-line">
          <Image src="/logo-icon.png" alt="Football Predictor by DTech" fill sizes="36px" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-ink-100 leading-none">Football Predictor</h1>
          <p className="text-[11px] text-ink-500 leading-none mt-1">by DTech · V2.0</p>
        </div>
      </div>
    </header>
  );
}
