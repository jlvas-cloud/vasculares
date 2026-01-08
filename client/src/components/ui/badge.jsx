export function Badge({ children, variant = 'default', className = '' }) {
  const variants = {
    default: 'bg-primary text-primary-foreground',
    outline: 'border border-input bg-background',
    secondary: 'bg-secondary text-secondary-foreground',
  };

  return (
    <div
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
        variants[variant] || variants.default
      } ${className}`}
    >
      {children}
    </div>
  );
}
