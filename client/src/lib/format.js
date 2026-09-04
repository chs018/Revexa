// Amounts are stored in the smallest currency unit (paise for INR, cents
// for USD), same as Razorpay itself uses.
export function formatCurrency(amountInSmallestUnit, currency = 'INR') {
  if (amountInSmallestUnit == null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amountInSmallestUnit / 100);
  } catch {
    return `${amountInSmallestUnit} ${currency ?? ''}`;
  }
}
