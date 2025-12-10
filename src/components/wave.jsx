import "./wave.css";

export default function Wave({ height = '10vh', className = '' }) {
  // height controls the visible wave height; default 10vh for subtle bottom wave
  return (
    <div className={`ocean ${className}`} style={{ height }} aria-hidden="true">
      <div className="wave wave-1" />
      <div className="wave wave-2" />
      <div className="wave wave-3" />
    </div>
  );
}