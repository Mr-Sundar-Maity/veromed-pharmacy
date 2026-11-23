import React from 'react';

interface BrandLogoProps {
  className?: string;
  tone?: 'dark' | 'light';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = '',
  tone = 'dark',
}) => {
  const textColor = tone === 'light' ? 'text-white' : 'text-slate-900';

  return (
    <span className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${className}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="#0F766E" />
        <path
          d="M14 7.5C14 6.67157 14.6716 6 15.5 6H16.5C17.3284 6 18 6.67157 18 7.5V24.5C18 25.3284 17.3284 26 16.5 26H15.5C14.6716 26 14 25.3284 14 24.5V7.5Z"
          fill="#FFFFFF"
        />
        <path
          d="M7.5 14C6.67157 14 6 14.6716 6 15.5V16.5C6 17.3284 6.67157 18 7.5 18H24.5C25.3284 18 26 17.3284 26 16.5V15.5C26 14.6716 25.3284 14 24.5 14H7.5Z"
          fill="#CCFBF1"
        />
        <circle cx="22.5" cy="9.5" r="2.5" fill="#5EEAD4" />
      </svg>
      <span className={`font-display text-lg font-bold tracking-tight ${textColor}`}>
        VeroMed
      </span>
    </span>
  );
};
