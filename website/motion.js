// Decorative only: the page and downloads work independently of this script.
const particleField = document.querySelector('.hero-particles');
for (let index = 0; index < 16; index++) {
  const particle = document.createElement('span');
  const angle = index * Math.PI * 2 / 16;
  particle.style.cssText = `left:${50 + Math.cos(angle) * 44}%;top:${50 + Math.sin(angle) * 43}%;--size:${3 + index % 4}px;--duration:${12 + index % 7}s;--delay:-${index * 1.7}s;--drift:${index % 2 ? 12 : -12}px`;
  particleField.append(particle);
}

// CSS handles reduced motion; visibility pauses even an offscreen tab's particles.
function syncParticleVisibility() {
  particleField.classList.toggle('is-paused', document.hidden);
}
document.addEventListener('visibilitychange', syncParticleVisibility);
syncParticleVisibility();
