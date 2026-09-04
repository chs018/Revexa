import { useParams } from 'react-router-dom';

export default function Detail() {
  const { id } = useParams();

  return (
    <div className="p-8">
      <h1 className="font-display text-xl font-semibold text-(--color-graphite)">Dispute Detail</h1>
      <p className="mt-2 text-sm text-graphite-muted">
        Full dispute detail, evidence draft, and approve/reject actions for{' '}
        <span className="font-mono text-(--color-graphite)">{id}</span> land here on Day 6.
      </p>
    </div>
  );
}
