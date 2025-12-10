import "./loading.css";

export default function Loading({ size = 'small' }) {
  const cls = size === 'small' ? 'box-canvas box-small' : 'box-canvas';
  return (
    <div className={cls} role="status" aria-label="Loading">
      <div className="machine">
        <div className="drawer"></div>
        <div className="panel"></div>
        <div className="divider"></div>
        <div className="door">
          <div className="drum"></div>
        </div>
      </div>
    </div>
  );
}