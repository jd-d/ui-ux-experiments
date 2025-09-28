(function () {
  'use strict';

  var currentScript = document.currentScript;

function resolveDataPath(relativePath) {
  if (!relativePath) return relativePath;

  var lastError = null;

  // 1) Try to resolve against the current page URL
  if (typeof window !== 'undefined' && window.location && window.location.href) {
    try {
      return new URL(relativePath, window.location.href).toString();
    } catch (error) {
      lastError = error;
    }
  }

  // 2) Fallback: resolve against the script URL
  if (currentScript && currentScript.src) {
    try {
      return new URL(relativePath, currentScript.src).toString();
    } catch (error) {
      lastError = error;
    }
  }

  // 3) If both failed, warn once with the last captured error
  if (lastError) {
    console.warn('[post-page] unable to resolve data path', lastError);
  }

  // 4) Final fallback: return the input unchanged
  return relativePath;
}

  function getSlugFromLocation() {
    var loc = window.location;
    if (!loc || !loc.pathname) return null;
    var parts = loc.pathname.split('/');
    var candidate = parts.pop();
    if (!candidate) {
      candidate = parts.pop();
    }
    if (!candidate) return null;
    if (!candidate.endsWith('.html')) return null;
    var name = candidate.replace(/\.html$/i, '');
    if (!name || name === 'index') return null;
    return name;
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return response.json();
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[_]+/g, ' ')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function normalizeLabel(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    text = text.replace(/[_\-]+/g, ' ');
    var upper = text.toUpperCase();
    if (text === upper) {
      return text;
    }
    return text
      .toLowerCase()
      .replace(/\b\w/g, function (match) {
        return match.toUpperCase();
      });
  }

  function normalizeTitle(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function dedupeTags(tags) {
    var seen = new Set();
    return tags.filter(function (tag) {
      var slug = tag && tag.slug ? tag.slug : '';
      if (!slug || seen.has(slug)) {
        return false;
      }
      seen.add(slug);
      return true;
    });
  }

  function collectTagsFromItem(item, event, domTags) {
    var tags = Array.isArray(domTags) ? domTags.slice() : [];

    function addTag(label, slugHint) {
      var labelText = normalizeLabel(label);
      var slug = slugify(slugHint || labelText);
      if (!slug || !labelText) return;
      tags.push({ slug: slug, label: labelText });
    }

    if (event) {
      if (event.cluster) {
        addTag(event.cluster, event.cluster);
      } else if (event.fingerprint_fields && event.fingerprint_fields.cluster) {
        addTag(event.fingerprint_fields.cluster, event.fingerprint_fields.cluster);
      }
      if (event.event_type) {
        addTag(event.event_type, event.event_type);
      }
    }

    if (item && item.cluster) {
      addTag(item.cluster, item.cluster);
    }

    if (item && Array.isArray(item.tags)) {
      item.tags.forEach(function (tag) {
        if (tag && tag.label && tag.slug) {
          tags.push({ slug: tag.slug, label: tag.label });
        }
      });
    }

    return dedupeTags(tags);
  }

  function buildEventIndex(eventsPayload) {
    var byUid = Object.create(null);
    var byTitle = Object.create(null);
    if (!eventsPayload || !Array.isArray(eventsPayload.events)) {
      return { byUid: byUid, byTitle: byTitle };
    }
    eventsPayload.events.forEach(function (event) {
      if (!event) return;
      if (event.uid) {
        byUid[String(event.uid)] = event;
      }
      if (event.title) {
        var key = normalizeTitle(event.title);
        if (key && !byTitle[key]) {
          byTitle[key] = event;
        }
      }
    });
    return { byUid: byUid, byTitle: byTitle };
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      var date = new Date(value + 'T00:00:00Z');
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
    } catch (error) {
      return '';
    }
    return '';
  }

  function ensurePagination(container, footer) {
    var nav = container.querySelector('[data-post-pagination]');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'post-pagination';
      nav.setAttribute('aria-label', 'Briefing navigation');
      nav.setAttribute('data-post-pagination', '');
      nav.hidden = true;

      var prevLink = document.createElement('a');
      prevLink.className = 'post-pagination__link post-pagination__link--prev';
      prevLink.setAttribute('data-pagination-prev', '');
      prevLink.href = '#';
      prevLink.hidden = true;

      var nextLink = document.createElement('a');
      nextLink.className = 'post-pagination__link post-pagination__link--next';
      nextLink.setAttribute('data-pagination-next', '');
      nextLink.href = '#';
      nextLink.hidden = true;

      nav.appendChild(prevLink);
      nav.appendChild(nextLink);

      if (footer && footer.parentNode) {
        container.insertBefore(nav, footer);
      } else {
        container.appendChild(nav);
      }
    }

    return {
      nav: nav,
      prev: nav.querySelector('[data-pagination-prev]'),
      next: nav.querySelector('[data-pagination-next]'),
    };
  }

  function ensureTagSection(container, footer) {
    var section = container.querySelector('[data-post-tags]');
    if (!section) {
      section = document.createElement('section');
      section.className = 'post-related-tags';
      section.setAttribute('data-post-tags', '');
      section.hidden = true;

      var title = document.createElement('h2');
      title.className = 'post-related-tags__title';
      title.textContent = 'Explore related briefings';
      section.appendChild(title);

      var list = document.createElement('ul');
      list.className = 'post-related-tags__list';
      list.setAttribute('data-post-tags-list', '');
      section.appendChild(list);

      if (footer && footer.parentNode) {
        container.insertBefore(section, footer);
      } else {
        container.appendChild(section);
      }
    }

    return {
      section: section,
      list: section.querySelector('[data-post-tags-list]'),
    };
  }

  function extractDomTags(article) {
    var tags = [];
    var metaLinks = article.querySelectorAll('.post-meta a[data-preview-label]');
    metaLinks.forEach(function (link) {
      var preview = link.getAttribute('data-preview-label') || '';
      var text = link.textContent || '';
      if (!preview || !text) return;
      if (preview.indexOf('Event type') !== -1 || preview.indexOf('Cluster') !== -1) {
        tags.push({ slug: slugify(text), label: normalizeLabel(text) });
      }
    });
    return dedupeTags(tags);
  }

  function findEmbeddedSources(contentEl) {
    var nodes = contentEl.querySelectorAll('small');
    var matches = [];
    nodes.forEach(function (node) {
      var text = (node.textContent || '').trim().toLowerCase();
      if (!text) return;
      if (text.startsWith('sources')) {
        matches.push(node);
      }
    });
    return matches;
  }

  function normalizeSourceUrl(url) {
    if (!url) return '';
    try {
      var parsed = new URL(url, window.location.href);
      var normalized = parsed.protocol.replace(/:$/, '') + '://' + parsed.hostname.toLowerCase();
      if (parsed.port) {
        normalized += ':' + parsed.port;
      }
      var path = parsed.pathname || '';
      if (path && path !== '/') {
        normalized += path.replace(/\/$/, '');
      }
      return normalized;
    } catch (error) {
      return String(url).trim();
    }
  }

  function sourceLabelFromUrl(url) {
    try {
      var parsed = new URL(url);
      var host = (parsed.hostname || '').toLowerCase();
      if (host.startsWith('www.')) {
        host = host.slice(4);
      }
      return host || url;
    } catch (error) {
      return url;
    }
  }

  function renderSources(contentEl, sources) {
    if (!Array.isArray(sources) || !sources.length) {
      return;
    }
    var seen = new Set();
    var items = [];
    sources.forEach(function (raw) {
      var normalized = normalizeSourceUrl(raw);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      items.push({ url: raw, label: sourceLabelFromUrl(normalized) });
    });
    if (!items.length) {
      return;
    }

    var section = document.createElement('section');
    section.className = 'post-sources';
    section.setAttribute('aria-label', 'Source links');

    var heading = document.createElement('h2');
    heading.className = 'post-sources__title';
    heading.textContent = 'Sources';
    section.appendChild(heading);

    var list = document.createElement('ul');
    list.className = 'post-sources__list';
    items.forEach(function (item) {
      var li = document.createElement('li');
      var anchor = document.createElement('a');
      anchor.href = item.url;
      anchor.textContent = item.label;
      anchor.rel = 'noopener noreferrer';
      anchor.target = '_blank';
      li.appendChild(anchor);
      list.appendChild(li);
    });
    section.appendChild(list);

    contentEl.appendChild(section);
  }

  function updatePagination(navElements, currentItem, prevItem, nextItem) {
    if (!navElements || !navElements.nav) {
      return;
    }
    var hasPrev = prevItem && prevItem.slug;
    var hasNext = nextItem && nextItem.slug;

    if (navElements.prev) {
      if (hasPrev) {
        var prevHref = escapeHtml(prevItem.slug) + '.html';
        navElements.prev.href = prevHref;
        navElements.prev.innerHTML =
          '<span class="post-pagination__label">&larr; Previous briefing</span>' +
          '<span class="post-pagination__title">' +
          escapeHtml(prevItem.title || prevItem.slug || 'Previous briefing') +
          '</span>' +
          (prevItem.as_of
            ? '<span class="post-pagination__date">' + escapeHtml(formatDate(prevItem.as_of)) + '</span>'
            : '');
        navElements.prev.hidden = false;
      } else {
        navElements.prev.hidden = true;
      }
    }

    if (navElements.next) {
      if (hasNext) {
        var nextHref = escapeHtml(nextItem.slug) + '.html';
        navElements.next.href = nextHref;
        navElements.next.innerHTML =
          '<span class="post-pagination__label">Next briefing &rarr;</span>' +
          '<span class="post-pagination__title">' +
          escapeHtml(nextItem.title || nextItem.slug || 'Next briefing') +
          '</span>' +
          (nextItem.as_of
            ? '<span class="post-pagination__date">' + escapeHtml(formatDate(nextItem.as_of)) + '</span>'
            : '');
        navElements.next.hidden = false;
      } else {
        navElements.next.hidden = true;
      }
    }

    navElements.nav.hidden = !(hasPrev || hasNext);
  }

  function renderTags(tagElements, tags) {
    if (!tagElements || !tagElements.section || !tagElements.list) {
      return;
    }
    tagElements.list.innerHTML = '';
    if (!Array.isArray(tags) || !tags.length) {
      tagElements.section.hidden = true;
      return;
    }

    tags.forEach(function (tag) {
      var li = document.createElement('li');
      li.className = 'post-related-tags__item';
      var anchor = document.createElement('a');
      anchor.className = 'post-related-tags__link';
      anchor.href = '../tags/index.html?tag=' + encodeURIComponent(tag.slug);
      anchor.textContent = 'See other ' + tag.label + ' briefings';
      li.appendChild(anchor);
      tagElements.list.appendChild(li);
    });

    tagElements.section.hidden = false;
  }

  function findArchiveItem(items, slug) {
    if (!Array.isArray(items)) return -1;
    var lower = slug.toLowerCase();
    for (var i = 0; i < items.length; i += 1) {
      var candidate = (items[i] && items[i].slug ? String(items[i].slug) : '').toLowerCase();
      if (candidate === lower) {
        return i;
      }
    }
    return -1;
  }

  var slug = getSlugFromLocation();
  if (!slug) return;

  var article = document.querySelector('.post');
  if (!article) return;

  if (document.querySelector('[data-archive-list]')) {
    return;
  }

  var postContent = article.querySelector('.post-content');
  if (!postContent) return;

  var postFooter = article.querySelector('.post-footer');
  var pagination = ensurePagination(article, postFooter);
  var tagElements = ensureTagSection(article, postFooter);
  var domTags = extractDomTags(article);
  var embeddedSources = findEmbeddedSources(postContent);

  Promise.all([
    fetchJson(resolveDataPath('../data/briefings_archive.json')).catch(function (error) {
      console.warn('[post-page] unable to load archive', error);
      return null;
    }),
    fetchJson(resolveDataPath('../data/events.json')).catch(function (error) {
      console.warn('[post-page] unable to load events', error);
      return null;
    }),
  ])
    .then(function (results) {
      var archivePayload = results[0];
      var eventsPayload = results[1];
      var items = archivePayload && Array.isArray(archivePayload.items) ? archivePayload.items : [];
      var eventIndex = buildEventIndex(eventsPayload);

      var index = findArchiveItem(items, slug);
      var currentItem = index >= 0 ? items[index] : null;
      var prevItem = index >= 0 && index + 1 < items.length ? items[index + 1] : null;
      var nextItem = index > 0 ? items[index - 1] : null;

      var eventUid = currentItem && currentItem.event_uid ? String(currentItem.event_uid) : null;
      var event = null;
      if (eventIndex) {
        if (eventUid && eventIndex.byUid[eventUid]) {
          event = eventIndex.byUid[eventUid];
        } else if (currentItem && currentItem.title) {
          var titleKey = normalizeTitle(currentItem.title);
          event = eventIndex.byTitle[titleKey] || null;
        }
      }

      var tags = collectTagsFromItem(currentItem, event, domTags);
      renderTags(tagElements, tags);

      updatePagination(pagination, currentItem, prevItem, nextItem);

      var sources = event && Array.isArray(event.sources) ? event.sources : [];
      if (sources.length) {
        embeddedSources.forEach(function (node) {
          if (node && node.parentNode) {
            node.parentNode.removeChild(node);
          }
        });
        renderSources(postContent, sources);
      }
    })
    .catch(function (error) {
      console.warn('[post-page] enhancements failed', error);
    });
})();
