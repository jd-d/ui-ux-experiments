(function () {
  var listEl = document.querySelector('[data-archive-list]');
  if (!listEl) return;

  var statusEl = document.querySelector('[data-archive-status]');
  var summaryEl = document.querySelector('[data-archive-summary]');
  var loadMoreBtn = document.querySelector('[data-archive-more]');
  var sentinelEl = document.querySelector('[data-archive-sentinel]');

  var PAGE_SIZE = 12;
  var items = [];
  var rendered = 0;
  var observer = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    if (!value) return 'Date unavailable';
    var date = new Date(value + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      date = new Date(value);
    }
    if (isNaN(date.getTime())) return escapeHtml(value);
    try {
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (error) {
      return value;
    }
  }

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
  }

  function updateSummary(meta) {
    if (!summaryEl) return;
    if (!meta || !items.length) {
      summaryEl.textContent = '';
      return;
    }
    var updated = meta.generated_at ? formatDate(meta.generated_at) : null;
    var parts = [];
    parts.push(items.length + (items.length === 1 ? ' briefing' : ' briefings'));
    if (updated) {
      parts.push('updated ' + updated);
    }
    summaryEl.textContent = parts.join(' · ');
  }

  function createCard(item) {
    var slug = item.slug || '';
    var href = slug ? slug + '.html' : '#';
    var title = escapeHtml(item.title || slug || 'Untitled briefing');
    var dateLabel = formatDate(item.as_of);
    var cluster = item.cluster ? '<ul class="tag-list"><li class="tag">' + escapeHtml(item.cluster) + '</li></ul>' : '';
    var cta = slug ? 'Read the signal' : 'Read more';
    return (
      '<article class="post-card">' +
      '<span class="post-card__date">' + escapeHtml(dateLabel) + '</span>' +
      '<h3><a href="' + escapeHtml(href) + '">' + title + '</a></h3>' +
      cluster +
      '<a class="post-card__cta" href="' + escapeHtml(href) + '">' + escapeHtml(cta) + '</a>' +
      '</article>'
    );
  }

  function renderNextPage() {
    if (!items.length) {
      setStatus('No briefings available yet.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      if (observer) {
        observer.disconnect();
      }
      return;
    }

    if (rendered >= items.length) {
      setStatus('All briefings loaded.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      if (observer) {
        observer.disconnect();
      }
      return;
    }

    var nextItems = items.slice(rendered, rendered + PAGE_SIZE);
    var html = nextItems.map(createCard).join('');
    var container = document.createElement('div');
    container.innerHTML = html;
    while (container.firstChild) {
      listEl.appendChild(container.firstChild);
    }
    rendered += nextItems.length;

    if (rendered >= items.length) {
      setStatus('All briefings loaded.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      if (observer) {
        observer.disconnect();
      }
    } else {
      setStatus('Showing ' + rendered + ' of ' + items.length + ' briefings.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = false;
      }
    }
  }

  function onIntersection(entries) {
    if (!entries) return;
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        renderNextPage();
      }
    });
  }

  function onLoadMore(event) {
    if (event) {
      event.preventDefault();
    }
    renderNextPage();
  }

  function activateInfiniteScroll() {
    if (!('IntersectionObserver' in window) || !sentinelEl) {
      if (loadMoreBtn) {
        loadMoreBtn.hidden = false;
      }
      return;
    }
    if (observer) {
      observer.disconnect();
    }
    observer = new IntersectionObserver(onIntersection, {
      rootMargin: '0px 0px 320px 0px',
    });
    observer.observe(sentinelEl);
    if (loadMoreBtn) {
      loadMoreBtn.hidden = true;
    }
  }

  function resolveArchiveUrl() {
    var cacheBust = Date.now().toString();
    var script = document.currentScript;
    if (script && script.src) {
      try {
        var url = new URL('../../data/briefings_archive.json', script.src);
        url.searchParams.set('v', cacheBust);
        return url.toString();
      } catch (error) {
        console.warn('[archive] unable to resolve URL from script src', error);
      }
    }
    try {
      var loc = window.location;
      if (loc && loc.href) {
        var urlFromLocation = new URL('../data/briefings_archive.json', loc.href);
        urlFromLocation.searchParams.set('v', cacheBust);
        return urlFromLocation.toString();
      }
    } catch (error) {
      console.warn('[archive] unable to resolve URL from location', error);
    }
    return '../data/briefings_archive.json?v=' + cacheBust;
  }

  function initializeControls() {
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', onLoadMore);
      loadMoreBtn.hidden = true;
    }
  }

  function ingestData(payload) {
    if (!payload || !Array.isArray(payload.items)) {
      setStatus('All briefings data is unavailable.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      return;
    }
    items = payload.items.slice();
    updateSummary({ generated_at: payload.generated_at });
    if (!items.length) {
      setStatus('No briefings available yet.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      return;
    }
    setStatus('Preparing archive…');
    activateInfiniteScroll();
    renderNextPage();
  }

  initializeControls();
  setStatus('Loading all briefings…');

  fetch(resolveArchiveUrl(), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      ingestData(data);
    })
    .catch(function (error) {
      console.warn('[archive] failed to load archive', error);
      setStatus('Unable to load the archive right now. Please try again later.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
    });
})();
