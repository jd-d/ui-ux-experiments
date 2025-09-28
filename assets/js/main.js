(function () {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
      nav.classList.toggle('open');
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        if (nav.classList.contains('open')) {
          nav.classList.remove('open');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  const form = document.querySelector('.subscribe__form');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const email = (formData.get('email') || '').toString().trim();
      if (!email) {
        return;
      }

      const existing = form.parentElement?.querySelector('.subscribe__message');
      if (existing) {
        existing.remove();
      }

      const message = document.createElement('p');
      message.className = 'subscribe__message';
      message.setAttribute('role', 'status');
      message.textContent = `Thanks! Cycle updates will be sent to ${email}.`;
      message.style.marginTop = '1rem';
      message.style.color = 'var(--color-text-muted)';
      form.parentElement?.appendChild(message);
      form.reset();
    });
  }

  const confirmLinks = document.querySelectorAll('[data-confirm-link]');
  if (confirmLinks.length && document.body) {
    const announcer = document.createElement('div');
    announcer.className = 'sr-only confirm-link-announcer';
    announcer.setAttribute('aria-live', 'polite');
    document.body.appendChild(announcer);

    confirmLinks.forEach((link) => {
      let resetTimer;

      const disarm = () => {
        if (resetTimer) {
          window.clearTimeout(resetTimer);
          resetTimer = undefined;
        }
        delete link.dataset.confirmArmed;
        link.classList.remove('confirm-link--armed');
      };

      link.addEventListener('click', (event) => {
        if (link.dataset.confirmArmed === 'true') {
          disarm();
          return;
        }

        event.preventDefault();
        link.dataset.confirmArmed = 'true';
        link.classList.add('confirm-link--armed');
        const preview =
          link.getAttribute('data-preview-label') || `Opens ${link.getAttribute('href')}`;
        announcer.textContent = `${preview}. Click again to open.`;

        if (resetTimer) {
          window.clearTimeout(resetTimer);
        }
        resetTimer = window.setTimeout(() => {
          disarm();
        }, 4000);
      });

      link.addEventListener('blur', () => {
        disarm();
      });

      link.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          disarm();
        }
      });
    });
  }

  function resolveAssetPath(relativePath) {
    const current = document.currentScript;
    if (current && current.src) {
      try {
        const url = new URL(relativePath, current.src);
        return url.toString();
      } catch (error) {
        console.warn('[main] unable to resolve asset path', error);
      }
    }
    return relativePath;
  }

  function bootstrapPostEnhancements() {
    const slug = (function deriveSlug() {
      const path = window.location && window.location.pathname;
      if (!path) return null;
      const parts = path.split('/');
      let candidate = parts.pop();
      if (!candidate) {
        candidate = parts.pop();
      }
      if (!candidate) return null;
      if (!candidate.endsWith('.html')) return null;
      const name = candidate.replace(/\.html$/i, '');
      if (!name || name === 'index') return null;
      return name;
    })();

    if (!slug) {
      return;
    }

    const script = document.createElement('script');
    script.src = resolveAssetPath('post-page.js');
    script.defer = true;
    script.type = 'text/javascript';
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapPostEnhancements, {
      once: true,
    });
  } else {
    bootstrapPostEnhancements();
  }
})();
