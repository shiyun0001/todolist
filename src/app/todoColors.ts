export const TODO_CARD_COLORS = [
  { value: 'none', label: '素白', accent: 'transparent', swatch: 'var(--border-strong)' },
  { value: 'mist', label: '雾蓝', accent: 'oklch(70% 0.06 232)', swatch: 'oklch(70% 0.06 232)' },
  { value: 'sprout', label: '青芽', accent: 'oklch(74% 0.08 160)', swatch: 'oklch(74% 0.08 160)' },
  { value: 'sun', label: '晨金', accent: 'oklch(82% 0.09 92)', swatch: 'oklch(82% 0.09 92)' },
  { value: 'coral', label: '珊瑚', accent: 'oklch(72% 0.11 28)', swatch: 'oklch(72% 0.11 28)' },
  { value: 'lilac', label: '暮丁香', accent: 'oklch(70% 0.08 318)', swatch: 'oklch(70% 0.08 318)' },
] as const;

export const TODO_TEXT_COLORS = [
  { value: 'default', label: '默认', token: 'var(--text-main)' },
  { value: 'muted', label: '灰淡', token: 'var(--text-muted)' },
  { value: 'blue', label: '蓝', token: 'oklch(58% 0.14 240)' },
  { value: 'green', label: '绿', token: 'oklch(56% 0.14 152)' },
  { value: 'amber', label: '琥珀', token: 'oklch(60% 0.14 60)' },
  { value: 'rose', label: '玫瑰', token: 'oklch(58% 0.16 14)' },
  { value: 'purple', label: '紫', token: 'oklch(56% 0.14 300)' },
] as const;

export type TodoCardColor = (typeof TODO_CARD_COLORS)[number]['value'];
export type TodoTextColor = (typeof TODO_TEXT_COLORS)[number]['value'];

export function resolveCardColor(color: string) {
  return TODO_CARD_COLORS.find((option) => option.value === color) ?? TODO_CARD_COLORS[1];
}

export function resolveTextColor(color: string) {
  return TODO_TEXT_COLORS.find((option) => option.value === color) ?? TODO_TEXT_COLORS[0];
}
