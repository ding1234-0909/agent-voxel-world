export function releasePointerLock(): void {
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    document.exitPointerLock();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('blur'));
  }
}
