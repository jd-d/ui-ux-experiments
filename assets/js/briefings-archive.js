(function () {
  var listEl = document.querySelector('[data-archive-list]');
  if (!listEl) return;

  var statusEl = document.querySelector('[data-archive-status]');
  var summaryEl = document.querySelector('[data-archive-summary]');
  var loadMoreBtn = document.querySelector('[data-archive-more]');
  var sentinelEl = document.querySelector('[data-archive-sentinel]');
  var clusterSelect = document.querySelector('[data-filter-cluster]');
  var timeframeSelect = document.querySelector('[data-filter-timeframe]');
  var searchInput = document.querySelector('[data-filter-search]');
  var resetBtn = document.querySelector('[data-filter-reset]');
  var controlsForm = document.querySelector('[data-archive-controls]');

  var PAGE_SIZE = 12;
  var rendered = 0;
  var observer = null;
  var allItems = [];
  var items = [];
  var archiveMeta = { generated_at: null };
  var searchTimer = null;
  var MS_IN_DAY = 24 * 60 * 60 * 1000;

  var clusterVisuals = {
    SHIPPING: { icon: '🚢', theme: 'ocean' },
    EURO_SOV: { icon: '💶', theme: 'sovereign' },
    US_CRE: { icon: '🏢', theme: 'credit' },
    CHINA_CREDIT: { icon: '💴', theme: 'asia' },
    ODTE: { icon: '📉', theme: 'volatility' },
    AI_POWER: { icon: '⚡', theme: 'energy' },
    AGRITECH: { icon: '🌾', theme: 'growth' },
    DEFAULT: { icon: '📊', theme: 'default' },
  };

  var filters = {
    cluster: '',
    timeframe: 'all',
    query: '',
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value, options) {
    if (!value) return '';
    var date = new Date(value + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      date = new Date(value);
    }
    if (isNaN(date.getTime())) {
      return escapeHtml(value);
    }
    try {
      return date.toLocaleDateString(undefined, options || {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (error) {
      return escapeHtml(value);
    }
  }

  function formatClusterLabel(value) {
    if (!value) return '';
    var text = String(value);
    if (text === text.toUpperCase()) return text;
    return text.replace(/_/g, ' ').replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
  }

  function resolveVisual(cluster) {
    var key = (cluster || '').toUpperCase();
    if (clusterVisuals[key]) return clusterVisuals[key];
    return clusterVisuals.DEFAULT;
  }

  function renderTags(clusterLabel, tags) {
    var unique = [];
    var seen = {};
    if (clusterLabel) {
      unique.push(clusterLabel);
      seen[clusterLabel.toLowerCase()] = true;
    }
    if (Array.isArray(tags)) {
      for (var i = 0; i < tags.length; i += 1) {
        var label = tags[i] && (tags[i].label || tags[i].name);
        if (!label) continue;
        var key = String(label).toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        unique.push(String(label));
        if (unique.length >= 4) break;
      }
    }
    if (!unique.length) return '';
    return (
      '<ul class="tag-list">' +
      unique
        .map(function (label) {
          return '<li class="tag">' + escapeHtml(label) + '</li>';
        })
        .join('') +
      '</ul>'
    );
  }

  function setStatus(message) {
    if (statusEl) {
      statusEl.textContent = message || '';
    }
  }

  function resetRendering() {
    rendered = 0;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (loadMoreBtn) {
      loadMoreBtn.hidden = true;
    }
    listEl.innerHTML = '';
  }

  function updateSummary() {
    if (!summaryEl) return;
    if (!allItems.length) {
      summaryEl.textContent = '';
      return;
    }
    var updated = archiveMeta.generated_at ? formatDate(archiveMeta.generated_at) : null;
    var visibleCount = items.length;
    var totalCount = allItems.length;
    var parts = [];
    if (visibleCount === totalCount) {
      parts.push(visibleCount + (visibleCount === 1 ? ' briefing' : ' briefings'));
    } else {
      parts.push(visibleCount + ' of ' + totalCount + ' briefings');
    }
    if (filters.cluster) {
      parts.push('cluster: ' + formatClusterLabel(filters.cluster));
    }
    if (filters.timeframe !== 'all') {
      parts.push('timeframe: last ' + filters.timeframe + ' days');
    }
    if (updated) {
      parts.push('updated ' + updated);
    }
    summaryEl.textContent = parts.join(' · ');
  }

  function matchesCluster(item) {
    if (!filters.cluster) return true;
    var cluster = String(item.cluster || '').toLowerCase();
    return cluster === filters.cluster.toLowerCase();
  }

  function matchesTimeframe(item) {
    if (!filters.timeframe || filters.timeframe === 'all') return true;
    var days = parseInt(filters.timeframe, 10);
    if (!days || !item.as_of) return true;
    var itemDate = new Date(item.as_of + 'T00:00:00Z');
    if (isNaN(itemDate.getTime())) {
      itemDate = new Date(item.as_of);
    }
    if (isNaN(itemDate.getTime())) return true;
    var now = new Date();
    var diff = now.getTime() - itemDate.getTime();
    return diff <= days * MS_IN_DAY;
  }

  function matchesQuery(item) {
    var query = filters.query;
    if (!query) return true;
    var haystack = [
      item.title || '',
      item.summary || '',
      item.cluster || '',
    ];
    if (Array.isArray(item.tags)) {
      for (var i = 0; i < item.tags.length; i += 1) {
        var tagLabel = item.tags[i] && (item.tags[i].label || item.tags[i].name || '');
        if (tagLabel) {
          haystack.push(tagLabel);
        }
      }
    }
    var joined = haystack.join(' ').toLowerCase();
    return joined.indexOf(query) !== -1;
  }

  function applyFilters() {
    items = allItems.filter(function (item) {
      return matchesCluster(item) && matchesTimeframe(item) && matchesQuery(item);
    });
    resetRendering();
    updateSummary();
    if (!items.length) {
      setStatus('No briefings match your filters yet.');
      return;
    }
    setStatus('Preparing filtered archive…');
    activateInfiniteScroll();
    renderNextPage();
  }

  function createCard(item) {
    var slug = item.slug || '';
    var href = slug ? slug + '.html' : '#';
    var title = item.title || slug || 'Untitled briefing';
    var summary = item.summary || '';
    var cluster = item.cluster || '';
    var clusterLabel = formatClusterLabel(cluster);
    var dateLabel = formatDate(item.as_of);
    var visual = resolveVisual(cluster);
    var iconLabel = clusterLabel ? clusterLabel + ' signal' : 'Trigger signal';

    return (
      '<article class="post-card post-card--enhanced post-card--theme-' +
      escapeHtml(visual.theme) +
      '">' +
        '<a class="post-card__visual" href="' + escapeHtml(href) + '" tabindex="-1" aria-hidden="true">' +
        '<span class="post-card__glyph" aria-hidden="true">' + escapeHtml(visual.icon) + '</span>' +
        '<span class="sr-only">' + escapeHtml(iconLabel) + '</span>' +
        '</a>' +
        '<div class="post-card__body">' +
        (dateLabel ? '<span class="post-card__date">' + escapeHtml(dateLabel) + '</span>' : '') +
        '<h3><a href="' + escapeHtml(href) + '">' + escapeHtml(title) + '</a></h3>' +
        (summary ? '<p class="post-card__summary">' + escapeHtml(summary) + '</p>' : '') +
        renderTags(clusterLabel, item.tags) +
        '<a class="post-card__cta" href="' + escapeHtml(href) + '">Read the signal</a>' +
        '</div>' +
      '</article>'
    );
  }

  function renderNextPage() {
    if (!items.length) {
      setStatus('No briefings match your filters yet.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      if (observer) {
        observer.disconnect();
      }
      return;
    }

    if (rendered >= items.length) {
      setStatus('All filtered briefings are loaded.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      if (observer) {
        observer.disconnect();
      }
      return;
    }

    var nextItems = items.slice(rendered, rendered + PAGE_SIZE);
    var container = document.createElement('div');
    container.innerHTML = nextItems.map(createCard).join('');
    while (container.firstChild) {
      listEl.appendChild(container.firstChild);
    }
    rendered += nextItems.length;

    if (rendered >= items.length) {
      setStatus('All filtered briefings are loaded.');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = true;
      }
      if (observer) {
        observer.disconnect();
      }
    } else {
      setStatus('Showing ' + rendered + ' of ' + items.length + ' matching briefings.');
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

  function populateClusterOptions(dataset) {
    if (!clusterSelect) return;
    var seen = {};
    dataset.forEach(function (item) {
      var cluster = item.cluster;
      if (!cluster) return;
      var normalized = String(cluster).toUpperCase();
      if (seen[normalized]) return;
      seen[normalized] = true;
    });
    var keys = Object.keys(seen).sort();
    var fragment = document.createDocumentFragment();
    keys.forEach(function (clusterKey) {
      var option = document.createElement('option');
      option.value = clusterKey;
      option.textContent = formatClusterLabel(clusterKey);
      fragment.appendChild(option);
    });
    clusterSelect.appendChild(fragment);
  }

  function handleClusterChange(event) {
    filters.cluster = (event.target && event.target.value) || '';
    applyFilters();
  }

  function handleTimeframeChange(event) {
    filters.timeframe = (event.target && event.target.value) || 'all';
    applyFilters();
  }

  function handleSearchInput(event) {
    var value = (event.target && event.target.value) || '';
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(function () {
      filters.query = value.trim().toLowerCase();
      applyFilters();
    }, 180);
  }

  function handleReset(event) {
    if (event) {
      event.preventDefault();
    }
    if (controlsForm) {
      controlsForm.reset();
    }
    filters.cluster = '';
    filters.timeframe = 'all';
    filters.query = '';
    applyFilters();
  }

  function initializeControls() {
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', onLoadMore);
      loadMoreBtn.hidden = true;
    }
    if (clusterSelect) {
      clusterSelect.addEventListener('change', handleClusterChange);
    }
    if (timeframeSelect) {
      timeframeSelect.addEventListener('change', handleTimeframeChange);
    }
    if (searchInput) {
      searchInput.addEventListener('input', handleSearchInput);
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', handleReset);
    }
    if (controlsForm) {
      controlsForm.addEventListener('reset', function () {
        window.setTimeout(function () {
          handleReset();
        }, 0);
      });
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
    archiveMeta.generated_at = payload.generated_at || null;
    allItems = payload.items.slice();
    populateClusterOptions(allItems);
    applyFilters();
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
