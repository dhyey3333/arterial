/**
 * Arterial's mark: a road bending through a junction, with one vehicle on it, cut out of the signature
 * off-white. One flat shape for the console bar, the landing and the favicon.
 */
export function BrandMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="#f2f2f3" />
      <path d="M5.2 17.6c3.1-.5 4.7-2.8 6-5.5s3.2-5.2 7.6-5.9" fill="none" stroke="#0a0a0b" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M5.2 12.9c2.1-.3 3.2-1.2 4.2-2.5" fill="none" stroke="#0a0a0b" strokeOpacity="0.4" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="18.6" cy="6.2" r="1.9" fill="#0a0a0b" />
    </svg>
  );
}
