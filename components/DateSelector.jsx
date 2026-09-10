'use client';

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// Fenêtre glissante V2.0 : J-2 et J-1 (matchs passés, pour l'audit des
// pronostics — module 4) jusqu'à J+5 (matchs à venir).
const DAYS_BEFORE = 2;
const DAYS_AFTER = 5;

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function buildDays() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: DAYS_BEFORE + DAYS_AFTER + 1 }, (_, index) => {
    const offset = index - DAYS_BEFORE;
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + offset);

    let label;
    if (offset === 0) label = "Aujourd'hui";
    else if (offset === 1) label = 'Demain';
    else if (offset === -1) label = 'Hier';
    else if (offset === -2) label = 'Avant-hier';
    else label = `${DAY_LABELS[date.getUTCDay()]} ${date.getUTCDate()}`;

    return { iso: toISODate(date), label, isPast: offset < 0 };
  });
}

export default function DateSelector({ selectedDate, onSelectDate }) {
  const days = buildDays();

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
      {days.map((day) => {
        const isActive = day.iso === selectedDate;
        return (
          <button
            key={day.iso}
            onClick={() => onSelectDate(day.iso)}
            aria-pressed={isActive}
            className={[
              'shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors border flex items-center gap-1.5',
              isActive
                ? 'bg-signal-home/15 border-signal-home/40 text-signal-home'
                : 'bg-base-800 border-line text-ink-500 hover:text-ink-100 hover:border-ink-700',
            ].join(' ')}
          >
            {day.isPast && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-signal-home' : 'bg-ink-700'}`}
                title="Journée passée — audit des pronostics disponible"
              />
            )}
            {day.label}
          </button>
        );
      })}
    </div>
  );
}
