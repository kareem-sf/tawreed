export function appendAccessibleStatus(label: string, status?: string): string {
  return status ? `${label}. ${status}` : label;
}
