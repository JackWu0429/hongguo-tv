(function () {
  'use strict';

  // TV remote buttons are routed by semantic zones. A geometry-only algorithm
  // can jump from the sidebar to a right-side action just because it is close
  // on screen, which is especially confusing on a TV.
  var zoneSelectors = {
    sidebar: '.side-item',
    channels: '.channel-tab',
    feed: '.hero-feed-focus',
    catalog: '.catalog-card',
    actions: '.round-action',
    controls: '.control-button',
    searchInput: '#search-input',
    searchActions: '.search-action',
    searchFilters: '.search-filter',
    searchResults: '.search-result-card',
    searchMore: '.search-more',
    rankTabs: '.rank-tab',
    rankSubnav: '.rank-subtab',
    rankItems: '.rank-row',
    rankActions: '.rank-row-play, .rank-row-detail',
    newTabs: '.new-tab',
    newFilters: '.new-filter',
    newItems: '.new-card',
    calendarDays: '.calendar-day',
    calendarItems: '.calendar-row',
    reservationTabs: '.reservation-tab',
    libraryActions: '.library-toolbar-button',
    libraryItems: '.library-card',
    libraryRemovals: '.library-remove',
    confirmation: '.confirm-button',
    modalActions: '.modal-action',
    episodes: '.detail-episode'
  };
  var status = document.getElementById('core-status');
  var notice = document.getElementById('action-notice');
  var shell = document.querySelector('.app-shell');
  var mainSurface = document.getElementById('main-surface');
  var pagePlaceholder = document.getElementById('page-placeholder');
  var detailModal = document.getElementById('detail-modal');
  var detailModalOpen = false;
  var detailGeneration = 0;
  var detailReturnFocus = null;
  var currentDetail = null;
  var lastContentFocus = null;
  var lastPageFocus = {};
  var catalogGeneration = 0;
  var featuredItem = null;
  var feedItems = [];
  var feedIndex = -1;
  var feedGeneration = 0;
  var searchGeneration = 0;
  var searchInput = document.getElementById('search-input');
  var searchPage = document.getElementById('search-page');
  var searchResults = document.getElementById('search-results');
  var searchMore = document.getElementById('search-more');
  var filterRows = [];
  var searchPanelPending = false;
  var searchFilters = { genre: '', sort: 'hot_score' };
  var searchKind = 'browse';
  var searchItems = [];
  var searchNextOffset = 0;
  var searchSession = '';
  var searchHasMore = false;
  var searchBusy = false;
  var searchLoaded = false;
  var searchFailed = false;
  var rankPage = document.getElementById('rank-page');
  var rankList = document.getElementById('rank-list');
  var newPage = document.getElementById('new-page');
  var newGrid = document.getElementById('new-grid');
  var calendarList = document.getElementById('calendar-list');
  var dateStrip = document.getElementById('new-date-strip');
  var reservationPage = document.getElementById('reservation-page');
  var rankItems = [];
  var newItems = [];
  var newMode = 'recommend';
  var newGender = 'all';
  var calendarOffset = 0;
  var currentRankPath = '/rank/hot-drama';
  var rankGeneration = 0;
  var newGeneration = 0;
  var playerReturnPage = null;
  var playerReturnFocus = null;
  var libraryPage = document.getElementById('library-page');
  var libraryData = { entries: [] };
  var libraryLoaded = false;
  var libraryError = '';
  var libraryEditing = false;
  var libraryQueue = Promise.resolve();
  var libraryReady;
  var confirmOpen = false;
  var confirmReturnFocus = null;
  var confirmOperation = null;
  var confirmationGeneration = 0;
  var activePlayback = null;
  var detailCache = {};
  var keyNames = {
    19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft', 22: 'ArrowRight',
    23: 'Enter', 66: 'Enter', 4: 'Escape', 111: 'Escape'
  };
  var channelPaths = {
    'channel-follow': '/rank/hot-drama',
    'channel-comic': '/category/comic-drama',
    'channel-real': '/category/real-drama',
    'channel-recommend': '/rank/hot-drama'
  };

  function pageMode() {
    return shell && shell.dataset.mode ? shell.dataset.mode : 'recommend';
  }

  function focusables(selector) {
    var result = [];
    var query = selector || Object.keys(zoneSelectors).map(function (zone) { return zoneSelectors[zone]; }).join(',');
    Array.prototype.forEach.call(document.querySelectorAll(query), function (element) {
      var style = window.getComputedStyle(element);
      var insideModal = element.closest && element.closest('#detail-modal');
      if (confirmOpen) { if (!element.closest('#confirm-modal')) return; }
      else if (detailModalOpen ? !insideModal : insideModal) return;
      if (!element.getClientRects || !element.getClientRects().length) return;
      if (!element.disabled && style.display !== 'none' && style.visibility !== 'hidden') result.push(element);
    });
    return result;
  }

  function firstVisible(selector) {
    return focusables(selector)[0] || null;
  }

  function markFocus(element) {
    document.querySelectorAll('.is-focused').forEach(function (node) { node.classList.remove('is-focused'); });
    if (element) element.classList.add('is-focused');
  }

  function zoneOf(element) {
    if (!element) return '';
    if (element.classList.contains('side-item')) return 'sidebar';
    if (element.classList.contains('channel-tab')) return 'channels';
    if (element.classList.contains('hero-feed-focus')) return 'feed';
    if (element.classList.contains('catalog-card')) return 'catalog';
    if (element.classList.contains('round-action')) return 'actions';
    if (element.classList.contains('control-button')) return 'controls';
    if (element.id === 'search-input') return 'searchInput';
    if (element.classList.contains('search-action')) return 'searchActions';
    if (element.classList.contains('search-filter')) return 'searchFilters';
    if (element.classList.contains('search-result-card')) return 'searchResults';
    if (element.classList.contains('search-more')) return 'searchMore';
    if (element.classList.contains('rank-tab')) return 'rankTabs';
    if (element.classList.contains('rank-subtab')) return 'rankSubnav';
    if (element.classList.contains('rank-row')) return 'rankItems';
    if (element.classList.contains('rank-row-play') || element.classList.contains('rank-row-detail')) return 'rankActions';
    if (element.classList.contains('new-tab')) return 'newTabs';
    if (element.classList.contains('new-filter')) return 'newFilters';
    if (element.classList.contains('new-card')) return 'newItems';
    if (element.classList.contains('calendar-day')) return 'calendarDays';
    if (element.classList.contains('calendar-row')) return 'calendarItems';
    if (element.classList.contains('reservation-tab')) return 'reservationTabs';
    if (element.classList.contains('library-toolbar-button')) return 'libraryActions';
    if (element.classList.contains('library-card')) return 'libraryItems';
    if (element.classList.contains('library-remove')) return 'libraryRemovals';
    if (element.classList.contains('confirm-button')) return 'confirmation';
    if (element.classList.contains('detail-episode')) return 'episodes';
    if (element.classList.contains('modal-action')) return 'modalActions';
    if (element.classList.contains('page-placeholder-action')) return 'placeholder';
    if (element.classList.contains('primary-action')) return 'hero';
    return '';
  }

  function goFocus(element) {
    if (!element || element.disabled) return;
    element.focus({ preventScroll: false });
    markFocus(element);
    if (!detailModalOpen && !confirmOpen && zoneOf(element) !== 'sidebar') {
      lastContentFocus = element;
      lastPageFocus[pageMode()] = element;
    }
  }

  function firstContentFocus() {
    if (pageMode() === 'player') return document.querySelector('.hero-feed-focus');
    var remembered = lastPageFocus[pageMode()];
    if (remembered && focusables().indexOf(remembered) >= 0) return remembered;
    if (pageMode() === 'search') return searchInput || document.querySelector('.search-submit');
    if (isLibraryPage()) return firstVisible('.library-card') || firstVisible('[data-action="library-discover"]') || firstVisible('.library-toolbar-button');
    if (pageMode() === 'rank') return firstVisible('.rank-tab.is-active') || firstRankTab();
    if (pageMode() === 'new') return firstVisible('.new-tab.is-active') || firstNewTab();
    if (pageMode() === 'reservations') return firstVisible('.reservation-tab.is-active');
    if (pageMode() !== 'recommend') return document.querySelector('.page-placeholder-action');
    return document.querySelector('.hero-feed-focus') || document.querySelector('.channel-tab.is-active') || document.querySelector('.catalog-card') || firstVisible('.primary-action');
  }

  function activeSidebar() {
    return document.querySelector('.side-item.is-active') || document.querySelector('.side-item');
  }

  function activeChannel() {
    return document.querySelector('.channel-tab.is-active') || document.querySelector('.channel-tab');
  }

  function firstCatalog() {
    return document.querySelector('.catalog-card');
  }

  function firstSearchFilter() {
    return firstVisible('.search-filter');
  }

  function firstSearchResult() {
    return firstVisible('.search-result-card');
  }

  function firstRankTab() { return firstVisible('.rank-tab'); }
  function firstRankSubtab() { return firstVisible('.rank-subtab'); }
  function firstRankRow() { return firstVisible('.rank-row'); }
  function firstNewTab() { return firstVisible('.new-tab'); }
  function firstNewFilter() { return firstVisible('.new-filter'); }
  function firstNewCard() { return firstVisible('.new-card'); }
  function firstCalendarDay() { return firstVisible('.calendar-day.is-active') || firstVisible('.calendar-day'); }
  function firstCalendarRow() { return firstVisible('.calendar-row'); }

  function hideWorkspacePages() {
    [rankPage, newPage, reservationPage, libraryPage].forEach(function (page) {
      if (page) page.classList.add('is-hidden');
    });
  }

  function moveSearchFilter(current, direction) {
    var row = current && current.closest ? current.closest('.filter-row') : null;
    if (!row) return null;
    var items = focusables('.filter-row[data-filter-group="' + row.dataset.filterGroup + '"] .search-filter');
    if (direction === 'left' || direction === 'right') {
      var index = items.indexOf(current);
      if (index < 0) return items[0] || null;
      index += direction === 'left' ? -1 : 1;
      return items[index] || (direction === 'left' ? activeSidebar() : null);
    }
    var rows = [];
    document.querySelectorAll('.filter-row[data-filter-group]').forEach(function (node) { rows.push(node); });
    var rowIndex = rows.indexOf(row);
    var targetRowIndex = rowIndex + (direction === 'up' ? -1 : 1);
    if (targetRowIndex < 0) return searchInput;
    if (targetRowIndex >= rows.length) return firstSearchResult() || firstVisible('.search-more');
    var targetItems = focusables('.filter-row[data-filter-group="' + rows[targetRowIndex].dataset.filterGroup + '"] .search-filter');
    if (!targetItems.length) return null;
    var currentRect = current.getBoundingClientRect();
    var best = targetItems[0];
    var bestDistance = Infinity;
    targetItems.forEach(function (node) {
      var distance = Math.abs(node.getBoundingClientRect().left - currentRect.left);
      if (distance < bestDistance) { bestDistance = distance; best = node; }
    });
    return best;
  }

  function moveWithinZone(zone, current, direction) {
    var items = focusables(zoneSelectors[zone]);
    var index = items.indexOf(current);
    if (index < 0) return items[0] || null;
    if (direction === 'up' || direction === 'left') index -= 1;
    if (direction === 'down' || direction === 'right') index += 1;
    return items[index] || null;
  }

  function moveGrid(selector, current, direction) {
    var currentRect = current && current.getBoundingClientRect ? current.getBoundingClientRect() : null;
    if (!currentRect) return null;
    var candidates = focusables(selector).filter(function (node) { return node !== current; });
    var currentX = currentRect.left + currentRect.width / 2;
    var currentY = currentRect.top + currentRect.height / 2;
    var vertical = direction === 'up' || direction === 'down';
    var best = null;
    var bestScore = Infinity;
    candidates.forEach(function (node) {
      var rect = node.getBoundingClientRect();
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var rowDelta = direction === 'down' ? y - currentY : currentY - y;
      if (vertical && rowDelta <= 16) return;
      if (!vertical) {
        if (Math.abs(y - currentY) > 16) return;
        var columnDelta = direction === 'right' ? x - currentX : currentX - x;
        if (columnDelta > 8 && columnDelta < bestScore) { bestScore = columnDelta; best = node; }
        return;
      }
      var horizontal = Math.abs(x - currentX);
      var score = rowDelta * 100 + horizontal;
      if (score < bestScore) { bestScore = score; best = node; }
    });
    return best;
  }

  function moveModalFrom(current, direction) {
    var zone = zoneOf(current);
    if (zone === 'modalActions') {
      if (current.id === 'detail-close') return direction === 'down' ? document.getElementById('detail-play') : null;
      if (direction === 'left') return current.id === 'detail-save' ? document.getElementById('detail-play') : null;
      if (direction === 'right') return current.id === 'detail-play' ? document.getElementById('detail-save') : null;
      if (direction === 'up') return document.getElementById('detail-close');
      if (direction === 'down') return document.querySelector('.detail-episode.is-playing') || document.querySelector('.detail-episode');
      return null;
    }
    if (zone === 'episodes') {
      if (direction === 'left' || direction === 'right') {
        var episodeTarget = moveGrid('.detail-episode', current, direction);
        return episodeTarget || (direction === 'left' ? document.querySelector('.detail-close') : null);
      }
      if (direction === 'up') return moveGrid('.detail-episode', current, direction) || document.querySelector('.detail-play') || document.querySelector('.detail-close');
      if (direction === 'down') return moveGrid('.detail-episode', current, direction);
      return null;
    }
    return null;
  }

  function moveFrom(current, direction) {
    if (confirmOpen) return direction === 'left' || direction === 'right' ? moveWithinZone('confirmation', current, direction) : null;
    if (detailModalOpen) return moveModalFrom(current, direction);
    var zone = zoneOf(current);
    if (zone === 'sidebar') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'right') return firstContentFocus();
      return null;
    }
    if (zone === 'channels') {
      if (direction === 'left' || direction === 'right') {
        var channelTarget = moveWithinZone(zone, current, direction);
        return channelTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'down') return firstVisible('.hero-feed-focus') || firstCatalog() || firstVisible('.primary-action');
      if (direction === 'up') return activeSidebar();
      return null;
    }
    if (zone === 'feed') {
      if (direction === 'left') return activeSidebar();
      if (direction === 'right') return firstVisible('.round-action') || firstVisible('.control-button');
      if (direction === 'down') return firstVisible('.control-button');
      if (direction === 'up') return pageMode() === 'player' ? null : activeChannel();
      return null;
    }
    if (zone === 'hero') {
      if (direction === 'right') return document.querySelector('.round-action');
      if (direction === 'down') return firstCatalog() || firstVisible('.control-button');
      if (direction === 'up') return activeChannel();
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'placeholder') {
      if (direction === 'up') return activeSidebar();
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'catalog') {
      if (direction === 'left' || direction === 'right') {
        var cardTarget = moveWithinZone(zone, current, direction);
        return cardTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return firstVisible('.primary-action') || activeChannel();
      if (direction === 'down') return document.querySelector('.control-button');
      return null;
    }
    if (zone === 'actions') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return firstVisible('.hero-feed-focus') || firstVisible('.primary-action') || firstCatalog();
      return null;
    }
    if (zone === 'controls') {
      if (direction === 'left' || direction === 'right') {
        var controlTarget = moveWithinZone(zone, current, direction);
        return controlTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return firstVisible('.hero-feed-focus') || firstCatalog() || firstVisible('.primary-action');
      return null;
    }
    if (zone === 'searchInput') {
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstSearchFilter() || firstVisible('.search-submit');
      if (direction === 'right') return firstVisible('.search-submit');
      return null;
    }
    if (zone === 'searchActions') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? searchInput : null);
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstSearchFilter() || firstSearchResult();
      return null;
    }
    if (zone === 'searchFilters') {
      return moveSearchFilter(current, direction);
    }
    if (zone === 'searchResults') {
      if (direction === 'left' || direction === 'right') {
        var resultTarget = moveGrid('.search-result-card', current, direction);
        return resultTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return moveGrid('.search-result-card', current, direction) || lastSearchFilter() || searchInput;
      if (direction === 'down') return moveGrid('.search-result-card', current, direction) || firstVisible('.search-more');
      return null;
    }
    if (zone === 'searchMore') {
      if (direction === 'up') { var cards = focusables('.search-result-card'); return cards[cards.length - 1] || lastSearchFilter() || searchInput; }
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'libraryActions') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'down') return firstVisible('.library-card') || firstVisible('[data-action="library-discover"]');
      if (direction === 'up') return firstVisible('.library-card') || activeSidebar();
      return null;
    }
    if (zone === 'libraryItems') {
      if (direction === 'left' || direction === 'right') return moveGrid('.library-card', current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return moveGrid('.library-card', current, direction) || firstVisible('.library-toolbar-button');
      if (direction === 'down') return libraryEditing ? current.parentElement.querySelector('.library-remove') : moveGrid('.library-card', current, direction);
      return null;
    }
    if (zone === 'libraryRemovals') {
      if (direction === 'up') return current.parentElement.querySelector('.library-card');
      if (direction === 'down') return moveGrid('.library-card', current.parentElement.querySelector('.library-card'), 'down');
      if (direction === 'left' || direction === 'right') return moveGrid('.library-remove', current, direction) || (direction === 'left' ? activeSidebar() : null);
      return null;
    }
    if (zone === 'rankTabs') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstVisible('.rank-subtab.is-active') || firstRankSubtab() || firstRankRow();
      return null;
    }
    if (zone === 'rankSubnav') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.rank-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return activeSidebar();
      if (direction === 'right') return firstRankRow();
      return moveWithinZone(zone, current, direction);
    }
    if (zone === 'rankItems') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.rank-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return firstVisible('.rank-subtab.is-active');
      if (direction === 'right') return current.querySelector('.rank-row-play');
      return null;
    }
    if (zone === 'rankActions') {
      var row = current.closest('.rank-row');
      if (direction === 'left') return row;
      if (direction === 'up' && current.classList.contains('rank-row-detail')) return row.querySelector('.rank-row-play');
      if (direction === 'down' && current.classList.contains('rank-row-play')) return row.querySelector('.rank-row-detail');
      if (direction === 'up' || direction === 'down') return moveFrom(row, direction);
      return null;
    }
    if (zone === 'newTabs') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : firstNewFilter());
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstNewFilter() || (newMode === 'calendar' ? firstCalendarDay() : firstNewCard());
      return null;
    }
    if (zone === 'newFilters') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? firstVisible('.new-tab.is-active') : null);
      if (direction === 'up') return firstNewTab();
      if (direction === 'down') return newMode === 'calendar' ? firstCalendarDay() : firstNewCard();
      return null;
    }
    if (zone === 'newItems') {
      if (direction === 'left' || direction === 'right') return moveGrid('.new-card', current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return moveGrid('.new-card', current, direction) || firstNewFilter() || firstNewTab();
      if (direction === 'down') return moveGrid('.new-card', current, direction);
      return null;
    }
    if (zone === 'calendarDays') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return firstNewTab();
      if (direction === 'down') return firstCalendarRow();
      return null;
    }
    if (zone === 'calendarItems') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstCalendarDay();
      if (direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'reservationTabs') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return activeSidebar();
      return null;
    }
    return direction === 'right' ? firstContentFocus() : activeSidebar();
  }

  function normalizedKey(event) {
    var key = event.key;
    if (!key || key === 'Unidentified' || key === 'Unknown') key = keyNames[event.keyCode] || '';
    if (key === 'GoBack' || key === 'BrowserBack') key = 'Escape';
    return key;
  }

  function handleKey(event) {
    var key = normalizedKey(event);
    var current = document.activeElement;
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[key];

    if (current && current.id === 'search-input' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;

    if (key === 'Enter') {
      if (event.repeat) { event.preventDefault(); return; }
      if (current && current.id === 'search-input') {
        submitSearch();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (current && typeof current.click === 'function') {
        current.click();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (key === 'Escape' || key === 'Backspace') {
      var handledBack = confirmOpen || detailModalOpen || pageMode() === 'player' || zoneOf(current) !== 'sidebar';
      if (confirmOpen) {
        closeConfirmation();
      } else if (detailModalOpen) {
        closeDetail();
      } else if (pageMode() === 'player') {
        leavePlayer();
      } else if (zoneOf(current) !== 'sidebar') {
        goFocus(activeSidebar());
      }
      if (handledBack) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!direction) return;
    if (!detailModalOpen && pageMode() === 'recommend' && zoneOf(current) === 'feed' && (direction === 'up' || direction === 'down')) {
      playFeedItem(feedIndex + (direction === 'up' ? -1 : 1));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    var target = moveFrom(current, direction);
    if (target) {
      goFocus(target);
    }
    // Consume boundary keys too; WebView must not scroll the page or perform
    // its own focus search when the remote reaches the end of a zone.
    event.preventDefault();
    event.stopPropagation();
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.remove('is-hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(function () { notice.classList.add('is-hidden'); }, 3200);
  }

  function isLibraryPage() { return ['history', 'favorites', 'likes'].indexOf(pageMode()) >= 0; }
  function libraryEntry(id) { return libraryData.entries.filter(function (entry) { return entry.drama.series_id === id; })[0] || null; }
  function libraryTime(entry, kind) { return entry[({ history: 'last_played_at', favorites: 'favorite_at', likes: 'liked_at' })[kind]] || 0; }
  function resumeEpisode(entry, item) {
    if (!entry || !entry.last_played_at || !entry.episode) return 1;
    if (!entry.completed) return entry.episode;
    return item.episode_count && entry.episode >= item.episode_count ? 1 : entry.episode + 1;
  }
  function clockText(value) { value = Math.max(0, Math.floor(value || 0)); return Math.floor(value / 60) + ':' + ('0' + value % 60).slice(-2); }
  function basicDrama(item) {
    var result = {};
    ['series_id', 'title', 'cover', 'cover_fallback', 'intro', 'score', 'episode_count', 'tags'].forEach(function (key) { if (item[key] !== undefined) result[key] = item[key]; });
    return result;
  }
  function updateSavedButtons() {
    var entry = featuredItem && libraryEntry(featuredItem.series_id);
    ['favorite', 'like'].forEach(function (kind) {
      var button = document.querySelector('.round-action[data-action="' + kind + '"]');
      var saved = !!(entry && (kind === 'favorite' ? entry.favorite_at : entry.liked_at));
      button.classList.toggle('is-saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.querySelector('small').textContent = kind === 'favorite' ? saved ? '已收藏' : '收藏' : saved ? '已点赞' : '点赞';
    });
    var detailEntry = currentDetail && libraryEntry(currentDetail.series_id);
    var detailButton = document.getElementById('detail-save');
    detailButton.textContent = detailEntry && detailEntry.favorite_at ? '已收藏' : '收藏';
    detailButton.classList.toggle('is-saved', !!(detailEntry && detailEntry.favorite_at));
    detailButton.setAttribute('aria-pressed', String(!!(detailEntry && detailEntry.favorite_at)));
  }
  function loadLibrary() {
    libraryError = '';
    return fetch('/api/v1/library')
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (!payload.ok || !payload.data) throw new Error(payload.error || '记录响应无效');
        libraryData = payload.data;
        libraryLoaded = true;
        updateSavedButtons();
        if (isLibraryPage()) renderLibrary(true);
        return true;
      }).catch(function (error) { libraryError = error.message; if (isLibraryPage()) renderLibrary(true); return false; });
  }
  function changeLibrary(change, quiet) {
    var operation = libraryQueue.catch(function () {}).then(function () { return libraryReady; }).then(function () {
      return fetch('/api/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
    }).then(function (response) {
      return response.json().then(function (payload) { if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '记录保存失败'); return payload; });
    }).then(function (payload) {
      libraryData = payload.data;
      libraryLoaded = true;
      updateSavedButtons();
      if (isLibraryPage()) renderLibrary(!!quiet);
      return true;
    });
    libraryQueue = operation;
    return operation.catch(function (error) { showNotice('本机记录未保存：' + error.message); return false; });
  }
  function toggleSaved(item, kind, button) {
    if (!item || !item.series_id || !libraryLoaded || button.disabled) return;
    var entry = libraryEntry(item.series_id);
    var saved = !!(entry && (kind === 'favorite' ? entry.favorite_at : entry.liked_at));
    var wasFocused = document.activeElement === button;
    button.disabled = true;
    changeLibrary({ action: kind, drama: basicDrama(item), value: !saved }).then(function (ok) {
      button.disabled = false;
      if (wasFocused && document.activeElement === document.body && button.getClientRects().length) goFocus(button);
      if (ok) showNotice(saved ? kind === 'favorite' ? '已取消收藏' : '已取消点赞' : kind === 'favorite' ? '已收藏到本机' : '已保存到本机点赞');
    });
  }
  function renderLibrary(restoring) {
    var kind = pageMode();
    if (!isLibraryPage()) return;
    var label = ({ history: '历史', favorites: '收藏', likes: '点赞' })[kind];
    document.getElementById('library-title').textContent = label;
    document.getElementById('library-hint').textContent = kind === 'history' ? '保存在本机 · 自动记住集数和进度 · 最多 200 部' : '保存在本机 · 最多 300 部';
    var grid = document.getElementById('library-grid');
    var entries = libraryData.entries.filter(function (entry) { return libraryTime(entry, kind) > 0; });
    entries.sort(function (a, b) { return libraryTime(b, kind) - libraryTime(a, kind); });
    var existing = {};
    Array.prototype.forEach.call(grid.children, function (tile, index) { existing[tile.dataset.seriesId] = { tile: tile, index: index }; });
    if (restoring) entries.sort(function (a, b) { return (existing[a.drama.series_id] ? existing[a.drama.series_id].index : 10000) - (existing[b.drama.series_id] ? existing[b.drama.series_id].index : 10000); });
    var current = document.activeElement;
    var currentTile = current.closest && current.closest('.library-tile');
    var priorIndex = currentTile && existing[currentTile.dataset.seriesId] ? existing[currentTile.dataset.seriesId].index : 0;
    var keep = {};
    entries.forEach(function (entry, index) {
      var id = entry.drama.series_id;
      var tile = existing[id] ? existing[id].tile : document.createElement('div');
      if (!existing[id]) {
        tile.className = 'library-tile';
        tile.dataset.seriesId = id;
        var card = document.createElement('button');
        card.className = 'library-card';
        card.dataset.focus = 'library-' + id;
        var image = document.createElement('img'); image.loading = 'lazy'; card.appendChild(image);
        ['title', 'meta', 'time'].forEach(function (name) { var span = document.createElement('span'); span.className = 'library-card-' + name; card.appendChild(span); });
        var progress = document.createElement('span'); progress.className = 'library-progress'; progress.appendChild(document.createElement('span')); card.appendChild(progress);
        card.addEventListener('click', function () { if (libraryEditing) goFocus(tile.querySelector('.library-remove')); else startPlayer(tile.__entry.drama, card); });
        card.addEventListener('focus', function () { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        tile.appendChild(card);
        var remove = document.createElement('button'); remove.className = 'library-remove'; remove.dataset.focus = 'library-remove-' + id; remove.textContent = '移除';
        remove.addEventListener('click', function () {
          var kind = pageMode();
          var index = Array.prototype.indexOf.call(grid.children, tile);
          var wasFocused = document.activeElement === remove;
          remove.disabled = true;
          changeLibrary({ action: 'remove', kind: kind, series_id: id }).then(function (ok) {
            remove.disabled = false;
            if (ok && wasFocused && pageMode() === kind && document.activeElement === document.body) {
              var cards = focusables('.library-card');
              goFocus(cards[Math.min(index, cards.length - 1)] || firstVisible('[data-action="library-discover"]'));
            }
          });
        });
        tile.appendChild(remove);
      }
      tile.__entry = entry;
      keep[id] = true;
      var card = tile.querySelector('.library-card');
      if (card.querySelector('img').alt !== entry.drama.title) setCover(card.querySelector('img'), entry.drama);
      card.querySelector('.library-card-title').textContent = entry.drama.title;
      card.querySelector('.library-card-meta').textContent = entry.last_played_at ? entry.completed && entry.drama.episode_count && entry.episode >= entry.drama.episode_count ? '已看完 · 全' + entry.episode + '集' : '继续第' + resumeEpisode(entry, entry.drama) + '集' + (!entry.completed && entry.position ? ' · ' + clockText(entry.position) : '') : entry.drama.episode_count ? '全' + entry.drama.episode_count + '集' : '从第一集播放';
      card.querySelector('.library-card-time').textContent = new Date(libraryTime(entry, kind)).toLocaleDateString();
      card.querySelector('.library-progress').classList.toggle('is-hidden', !entry.last_played_at || !entry.duration);
      card.querySelector('.library-progress > span').style.width = Math.min(100, entry.duration ? entry.position / entry.duration * 100 : 0) + '%';
      tile.querySelector('.library-remove').classList.toggle('is-hidden', !libraryEditing);
      if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);
    });
    Array.prototype.slice.call(grid.children).forEach(function (tile) { if (!keep[tile.dataset.seriesId]) tile.remove(); });
    document.getElementById('library-count').textContent = entries.length ? entries.length + ' 部' : '';
    document.getElementById('library-manage').textContent = libraryError ? '重试' : libraryEditing ? '完成' : '管理';
    document.getElementById('library-manage').disabled = !libraryError && !entries.length;
    document.getElementById('library-clear').disabled = !entries.length;
    document.getElementById('library-empty').classList.toggle('is-hidden', entries.length > 0);
    document.getElementById('library-empty-title').textContent = libraryError ? '读取本机记录失败' : !libraryLoaded ? '正在读取本机记录…' : kind === 'history' ? '还没有观看记录' : '还没有' + label + '的短剧';
    document.getElementById('library-empty-copy').textContent = libraryError || (kind === 'history' ? '开始播放后，会自动保存集数和进度' : '在播放页点' + label + '，以后可从这里继续观看');
    if (currentTile && !document.contains(current)) {
      var cards = focusables('.library-card');
      goFocus(cards[Math.min(priorIndex, cards.length - 1)] || firstVisible('[data-action="library-discover"]'));
    } else if (currentTile && document.activeElement !== current) {
      goFocus(current);
    }
  }
  function closeConfirmation() {
    ++confirmationGeneration;
    confirmOpen = false;
    confirmOperation = null;
    document.getElementById('confirm-modal').classList.add('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'true');
    var target = confirmReturnFocus;
    confirmReturnFocus = null;
    goFocus(target && document.contains(target) && !target.disabled ? target : firstContentFocus());
  }
  function confirmClearLibrary() {
    ++confirmationGeneration;
    var kind = pageMode();
    var label = ({ history: '历史', favorites: '收藏', likes: '点赞' })[kind];
    confirmReturnFocus = document.activeElement;
    confirmOperation = function () { return changeLibrary({ action: 'clear', kind: kind }); };
    confirmOpen = true;
    document.getElementById('confirm-title').textContent = '清空全部' + label + '？';
    document.getElementById('confirm-copy').textContent = kind === 'history' ? '观看进度也会移除，收藏和点赞会保留。' : '只清空本机' + label + '，观看历史和其它记录会保留。';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    goFocus(document.getElementById('confirm-cancel'));
  }

  function setCatalogHeading(text) {
    document.getElementById('catalog-heading').textContent = text || '热播短剧';
  }

  function catalogMeta(item) {
    var values = [];
    if (item.episode_count) values.push(item.episode_count + ' 集');
    if (item.score) values.push(item.score + ' 分');
    return values.join(' · ') || '红果短剧';
  }

  function setCover(image, item) {
    image.alt = item.title || '';
    image.src = item.cover_fallback || item.cover || '';
    image.onerror = function () { image.removeAttribute('src'); image.alt = ''; image.classList.add('is-empty'); };
  }

  function setFeatured(item) {
    if (!item || !item.series_id) return;
    featuredItem = item;
    var backdrop = document.getElementById('hero-backdrop');
    var title = document.querySelector('.hero-title');
    var episode = document.querySelector('.hero-episode');
    var summary = document.querySelector('.hero-summary');
    var topTitle = document.getElementById('hero-top-title');
    var topEpisode = document.getElementById('hero-top-episode');
    var placeholderTitle = document.getElementById('hero-placeholder-title');
    var placeholderSummary = document.getElementById('hero-placeholder-summary');
    var action = document.querySelector('[data-action="featured"]');
    if (backdrop) {
      setCover(backdrop, item);
    }
    if (title) title.textContent = item.title || '红果短剧';
    if (episode) episode.textContent = '第' + (item.start_episode || 1) + '集' + (item.episode_count ? ' · 全' + item.episode_count + '集' : '');
    if (summary) summary.textContent = item.intro || '打开详情查看完整集数。';
    if (topTitle) topTitle.textContent = item.title || '红果短剧';
    if (topEpisode) topEpisode.textContent = '第' + (item.start_episode || 1) + '集';
    if (placeholderTitle) placeholderTitle.textContent = item.title || '红果短剧';
    if (placeholderSummary) placeholderSummary.textContent = item.intro || '打开详情查看完整集数和播放状态。';
    if (action) action.textContent = '查看详情';
    updateSavedButtons();
    document.querySelector('[data-action="episodes"]').textContent = '选集 · ' + (item.episode_count || '--') + ' 集';
  }

  function updateFeedCounter() {
    var counter = document.getElementById('hero-top-count');
    if (counter) counter.textContent = feedItems.length ? (feedIndex + 1) + ' / ' + feedItems.length : '0 / 0';
  }

  function firstVid(item) {
    if (!item) return '';
    if (item.vid) return item.vid;
    if (item.vid_list && item.vid_list.length) return item.vid_list[0];
    return '';
  }

  function getDetail(item) {
    if (detailCache[item.series_id]) return Promise.resolve(detailCache[item.series_id]);
    return fetch('/api/v1/series/detail?series_id=' + encodeURIComponent(item.series_id))
      .then(function (response) { if (!response.ok) throw new Error('详情 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (!payload.ok || !payload.data) throw new Error(payload.error || '详情响应无效');
        var keys = Object.keys(detailCache);
        if (keys.length >= 24) delete detailCache[keys[0]];
        detailCache[item.series_id] = payload.data;
        return payload.data;
      });
  }

  function saveProgress(force, completed) {
    var playback = activePlayback;
    if (!playback || !playback.started) return Promise.resolve(false);
    var video = document.getElementById('hero-video');
    var now = Date.now();
    if (!force && now - playback.lastWrite < 10000) return Promise.resolve(false);
    playback.lastWrite = now;
    if (completed) playback.completed = true;
    return changeLibrary({ action: 'progress', drama: basicDrama(playback.item), episode: playback.episode, video_id: playback.vid,
      position: Math.max(0, Number(video.currentTime) || 0), duration: Number.isFinite(video.duration) ? video.duration : 0, completed: !!playback.completed }, true);
  }

  function playFeedItem(index, forcedEpisode, forcedPosition) {
    if (!feedItems.length) return;
    if (index < 0) index = feedItems.length - 1;
    if (index >= feedItems.length) index = 0;
    var item = feedItems[index];
    if (!item || !item.series_id) return;
    saveProgress(true);
    activePlayback = null;
    feedIndex = index;
    updateFeedCounter();
    setFeatured(item);
    var hero = document.getElementById('hero');
    var video = document.getElementById('hero-video');
    var placeholder = document.getElementById('hero-placeholder');
    var generation = ++feedGeneration;
    hero.classList.add('is-feed');
    video.classList.remove('has-source');
    video.removeAttribute('src');
    video.load();
    placeholder.classList.remove('is-hidden');
    showNotice('正在准备播放…');
    Promise.resolve(libraryReady).then(function () { return libraryQueue.catch(function () {}); }).then(function () {
      if (generation !== feedGeneration) return null;
      var entry = libraryEntry(item.series_id);
      var episode = forcedEpisode || resumeEpisode(entry, item);
      var position = forcedPosition !== undefined ? forcedPosition : entry && episode === entry.episode && !entry.completed ? entry.position || 0 : 0;
      var source = episode === 1 && firstVid(item) ? Promise.resolve(item) : getDetail(item);
      return source.then(function (detail) {
        if (generation !== feedGeneration) return null;
        var vid = episode === 1 ? firstVid(detail) : detail.vid_list && detail.vid_list[episode - 1];
        if (!vid) throw new Error('第' + episode + '集暂无视频数据');
        var playing = Object.assign({}, item, detail, { start_episode: episode, vid: vid });
        activePlayback = { item: playing, episode: episode, vid: vid, position: position, generation: generation, started: false, lastWrite: 0, completed: false };
        setFeatured(playing);
        showNotice('正在准备第 ' + episode + ' 集…');
        return fetch('/api/v1/play/info?series_id=' + encodeURIComponent(item.series_id) + '&vid=' + encodeURIComponent(vid));
      });
    })
      .then(function (response) { if (!response) return null; if (!response.ok) throw new Error('播放 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        if (!payload) return;
        if (!payload.ok || !payload.data || !payload.data.path) throw new Error(payload.error || '播放服务没有返回地址');
        video.src = payload.data.path;
        video.classList.add('has-source');
        placeholder.classList.add('is-hidden');
        video.load();
        video.play().catch(function () { showNotice('视频已准备好，请按确认键开始播放。'); });
        showNotice('正在播放 ' + (item.title || '红果短剧'));
      })
      .catch(function (error) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        placeholder.classList.remove('is-hidden');
        showNotice('播放地址获取失败：' + error.message);
      });
  }

  function renderFeed(items) {
    feedItems = (items || []).filter(function (item) { return item && item.series_id; }).slice(0, 15);
    feedIndex = feedItems.length ? 0 : -1;
    updateFeedCounter();
    if (!feedItems.length) {
      document.getElementById('hero-placeholder-title').textContent = '暂时没有推荐内容';
      document.getElementById('hero-placeholder-summary').textContent = '请稍后刷新红果短剧推荐。';
      document.getElementById('hero-placeholder').classList.remove('is-hidden');
      return;
    }
    playFeedItem(0);
  }

  function startPlayer(item, returnFocus) {
    if (!item || !item.series_id) return;
    if (pageMode() !== 'player') {
      playerReturnPage = pageMode();
      playerReturnFocus = returnFocus || document.activeElement;
    }
    shell.dataset.mode = 'player';
    shell.classList.add('is-player');
    ++catalogGeneration;
    mainSurface.classList.remove('has-search', 'has-placeholder', 'has-workspace');
    hideWorkspacePages();
    searchPage.classList.add('is-hidden');
    pagePlaceholder.classList.add('is-hidden');
    document.getElementById('page-context').textContent = '← 返回';
    document.getElementById('hero').classList.add('is-feed');
    feedItems = [item];
    feedIndex = 0;
    playFeedItem(0, item.__explicitEpisode ? item.start_episode : undefined, item.__explicitEpisode ? 0 : undefined);
    goFocus(document.getElementById('hero-feed-focus'));
  }

  function leavePlayer() {
    var page = playerReturnPage || 'search';
    var target = playerReturnFocus;
    playerReturnPage = null;
    playerReturnFocus = null;
    var item = document.querySelector('.side-item[data-page="' + page + '"]');
    if (!item) item = document.querySelector('.side-item[data-page="recommend"]');
    if (item) activatePage(item, true);
    if (target && document.contains(target)) goFocus(target);
    else goFocus(firstContentFocus());
  }

  function renderCatalog(items) {
    var track = document.getElementById('catalog-track');
    document.getElementById('hero-placeholder').classList.remove('is-hidden');
    track.innerHTML = '';
    var visibleItems = (items || []).slice(0, 9);
    visibleItems.forEach(function (item) {
      if (!item || !item.series_id) return;
      var card = document.createElement('button');
      card.className = 'catalog-card';
      card.dataset.seriesId = item.series_id;
      card.dataset.focus = 'catalog-' + item.series_id;
      var image = document.createElement('img');
      image.className = 'catalog-card-image';
      setCover(image, item);
      var title = document.createElement('span');
      title.className = 'catalog-card-title';
      title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span');
      meta.className = 'catalog-card-meta';
      meta.textContent = catalogMeta(item);
      card.appendChild(image);
      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () {
        setFeatured(item);
        try { card.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (ignore) { card.scrollIntoView(false); }
      });
      track.appendChild(card);
    });
    if (visibleItems.length) setFeatured(visibleItems[0]);
  }

  function renderSearchResults(items, append) {
    if (!append) { searchResults.innerHTML = ''; searchItems = []; }
    var seen = {};
    searchItems.forEach(function (item) { seen[item.series_id] = true; });
    var list = (items || []).filter(function (item) {
      if (!item || !item.series_id || seen[item.series_id]) return false;
      seen[item.series_id] = true;
      return true;
    });
    searchItems = searchItems.concat(list);
    document.getElementById('search-result-count').textContent = searchItems.length ? '已加载 ' + searchItems.length + ' 部' : '';
    if (!searchItems.length) {
      var empty = document.createElement('div');
      empty.className = 'search-result-empty';
      empty.textContent = searchKind === 'browse' ? '没有符合这些条件的短剧，试试放宽筛选。' : '没有找到匹配的短剧，换个关键词试试。';
      searchResults.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var card = document.createElement('button');
      card.className = 'search-result-card';
      card.dataset.seriesId = item.series_id;
      card.dataset.focus = 'search-result-' + item.series_id;
      var image = document.createElement('img');
      image.className = 'search-result-card-image';
      image.loading = 'lazy';
      setCover(image, item);
      var title = document.createElement('span');
      title.className = 'search-result-card-title';
      title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span');
      meta.className = 'search-result-card-meta';
      meta.textContent = catalogMeta(item);
      card.appendChild(image);
      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () {
        try { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (ignore) { card.scrollIntoView(false); }
      });
      searchResults.appendChild(card);
    });
    return list;
  }

  function lastSearchFilter() {
    var rows = document.querySelectorAll('.filter-row[data-filter-group]');
    var row = rows[rows.length - 1];
    return row && !document.getElementById('filter-panel').classList.contains('is-hidden') ? row.querySelector('.is-active') || row.querySelector('button') : null;
  }

  function updateSearchPagination(message) {
    searchMore.classList.toggle('is-hidden', !(searchHasMore || searchFailed || searchBusy));
    searchMore.setAttribute('aria-busy', searchBusy ? 'true' : 'false');
    searchMore.textContent = searchBusy ? '正在加载…' : searchFailed ? '重试' : '加载更多';
    document.getElementById('search-page-status').textContent = message || (searchHasMore ? '在最后一行向下可继续加载' : searchItems.length ? '已显示全部结果' : '');
  }

  function filterSummary() {
    var labels = [];
    filterRows.forEach(function (row) {
      var value = searchFilters[row.type];
      row.options.forEach(function (option) { if (value === option.id) labels.push(option.label); });
    });
    return labels.join(' · ') || '全部短剧';
  }

  function renderFilterRows(rows) {
    var current = document.activeElement;
    var focusKey = zoneOf(current) === 'searchFilters' ? current.dataset.focus : '';
    filterRows = rows;
    var container = document.getElementById('filter-rows');
    container.innerHTML = '';
    rows.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'filter-row';
      line.dataset.filterGroup = row.type;
      var label = document.createElement('strong');
      label.textContent = row.label;
      line.appendChild(label);
      var options = document.createElement('div');
      options.className = 'filter-options';
      [{ id: '', label: '全部' }].concat(row.options).forEach(function (option) {
        var button = document.createElement('button');
        button.className = 'search-filter';
        button.dataset.filterType = row.type;
        button.dataset.filterValue = option.id;
        button.dataset.focus = 'filter-' + row.type + '-' + (option.id || 'all');
        button.textContent = option.label;
        var active = (searchFilters[row.type] || '') === option.id;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.addEventListener('click', function () { selectSearchFilter(button); });
        button.addEventListener('focus', function () { button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        options.appendChild(button);
      });
      line.appendChild(options);
      container.appendChild(line);
    });
    if (focusKey) goFocus(container.querySelector('[data-focus="' + focusKey + '"]') || firstSearchFilter());
    document.getElementById('filter-state').textContent = filterSummary();
  }

  function loadBrowse(append, refreshFilters) {
    if (append && (searchBusy || !searchHasMore && !searchFailed)) return;
    var generation = ++searchGeneration;
    var oldOffset = searchNextOffset;
    var oldCount = searchItems.length;
    var path = ({ comic_series: '/category/comic-drama', ai_series: '/category/ai-drama' })[searchFilters.genre] || '/category/real-drama';
    var params = new URLSearchParams({ path: path });
    Object.keys(searchFilters).forEach(function (kind) { params.set(kind, searchFilters[kind]); });
    if (refreshFilters || !filterRows.length) searchPanelPending = true;
    var needsPanel = searchPanelPending;
    if (needsPanel) params.set('selectors', '1');
    document.querySelectorAll('.search-filter').forEach(function (button) {
      button.disabled = needsPanel && ['category_dim_theme', 'category_dim_role', 'category_dim_epoch', 'creation_status'].indexOf(button.dataset.filterType) >= 0;
    });
    if (append) {
      params.set('offset', String(searchNextOffset));
      params.set('session_id', searchSession);
      params.set('shown', searchItems.map(function (item) { return item.series_id; }).join(','));
    } else {
      searchItems = [];
      searchNextOffset = 0;
      searchSession = '';
      searchHasMore = false;
      document.getElementById('search-result-count').textContent = '';
      renderMessage(searchResults, 'search-result-empty', '正在读取短剧…');
    }
    searchKind = 'browse';
    searchBusy = true;
    searchFailed = false;
    searchLoaded = true;
    document.getElementById('filter-panel').classList.remove('is-hidden');
    document.getElementById('search-browse').classList.add('is-hidden');
    document.getElementById('search-result-title').textContent = filterSummary();
    updateSearchPagination();
    fetch('/api/v1/category?' + params.toString())
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== searchGeneration) return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '分类响应无效');
        var data = payload.data;
        if (needsPanel && (!data.filters || !data.filters.length)) throw new Error('筛选条件未返回');
        if (data.filters && data.filters.length) { searchPanelPending = false; renderFilterRows(data.filters); }
        var added = renderSearchResults(data.items || [], append) || [];
        searchNextOffset = data.next_offset || 0;
        searchSession = data.session_id || searchSession;
        // Stop a stalled cursor instead of requesting the same page forever.
        searchHasMore = !!data.has_more && searchNextOffset > (append ? oldOffset : 0);
        searchBusy = false;
        document.getElementById('search-result-title').textContent = filterSummary();
        document.getElementById('filter-state').textContent = filterSummary();
        var wasOnMore = document.activeElement === searchMore;
        updateSearchPagination();
        if (wasOnMore && pageMode() === 'search') {
          var cards = focusables('.search-result-card');
          if (append && added.length) goFocus(cards[oldCount]);
          else if (searchMore.classList.contains('is-hidden')) goFocus(cards[cards.length - 1] || firstSearchFilter() || searchInput);
        }
      })
      .catch(function (error) {
        if (generation !== searchGeneration) return;
        searchBusy = false;
        searchFailed = true;
        if (!append) renderMessage(searchResults, 'search-result-empty', '短剧加载失败，请重试。');
        updateSearchPagination('加载失败：' + error.message);
      });
  }

  function beginBrowse() {
    searchInput.value = '';
    loadBrowse(false, !filterRows.length);
    goFocus(firstSearchFilter() || searchInput);
  }

  function dramaMeta(item) {
    var values = [];
    if (item.score) values.push(item.score + '分');
    if (item.episode_count) values.push('全' + item.episode_count + '集');
    if (item.tags && item.tags.length) values.push(item.tags.slice(0, 2).join(' · '));
    return values.join(' · ') || '红果短剧';
  }

  function rankLabel() {
    var active = document.querySelector('.rank-subtab.is-active');
    return active ? active.textContent : '热播榜';
  }

  function renderMessage(container, className, message) {
    container.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = className;
    empty.textContent = message;
    container.appendChild(empty);
  }

  function rankUnavailable() {
    var tab = document.querySelector('.rank-tab.is-active');
    var type = document.querySelector('.rank-subtab.is-active');
    var missing = tab && tab.dataset.rankUnavailable;
    if (!missing && type && type.dataset.focus !== 'rank-sub-hot') missing = type.textContent;
    if (!missing) return false;
    ++rankGeneration;
    document.getElementById('rank-list-title').textContent = missing;
    document.getElementById('rank-list-update').textContent = '';
    renderMessage(rankList, 'rank-empty', missing + '数据接入中');
    return true;
  }

  function renderRank(items) {
    rankItems = (items || []).filter(function (item) { return item && item.series_id; });
    rankList.innerHTML = '';
    document.getElementById('rank-list-title').textContent = rankLabel();
    document.getElementById('rank-list-update').textContent = rankItems.length ? '红果热播榜 · ' + rankItems.length + '部' : '暂时没有榜单内容';
    if (!rankItems.length) {
      rankList.innerHTML = '<div class="rank-empty">暂时没有榜单内容，请稍后刷新。</div>';
      return;
    }
    rankItems.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'rank-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', '播放：' + item.title);
      row.dataset.index = String(index);
      row.dataset.focus = 'rank-item-' + item.series_id;
      var rank = document.createElement('span');
      rank.className = 'rank-row-rank';
      rank.textContent = String(item.rank || index + 1);
      var image = document.createElement('img');
      image.className = 'rank-row-image';
      setCover(image, item);
      var copy = document.createElement('span');
      copy.className = 'rank-row-copy';
      var title = document.createElement('span');
      title.className = 'rank-row-title';
      title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span');
      meta.className = 'rank-row-meta';
      meta.textContent = dramaMeta(item);
      var intro = document.createElement('span');
      intro.className = 'rank-row-intro';
      intro.textContent = item.intro || '暂无简介';
      var heat = document.createElement('span');
      heat.className = 'rank-row-heat';
      heat.textContent = item.heat || item.favorite_text || item.like_text || '';
      copy.appendChild(title); copy.appendChild(meta); copy.appendChild(intro); copy.appendChild(heat);
      var side = document.createElement('span');
      side.className = 'rank-row-side';
      var play = document.createElement('button');
      play.className = 'rank-row-play';
      play.textContent = '▶ 播放';
      var detail = document.createElement('button');
      detail.className = 'rank-row-detail';
      detail.textContent = '详情';
      play.addEventListener('click', function (event) { event.stopPropagation(); startPlayer(item, play); });
      detail.addEventListener('click', function (event) { event.stopPropagation(); openDetail(item); });
      side.appendChild(play); side.appendChild(detail);
      row.appendChild(rank); row.appendChild(image); row.appendChild(copy); row.appendChild(side);
      row.addEventListener('click', function (event) { if (!event.target.closest('button')) startPlayer(item, row); });
      row.addEventListener('focus', function () { try { row.scrollIntoView({ block: 'nearest' }); } catch (ignore) {} });
      rankList.appendChild(row);
    });
  }

  function loadRank(path) {
    currentRankPath = path || currentRankPath;
    if (rankUnavailable()) return;
    rankItems = [];
    var generation = ++rankGeneration;
    rankList.innerHTML = '<div class="rank-empty">正在读取榜单…</div>';
    showNotice('正在读取' + rankLabel() + '…');
    fetch('/api/v1/rank?path=' + encodeURIComponent(currentRankPath))
      .then(function (response) { if (!response.ok) throw new Error('榜单 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== rankGeneration || pageMode() !== 'rank') return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '榜单响应无效');
        renderRank(payload.data.items || []);
        showNotice(payload.data.items && payload.data.items.length ? '已加载 ' + payload.data.items.length + ' 部榜单内容。' : '暂时没有榜单内容。');
      })
      .catch(function (error) {
        if (generation !== rankGeneration || pageMode() !== 'rank') return;
        rankItems = [];
        renderMessage(rankList, 'rank-empty', '榜单加载失败：' + error.message);
        showNotice('榜单加载失败：' + error.message);
      });
  }

  function renderNew(items) {
    newItems = (items || []).filter(function (item) { return item && item.series_id; });
    newGrid.innerHTML = '';
    if (!newItems.length) {
      newGrid.innerHTML = '<div class="search-result-empty">暂时没有新剧内容。</div>';
      return;
    }
    newItems.forEach(function (item) {
      var card = document.createElement('button');
      card.className = 'new-card';
      card.dataset.focus = 'new-item-' + item.series_id;
      var poster = document.createElement('span'); poster.className = 'new-card-poster';
      var image = document.createElement('img');
      image.className = 'new-card-image'; setCover(image, item);
      var episodeCount = document.createElement('span'); episodeCount.className = 'new-card-episodes'; episodeCount.textContent = item.episode_count ? '共' + item.episode_count + '集' : '';
      poster.appendChild(image); if (episodeCount.textContent) poster.appendChild(episodeCount);
      var title = document.createElement('span'); title.className = 'new-card-title'; title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span'); meta.className = 'new-card-meta'; meta.textContent = (item.tags || []).slice(0, 3).join(' · ') || '新剧';
      var score = document.createElement('span'); score.className = 'new-card-score'; score.textContent = item.score ? item.score + ' 分' : (item.episode_count ? '共' + item.episode_count + '集' : '');
      card.appendChild(poster); card.appendChild(title); card.appendChild(meta); card.appendChild(score);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () { try { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (ignore) {} });
      newGrid.appendChild(card);
    });
  }

  function dateLabel(offset) {
    var date = new Date(); date.setDate(date.getDate() + offset);
    var weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return { week: offset === 0 ? '今天' : '周' + weekday, date: (date.getMonth() + 1) + '/' + date.getDate() };
  }

  function renderCalendar() {
    dateStrip.innerHTML = '';
    [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].forEach(function (offset) {
      var label = dateLabel(offset);
      var day = document.createElement('button'); day.className = 'calendar-day' + (offset === calendarOffset ? ' is-active' : '');
      day.dataset.focus = 'calendar-day-' + offset;
      day.innerHTML = '<span>' + label.week + '</span><strong>' + label.date + '</strong>';
      day.addEventListener('click', function () { calendarOffset = offset; document.querySelectorAll('.calendar-day').forEach(function (node) { node.classList.toggle('is-active', node === day); }); renderMessage(calendarList, 'calendar-empty', label.date + ' 上新日历数据接入中'); });
      dateStrip.appendChild(day);
    });
    renderMessage(calendarList, 'calendar-empty', dateLabel(calendarOffset).date + ' 上新日历数据接入中');
  }

  function renderNewMode() {
    var calendar = newMode === 'calendar';
    dateStrip.classList.toggle('is-hidden', !calendar);
    newGrid.classList.toggle('is-hidden', calendar);
    calendarList.classList.toggle('is-hidden', !calendar);
    if (calendar) renderCalendar();
    else renderNew(newItems);
  }

  function loadNew() {
    var generation = ++newGeneration;
    newGrid.innerHTML = '<div class="search-result-empty">正在读取新剧…</div>';
    showNotice('正在读取新剧…');
    var gender = ({ male: '1', female: '0' })[newGender] || '';
    fetch('/api/v1/category?path=' + encodeURIComponent('/new/recommend') + '&gender=' + gender)
      .then(function (response) { if (!response.ok) throw new Error('新剧 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== newGeneration || pageMode() !== 'new') return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '新剧响应无效');
        newItems = payload.data.items || [];
        if (newMode === 'recommend') renderNew(newItems);
        showNotice(newItems.length ? '已加载 ' + newItems.length + ' 部新剧。' : '暂时没有新剧内容。');
      })
      .catch(function (error) { if (generation !== newGeneration || pageMode() !== 'new') return; newItems = []; if (newMode === 'recommend') renderMessage(newGrid, 'search-result-empty', '新剧加载失败：' + error.message); showNotice('新剧加载失败：' + error.message); });
  }

  function switchNewMode(mode) {
    newMode = mode === 'calendar' ? 'calendar' : 'recommend';
    document.querySelectorAll('.new-tab').forEach(function (node) { node.classList.toggle('is-active', node.dataset.newMode === newMode); });
    renderNewMode();
    if (newMode === 'recommend' && !newItems.length) loadNew();
  }

  function renderReservations(mode) {
    document.querySelectorAll('.reservation-tab').forEach(function (node) { node.classList.toggle('is-active', node.dataset.reservationMode === mode); });
    document.getElementById('reservation-empty').textContent = mode === 'upcoming' ? '待上线预约数据接入中' : '已上线预约数据接入中';
  }

  function submitSearch() {
    var query = searchInput ? searchInput.value.trim() : '';
    if (!query) {
      showNotice('请输入剧名或关键词。');
      goFocus(searchInput);
      return;
    }
    var generation = ++searchGeneration;
    var returnTarget = document.activeElement;
    searchKind = 'keyword';
    searchLoaded = true;
    searchItems = [];
    searchBusy = true;
    searchHasMore = false;
    searchFailed = false;
    document.getElementById('filter-panel').classList.add('is-hidden');
    document.getElementById('search-browse').classList.remove('is-hidden');
    updateSearchPagination('');
    document.getElementById('search-result-title').textContent = '搜索：' + query;
    document.getElementById('search-result-count').textContent = '';
    searchResults.innerHTML = '<div class="search-result-empty">正在读取红果剧库…</div>';
    showNotice('正在搜索“' + query + '”…');
    fetch('/api/v1/search?q=' + encodeURIComponent(query))
      .then(function (response) { if (!response.ok) throw new Error('搜索 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== searchGeneration) return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '搜索响应无效');
        renderSearchResults(payload.data.items || []);
        searchBusy = false;
        updateSearchPagination();
        showNotice(payload.data.items && payload.data.items.length ? '已找到 ' + payload.data.items.length + ' 部短剧。' : '没有找到匹配的短剧。');
        var first = firstSearchResult();
        if (pageMode() === 'search' && document.activeElement === returnTarget) goFocus(first || searchInput);
      })
      .catch(function (error) {
        if (generation !== searchGeneration) return;
        searchBusy = false;
        searchFailed = true;
        updateSearchPagination('搜索失败，请重试');
        renderMessage(searchResults, 'search-result-empty', '搜索失败：' + error.message);
        showNotice('搜索失败：' + error.message);
      });
  }

  function selectSearchFilter(item) {
    var row = item && item.closest('.filter-row');
    if (!row) return;
    var kind = item.dataset.filterType;
    var value = item.dataset.filterValue;
    if ((searchFilters[kind] || '') === value) return;
    searchFilters[kind] = value;
    if (kind === 'genre') {
      ['category_dim_theme', 'category_dim_role', 'category_dim_epoch', 'creation_status'].forEach(function (key) { delete searchFilters[key]; });
      renderFilterRows(filterRows);
    } else {
      row.querySelectorAll('.search-filter').forEach(function (node) { node.classList.toggle('is-active', node === item); node.setAttribute('aria-pressed', String(node === item)); });
    }
    document.getElementById('filter-state').textContent = filterSummary();
    loadBrowse(false, kind === 'genre');
  }

  function loadCatalog(path, title) {
    var generation = ++catalogGeneration;
    setCatalogHeading(title || '热播短剧');
    showNotice('正在读取' + (title || '红果短剧') + '…');
    fetch('/api/v1/category?path=' + encodeURIComponent(path || '/rank/hot-drama'))
      .then(function (response) { if (!response.ok) throw new Error('分类 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== catalogGeneration || pageMode() !== 'recommend') return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '分类响应无效');
        if (pageMode() === 'recommend') renderFeed(payload.data.items || []);
        else renderCatalog(payload.data.items || []);
        if (!payload.data.items || !payload.data.items.length) showNotice('这个分类暂时没有内容。');
        else if (pageMode() !== 'recommend') showNotice('已加载 ' + payload.data.items.length + ' 部短剧。');
      })
      .catch(function (error) {
        if (generation !== catalogGeneration) return;
        if (pageMode() === 'recommend') renderFeed([]);
        else renderCatalog([]);
        showNotice('分类加载失败：' + error.message);
      });
  }

  function detailElements() {
    return {
      title: document.getElementById('detail-title'),
      name: document.getElementById('detail-name'),
      cover: document.getElementById('detail-cover'),
      meta: document.getElementById('detail-meta'),
      intro: document.getElementById('detail-intro'),
      play: document.getElementById('detail-play'),
      episodes: document.getElementById('detail-episodes')
    };
  }

  function renderDetail(item) {
    var nodes = detailElements();
    nodes.title.textContent = item.title || '短剧详情';
    nodes.name.textContent = item.title || '未命名短剧';
    setCover(nodes.cover, item);
    nodes.meta.textContent = [item.episode_count ? item.episode_count + ' 集' : '', item.score ? item.score + ' 分' : ''].filter(Boolean).join(' · ');
    nodes.intro.textContent = item.intro || '暂无简介';
    var entry = libraryEntry(item.series_id);
    var episode = resumeEpisode(entry, item);
    nodes.play.textContent = entry && entry.last_played_at ? entry.completed && episode === 1 ? '重新播放' : '继续第' + episode + '集' : '播放第一集';
    nodes.play.disabled = false;
    nodes.episodes.innerHTML = '';
    (item.episodes || []).forEach(function (episode) {
      var button = document.createElement('button');
      button.className = 'detail-episode' + (episode.locked ? ' is-locked' : '');
      button.dataset.index = String(Math.max(0, episode.index - 1));
      button.textContent = String(episode.index);
      button.title = episode.locked ? '接口标记为锁定，仍尝试使用播放服务解析' : '播放第' + episode.index + '集';
      button.addEventListener('click', function () { playEpisode(Number(button.dataset.index)); });
      nodes.episodes.appendChild(button);
    });
    if (entry && entry.episode) updateEpisodeHighlight(entry.episode - 1);
    updateSavedButtons();
  }

  function openDetail(item) {
    if (!item || !item.series_id) return;
    detailReturnFocus = document.activeElement;
    detailModalOpen = true;
    currentDetail = null;
    var generation = ++detailGeneration;
    detailModal.classList.remove('is-hidden');
    detailModal.setAttribute('aria-hidden', 'false');
    var nodes = detailElements();
    nodes.title.textContent = '正在读取详情…';
    nodes.name.textContent = '正在读取详情…';
    nodes.intro.textContent = '请稍候…';
    nodes.play.disabled = true;
    nodes.episodes.innerHTML = '';
    goFocus(document.querySelector('.detail-close'));
    getDetail(item).then(function (detail) {
        if (!detailModalOpen || generation !== detailGeneration) return;
        currentDetail = detail;
        renderDetail(currentDetail);
        goFocus(document.querySelector('.detail-play'));
      })
      .catch(function (error) {
        if (!detailModalOpen || generation !== detailGeneration) return;
        detailElements().title.textContent = '详情加载失败';
        detailElements().intro.textContent = error.message;
        showNotice('详情加载失败：' + error.message);
        goFocus(document.querySelector('.detail-close'));
      });
  }

  function closeDetail() {
    detailModalOpen = false;
    currentDetail = null;
    detailModal.classList.add('is-hidden');
    detailModal.setAttribute('aria-hidden', 'true');
    var target = detailReturnFocus && document.contains(detailReturnFocus) ? detailReturnFocus : firstCatalog() || activeChannel();
    detailReturnFocus = null;
    goFocus(target);
  }

  function updateEpisodeHighlight(index) {
    document.querySelectorAll('.detail-episode').forEach(function (node) {
      node.classList.toggle('is-playing', Number(node.dataset.index) === index);
    });
  }

  function playEpisode(index) {
    if (!currentDetail || !currentDetail.episodes || !currentDetail.episodes[index]) return;
    var episode = currentDetail.episodes[index];
    var item = Object.assign({}, currentDetail, { vid: episode.video_id, start_episode: episode.index, __explicitEpisode: true });
    var returnFocus = detailReturnFocus;
    closeDetail();
    startPlayer(item, returnFocus);
  }

  function toggleVideo() {
    var video = document.getElementById('hero-video');
    if (!video.src) { showNotice('请先打开一部短剧并选择集数。'); return; }
    if (video.paused) video.play().catch(function () { showNotice('播放被设备阻止，请再次确认。'); });
    else video.pause();
  }

  function activatePage(item, restoring) {
    saveProgress(true);
    activePlayback = null;
    ++catalogGeneration;
    ++feedGeneration;
    document.getElementById('hero-video').pause();
    document.querySelectorAll('.side-item').forEach(function (node) { node.classList.toggle('is-active', node === item); });
    var label = item.querySelector('span:last-child');
    shell.dataset.mode = item.dataset.page || 'recommend';
    document.getElementById('page-context').textContent = label ? label.textContent : '页面';
    shell.classList.remove('is-player');
    mainSurface.classList.remove('has-search', 'has-workspace', 'has-placeholder');
    searchPage.classList.add('is-hidden');
    pagePlaceholder.classList.add('is-hidden');
    hideWorkspacePages();
    if (item.dataset.page === 'recommend') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      document.getElementById('hero').classList.add('is-feed');
      var active = document.querySelector('.channel-tab.is-active');
      loadCatalog(channelPaths[active && active.dataset.focus] || '/rank/hot-drama', active ? active.textContent : '热播短剧');
    } else if (item.dataset.page === 'search') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      mainSurface.classList.add('has-search');
      searchPage.classList.remove('is-hidden');
      if (!restoring && !searchLoaded) loadBrowse(false, true);
    } else if (item.dataset.page === 'rank') {
      mainSurface.classList.add('has-workspace');
      rankPage.classList.remove('is-hidden');
      if (!restoring && !rankUnavailable() && !rankItems.length) loadRank(currentRankPath);
    } else if (item.dataset.page === 'new') {
      mainSurface.classList.add('has-workspace');
      newPage.classList.remove('is-hidden');
      if (!restoring && !newItems.length) { renderNewMode(); if (newMode === 'recommend') loadNew(); }
    } else if (item.dataset.page === 'reservations') {
      mainSurface.classList.add('has-workspace');
      reservationPage.classList.remove('is-hidden');
      var reservationTab = document.querySelector('.reservation-tab.is-active');
      renderReservations(reservationTab ? reservationTab.dataset.reservationMode : 'online');
    } else if (['history', 'favorites', 'likes'].indexOf(item.dataset.page) >= 0) {
      mainSurface.classList.add('has-workspace');
      libraryPage.classList.remove('is-hidden');
      if (!restoring) libraryEditing = false;
      renderLibrary(!!restoring);
    } else {
      mainSurface.classList.add('has-placeholder');
      pagePlaceholder.classList.remove('is-hidden');
      document.getElementById('page-placeholder-title').textContent = label ? label.textContent : '页面';
      document.getElementById('page-placeholder-copy').textContent = (label ? label.textContent : '这个页面') + '的数据和交互正在接入。';
      showNotice((label ? label.textContent : '页面') + '页面已进入，下一步接入对应数据。');
    }
    if (!restoring) goFocus(firstContentFocus());
  }

  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('focusin', function (event) {
    markFocus(event.target);
    if (!detailModalOpen && !confirmOpen && zoneOf(event.target) !== 'sidebar') {
      lastContentFocus = event.target;
      lastPageFocus[pageMode()] = event.target;
    }
  });

  document.querySelectorAll('.side-item').forEach(function (item) {
    item.addEventListener('click', function () {
      activatePage(item);
      if (item.dataset.page === 'recommend') goFocus(firstContentFocus());
    });
  });

  document.querySelectorAll('[data-action]').forEach(function (item) {
    item.addEventListener('click', function () {
      if (item.dataset.action === 'search-submit') {
        submitSearch();
      } else if (item.dataset.action === 'search-browse') {
        beginBrowse();
      } else if (item.dataset.action === 'favorite' || item.dataset.action === 'like') {
        toggleSaved(featuredItem, item.dataset.action, item);
      } else if (item.dataset.action === 'library-discover') {
        activatePage(document.querySelector('.side-item[data-page="search"]'));
      } else if (item.dataset.action === 'featured') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      } else if (item.dataset.action === 'play' || item.dataset.action === 'pause') toggleVideo();
      else if (item.dataset.action === 'episodes') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      }
      else if (item.dataset.action === 'return-recommend') {
        var recommend = document.querySelector('.side-item[data-page="recommend"]');
        if (recommend) {
          activatePage(recommend);
          goFocus(firstContentFocus());
        }
      }
      else showNotice('已收到操作：' + item.dataset.action + '。');
    });
  });

  document.querySelectorAll('.channel-tab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.channel-tab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      loadCatalog(channelPaths[item.dataset.focus] || '/rank/hot-drama', item.textContent);
    });
  });
  searchMore.addEventListener('click', function () {
    if (searchBusy) return;
    if (searchKind === 'keyword') submitSearch();
    else loadBrowse(searchItems.length > 0, searchFailed || !filterRows.length);
  });
  document.querySelectorAll('.rank-tab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.rank-tab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      if (!rankUnavailable()) loadRank(item.dataset.rankPath);
    });
  });
  document.querySelectorAll('.rank-subtab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.rank-subtab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      if (!rankUnavailable()) loadRank(currentRankPath);
    });
  });
  document.querySelectorAll('.new-tab').forEach(function (item) {
    item.addEventListener('click', function () { switchNewMode(item.dataset.newMode); });
  });
  document.querySelectorAll('.new-filter').forEach(function (item) {
    item.addEventListener('click', function () {
      newGender = item.dataset.newGender;
      newItems = [];
      ++newGeneration;
      document.querySelectorAll('.new-filter').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      if (newMode === 'recommend') loadNew();
      else renderNewMode();
    });
  });
  document.querySelectorAll('.reservation-tab').forEach(function (item) {
    item.addEventListener('click', function () { renderReservations(item.dataset.reservationMode); });
  });
  if (searchInput) {
    searchInput.addEventListener('keydown', function (event) {
      if (normalizedKey(event) === 'Enter') {
        submitSearch();
        event.preventDefault();
      }
    });
  }
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-play').addEventListener('click', function () {
    if (!currentDetail) return;
    var item = Object.assign({}, currentDetail);
    var returnFocus = detailReturnFocus;
    closeDetail();
    startPlayer(item, returnFocus);
  });
  document.getElementById('detail-save').addEventListener('click', function () { toggleSaved(currentDetail, 'favorite', this); });
  document.getElementById('library-manage').addEventListener('click', function () {
    if (libraryError) { libraryReady = loadLibrary(); return; }
    libraryEditing = !libraryEditing;
    renderLibrary(true);
  });
  document.getElementById('library-clear').addEventListener('click', confirmClearLibrary);
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirmation);
  document.getElementById('confirm-accept').addEventListener('click', function () {
    if (!confirmOperation || this.disabled) return;
    var button = this;
    var generation = confirmationGeneration;
    button.disabled = true;
    confirmOperation().then(function (ok) { button.disabled = false; if (ok && confirmOpen && generation === confirmationGeneration) closeConfirmation(); });
  });
  document.getElementById('hero-feed-focus').addEventListener('click', toggleVideo);

  function loadStatus() {
    fetch('/api/v1/status').then(function (response) { return response.json(); }).then(function (data) {
      status.textContent = data.ok ? '已连接' : '连接异常';
      status.dataset.ok = data.ok ? 'true' : 'false';
    }).catch(function () {
      status.textContent = '连接失败';
      status.dataset.ok = 'false';
    });
  }

  var media = document.getElementById('hero-video');
  media.addEventListener('loadedmetadata', function () {
    if (!activePlayback || activePlayback.generation !== feedGeneration) return;
    var position = activePlayback.position;
    if (position > 0 && Number.isFinite(media.duration)) media.currentTime = Math.min(position, Math.max(0, media.duration - .25));
  });
  media.addEventListener('playing', function () {
    if (!activePlayback || activePlayback.generation !== feedGeneration) return;
    activePlayback.started = true;
    saveProgress(true);
  });
  media.addEventListener('timeupdate', function () {
    if (!activePlayback || !activePlayback.started) return;
    document.querySelector('.time-label').textContent = clockText(media.currentTime) + ' / ' + clockText(Number.isFinite(media.duration) ? media.duration : 0);
    document.querySelector('.progress-track > span').style.width = (media.duration ? Math.min(100, media.currentTime / media.duration * 100) : 0) + '%';
    saveProgress(false);
  });
  media.addEventListener('pause', function () { saveProgress(true); });
  media.addEventListener('ended', function () {
    var playback = activePlayback;
    if (!playback || !playback.started || playback.generation !== feedGeneration) return;
    saveProgress(true, true);
    getDetail(playback.item).then(function (detail) {
      if (activePlayback !== playback || playback.generation !== feedGeneration) return;
      if (detail.vid_list && detail.vid_list[playback.episode]) playFeedItem(feedIndex, playback.episode + 1, 0);
      else if (pageMode() === 'recommend' && feedItems.length > 1) playFeedItem(feedIndex + 1);
      else showNotice('本剧已播放完');
    }).catch(function (error) { if (activePlayback === playback) showNotice('下一集准备失败，可从选集继续：' + error.message); });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveProgress(true); });

  goFocus(document.querySelector('.side-item.is-active'));
  loadStatus();
  libraryReady = loadLibrary();
  loadCatalog('/rank/hot-drama', '热播短剧');
}());
