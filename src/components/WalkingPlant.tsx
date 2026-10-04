export default function WalkingPlant({
  progress = 0,
  complete = false,
}: {
  progress?: number;
  complete?: boolean;
}) {
  const growth = complete ? 1 : Math.max(0, Math.min(1, progress));
  const scale = 0.58 + growth * 0.42;
  return (
    <svg
      className="walking-plant"
      viewBox="0 0 280 300"
      role="img"
      aria-label={
        complete
          ? "A fully grown calm plant"
          : "A calm plant growing as you walk"
      }
    >
      <defs>
        <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b8c8a9" />
          <stop offset="1" stopColor="#6d8764" />
        </linearGradient>
      </defs>
      <path className="plant-ground" d="M43 267c55-7 139-7 196 0" />
      <g transform={`translate(${140 * (1 - scale)} ${267 * (1 - scale)}) scale(${scale})`}>
        <path
          className="plant-stem"
          d="M140 266c-1-44 0-79 2-115M141 202c-20-29-39-45-62-54M145 166c22-26 42-39 66-43"
        />
        <path
          className="plant-leaf"
          d="M78 148c25-3 48 11 62 49-34 0-57-17-62-49Z"
        />
        <path className="plant-vein" d="M84 152c22 10 38 24 55 44" />
        <path
          className="plant-leaf"
          d="M211 123c-31-2-51 13-65 41 31 5 54-10 65-41Z"
        />
        <path className="plant-vein" d="M205 127c-24 9-41 21-58 36" />
        {growth > 0.42 && (
          <>
            <path className="plant-stem" d="M142 155c2-18 5-35 8-51M150 114c-17-22-27-37-35-57" />
            <path
              className="plant-leaf"
              d="M115 57c-9 28 1 49 34 59 6-29-5-48-34-59Z"
            />
            <path className="plant-vein" d="M119 63c9 20 18 35 29 51" />
          </>
        )}
        {growth > 0.68 && (
          <>
            <path className="plant-stem" d="M150 108c2-17 4-35 7-54" />
            <path
              className="plant-leaf"
              d="M157 54c-4-28 10-46 39-54 0 29-13 47-39 54Z"
            />
            <path className="plant-vein" d="M192 6c-15 16-24 31-34 46" />
          </>
        )}
      </g>
    </svg>
  );
}
