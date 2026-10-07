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
    controls: '.playback-buttons .control-button, #player-retry',
    timeline: '#control-progress',
    searchInput: '#search-input',
    searchActions: '.search-action',
    searchFilters: '.search-filter',
    searchResults: '.search-result-card',
    listRetry: '.list-retry',
    rankPanels: '.rank-panel',
    discussion: '.discussion-item, .discussion-reply, .discussion-action, .discussion-close, #discussion-input',
    reservationItems: '.reservation-row',
    publicationActions: '.publication-action',
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
    accountInputs: '.account-input',
    accountKeypad: '.account-keypad-key',
    accountActions: '.account-action',
    appUpdates: '.app-update-action',
    support: '.support-card, .support-close',
    confirmation: '.confirm-button',
    playerOptions: '.player-option, #player-compose-input',
    modalActions: '.modal-action',
    episodes: '.detail-episode',
    detailTabs: '.detail-tab',
    seriesRows: '.series-row'
  };
  var status = document.getElementById('core-status');
  var notice = document.getElementById('action-notice');
  var shell = document.querySelector('.app-shell');
  var androidShell = /HongguoTV-Android/.test(navigator.userAgent);
  var numericKeypad;
  var accountNumberScan;
  var accountKeypadReturnFocus = null;
  var accountKeypadPhase = '';
  var mainSurface = document.getElementById('main-surface');
  var supportPage = document.getElementById('support-page');
  var supportModalOpen = false;
  var supportReturnFocus = null;
  var engagement;
  var pagePlaceholder = document.getElementById('page-placeholder');
  var detailModal = document.getElementById('detail-modal');
  var detailModalOpen = false;
  var discussionOpen = false;
  var discussionReturn = null;
  var discussionSession = null;
  var discussionEpoch = 0;
  var discussionReplyTarget = null;
  var discussionBusy = false;
  var discussionRequest = null;
  var discussionDrafts = {};
  var replyPagers = [];
  var danmakuEnabled = false;
  var danmakuGeneration = 0;
  var danmakuRequest = null;
  var danmakuRows = [];
  var danmakuWindow = -1;
  var danmakuBusy = false;
  var danmakuLane = 0;
  var danmakuLast = -1;
  var detailGeneration = 0;
  var detailReturnFocus = null;
  var detailSeriesID = '';
  var currentDetail = null;
  var detailTab = 'episodes';
  var seriesRootID = '';
  var seriesItems = [];
  var seriesLoaded = false;
  var seriesGeneration = 0;
  var seriesRequest = null;
  var seriesFocusCurrent = false;
  var seasonCatalogCache = {};
  var seasonCatalogKeys = [];
  var seasonCatalogRequests = [];
  var seasonControlID = '';
  var seasonControlState = '';
  var seasonControlGeneration = 0;
  var seasonSwitchGeneration = 0;
  var seasonSwitchRequest = null;
  var seasonSwitchID = '';
  var seriesReservationRequest = null;
  var seriesReservationID = '';
  var lastContentFocus = null;
  var lastPageFocus = {};
  var featuredItem = null;
  var feedItems = [];
  var feedIndex = -1;
  var feedGeneration = 0;
  var continuationGeneration = 0;
  var searchInput = document.getElementById('search-input');
  var searchPage = document.getElementById('search-page');
  var searchResults = document.getElementById('search-results');

  var filterRows = [];
  var searchPanelPending = false;
  var searchFilters = { genre: '', sort: 'hot_score' };
  var searchKind = 'browse';
  var searchItems = [];
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
  var calendarDate = '';
  var calendarSchema = null;
  var rankOptions = [];
  var rankSelection = { rank: 'all', rank_sub: 'ranklist_hot_play_sc', rank_panel: '' };
  var reservationMode = 'online';
  var reservationCounts = { online: null, upcoming: null };
  var activeSearchQuery = '';
  var tailTimer = null;
  var playerReturnPage = null;
  var playerReturnFocus = null;
  var libraryPage = document.getElementById('library-page');
  var accountPage = document.getElementById('account-page');
  var accountData = null;
  var accountBusy = false;
  var accountNotice = '';
  var accountLeftFocus = null;
  var accountPollBusy = false;
  var accountEpoch = 0;
  var accountRequestGeneration = 0;
  var accountPollTimer = null;
  var smsVerification = null;
  var accountCountdownUntil = 0;
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
  var playerOptionsOpen = false;
  var playerOptionsReturn = null;
  var controlsTimer = null;
  var lastPlaybackControl = null;
  var nativeFullscreen = false;
  var fullscreenExitKeepsHidden = false;
  var playbackQuality = '';
  var playbackQualities = [];
  var qualityRequest = null;
  var qualityEpoch = 0;
  var qualityPrevious = null;
  var composeSession = null;
  var composeRequest = null;
  var composeBusy = false;
  var composeEpoch = 0;
  var danmakuDrafts = {};
  var playbackRequest = null;
  var playbackInfoRequest = null;
  var playbackPrefetchHandoff = null;
  var playbackTiming = [];
  // Bounded, memory-only diagnostics. No drama IDs, titles or account data.
  window.HongguoTVPlaybackTiming = { snapshot: function () { return playbackTiming.map(function (item) { return Object.assign({}, item); }); } };
  var episodePrefetch = HongguoEpisodePrefetch.create({
    lookup: function (info, signal) {
      return getDetail(info.item, signal).then(function (detail) {
        var vid = detail.vid_list && detail.vid_list[info.episode];
        return vid ? { series_id: info.series_id, vid: vid, quality: info.quality || '', fallback: '1' } : null;
      });
    },
    prepare: function (target, signal) {
      return fetchData('/api/v1/play/info?' + new URLSearchParams(Object.assign({}, target, { prefetch: '1' })), signal ? { signal: signal } : {});
    }
  });
  var applicationInBackground = false;
  var playbackPreferences = { speed: 1, volume: 100, quality: '', danmaku: false };
  var playbackSpeeds = [.5, .75, 1, 1.25, 1.5, 2];
  var keyNames = {
    // WebView delivers DOM key codes, not Android KeyEvent constants.
    // Chromium 44 may omit event.key entirely.
    37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
    13: 'Enter', 27: 'Escape', 8: 'Backspace', 9: 'Tab', 46: 'Delete', 32: ' ',
    19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft', 22: 'ArrowRight',
    23: 'Enter', 66: 'Enter', 4: 'Escape', 111: 'Escape'
  };

  function playMedia(video) {
    // play() returned undefined before Chromium 50.
    try { return Promise.resolve(video.play()); } catch (error) { return Promise.reject(error); }
  }

  function fetchData(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || '连接失败（' + response.status + '）');
        return payload.data || payload;
      });
    });
  }
  function listStatus(pager, id) {
    var node = document.getElementById(id);
    if (!node) return;
    // Keep the retry node stable while it owns focus.
    if (pager.error) {
      var text = node.querySelector('span');
      if (!text) { node.innerHTML = ''; text = document.createElement('span'); node.appendChild(text); }
      text.textContent = '加载失败：' + pager.error;
      var retry = node.querySelector('button');
      if (!retry) {
        retry = document.createElement('button'); retry.className = 'list-retry'; retry.textContent = '重试'; retry.dataset.focus = id + '-retry'; retry.__pager = pager;
        retry.addEventListener('click', function () {
          var current = document.activeElement; var generation = pager.generation;
          pager.load(true).then(function (added) {
            if (generation !== pager.generation || document.activeElement !== current && document.activeElement !== document.body) return;
            if (!pager.error) { var cards = focusables(pager.selector); goFocus(cards[cards.length - added.length] || cards[cards.length - 1] || firstContentFocus()); }
          });
        });
        node.appendChild(retry);
      }
      retry.disabled = pager.busy;
    } else {
      var oldRetry = node.querySelector('button');
      if (oldRetry && document.activeElement === oldRetry && pager.busy) { oldRetry.disabled = true; return; }
      node.textContent = pager.busy ? '正在加载…' : pager.loaded && !pager.hasMore() && pager.items.length ? '已显示全部' : '';
    }
    node.setAttribute('aria-busy', String(pager.busy));
  }
  function calendarCursor(data, old) {
    var cursor = { offset: Number(data.next_offset) || 0, session_id: data.session_id || old.session_id || '',
      subscribe_offset: data.next_subscribe_offset == null ? old.subscribe_offset || '' : String(data.next_subscribe_offset) };
    var date = data.calendar && data.calendar.default_date || old.date;
    if (date) cursor.date = date;
    return cursor;
  }
  function createListPager(endpoint, container, selector, id, render, metadata) {
    var pager = HongguoPagination.create({
      request: function (params, signal) { return fetchData((pager.endpoint || endpoint) + '?' + new URLSearchParams(params).toString(), signal ? { signal: signal } : {}); },
      clear: function () { if (container) renderMessage(container, 'list-empty', '正在加载…'); },
      render: function (items, append, p) {
        if (items.length && container) container.querySelectorAll('.list-empty, .calendar-empty, .search-result-empty, .rank-empty').forEach(function (node) { node.remove(); });
        render(items, append, p);
      },
      metadata: metadata,
      cursor: endpoint === '/api/v1/lists/calendar' ? calendarCursor : endpoint === '/api/v1/lists/recommend' ? function (data, old) { return { offset: Number(data.next_offset) || 0, session_id: data.session_id || old.session_id || '', feed_cell: data.feed_cell || old.feed_cell || '', feed_plan: data.feed_plan || old.feed_plan || '' }; } : null,
      status: function (p) { listStatus(p, id); },
      after: queueTailCheck
    });
    pager.container = container; pager.selector = selector; pager.statusID = id;
    return pager;
  }
  var searchPager = (function () {
    var pager;
    // A single endpoint wrapper handles both contracts without changing cursors.
    pager = HongguoPagination.create({
      request: function (params, signal) { return fetchData((params.q ? '/api/v1/lists/search' : '/api/v1/category') + '?' + new URLSearchParams(params).toString(), signal ? { signal: signal } : {}); },
      clear: function () { searchItems = []; document.getElementById('search-result-count').textContent = ''; renderMessage(searchResults, 'list-empty', '正在读取短剧…'); },
      render: function (items, append) { if (items.length) searchResults.querySelectorAll('.list-empty, .search-result-empty').forEach(function (node) { node.remove(); }); renderSearchResults(items, append); },
      metadata: function (data) {
        if (searchKind === 'browse') {
          if (searchPanelPending && (!data.filters || !data.filters.length)) throw new Error('筛选条件未返回');
          if (data.filters && data.filters.length) { searchPanelPending = false; renderFilterRows(data.filters); }
          document.getElementById('search-result-title').textContent = filterSummary(); document.getElementById('filter-state').textContent = filterSummary();
        }
      },
      status: function (p) { listStatus(p, 'search-pagination'); }, after: queueTailCheck
    });
    pager.container = searchResults; pager.selector = '.search-result-card'; pager.statusID = 'search-pagination'; return pager;
  })();
  var rankPager = createListPager('/api/v1/lists/rank', rankList, '.rank-row', 'rank-pagination', renderRank, function (data, pager) { if (!pager.loaded) renderRankSelectors(data.ranks); });
  var newPager = createListPager('/api/v1/lists/new', newGrid, '.new-card', 'new-pagination', renderNew);
  var calendarPager = createListPager('/api/v1/lists/calendar', calendarList, '.calendar-row', 'calendar-pagination', function (items, append) { renderPublications(items, append, false); }, function (data) { renderCalendarDays(data.calendar); });
  var reservationPager = createListPager('/api/v1/lists/reservations', document.getElementById('reservation-list'), '.reservation-row', 'reservation-pagination', function (items, append) { renderPublications(items, append, true); }, updateReservationCounts);
  var libraryPager = createListPager('', document.getElementById('library-grid'), '.library-card', 'library-pagination', function () { renderLibrary(true); });
  var feedPager = createListPager('/api/v1/lists/recommend', null, '.hero-feed-focus', '', function (items, append) {
    if (!append) renderFeed(items);
    else if (feedIndex < 0 && items.length) renderFeed(items);
    else { feedItems = feedItems.concat(items); updateFeedCounter(); }
  });
  var discussionPager = HongguoPagination.create({
    key: function (item) { return item.comment_id; },
    cursor: function (data) { return data.next_cursor ? { cursor: data.next_cursor } : {}; },
    request: function (params, signal) { return fetchData('/api/v1/comments?' + new URLSearchParams(params), signal ? { signal: signal } : {}); },
    metadata: function (data) { if (discussionSession) { document.getElementById('discussion-title').textContent = '第' + discussionSession.episode + '集评论 · ' + (data.total || 0); engagement.commentTotal(discussionSession, data.total); } },
    clear: function () { renderMessage(document.getElementById('discussion-list'), 'list-empty', '正在读取评论…'); },
    render: renderDiscussion,
    status: function (p) { listStatus(p, 'discussion-pagination'); }, after: queueTailCheck
  });
  discussionPager.container = document.getElementById('discussion-list'); discussionPager.selector = '.discussion-item'; discussionPager.statusID = 'discussion-pagination';
  var allPagers = [searchPager, rankPager, newPager, calendarPager, reservationPager, libraryPager, feedPager, discussionPager];

  function visiblePager() {
    if (discussionOpen) {
      var row = document.activeElement && document.activeElement.closest('.discussion-item');
      if (row && row.__replyPager && !row.querySelector('.discussion-replies').classList.contains('is-hidden') && row.__replyPager.hasMore()) return row.__replyPager;
      return discussionPager;
    }
    if (detailModalOpen || confirmOpen || playerOptionsOpen) return null;
    if (pageMode() === 'search') return searchPager;
    if (pageMode() === 'rank') return rankPager;
    if (pageMode() === 'new') return newMode === 'calendar' ? calendarPager : newPager;
    if (pageMode() === 'reservations') return reservationPager;
    if (isLibraryPage()) return libraryPager;
    return null;
  }
  function queueTailCheck() {
    clearTimeout(tailTimer); tailTimer = setTimeout(checkListTail, 80);
  }
  function checkListTail() {
    var pager = visiblePager();
    if (!pager || !pager.loaded || pager.busy || pager.error || !pager.hasMore()) return;
    var cards = pager.container.querySelectorAll(pager.selector);
    var last = cards[cards.length - 1];
    if (!last) { pager.load(); return; }
    var bottom = discussionOpen ? document.getElementById('discussion-scroll').getBoundingClientRect().bottom : mainSurface.getBoundingClientRect().bottom;
    var page = pager.container.closest('.page-workspace');
    if (page) bottom = Math.min(bottom, page.getBoundingClientRect().bottom);
    if (last.getBoundingClientRect().bottom < bottom + 280) pager.load();
  }
  function listBoundary(pager, current, direction, focusAnchor) {
    focusAnchor = focusAnchor || current;
    if (pager.error) return firstVisible('#' + pager.statusID + ' .list-retry');
    if (pager.hasMore()) {
      var generation = pager.generation; var mode = pageMode();
      pager.load().then(function () {
        if (generation !== pager.generation || pageMode() !== mode || focusAnchor !== document.activeElement) return;
        var target = moveGrid(pager.selector, current, direction);
        if (target) goFocus(target);
        else if (pager.error) goFocus(firstVisible('#' + pager.statusID + ' .list-retry'));
      });
    }
    return null;
  }

  function playbackSnapshot() {
    return activePlayback && activePlayback.vid ? { series_id: activePlayback.item.series_id, vid: activePlayback.vid, episode: activePlayback.episode } : null;
  }
  function draftKey(session) { return session ? session.series_id + ':' + session.vid : ''; }
  function storeDraft(drafts, key, value) {
    if (value.trim()) drafts[key] = value; else delete drafts[key];
    var keys = Object.keys(drafts); while (keys.length > 20) delete drafts[keys.shift()];
  }
  function writePlayerAction(body, signal) {
    return fetchData('/api/v1/player/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal });
  }
  function needPlayerLogin(message) {
    if (accountData && accountData.logged_in) return false;
    message.textContent = '请先到“我的 / 登录”登录红果账号'; return true;
  }
  function discussionAction(text, focus, operation) {
    var button = document.createElement('button'); button.className = 'discussion-action'; button.textContent = text; button.dataset.focus = focus;
    button.addEventListener('click', function (event) { event.stopPropagation(); operation(button); }); return button;
  }
  function commentAge(created) {
    var elapsed = Math.max(0, Date.now() / 1000 - created);
    return !created ? '' : elapsed < 60 ? '刚刚' : elapsed < 3600 ? Math.floor(elapsed / 60) + '分钟前' : elapsed < 86400 ? Math.floor(elapsed / 3600) + '小时前' : Math.floor(elapsed / 86400) + '天前';
  }
  function renderDiscussion(items, append) {
    var list = document.getElementById('discussion-list');
    if (!append) list.innerHTML = '';
    if (items.length) list.querySelectorAll('.list-empty').forEach(function (node) { node.remove(); });
    if (!items.length && !list.children.length) renderMessage(list, 'list-empty', '本集暂无评论');
    items.forEach(function (item) {
      var row = document.createElement('div'); row.className = 'discussion-item'; row.tabIndex = 0; row.dataset.focus = 'comment-' + item.comment_id; row.__item = item;
      var main = document.createElement('div'); main.className = 'discussion-main';
      var avatar = document.createElement('img'); avatar.className = 'discussion-avatar'; avatar.alt = ''; avatar.referrerPolicy = 'no-referrer';
      if (/^https?:\/\//.test(item.avatar || '')) avatar.src = item.avatar;
      avatar.addEventListener('error', function () { avatar.removeAttribute('src'); });
      var content = document.createElement('div'); content.className = 'discussion-copy';
      var author = document.createElement('strong'); author.textContent = item.author || '红果用户';
      var copy = document.createElement('p'); copy.textContent = item.text;
      var meta = document.createElement('small'); meta.textContent = commentAge(item.created);
      var actions = document.createElement('div'); actions.className = 'discussion-actions';
      actions.appendChild(discussionAction('回复', 'reply-' + item.comment_id, function () { selectDiscussionReply(item); }));
      if (item.replies) actions.appendChild(discussionAction('展开 ' + item.replies + ' 条回复', 'expand-' + item.comment_id, function (button) { toggleReplies(row, button); }));
      if (item.own) actions.appendChild(discussionAction('删除', 'delete-' + item.comment_id, function (button) { confirmDeleteComment(row, button); }));
      var like = discussionAction('', 'comment-like-' + item.comment_id, function (button) { likeComment(row, button); }); like.classList.add('discussion-like');
      like.innerHTML = '<svg><use href="#icon-favorite" xlink:href="#icon-favorite"></use></svg><small></small>';
      like.setAttribute('aria-pressed', String(!!item.liked)); like.setAttribute('aria-label', '评论点赞'); like.querySelector('small').textContent = item.likes || 0;
      content.appendChild(author); content.appendChild(copy); content.appendChild(meta); content.appendChild(actions); main.appendChild(avatar); main.appendChild(content); main.appendChild(like); row.appendChild(main);
      var replies = document.createElement('div'); replies.className = 'discussion-replies is-hidden'; row.appendChild(replies);
      row.addEventListener('focus', function () { main.scrollIntoView({ block: 'nearest' }); }); list.appendChild(row);
    });
  }
  function likeComment(row, button) {
    if (button.getAttribute('aria-busy') === 'true' || needPlayerLogin(document.getElementById('discussion-message'))) return;
    var epoch = discussionEpoch; var item = row.__item; var value = !item.liked;
    button.setAttribute('aria-busy', 'true');
    writePlayerAction(Object.assign({ series_id: discussionSession.series_id, vid: discussionSession.vid }, { action: 'comment-like', comment_id: item.comment_id, value: value })).then(function () {
      if (epoch !== discussionEpoch) return;
      item.liked = value; item.likes = Math.max(0, (item.likes || 0) + (value ? 1 : -1));
      button.setAttribute('aria-pressed', String(value)); button.querySelector('small').textContent = item.likes;
    }).catch(function (error) { if (epoch === discussionEpoch) document.getElementById('discussion-message').textContent = error.message; })
      .then(function () { button.removeAttribute('aria-busy'); });
  }
  function confirmDeleteComment(row, button) {
    if (needPlayerLogin(document.getElementById('discussion-message'))) return;
    confirmOpen = true; confirmReturnFocus = button; ++confirmationGeneration;
    document.getElementById('confirm-title').textContent = '删除这条评论？';
    document.getElementById('confirm-copy').textContent = '会从红果账号的评论中删除，删除后无法恢复。';
    document.getElementById('confirm-accept').textContent = '删除';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    var session = { series_id: discussionSession.series_id, vid: discussionSession.vid }; var epoch = discussionEpoch;
    confirmOperation = function () {
      if (epoch !== discussionEpoch) return Promise.resolve(true);
      return writePlayerAction(Object.assign(session, { action: 'comment-delete', comment_id: row.__item.comment_id })).then(function () {
        if (epoch !== discussionEpoch) return true;
        var next = row.nextElementSibling || row.previousElementSibling;
        if (row.__replyPager) row.__replyPager.cancel();
        row.remove(); confirmReturnFocus = next && next.classList.contains('discussion-item') ? next : document.getElementById('discussion-input');
        return true;
      }).catch(function (error) { if (epoch === discussionEpoch) document.getElementById('confirm-copy').textContent = error.message; return false; });
    };
    goFocus(document.getElementById('confirm-cancel'));
  }
  function selectDiscussionReply(item) {
    discussionReplyTarget = item || null;
    var target = document.getElementById('discussion-target'); target.classList.toggle('is-hidden', !item); target.textContent = item ? '回复 ' + (item.author || '红果用户') : '';
    document.getElementById('discussion-cancel-reply').classList.toggle('is-hidden', !item);
    if (item) goFocus(document.getElementById('discussion-input'));
  }
  function toggleReplies(row, button) {
    var panel = row.querySelector('.discussion-replies'); var item = row.__item;
    var opening = panel.classList.contains('is-hidden'); panel.classList.toggle('is-hidden', !opening); button.textContent = opening ? '收起回复' : '展开 ' + item.replies + ' 条回复';
    if (!opening) { if (row.__replyPager) row.__replyPager.cancel(); return; }
    if (!row.__replyPager) {
      var list = document.createElement('div'); panel.appendChild(list);
      var statusNode = document.createElement('div'); statusNode.className = 'list-status'; statusNode.id = 'replies-status-' + item.comment_id; panel.appendChild(statusNode);
      var pager = HongguoPagination.create({ key: function (reply) { return reply.comment_id; }, cursor: function (data) { return data.next_cursor ? { cursor: data.next_cursor } : {}; },
        request: function (params, signal) { return fetchData('/api/v1/replies?' + new URLSearchParams(params), signal ? { signal: signal } : {}); },
        clear: function () { renderMessage(list, 'list-empty', '正在读取回复…'); },
        render: function (replies, append) {
          if (!append) list.innerHTML = '';
          if (!replies.length && !list.children.length) renderMessage(list, 'list-empty', '暂无回复');
          replies.forEach(function (reply) { var node = document.createElement('div'); node.className = 'discussion-reply'; node.tabIndex = 0; node.dataset.focus = 'reply-row-' + reply.comment_id; var name = document.createElement('strong'); name.textContent = reply.author || '红果用户'; var text = document.createElement('p'); text.textContent = reply.text; node.appendChild(name); node.appendChild(text); node.addEventListener('focus', function () { node.scrollIntoView({ block: 'nearest' }); }); list.appendChild(node); });
        }, status: function (p) { listStatus(p, statusNode.id); }, after: queueTailCheck });
      pager.container = list; pager.selector = '.discussion-reply'; pager.statusID = statusNode.id; row.__replyPager = pager; replyPagers.push(pager);
      pager.reset(Object.assign({}, discussionSession, { comment_id: item.comment_id }));
    } else if (!row.__replyPager.loaded) row.__replyPager.load(!!row.__replyPager.error);
    queueTailCheck();
  }
  function sendDiscussion() {
    var input = document.getElementById('discussion-input'); var message = document.getElementById('discussion-message');
    if (discussionBusy || !discussionSession || needPlayerLogin(message)) return;
    var text = input.value.trim(); if (!text || Array.from(text).length > 500) { message.textContent = '请输入 1～500 字的内容'; goFocus(input); return; }
    var epoch = discussionEpoch; var target = discussionReplyTarget;
    var body = Object.assign({}, discussionSession, { action: target ? 'reply' : 'comment', text: text }); delete body.episode;
    if (target) body.comment_id = target.comment_id;
    discussionBusy = true; input.readOnly = true; message.textContent = '正在发送…'; document.getElementById('discussion-send').setAttribute('aria-busy', 'true');
    discussionRequest = typeof AbortController === 'function' ? new AbortController() : null;
    writePlayerAction(body, discussionRequest && discussionRequest.signal).then(function () {
      if (epoch !== discussionEpoch) return;
      input.value = ''; delete discussionDrafts[draftKey(discussionSession)]; selectDiscussionReply(null);
      message.textContent = '已发送，审核通过后显示';
      goFocus(input);
    }).catch(function (error) { if (epoch === discussionEpoch && error.name !== 'AbortError') message.textContent = error.message; })
      .then(function () { if (epoch === discussionEpoch) { discussionBusy = false; discussionRequest = null; input.readOnly = false; document.getElementById('discussion-send').removeAttribute('aria-busy'); } });
  }
  function openDiscussion(button) {
    var session = playbackSnapshot();
    if (!session) { showNotice('开始播放后可查看本集评论'); return; }
    closePlayerOptions(false); clearTimeout(controlsTimer); discussionOpen = true; discussionReturn = button; discussionSession = session; ++discussionEpoch;
    shell.classList.add('is-discussion-open');
    var panel = document.getElementById('discussion-panel'); panel.classList.remove('is-hidden'); panel.setAttribute('aria-hidden', 'false');
    document.getElementById('discussion-title').textContent = '第' + session.episode + '集评论';
    document.getElementById('discussion-input').value = discussionDrafts[draftKey(session)] || ''; document.getElementById('discussion-message').textContent = ''; selectDiscussionReply(null);
    discussionPager.reset({ series_id: session.series_id, vid: session.vid });
    goFocus(document.getElementById('discussion-close'));
  }
  function closeDiscussion(restore) {
    if (!discussionOpen) return;
    if (discussionSession) storeDraft(discussionDrafts, draftKey(discussionSession), document.getElementById('discussion-input').value);
    ++discussionEpoch; if (discussionRequest) discussionRequest.abort(); discussionRequest = null; discussionBusy = false; discussionSession = null;
    document.getElementById('discussion-input').readOnly = false; document.getElementById('discussion-send').removeAttribute('aria-busy');
    replyPagers.forEach(function (pager) { pager.cancel(); }); replyPagers = [];
    discussionOpen = false; discussionPager.cancel(); shell.classList.remove('is-discussion-open');
    document.getElementById('discussion-panel').classList.add('is-hidden'); document.getElementById('discussion-panel').setAttribute('aria-hidden', 'true');
    if (restore !== false) { goFocus(discussionReturn || document.getElementById('hero-feed-focus')); scheduleControlsHide(); }
    discussionReturn = null;
  }
  function moveDiscussion(current, direction) {
    var input = document.getElementById('discussion-input'); var close = document.getElementById('discussion-close');
    var rows = focusables('.discussion-item,.discussion-reply');
    if (current.id === 'discussion-close') return direction === 'down' ? rows[0] || firstVisible('#discussion-pagination .list-retry') || input : null;
    if (current === input) return direction === 'up' ? rows[rows.length - 1] || close : direction === 'down' ? document.getElementById('discussion-send') : null;
    if (current.closest('.discussion-compose-actions')) {
      var composeActions = focusables('.discussion-compose-actions .discussion-action');
      return direction === 'up' ? input : direction === 'left' || direction === 'right' ? composeActions[composeActions.indexOf(current) + (direction === 'right' ? 1 : -1)] || null : null;
    }
    if (current.classList.contains('list-retry')) return direction === 'down' ? input : rows[rows.length - 1] || close;
    var root = current.closest('.discussion-item');
    var row = current.closest('.discussion-reply') || root;
    if (!row) return input;
    if (direction === 'left' || direction === 'right') {
      if (current === row) return direction === 'right' && root ? root.querySelector('.discussion-like') : close;
      var actions = focusables('.discussion-like,.discussion-actions .discussion-action').filter(function (node) { return node.closest('.discussion-item') === root; });
      actions.sort(function (a, b) { return a.classList.contains('discussion-like') ? -1 : b.classList.contains('discussion-like') ? 1 : 0; });
      return actions[actions.indexOf(current) + (direction === 'right' ? 1 : -1)] || (direction === 'left' ? row : null);
    }
    if (direction === 'up' && current !== row) return row;
    var index = rows.indexOf(row); var next = rows[index + (direction === 'down' ? 1 : -1)];
    var pager = root && root.__replyPager && row.classList.contains('discussion-reply') ? root.__replyPager : discussionPager;
    if (direction === 'down' && root && root.__replyPager && root.__replyPager.hasMore() && row.classList.contains('discussion-reply') && (!next || !root.contains(next))) {
      loadDiscussionTail(root.__replyPager, row, current); return null;
    }
    if (next) return next;
    if (direction === 'up') return close;
    if (pager.error) return firstVisible('#' + pager.statusID + ' .list-retry') || input;
    if (pager.hasMore()) { loadDiscussionTail(pager, row, current); return null; }
    return input;
  }
  function loadDiscussionTail(pager, row, anchor) {
    var epoch = discussionEpoch; var generation = pager.generation;
    pager.load().then(function () {
      if (epoch !== discussionEpoch || generation !== pager.generation || document.activeElement !== anchor) return;
      if (pager.error) { goFocus(firstVisible('#' + pager.statusID + ' .list-retry')); return; }
      var rows = focusables('.discussion-item,.discussion-reply'); goFocus(rows[rows.indexOf(row) + 1] || document.getElementById('discussion-input'));
    });
  }
  function resetDanmaku() {
    ++danmakuGeneration; if (danmakuRequest) danmakuRequest.abort(); danmakuRequest = null;
    danmakuRows = []; danmakuWindow = -1; danmakuBusy = false; danmakuLast = -1;
    document.getElementById('danmaku-layer').innerHTML = '';
  }
  function toggleDanmaku() {
    danmakuEnabled = !danmakuEnabled; resetDanmaku();
    playbackPreferences.danmaku = danmakuEnabled; savePlaybackPreferences(); updateDanmakuButton(); tickDanmaku();
  }
  function updateDanmakuButton() {
    var button = document.querySelector('[data-action="danmaku"]'); button.setAttribute('aria-pressed', String(danmakuEnabled)); button.querySelector('small').textContent = danmakuEnabled ? '弹幕开' : '弹幕关';
  }
  function tickDanmaku() {
    var video = document.getElementById('hero-video');
    if (!danmakuEnabled || !activePlayback || !activePlayback.vid || video.paused || !isPlaybackPage() || document.hidden || applicationInBackground) return;
    var now = Math.floor(video.currentTime * 1000); var windowStart = Math.floor(now / 30000) * 30000;
    if (danmakuWindow !== windowStart && !danmakuBusy) {
      danmakuWindow = windowStart; danmakuBusy = true; danmakuRows = [];
      var generation = danmakuGeneration;
      danmakuRequest = typeof AbortController === 'function' ? new AbortController() : null;
      var params = new URLSearchParams({ series_id: activePlayback.item.series_id, vid: activePlayback.vid, start: String(windowStart), duration: String(Math.max(1, Math.floor((video.duration || 600) * 1000))) });
      fetchData('/api/v1/danmaku?' + params, danmakuRequest ? { signal: danmakuRequest.signal } : {}).then(function (data) {
        if (generation !== danmakuGeneration) return;
        danmakuRows = (data.items || []).filter(function (item) { return item.offset_ms >= now - 1500 && item.offset_ms < windowStart + 30000; });
      }).catch(function (error) { if (generation === danmakuGeneration && error.name !== 'AbortError') showNotice('弹幕暂时不可用，可关闭后重试'); })
        .then(function () { if (generation === danmakuGeneration) { danmakuBusy = false; danmakuRequest = null; } });
    }
    var layer = document.getElementById('danmaku-layer'); var last = danmakuLast;
    danmakuRows.forEach(function (item) {
      if (item.shown || item.offset_ms > now || now - last < 700 || layer.children.length >= 8) return;
      item.shown = true; last = now; danmakuLast = now;
      if (item.offset_ms < now - 2000) return;
      var line = document.createElement('span'); line.className = 'danmaku-line'; line.textContent = item.text.slice(0, 120); line.style.top = (danmakuLane++ % 4) * 38 + 'px';
      line.addEventListener('animationend', function () { line.remove(); }); layer.appendChild(line);
    });
  }

  function pageMode() {
    return shell && shell.dataset.mode ? shell.dataset.mode : 'recommend';
  }

  function focusables(selector) {
    var result = [];
    var query = selector || Object.keys(zoneSelectors).map(function (zone) { return zoneSelectors[zone]; }).join(',');
    Array.prototype.forEach.call(document.querySelectorAll(query), function (element) {
      var style = window.getComputedStyle(element);
      var insideModal = element.closest && element.closest('#detail-modal');
      if (accountKeypadOpen()) { if (!element.closest('#account-keypad-modal')) return; }
      else if (supportModalOpen) { if (!element.closest('#support-modal')) return; }
      else if (confirmOpen) { if (!element.closest('#confirm-modal')) return; }
      else if (playerOptionsOpen) { if (!element.closest('#player-options')) return; }
      else if (discussionOpen) { if (!element.closest('#discussion-panel')) return; }
      else if (element.closest('#discussion-panel')) return;
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
    if (element.classList.contains('account-keypad-key')) return 'accountKeypad';
    if (element.classList.contains('support-card') || element.classList.contains('support-close')) return 'support';
    if (element.classList.contains('discussion-item') || element.classList.contains('discussion-close')) return 'discussion';
    if (element.classList.contains('side-item')) return 'sidebar';
    if (element.classList.contains('channel-tab')) return 'channels';
    if (element.classList.contains('hero-feed-focus')) return 'feed';
    if (element.classList.contains('catalog-card')) return 'catalog';
    if (element.classList.contains('round-action')) return 'actions';
    if (element.id === 'control-progress') return 'timeline';
    if (element.classList.contains('control-button')) return 'controls';
    if (element.id === 'search-input') return 'searchInput';
    if (element.classList.contains('search-action')) return 'searchActions';
    if (element.classList.contains('search-filter')) return 'searchFilters';
    if (element.classList.contains('search-result-card')) return 'searchResults';
    if (element.classList.contains('list-retry')) return 'listRetry';
    if (element.classList.contains('rank-panel')) return 'rankPanels';
    if (element.classList.contains('reservation-row')) return 'reservationItems';
    if (element.classList.contains('publication-action')) return 'publicationActions';
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
    if (element.classList.contains('account-input')) return 'accountInputs';
    if (element.classList.contains('app-update-action')) return 'appUpdates';
    if (element.classList.contains('account-action')) return 'accountActions';
    if (element.classList.contains('confirm-button')) return 'confirmation';
    if (element.classList.contains('player-option') || element.id === 'player-compose-input') return 'playerOptions';
    if (element.closest('#discussion-panel')) return 'discussion';
    if (element.classList.contains('detail-tab')) return 'detailTabs';
    if (element.classList.contains('series-row') || element.classList.contains('series-retry')) return 'seriesRows';
    if (element.classList.contains('detail-episode')) return 'episodes';
    if (element.classList.contains('modal-action')) return 'modalActions';
    if (element.classList.contains('page-placeholder-action')) return 'placeholder';
    if (element.classList.contains('primary-action')) return 'hero';
    return '';
  }

  function goFocus(element) {
    if (!element || element.disabled || !element.getClientRects().length) return;
    if (window.getComputedStyle(element).visibility !== 'visible') return;
    // The default scroll behavior is sufficient; old WebViews have no
    // focus-options overload.
    var previous = document.activeElement;
    if (previous && previous.tagName === 'INPUT' && element.tagName !== 'INPUT' && window.HongguoTVInput) window.HongguoTVInput.finishEditing();
    element.focus();
    markFocus(element);
    if (!accountKeypadOpen() && !detailModalOpen && !confirmOpen && !playerOptionsOpen && !discussionOpen && zoneOf(element) !== 'sidebar') {
      lastContentFocus = element;
      lastPageFocus[pageMode()] = element;
    }
  }

  function firstContentFocus() {
    if (pageMode() === 'player') return document.querySelector('.hero-feed-focus');
    var remembered = lastPageFocus[pageMode()];
    if (remembered && focusables().indexOf(remembered) >= 0) return remembered;
    if (pageMode() === 'search') return searchInput || document.querySelector('.search-submit');
    if (pageMode() === 'account') return firstVisible('.account-input') || firstVisible('.account-action');
    if (pageMode() === 'support') return firstVisible('.support-card');
    if (isLibraryPage()) return firstVisible('.library-card') || firstVisible('[data-action="library-discover"]') || firstVisible('.library-toolbar-button');
    if (pageMode() === 'rank') return firstVisible('.rank-tab.is-active') || firstRankTab();
    if (pageMode() === 'new') return firstVisible('.new-tab.is-active') || firstNewTab();
    if (pageMode() === 'reservations') return firstVisible('.reservation-tab.is-active');
    if (pageMode() !== 'recommend') return document.querySelector('.page-placeholder-action');
    return firstVisible('.hero-feed-focus') || activeChannel() || firstCatalog();
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
    [rankPage, newPage, reservationPage, libraryPage, accountPage, supportPage].forEach(function (page) {
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
    if (zone === 'detailTabs') {
      if (direction === 'left' || direction === 'right') return moveWithinZone('detailTabs', current, direction);
      if (direction === 'up') return document.getElementById('detail-close');
      if (direction === 'down') return detailTab === 'series' ? currentSeriesRow() || firstVisible('.series-row') || firstVisible('.series-retry') : firstVisible('.detail-play');
      return null;
    }
    if (zone === 'seriesRows') {
      if (direction === 'up') return moveWithinZone('seriesRows', current, direction) || document.getElementById('detail-tab-series');
      if (direction === 'down') return moveWithinZone('seriesRows', current, direction);
      if (direction === 'left') return document.getElementById('detail-tab-series');
      return null;
    }
    if (zone === 'modalActions') {
      if (current.id === 'detail-close') return direction === 'down' ? document.querySelector('.detail-tab.is-active') : null;
      if (direction === 'left') return current.id === 'detail-save' ? document.getElementById('detail-play') : null;
      if (direction === 'right') return current.id === 'detail-play' ? document.getElementById('detail-save') : null;
      if (direction === 'up') return document.getElementById('detail-tab-episodes');
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
    if (supportModalOpen) return document.getElementById('support-close');
    if (confirmOpen) return direction === 'left' || direction === 'right' ? moveWithinZone('confirmation', current, direction) : null;
    if (playerOptionsOpen) {
      if (current.id === 'player-compose-input') return direction === 'down' ? document.getElementById('player-compose-send') : direction === 'up' ? document.getElementById('player-options-close') : null;
      if (current.id === 'player-compose-send') return direction === 'up' ? document.getElementById('player-compose-input') : null;
      if (current.id === 'player-options-close') return direction === 'down' ? firstVisible('#player-compose-input') || document.querySelector('.player-option.is-selected') || firstVisible('#player-options-list .player-option') : null;
      return moveGrid('#player-options-list .player-option', current, direction) || (direction === 'up' ? document.getElementById('player-options-close') : null);
    }
    if (detailModalOpen) return moveModalFrom(current, direction);
    if (discussionOpen) {
      return moveDiscussion(current, direction);
    }
    var zone = zoneOf(current);
    if (zone === 'support') {
      if (direction === 'left' || direction === 'right') return moveWithinZone('support', current, direction) || (direction === 'left' ? activeSidebar() : null);
      return direction === 'up' ? activeSidebar() : null;
    }
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
      if (direction === 'left') return shell.classList.contains('is-cinema') ? firstVisible('.playback-buttons .control-button') : activeSidebar();
      if (direction === 'right') return firstVisible('.round-action') || firstVisible('.playback-buttons .control-button');
      if (direction === 'down') return firstVisible('.playback-buttons .control-button');
      if (direction === 'up') return pageMode() === 'player' ? null : activeChannel();
      return null;
    }
    if (zone === 'hero') {
      if (direction === 'right') return document.querySelector('.round-action');
      if (direction === 'down') return firstCatalog() || firstVisible('.playback-buttons .control-button');
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
      if (direction === 'down') return firstVisible('.playback-buttons .control-button');
      return null;
    }
    if (zone === 'actions') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction) || (direction === 'down' ? firstVisible('.playback-buttons [data-action="fullscreen"]') : null);
      if (direction === 'left') return firstVisible('.hero-feed-focus') || firstVisible('.primary-action') || firstCatalog();
      return null;
    }
    if (zone === 'controls') {
      if (direction === 'left' || direction === 'right') {
        var controlTarget = moveWithinZone(zone, current, direction);
        return controlTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') {
        if (current.dataset.action === 'fullscreen') return firstVisible('.round-action[data-action="danmaku"]') || firstVisible('#control-progress');
        return firstVisible('#control-progress') || firstVisible('.hero-feed-focus') || firstCatalog() || firstVisible('.primary-action');
      }
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
      if (direction === 'down') return moveGrid('.search-result-card', current, direction) || listBoundary(searchPager, current, direction);
      return null;
    }
    if (zone === 'listRetry') {
      var pager = current.__pager;
      if (direction === 'up') { var cards = focusables(pager.selector); return cards[cards.length - 1] || firstContentFocus(); }
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'rankPanels') {
      var target = moveGrid('.rank-panel', current, direction);
      if (target) return target;
      if (direction === 'down') return firstRankRow();
      if (direction === 'up') return firstVisible('.rank-tab.is-active');
      if (direction === 'left') return firstVisible('.rank-subtab.is-active');
      return null;
    }
    if (zone === 'publicationActions') {
      var row = current.closest('.publication-row');
      if (!row) return direction === 'left' || direction === 'up' ? firstVisible('.reservation-tab.is-active') : null;
      if (direction === 'left') return row;
      if (direction === 'up' || direction === 'down') {
        var reservations = row.classList.contains('reservation-row');
        var selector = reservations ? '.reservation-row' : '.calendar-row';
        return moveGrid(selector, row, direction) || (direction === 'down'
          ? listBoundary(reservations ? reservationPager : calendarPager, row, direction, current)
          : firstVisible(reservations ? '.reservation-tab.is-active' : '.calendar-day.is-active'));
      }
      return null;
    }
    if (zone === 'reservationItems') {
      if (reservationMode === 'online') {
        var target = moveGrid('.reservation-row', current, direction);
        if (target) return target;
        if (direction === 'up') return firstVisible('.reservation-tab.is-active');
        if (direction === 'down') return listBoundary(reservationPager, current, direction);
        if (direction === 'left') return activeSidebar();
        return null;
      }
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.reservation-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction) || listBoundary(reservationPager, current, direction);
      if (direction === 'right') return current.querySelector('.publication-action');
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'libraryActions') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'down') return firstVisible('.library-card') || firstVisible('[data-action="library-discover"]');
      if (direction === 'up') return firstVisible('.library-card') || activeSidebar();
      return null;
    }
    if (zone === 'appUpdates') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return firstVisible('#account-import-history') || firstVisible('#account-sync') || firstVisible('#account-profile .account-action') || firstVisible('#account-login-form .account-action');
      return null;
    }
    if (zone === 'accountInputs' || zone === 'accountActions') {
      if (current.id === 'account-sms-qr') return direction === 'down' ? firstVisible('#account-verify') || firstVisible('#account-cancel') : direction === 'left' || direction === 'up' ? activeSidebar() : null;
      if (accountData && accountData.phase === 'mfa' && direction === 'up' && (current.id === 'account-verify' || current.id === 'account-cancel')) return firstVisible('#account-sms-qr') || activeSidebar();
      var leftSelector = '#account-login-form .account-input, #account-login-form .account-action, #account-mfa .account-action, #account-profile .account-action';
      if (current.id === 'account-sync' || current.id === 'account-import-history') {
        if (direction === 'left') return focusables(leftSelector).indexOf(accountLeftFocus) >= 0 ? accountLeftFocus : firstVisible(leftSelector) || activeSidebar();
        if (direction === 'down') return current.id === 'account-sync' ? firstVisible('#account-import-history') || firstVisible('.app-update-action') : firstVisible('.app-update-action');
        if (direction === 'up') return current.id === 'account-import-history' ? firstVisible('#account-sync') || firstVisible(leftSelector) : null;
        return null;
      }
      if (zone === 'accountInputs' && direction === 'down') {
        if (current.id === 'account-phone' && firstVisible('#account-code')) return document.getElementById('account-code');
        return firstVisible('#account-login') || firstVisible('#account-send-code') || firstVisible('#account-change-phone');
      }
      if (zone === 'accountActions' && direction === 'up') {
        return firstVisible('#account-code') || firstVisible('#account-phone') || moveGrid(leftSelector, current, direction);
      }
      var target = moveGrid(leftSelector, current, direction);
      if (target) return target;
      if (direction === 'right' && (firstVisible('#account-sync') || firstVisible('#account-import-history'))) { accountLeftFocus = current; return firstVisible('#account-sync') || firstVisible('#account-import-history'); }
      return direction === 'down' ? firstVisible('.app-update-action') : direction === 'left' || direction === 'up' ? activeSidebar() : null;
    }
    if (zone === 'libraryItems') {
      if (direction === 'left' || direction === 'right') return moveGrid('.library-card', current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return moveGrid('.library-card', current, direction) || firstVisible('.library-toolbar-button');
      if (direction === 'down') return libraryEditing ? current.parentElement.querySelector('.library-remove') : moveGrid('.library-card', current, direction) || listBoundary(libraryPager, current, direction);
      return null;
    }
    if (zone === 'libraryRemovals') {
      if (direction === 'up') return current.parentElement.querySelector('.library-card');
      if (direction === 'down') { var card = current.parentElement.querySelector('.library-card'); return moveGrid('.library-card', card, 'down') || listBoundary(libraryPager, card, 'down', current); }
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
      if (direction === 'right') return firstVisible('.rank-panel.is-active') || firstVisible('.rank-panel') || firstRankRow();
      return moveWithinZone(zone, current, direction);
    }
    if (zone === 'rankItems') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.rank-panel.is-active') || firstVisible('.rank-panel') || firstVisible('.rank-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction) || listBoundary(rankPager, current, direction);
      if (direction === 'left') return firstVisible('.rank-subtab.is-active');
      if (direction === 'right') return current.querySelector('.rank-row-play');
      return null;
    }
    if (zone === 'rankActions') {
      var row = current.closest('.rank-row');
      if (direction === 'left') return row;
      if (direction === 'up' && current.classList.contains('rank-row-detail')) return row.querySelector('.rank-row-play');
      if (direction === 'down' && current.classList.contains('rank-row-play')) return row.querySelector('.rank-row-detail');
      if (direction === 'up' || direction === 'down') return moveGrid('.rank-row', row, direction) || (direction === 'down' ? listBoundary(rankPager, row, direction, current) : firstVisible('.rank-panel.is-active') || firstVisible('.rank-tab.is-active'));
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
      if (direction === 'down') return moveGrid('.new-card', current, direction) || listBoundary(newPager, current, direction);
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
      if (direction === 'down') return moveWithinZone(zone, current, direction) || listBoundary(calendarPager, current, direction);
      if (direction === 'right') return current.querySelector('.publication-action');
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'reservationTabs') {
      if (direction === 'down') return firstVisible('.reservation-row') || firstVisible('#reservation-page .publication-action') || firstVisible('#reservation-page .list-retry');
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return activeSidebar();
      return null;
    }
    return direction === 'right' ? firstContentFocus() : activeSidebar();
  }

  function accountKeypadOpen() { return !!(numericKeypad && numericKeypad.isOpen()); }
  function accountKeypadFocus() {
    return document.querySelectorAll('.account-keypad-key')[numericKeypad.snapshot().index];
  }
  function renderAccountNumber(field) {
    var code = field.id === 'account-code';
    var placeholder = code ? '请输入验证码' : accountData && accountData.phase === 'code' && accountData.phone ? '请重新输入 ' + accountData.phone + ' 的完整手机号' : '请输入手机号';
    field.textContent = field.value || placeholder;
    field.classList.toggle('is-empty', !field.value);
    field.setAttribute('aria-label', (code ? '短信验证码' : '手机号') + '，确认键输入');
  }
  function openAccountKeypad(field) {
    if (!numericKeypad || !field || field.disabled || accountBusy || pageMode() !== 'account' || accountKeypadOpen()) return;
    accountKeypadReturnFocus = field;
    accountKeypadPhase = accountData && accountData.phase || 'phone';
    var kind = field.id === 'account-code' ? 'code' : 'phone';
    if (numericKeypad.open(kind, field.value)) accountNumberScan.start(kind);
  }

  function normalizedKey(event) {
    var key = event.key || event.keyIdentifier;
    var aliases = { Left: 'ArrowLeft', Up: 'ArrowUp', Right: 'ArrowRight', Down: 'ArrowDown',
      Return: 'Enter', Esc: 'Escape', Spacebar: ' ', GoBack: 'Escape', BrowserBack: 'Escape',
      'U+000D': 'Enter', 'U+001B': 'Escape', 'U+0008': 'Backspace', 'U+0020': ' ' };
    if (aliases[key]) return aliases[key];
    if (!key || key === 'Unidentified' || key === 'Unknown' || /^U\+/.test(key)) {
      var code = event.keyCode || event.which;
      key = code >= 48 && code <= 57 ? String(code - 48) : code >= 96 && code <= 105 ? String(code - 96) : keyNames[code] || key || '';
    }
    return key;
  }

  function handleKey(event) {
    var key = normalizedKey(event);
    if (accountKeypadOpen()) {
      numericKeypad.handleKey(key, !!event.repeat);
      event.preventDefault(); event.stopPropagation(); return;
    }
    var current = document.activeElement;
    if (current && current.classList.contains('player-text-input') && ['Escape', 'ArrowUp', 'ArrowDown'].indexOf(key) < 0) return;
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[key];

    var command = ({ MediaPlayPause: 'toggle', MediaPlay: 'play', MediaPause: 'pause', MediaFastForward: 'forward', MediaRewind: 'rewind', ' ': 'toggle' })[key];
    if (command && (!event.repeat || command === 'forward' || command === 'rewind') && handleMediaCommand(command)) {
      event.preventDefault(); event.stopPropagation(); return;
    }

    if (current && current.id === 'search-input' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;

    if (key === 'Enter') {
      if (event.repeat) { event.preventDefault(); return; }
      if (zoneOf(current) === 'feed' && shell.classList.contains('is-controls-hidden')) {
        revealControls(); goFocus(firstVisible('.playback-buttons .control-button'));
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (current && current.id === 'control-progress') {
        goFocus(lastPlaybackControl || firstVisible('.playback-buttons .control-button'));
        event.preventDefault(); event.stopPropagation(); return;
      }
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
      if (handleBack()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!direction) return;
    if (!detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && current && current.id === 'control-progress') {
      if (direction === 'left' || direction === 'right') seekBy(direction === 'left' ? -10 : 10);
      else goFocus(direction === 'up' ? document.getElementById('hero-feed-focus') : lastPlaybackControl || firstVisible('.playback-buttons .control-button'));
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (!detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && pageMode() === 'recommend' && zoneOf(current) === 'feed' && (direction === 'up' || direction === 'down')) {
      if (!event.repeat) switchRecommendation(direction === 'up' ? -1 : 1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isPlaybackPage() && !detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && (direction !== 'left' || shell.classList.contains('is-cinema') || zoneOf(current) !== 'feed')) revealControls();
    if (zoneOf(current) === 'feed' && pageMode() === 'player' && (direction === 'up' || direction === 'down')) {
      goFocus(firstVisible('.playback-buttons .control-button'));
      event.preventDefault(); event.stopPropagation(); return;
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

  function remoteKey(keyCode, repeat) {
    if (keyCode !== 19 && keyCode !== 20) return false;
    var handled = false;
    handleKey({ keyCode: keyCode, repeat: !!repeat, preventDefault: function () { handled = true; }, stopPropagation: function () {} });
    return handled;
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.remove('is-hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(function () { notice.classList.add('is-hidden'); }, 3200);
  }

  function isPlaybackPage() { return pageMode() === 'recommend' || pageMode() === 'player'; }
  function scheduleControlsHide() {
    clearTimeout(controlsTimer);
    var video = document.getElementById('hero-video');
    if (!isPlaybackPage() || shell.classList.contains('is-controls-hidden') || video.paused || video.ended || detailModalOpen || confirmOpen || playerOptionsOpen || discussionOpen || zoneOf(document.activeElement) === 'sidebar') return;
    controlsTimer = setTimeout(function () { hideControls(); }, 4000);
  }
  function revealControls() {
    shell.classList.remove('is-controls-hidden');
    scheduleControlsHide();
  }
  function hideControls() {
    clearTimeout(controlsTimer);
    if (!isPlaybackPage() || detailModalOpen || confirmOpen || playerOptionsOpen || discussionOpen || zoneOf(document.activeElement) === 'sidebar') return;
    shell.classList.add('is-controls-hidden');
    goFocus(document.getElementById('hero-feed-focus'));
  }
  function setPlayerStatus(message, failed) {
    var panel = document.getElementById('player-status');
    panel.classList.toggle('is-hidden', !message);
    document.getElementById('player-status-text').textContent = message || '';
    panel.querySelector('.player-spinner').classList.toggle('is-hidden', !!failed);
    document.getElementById('player-retry').classList.toggle('is-hidden', !failed);
    if (failed) {
      revealControls();
      if (zoneOf(document.activeElement) === 'feed') goFocus(document.getElementById('player-retry'));
    }
  }
  function episodeLoadingText(episode) { return episode > 0 ? '正在加载第 ' + episode + ' 集…' : '正在加载…'; }
  function setControlIcon(action, label, icon) {
    var button = document.querySelector('[data-action="' + action + '"]');
    var text = button.querySelector('.control-label');
    if (text.textContent !== label) text.textContent = label;
    button.setAttribute('aria-label', label);
    var use = button.querySelector('use');
    if (use.getAttribute('href') !== '#' + icon) {
      use.setAttribute('href', '#' + icon);
      use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + icon);
    }
  }
  function updatePlaybackControls() {
    var video = document.getElementById('hero-video');
    var duration = Number.isFinite(video.duration) ? video.duration : 0;
    var position = Math.min(duration, Number(video.currentTime) || 0);
    var progress = document.getElementById('control-progress');
    document.querySelector('.time-label').textContent = clockText(position) + ' / ' + clockText(duration);
    progress.disabled = !duration;
    progress.setAttribute('aria-valuemax', String(Math.floor(duration)));
    progress.setAttribute('aria-valuenow', String(Math.floor(position)));
    progress.setAttribute('aria-valuetext', clockText(position) + ' / ' + clockText(duration));
    progress.querySelector('span').style.width = (duration ? position / duration * 100 : 0) + '%';
    var paused = video.paused || video.ended;
    setControlIcon('pause', paused ? '播放' : '暂停', paused ? 'icon-play' : 'icon-pause');
    setControlIcon('speed', video.playbackRate + 'x', 'icon-speed');
    var muted = video.muted || !video.volume;
    setControlIcon('volume', muted ? '静音' : '音量 ' + Math.round(video.volume * 100) + '%', muted ? 'icon-volume-muted' : 'icon-volume');
    setControlIcon('quality', playbackQuality ? (playbackPreferences.quality ? '' : '自动 · ') + playbackQuality : '清晰度', 'icon-quality');
    var cinema = shell.classList.contains('is-cinema');
    setControlIcon('fullscreen', cinema ? '退出全屏' : '全屏', cinema ? 'icon-fullscreen-exit' : 'icon-fullscreen');
  }
  function savePlaybackPreferences() {
    try {
      var value = JSON.stringify(playbackPreferences);
      if (androidShell && window.HongguoTVPreferences) window.HongguoTVPreferences.write(value);
      else localStorage.setItem('hongguo-tv-playback', value);
    } catch (error) { showNotice('播放设置未保存'); }
  }
  function restorePlaybackPreferences() {
    try {
      var value = androidShell && window.HongguoTVPreferences ? window.HongguoTVPreferences.read() : localStorage.getItem('hongguo-tv-playback');
      var saved = JSON.parse(value || '{}');
      if (playbackSpeeds.indexOf(saved.speed) >= 0) playbackPreferences.speed = saved.speed;
      if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 100) playbackPreferences.volume = saved.volume;
      if (/^[1-9][0-9]{2,3}P$/.test(saved.quality || '')) playbackPreferences.quality = saved.quality;
      danmakuEnabled = saved.danmaku === true; playbackPreferences.danmaku = danmakuEnabled;
    } catch (error) { /* Invalid preferences fall back to normal playback. */ }
    var video = document.getElementById('hero-video');
    document.querySelector('[data-action="volume"]').classList.toggle('is-hidden', androidShell);
    if (androidShell) {
      playbackPreferences.volume = 100;
      savePlaybackPreferences();
    }
    video.playbackRate = playbackPreferences.speed;
    video.defaultPlaybackRate = playbackPreferences.speed;
    video.volume = playbackPreferences.volume / 100;
    video.muted = playbackPreferences.volume === 0;
    updateDanmakuButton();
    updatePlaybackControls();
  }
  function closePlayerOptions(restoring) {
    cancelQualitySwitch();
    ++composeEpoch;
    if (composeSession) storeDraft(danmakuDrafts, draftKey(composeSession), document.getElementById('player-compose-input').value);
    if (composeRequest) composeRequest.abort(); composeRequest = null; composeBusy = false; composeSession = null;
    document.getElementById('player-compose-input').readOnly = false; document.getElementById('player-compose-send').removeAttribute('aria-busy');
    playerOptionsOpen = false;
    document.getElementById('player-options').classList.add('is-hidden');
    var target = playerOptionsReturn;
    playerOptionsReturn = null;
    if (restoring !== false) goFocus(target && document.contains(target) ? target : document.getElementById('hero-feed-focus'));
    scheduleControlsHide();
  }
  function cancelQualitySwitch() {
    ++qualityEpoch;
    if (qualityRequest) qualityRequest.abort(); qualityRequest = null;
    var old = qualityPrevious; qualityPrevious = null;
    if (old && activePlayback === old.playback) {
      setPlayerStatus('');
      if (old.playing && !document.hidden && !applicationInBackground) playMedia(document.getElementById('hero-video')).catch(function () {});
    }
  }
  function switchQuality(value) {
    if (qualityPrevious || !activePlayback) return;
    episodePrefetch.cancel();
    if (value === playbackQuality || value === playbackPreferences.quality) {
      playbackPreferences.quality = value; savePlaybackPreferences(); updatePlaybackControls(); closePlayerOptions(); return;
    }
    var video = document.getElementById('hero-video'); var playback = activePlayback;
    var epoch = ++qualityEpoch; var generation = feedGeneration;
    qualityPrevious = { playback: playback, playing: !video.paused && !video.ended };
    var previous = qualityPrevious; var position = video.currentTime;
    video.pause(); document.getElementById('player-options-message').textContent = '正在准备 ' + (value || '自动清晰度') + '…';
    qualityRequest = typeof AbortController === 'function' ? new AbortController() : null;
    var q = new URLSearchParams({ series_id: playback.item.series_id, vid: playback.vid, quality: value });
    fetchData('/api/v1/play/info?' + q, qualityRequest ? { signal: qualityRequest.signal } : {}).then(function (data) {
      if (epoch !== qualityEpoch || generation !== feedGeneration || activePlayback !== playback || !playerOptionsOpen) return;
      if (!data.path) throw new Error('服务没有返回视频地址');
      qualityPrevious = null; qualityRequest = null;
      playback.position = position; playback.started = false; playback.completed = false;
      playbackQuality = data.quality || ''; playbackQualities = data.qualities || [];
      playbackPreferences.quality = value; savePlaybackPreferences();
      if (playbackRequest) playbackRequest.position = position;
      video.src = data.path; video.load(); updatePlaybackControls(); closePlayerOptions();
      setPlayerStatus(episodeLoadingText(playback.episode));
      if (previous.playing && !document.hidden && !applicationInBackground) playMedia(video).catch(function () { setPlayerStatus(''); revealControls(); });
    }).catch(function (error) {
      if (epoch !== qualityEpoch || generation !== feedGeneration) return;
      qualityPrevious = null; qualityRequest = null;
      document.getElementById('player-options-message').textContent = error.message + '，原视频保留';
      if (previous.playing && !document.hidden && !applicationInBackground) playMedia(video).catch(function () {});
    });
  }
  function sendDanmaku() {
    var input = document.getElementById('player-compose-input'); var message = document.getElementById('player-options-message');
    if (composeBusy || !composeSession || needPlayerLogin(message)) return;
    var text = input.value.trim(); if (!text || Array.from(text).length > 100) { message.textContent = '请输入 1～100 字的弹幕'; goFocus(input); return; }
    var epoch = composeEpoch; var session = Object.assign({}, composeSession); delete session.episode; session.action = 'danmaku'; session.text = text;
    composeBusy = true; input.readOnly = true; document.getElementById('player-compose-send').setAttribute('aria-busy', 'true'); message.textContent = '正在发送…';
    composeRequest = typeof AbortController === 'function' ? new AbortController() : null;
    writePlayerAction(session, composeRequest && composeRequest.signal).then(function () {
      if (epoch !== composeEpoch) return;
      input.value = ''; delete danmakuDrafts[draftKey(composeSession)]; composeRequest = null;
      closePlayerOptions(); showNotice('弹幕已发送，审核通过后显示');
    }).catch(function (error) { if (epoch === composeEpoch && error.name !== 'AbortError') message.textContent = error.message; })
      .then(function () { if (epoch === composeEpoch) { composeBusy = false; composeRequest = null; input.readOnly = false; document.getElementById('player-compose-send').removeAttribute('aria-busy'); } });
  }
  function openPlayerOptions(kind, entry) {
    if (!isPlaybackPage()) return;
    if (kind === 'quality' && (!activePlayback || !document.getElementById('hero-video').getAttribute('src'))) { showNotice('视频准备好后可选择清晰度'); return; }
    if (kind === 'send-danmaku' && !playbackSnapshot()) { showNotice('开始播放后可发送弹幕'); return; }
    if (playerOptionsOpen) closePlayerOptions(false);
    revealControls(); clearTimeout(controlsTimer);
    playerOptionsReturn = entry;
    playerOptionsOpen = true;
    var video = document.getElementById('hero-video');
    var values = kind === 'speed' ? playbackSpeeds : kind === 'quality' ? [''].concat(playbackQualities) : [0, 25, 50, 75, 100];
    var selected = kind === 'speed' ? video.playbackRate : kind === 'quality' ? playbackPreferences.quality : video.muted ? 0 : Math.round(video.volume * 100);
    document.getElementById('player-options-title').textContent = ({ speed: '播放倍速', volume: '音量', quality: '清晰度', 'send-danmaku': '发弹幕' })[kind];
    document.getElementById('player-options-message').textContent = kind === 'quality' ? '切换后从当前时间继续播放' : '';
    document.getElementById('player-options').classList.toggle('is-composer', kind === 'send-danmaku');
    document.getElementById('player-compose').classList.toggle('is-hidden', kind !== 'send-danmaku');
    var list = document.getElementById('player-options-list'); list.innerHTML = '';
    list.classList.toggle('is-hidden', kind === 'send-danmaku');
    if (kind === 'send-danmaku') {
      composeSession = playbackSnapshot(); composeSession.offset_ms = Math.floor(video.currentTime * 1000); ++composeEpoch;
      document.getElementById('player-compose-label').textContent = '第' + composeSession.episode + '集 · ' + clockText(video.currentTime);
      document.getElementById('player-compose-input').value = danmakuDrafts[draftKey(composeSession)] || '';
      document.getElementById('player-options').classList.remove('is-hidden'); goFocus(document.getElementById('player-compose-input')); return;
    }
    values.forEach(function (value, index) {
      var option = document.createElement('button');
      option.className = 'player-option' + (value === selected ? ' is-selected' : '');
      option.dataset.focus = 'player-option-' + index;
      option.textContent = kind === 'speed' ? value + 'x' : kind === 'quality' ? value || '自动' : value === 0 ? '静音' : value + '%';
      option.addEventListener('click', function () {
        if (kind === 'quality') { switchQuality(value); return; }
        try {
          if (kind === 'speed') { video.playbackRate = value; video.defaultPlaybackRate = value; playbackPreferences.speed = value; }
          else { video.volume = value / 100; video.muted = value === 0; playbackPreferences.volume = value; }
          updatePlaybackControls(); savePlaybackPreferences(); closePlayerOptions();
        } catch (error) { showNotice(kind === 'speed' ? '设备不支持这个倍速' : '请用遥控器音量键调整音量'); }
      });
      list.appendChild(option);
    });
    document.getElementById('player-options').classList.remove('is-hidden');
    goFocus(list.querySelector('.is-selected') || list.querySelector('.player-option'));
  }
  function seekTo(position) {
    var video = document.getElementById('hero-video');
    if (!activePlayback || !Number.isFinite(position) || !Number.isFinite(video.duration) || video.duration <= 0) return false;
    video.currentTime = Math.max(0, Math.min(position, Math.max(0, video.duration - .25)));
    updatePlaybackControls(); revealControls();
    return true;
  }
  function seekBy(delta) { return seekTo(document.getElementById('hero-video').currentTime + delta); }
  function setCinema(enabled) { shell.classList.toggle('is-cinema', enabled); updatePlaybackControls(); }
  function exitCinema(keepHidden) {
    fullscreenExitKeepsHidden = !!keepHidden;
    setCinema(false);
    if (document.fullscreenElement && document.exitFullscreen) Promise.resolve(document.exitFullscreen()).catch(function () {});
  }
  function toggleCinema() {
    if (shell.classList.contains('is-cinema')) exitCinema();
    else {
      setCinema(true);
      // Android already fills the display. Keep the CSS layout if the browser
      // Fullscreen API is unavailable; never fullscreen the video alone.
      if (shell.requestFullscreen) Promise.resolve(shell.requestFullscreen()).catch(function () {});
    }
    revealControls();
  }
  function handleBack() {
    if (accountKeypadOpen()) { numericKeypad.close('back'); return true; }
    if (supportModalOpen) { closeSupportQR(); return true; }
    if (confirmOpen) closeConfirmation();
    else if (playerOptionsOpen) closePlayerOptions();
    else if (detailModalOpen) closeDetail();
    else if (discussionOpen) closeDiscussion();
    else if (pageMode() === 'account' && accountData && accountData.phase === 'mfa') { cancelAccountVerification(true); }
    else if (isPlaybackPage() && zoneOf(document.activeElement) !== 'sidebar' && !shell.classList.contains('is-controls-hidden')) hideControls();
    else if (shell.classList.contains('is-cinema')) { exitCinema(true); hideControls(); }
    else if (pageMode() === 'player') leavePlayer();
    else if (zoneOf(document.activeElement) !== 'sidebar') goFocus(activeSidebar());
    else return false;
    return true;
  }
  function handleMediaCommand(command) {
    var video = document.getElementById('hero-video');
    if (applicationInBackground || !isPlaybackPage() || !video.getAttribute('src')) return false;
    if (command === 'toggle') toggleVideo();
    else if (command === 'play') playMedia(video).catch(function () { showNotice('请按确认键开始播放'); });
    else if (command === 'pause') video.pause();
    else if (command === 'forward') seekBy(10);
    else if (command === 'rewind') seekBy(-10);
    else return false;
    revealControls();
    return true;
  }
  function pauseForBackground() {
    if (accountKeypadOpen()) numericKeypad.close('background');
    if (smsVerification) smsVerification.stop();
    var video = document.getElementById('hero-video');
    var preparing = playbackInfoRequest || playbackPrefetchHandoff || activePlayback && !video.getAttribute('src');
    applicationInBackground = true;
    episodePrefetch.cancel();
    cancelPlaybackPreparation();
    cancelQualitySwitch();
    cancelSeasonSwitch();
    ++continuationGeneration;
    if (activePlayback && activePlayback.continuationPending) setPlayerStatus('');
    saveProgress(true);
    video.pause();
    if (preparing) setPlayerStatus('视频准备已暂停，请重试', true);
    clearTimeout(controlsTimer);
  }
  function resumeFromBackground() {
    applicationInBackground = false;
    updatePlaybackControls();
    if (pageMode() === 'account' && document.activeElement && document.activeElement.closest('#account-keypad-modal')) goFocus(firstContentFocus());
  }
  function resetPlayerUI() {
    episodePrefetch.cancel(); cancelPlaybackPreparation();
    closeDiscussion(false); resetDanmaku();
    closePlayerOptions(false); clearTimeout(controlsTimer);
    shell.classList.remove('is-controls-hidden'); exitCinema();
    setPlayerStatus('');
  }
  function canShowAppUpdate() {
    var current = document.activeElement;
    return !applicationInBackground && !document.hidden && !isPlaybackPage() && !supportModalOpen && !detailModalOpen && !discussionOpen && !confirmOpen && !playerOptionsOpen && !accountBusy && !accountKeypadOpen() && !(current && /INPUT|TEXTAREA/.test(current.tagName));
  }
  // Old native IME callbacks are irrelevant to the app-owned numeric keypad.
  window.HongguoTV = { remoteKey: remoteKey, requestBack: handleBack, mediaCommand: handleMediaCommand, pauseForBackground: pauseForBackground, resumeFromBackground: resumeFromBackground, canShowAppUpdate: canShowAppUpdate, finishAccountEditing: function () {} };

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
    ['series_id', 'title', 'cover', 'cover_fallback', 'intro', 'score', 'episode_count', 'tags', 'season_index', 'is_multi_season'].forEach(function (key) { if (item[key] !== undefined) result[key] = item[key]; });
    return result;
  }
  function updateSavedButtons() {
    var entry = featuredItem && libraryEntry(featuredItem.series_id);
    ['favorite', 'like'].forEach(function (kind) {
      var button = document.querySelector('.round-action[data-action="' + kind + '"]');
      var saved = kind === 'favorite' ? !!(entry && entry.favorite_at) : currentVideoLiked(featuredItem);
      button.classList.toggle('is-saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.querySelector('small').textContent = kind === 'favorite' ? saved ? '已收藏' : '收藏' : saved ? '已点赞' : '点赞';
      button.setAttribute('aria-label', button.querySelector('small').textContent + ' · ' + button.querySelector('.action-count').textContent);
    });
    var detailEntry = currentDetail && libraryEntry(currentDetail.series_id);
    var detailButton = document.getElementById('detail-save');
    detailButton.textContent = detailEntry && detailEntry.favorite_at ? '已收藏' : '收藏';
    detailButton.classList.toggle('is-saved', !!(detailEntry && detailEntry.favorite_at));
    detailButton.setAttribute('aria-pressed', String(!!(detailEntry && detailEntry.favorite_at)));
  }
  function currentVideoLiked(item) {
    var entry = item && libraryEntry(item.series_id);
    var session = playbackSnapshot();
    return !!(entry && session && item && session.series_id === item.series_id && (entry.liked_videos || []).some(function (liked) { return liked.video_id === session.vid; }));
  }
  function loadLibrary() {
    var ownerEpoch = accountEpoch;
    libraryError = '';
    return fetch('/api/v1/library')
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (ownerEpoch !== accountEpoch) return false;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '记录响应无效');
        libraryData = payload.data;
        libraryLoaded = true;
        updateSavedButtons();
        updateDetailProgress();
        if (isLibraryPage()) renderLibrary(true);
        return true;
      }).catch(function (error) { libraryError = error.message; if (isLibraryPage()) renderLibrary(true); return false; });
  }
  function changeLibrary(change, quiet) {
    change.owner_id = libraryData.owner_id || '';
    var ownerEpoch = accountEpoch;
    var ready = libraryReady;
    var operation = libraryQueue.catch(function () {}).then(function () { return ready; }).then(function () {
      if (ownerEpoch !== accountEpoch) return false;
      return fetch('/api/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
        .then(function (response) {
          return response.json().then(function (payload) { if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '记录保存失败'); return payload; });
        }).then(function (payload) {
          if (ownerEpoch !== accountEpoch || (payload.data.owner_id || '') !== (libraryData.owner_id || '')) return false;
          libraryData = payload.data;
          libraryLoaded = true;
          updateSavedButtons();
          updateDetailProgress();
          if (isLibraryPage()) renderLibrary(!!quiet);
          return true;
        });
    });
    libraryQueue = operation;
    return operation.catch(function (error) { if (ownerEpoch === accountEpoch) showNotice((change.action === 'like' ? '点赞未完成：' : '本机记录未保存：') + error.message); return false; });
  }
  function toggleSaved(item, kind, button) {
    if (!item || !item.series_id || !libraryLoaded || button.disabled) return;
    var session = playbackSnapshot();
    if (kind === 'like') {
      if (!accountData || !accountData.logged_in) { showNotice('请先到“我的 / 登录”登录红果账号'); return; }
      if (!session || session.series_id !== item.series_id) { showNotice('请先选择要点赞的播放集'); return; }
    }
    var entry = libraryEntry(item.series_id);
    var saved = kind === 'favorite' ? !!(entry && entry.favorite_at) : currentVideoLiked(item);
    var ownerEpoch = accountEpoch;
    var wasFocused = document.activeElement === button;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    var change = { action: kind, drama: basicDrama(item), value: !saved };
    if (kind === 'like') { change.video_id = session.vid; change.episode = session.episode; }
    changeLibrary(change).then(function (ok) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      var current = playbackSnapshot();
      var same = ownerEpoch === accountEpoch && featuredItem && featuredItem.series_id === item.series_id && (kind !== 'like' || current && current.vid === session.vid);
      if (same && wasFocused && document.activeElement === document.body && button.getClientRects().length) goFocus(button);
      if (ok && same) {
        if (session) engagement.adjust(kind, saved ? -1 : 1, session);
        showNotice(saved ? kind === 'favorite' ? '已取消收藏' : '已取消第' + session.episode + '集点赞' : kind === 'favorite' ? '已收藏到本机' : '已点赞第' + session.episode + '集');
      }
    });
  }
  function renderLibrary(restoring) {
    var kind = pageMode();
    if (!isLibraryPage()) return;
    var label = ({ history: '历史', favorites: '收藏', likes: '点赞' })[kind];
    document.getElementById('library-title').textContent = label;
    var storageLabel = libraryData.owner_id ? '当前账号 · 云同步' : '保存在本机';
    document.getElementById('library-hint').textContent = storageLabel + (kind === 'history' ? ' · 自动记住集数和进度' : '');
    var grid = document.getElementById('library-grid');
    var entries = libraryData.entries.filter(function (entry) { return libraryTime(entry, kind) > 0; });
    entries.sort(function (a, b) { return libraryTime(b, kind) - libraryTime(a, kind); });
    var existing = {};
    Array.prototype.forEach.call(grid.children, function (tile, index) { existing[tile.dataset.seriesId] = { tile: tile, index: index }; });
    if (restoring) entries.sort(function (a, b) { return (existing[a.drama.series_id] ? existing[a.drama.series_id].index : 10000) - (existing[b.drama.series_id] ? existing[b.drama.series_id].index : 10000); });
    var totalEntries = entries.length;
    var count = libraryPager.params.kind === kind ? Math.max(20, libraryPager.items.length) : 20;
    if (libraryPager.params.kind !== kind) libraryPager.cancel();
    libraryPager.params.kind = kind;
    libraryPager.local(entries.map(function (entry) { return entry.drama; }), count);
    entries = entries.slice(0, count);
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
        var image = document.createElement('img'); image.loading = 'lazy'; card.appendChild(dramaPoster(image, entry.drama));
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
      updatePosterSeason(card.querySelector('.drama-poster'), entry.drama);
      card.querySelector('.library-card-title').textContent = entry.drama.title;
      card.querySelector('.library-card-meta').textContent = entry.last_played_at ? entry.completed && entry.drama.episode_count && entry.episode >= entry.drama.episode_count ? '已看完 · 全' + entry.episode + '集' : '继续第' + resumeEpisode(entry, entry.drama) + '集' + (!entry.completed && entry.position ? ' · ' + clockText(entry.position) : '') : entry.drama.episode_count ? '全' + entry.drama.episode_count + '集' : '从第一集播放';
      card.querySelector('.library-card-time').textContent = new Date(libraryTime(entry, kind)).toLocaleDateString();
      card.querySelector('.library-progress').classList.toggle('is-hidden', !entry.last_played_at || !entry.duration);
      card.querySelector('.library-progress > span').style.width = Math.min(100, entry.duration ? entry.position / entry.duration * 100 : 0) + '%';
      tile.querySelector('.library-remove').classList.toggle('is-hidden', !libraryEditing);
      if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);
    });
    Array.prototype.slice.call(grid.children).forEach(function (tile) { if (!keep[tile.dataset.seriesId]) tile.remove(); });
    document.getElementById('library-count').textContent = totalEntries ? totalEntries + ' 部 · 已显示 ' + entries.length + ' 部' : '';
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
    document.getElementById('confirm-accept').classList.remove('confirm-reserve');
    document.getElementById('confirm-accept').classList.add('confirm-danger');
    document.getElementById('confirm-cancel').textContent = '取消';
    var target = confirmReturnFocus;
    confirmReturnFocus = null;
    goFocus(target && focusables().indexOf(target) >= 0 ? target : firstContentFocus());
  }
  function confirmClearLibrary() {
    ++confirmationGeneration;
    var kind = pageMode();
    var label = ({ history: '历史', favorites: '收藏', likes: '点赞' })[kind];
    confirmReturnFocus = document.activeElement;
    confirmOperation = function () { return changeLibrary({ action: 'clear', kind: kind }); };
    confirmOpen = true;
    document.getElementById('confirm-title').textContent = '清空全部' + label + '？';
    document.getElementById('confirm-accept').textContent = '清空';
    document.getElementById('confirm-copy').textContent = kind === 'history' ? '观看进度也会移除，收藏和点赞会保留。' : '只清空本机' + label + '，观看历史和其它记录会保留。';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    goFocus(document.getElementById('confirm-cancel'));
  }

  function setCatalogHeading(text) {
    document.getElementById('catalog-heading').textContent = text || '热播短剧';
  }

  function acceptAccountStatus(data) {
    var previous = accountData;
    var owner = data.profile && data.profile.uid || '';
    var previousOwner = previous && previous.profile && previous.profile.uid || '';
    accountData = data;
    if (smsVerification) smsVerification.setSession(!data.logged_in && data.phase === 'mfa' && data.mfa_expires_at ? { key: String(data.mfa_expires_at) + ':' + (data.sms_number || '') + ':' + (data.sms_content || ''), expiresAt: data.mfa_expires_at } : null);
    accountCountdownUntil = Date.now() + (data.retry_after || 0) * 1000;
    if (owner !== previousOwner || owner !== (libraryData.owner_id || '')) {
      ++accountEpoch;
      if (engagement) engagement.resetAccount();
      episodePrefetch.cancel();
      var interruptedPlayback = playbackInfoRequest || playbackPrefetchHandoff;
      cancelPlaybackPreparation();
      if (interruptedPlayback && pageMode() === 'player') setPlayerStatus('账号已切换，请重试播放', true);
      resetSeasonCatalog();
      reservationCounts = { online: null, upcoming: null }; updateReservationCounts({});
      resetSeriesPanel();
      if (detailModalOpen && detailTab === 'series') { loadSeriesSeasons(); goFocus(document.getElementById('detail-tab-series')); }
      if (confirmOpen) closeConfirmation();
      closePlayerOptions(false);
      allPagers.forEach(function (pager) { pager.cancel(); pager.loaded = false; pager.items = []; pager.buffer = []; if (pager.container) pager.container.innerHTML = ''; });
      closeDiscussion(false); resetDanmaku();
      discussionDrafts = {}; danmakuDrafts = {};
      calendarSchema = null;
      if (pageMode() === 'reservations') renderReservations(reservationMode);
      else if (pageMode() === 'new') { if (newMode === 'calendar') loadCalendar(); else loadNew(); }
      else if (pageMode() === 'rank') loadRank();
      else if (pageMode() === 'search') { if (searchKind === 'keyword') submitSearch(); else loadBrowse(false, !filterRows.length); }
      else if (pageMode() === 'recommend') loadCatalog(activeChannel().textContent);
      libraryData = { entries: [], owner_id: owner };
      libraryLoaded = false;
      libraryReady = libraryQueue.catch(function () {}).then(loadLibrary);
      updateSavedButtons();
      updateDetailProgress();
    } else if (data.logged_in && data.sync && previous && previous.sync && data.sync.last_sync !== previous.sync.last_sync) {
      libraryQueue.catch(function () {}).then(loadLibrary);
    }
    renderAccount();
  }
  function renderAccount() {
    var data = accountData || { phase: 'phone', logged_in: false, sync: { state: 'local' } };
    if (accountKeypadOpen() && (data.logged_in || data.phase !== accountKeypadPhase || accountBusy)) numericKeypad.close('context');
    var logged = !!data.logged_in;
    var mfa = !logged && data.phase === 'mfa';
    var verification = smsVerification ? smsVerification.snapshot() : { state: 'idle', remaining: 0 };
    var mfaExpired = mfa && (verification.state === 'expired' || data.mfa_expires_at && Date.now() >= data.mfa_expires_at);
    document.getElementById('account-login-form').classList.toggle('is-hidden', logged || mfa);
    document.getElementById('account-profile').classList.toggle('is-hidden', !logged);
    document.getElementById('account-mfa').classList.toggle('is-hidden', !mfa);
    document.getElementById('account-code-field').classList.toggle('is-hidden', data.phase !== 'code');
    document.getElementById('account-login').classList.toggle('is-hidden', data.phase !== 'code');
    document.getElementById('account-change-phone').classList.toggle('is-hidden', data.phase !== 'code');
    var phoneInput = document.getElementById('account-phone');
    document.querySelectorAll('.account-input').forEach(function (node) { node.disabled = accountBusy; renderAccountNumber(node); });
    phoneInput.disabled = accountBusy || data.phase === 'code' && /^1[3-9]\d{9}$/.test(phoneInput.value) && !(accountKeypadOpen() && numericKeypad.snapshot().kind === 'phone');
    document.querySelectorAll('.account-action:not(.app-update-action)').forEach(function (node) { node.disabled = accountBusy; });
    document.getElementById('account-cancel').disabled = false;
    document.getElementById('account-verify').disabled = accountBusy || mfaExpired || verification.state === 'waiting';
    document.getElementById('account-verify').textContent = verification.state === 'waiting' ? '等待确认…' : verification.state === 'timeout' ? '再次查询' : '我已发送';
    document.getElementById('account-cancel').textContent = mfaExpired ? '重新获取验证码' : '取消验证';
    document.getElementById('account-mfa-session').textContent = mfaExpired ? '本机验证等待时间已结束，请重新获取验证码。' : mfa && data.mfa_expires_at ? '本机验证等待剩余 ' + clockText(Math.ceil((data.mfa_expires_at - Date.now()) / 1000)) + '，红果也可能提前要求重新验证。' : '';
    document.getElementById('account-mfa-wait').textContent = verification.state === 'waiting' ? '正在等待短信确认 · 本轮剩余 ' + verification.remaining + ' 秒' : verification.state === 'timeout' ? '本轮等待已结束。会话仍有效时可以再次查询，无需重复发送短信。' : '';
    document.getElementById('account-change-phone').disabled = false;
    var remaining = Math.max(0, Math.ceil((accountCountdownUntil - Date.now()) / 1000));
    var send = document.getElementById('account-send-code');
    send.disabled = accountBusy || remaining > 0;
    send.textContent = remaining > 0 ? remaining + (data.phase === 'code' && data.sms_state === 'sent' ? ' 秒后重发' : ' 秒后可重试') : data.phase === 'code' ? '重新发送' : '获取验证码';
    document.getElementById('account-sync').disabled = !logged || accountBusy || data.sync && data.sync.state === 'syncing';
    var guestHistory = data.guest_history || {};
    document.getElementById('account-import-history').disabled = !logged || accountBusy || !(guestHistory.available > 0);
    document.getElementById('account-import-detail').textContent = !logged ? '登录后可将本机观看历史合并到当前账号。' : guestHistory.available > 0 ? '有 ' + guestHistory.available + ' 部登录前观看的短剧可合并。' : guestHistory.total > 0 ? '没有待合并的新记录；已合并、删除或较旧的进度不会重复加入。' : '本机暂无登录前的观看历史。';
    if (logged) {
      document.getElementById('account-name').textContent = data.profile.name;
      document.getElementById('account-phone-mask').textContent = data.profile.phone || '';
    }
    document.getElementById('account-sms-number').textContent = data.sms_number || '';
    document.getElementById('account-sms-content').textContent = data.sms_content || '';
    var smsImage = document.getElementById('account-sms-qr-image');
    var smsQR = mfa && !mfaExpired && /^data:image\/png;base64,/.test(data.sms_qr || '') ? data.sms_qr : '';
    if (smsImage.getAttribute('src') !== smsQR) {
      if (smsQR) smsImage.setAttribute('src', smsQR); else smsImage.removeAttribute('src');
    }
    document.getElementById('account-sms-qr').classList.toggle('is-hidden', !smsQR);
    document.getElementById('account-sms-qr-help').classList.toggle('is-hidden', !smsQR);
    document.getElementById('account-sms-qr').disabled = false;
    if (supportModalOpen && supportReturnFocus && supportReturnFocus.id === 'account-sms-qr' && !smsQR) closeSupportQR();
    var sync = data.sync || {};
    var syncLabel = !logged ? '未登录 · 记录保存在本机' : ({ syncing: '正在同步…', pending: '等待同步', error: '同步暂未完成', idle: sync.last_sync ? '已同步' : '尚未同步' })[sync.state] || '等待同步';
    document.getElementById('account-sync-state').textContent = syncLabel;
    document.getElementById('account-sync-detail').textContent = sync.error || (logged ? (sync.pending ? sync.pending + ' 项记录待同步。' : '收藏、点赞与观看进度会自动同步。') + (sync.last_sync ? ' 最近同步：' + new Date(sync.last_sync).toLocaleTimeString() : '') : '收藏、点赞、观看历史和播放进度会与红果账号同步。');
    document.getElementById('account-message').textContent = accountBusy ? '正在连接红果，请稍候…' : accountNotice || data.error || '';
    document.querySelector('.side-item[data-page="account"] span:last-child').textContent = logged ? '我的账号' : '我的 / 登录';
    if (pageMode() === 'account') document.getElementById('page-context').textContent = logged ? '我的账号' : '我的 / 登录';
    var current = document.activeElement;
    if (!accountKeypadOpen() && !accountBusy && pageMode() === 'account' && current && current.closest('#account-keypad-modal')) goFocus(firstContentFocus());
    if (!accountBusy && !confirmOpen && pageMode() === 'account' && current && /accountInputs|accountActions/.test(zoneOf(current)) && focusables().indexOf(current) < 0) goFocus(firstContentFocus());
  }
  function setAccountMessage(message) { accountNotice = message; renderAccount(); }
  function pollAccount() {
    if (accountPollBusy || accountBusy) return Promise.resolve();
    accountPollBusy = true;
    var epoch = accountEpoch;
    var generation = accountRequestGeneration;
    return fetch('/api/v1/account').then(function (response) { return response.json(); }).then(function (payload) {
      if (epoch !== accountEpoch || generation !== accountRequestGeneration || accountBusy) return;
      if (!payload.ok || !payload.data) throw new Error(payload.error || '账号状态读取失败');
      acceptAccountStatus(payload.data);
    }).catch(function (error) { if (pageMode() === 'account') setAccountMessage(error.message); })
      .then(function () { accountPollBusy = false; });
  }
  function accountRequest(action, value, signal) {
    if (accountBusy && action !== 'cancel') return Promise.resolve(false);
    var returnFocus = document.activeElement;
    function restoreRequestFocus() {
      if (pageMode() === 'account' && !confirmOpen && document.activeElement === document.body) goFocus(focusables().indexOf(returnFocus) >= 0 ? returnFocus : firstContentFocus());
    }
    accountBusy = true;
    accountNotice = '';
    var generation = ++accountRequestGeneration;
    function aborted() {
      if (generation !== accountRequestGeneration) return;
      ++accountRequestGeneration; accountBusy = false; renderAccount(); restoreRequestFocus();
    }
    if (signal) signal.addEventListener('abort', aborted);
    renderAccount();
    return fetch('/api/v1/account/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value || {}), signal: signal })
      .then(function (response) { return response.json(); }).then(function (payload) {
        if (generation !== accountRequestGeneration) return false;
        accountBusy = false;
        if (payload.data) acceptAccountStatus(payload.data);
        restoreRequestFocus();
        if (!payload.ok) throw new Error(payload.error || '账号请求失败');
        if (action === 'import-history' && payload.import_history && payload.data && payload.data.profile && payload.data.profile.uid === value.owner_id) {
          var imported = payload.import_history;
          setAccountMessage(imported.imported > 0 ? '已合并 ' + imported.imported + ' 部短剧。' + (imported.remaining > 0 ? '还有 ' + imported.remaining + ' 部待合并，请完成同步后再试。' : '将自动同步到当前账号，网络恢复后会重试。') : '没有需要合并的新记录。');
        }
        return true;
      }).catch(function (error) {
        if (generation !== accountRequestGeneration) return false;
        accountBusy = false; renderAccount();
        setAccountMessage(error.message);
        restoreRequestFocus();
        return false;
      }).then(function (ok) { if (signal) signal.removeEventListener('abort', aborted); return ok; });
  }
  function accountSendCode() {
    var phone = document.getElementById('account-phone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { setAccountMessage('请输入正确的手机号'); goFocus(document.getElementById('account-phone')); return; }
    accountRequest('send-code', { phone: phone }).then(function (ok) {
      if (pageMode() === 'account') goFocus(ok ? document.getElementById('account-code') : firstVisible('.account-input'));
    });
  }
  function accountLogin() {
    var phone = document.getElementById('account-phone').value.trim();
    var code = document.getElementById('account-code').value.trim();
    if (!/^\d{4,8}$/.test(code)) { setAccountMessage('请输入短信验证码'); goFocus(document.getElementById('account-code')); return; }
    accountRequest('login', { phone: phone, code: code }).then(function (ok) {
      if (!ok) { if (pageMode() === 'account') goFocus(document.getElementById('account-code')); return; }
      document.getElementById('account-code').value = '';
      renderAccountNumber(document.getElementById('account-code'));
      if (pageMode() === 'account') goFocus(accountData.logged_in ? document.getElementById('account-logout') : document.getElementById('account-verify'));
    });
  }
  function cancelAccountVerification(returnToSidebar) {
    if (smsVerification) smsVerification.stop();
    return accountRequest('cancel').then(function () {
      document.getElementById('account-code').value = '';
      renderAccountNumber(document.getElementById('account-code'));
      if (pageMode() === 'account') goFocus(returnToSidebar === true ? activeSidebar() : document.getElementById('account-phone'));
    });
  }
  function verifyAccountSMS() {
    if (accountBusy) return;
    if (smsVerification) smsVerification.start();
  }
  function confirmAccountLogout() {
    ++confirmationGeneration;
    confirmReturnFocus = document.activeElement;
    confirmOperation = function () {
      if (smsVerification) smsVerification.stop();
      return accountRequest('logout').then(function (ok) {
        if (ok) document.querySelectorAll('.account-input').forEach(function (field) { field.value = ''; renderAccountNumber(field); });
        return ok;
      });
    };
    confirmOpen = true;
    document.getElementById('confirm-title').textContent = '退出当前账号？';
    document.getElementById('confirm-accept').textContent = '退出';
    document.getElementById('confirm-copy').textContent = '云端记录会保留。待同步记录留在当前账号的本机目录，再次登录这个账号后继续同步。退出后显示登录前的本机记录。';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    goFocus(document.getElementById('confirm-cancel'));
  }

  function catalogMeta(item) {
    var values = [];
    if (item.episode_count) values.push(item.episode_count + ' 集');
    if (item.score) values.push(item.score + ' 分');
    return values.join(' · ') || '红果短剧';
  }

  function setCover(image, item) {
    image.alt = item.title || '';
    var source = item.cover_fallback || item.cover || '';
    if (image.getAttribute('src') === source && image.complete && image.naturalWidth) return;
    var generation = image.__coverGeneration = (image.__coverGeneration || 0) + 1;
    image.classList.remove('is-empty');
    image.classList.add('is-cover-pending');
    image.onload = function () {
      // Let the reserved poster box settle before showing decoded pixels.
      requestAnimationFrame(function () {
        if (image.__coverGeneration === generation) image.classList.remove('is-cover-pending');
      });
    };
    image.onerror = function () {
      image.removeAttribute('src'); image.alt = ''; image.classList.add('is-empty');
    };
    if (source) image.src = source;
    else image.onerror();
  }

  function setBackdrop(backdrop, item) {
    var source = item.cover_fallback || item.cover || '';
    if (backdrop.__coverSource === source) return;
    backdrop.__coverSource = source;
    var loader = new Image();
    backdrop.__coverLoader = loader;
    backdrop.classList.add('is-cover-pending');
    backdrop.style.backgroundImage = 'none';
    loader.onload = function () {
      if (backdrop.__coverLoader !== loader) return;
      // Background cover preserves the intrinsic ratio even on old WebViews;
      // the loading poster is never painted as a stretched full-size img.
      backdrop.style.backgroundImage = 'url(' + JSON.stringify(loader.src) + ')';
      requestAnimationFrame(function () {
        if (backdrop.__coverLoader === loader) backdrop.classList.remove('is-cover-pending');
      });
    };
    loader.onerror = function () { if (backdrop.__coverLoader === loader) backdrop.style.backgroundImage = 'none'; };
    if (source) loader.src = source;
  }

  function setFeatured(item, waitingForProgress) {
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
    if (backdrop) {
      setBackdrop(backdrop, item);
    }
    if (title) title.textContent = item.title || '红果短剧';
    if (episode) episode.textContent = waitingForProgress ? item.episode_count ? '全' + item.episode_count + '集' : '' : '第' + (item.start_episode || 1) + '集' + (item.episode_count ? ' · 全' + item.episode_count + '集' : '');
    if (summary) summary.textContent = item.intro || '';
    if (topTitle) topTitle.textContent = item.title || '红果短剧';
    if (topEpisode) topEpisode.textContent = waitingForProgress ? '' : '第' + (item.start_episode || 1) + '集';
    if (placeholderTitle) placeholderTitle.textContent = item.title || '红果短剧';
    if (placeholderSummary) placeholderSummary.textContent = item.intro || '';
    updateSavedButtons();
    if (engagement) engagement.select(activePlayback && activePlayback.item.series_id === item.series_id ? { series_id: item.series_id, vid: activePlayback.vid } : null);
    setControlIcon('episodes', '选集 · ' + (item.episode_count || '--') + ' 集', 'icon-episodes');
    updateSeasonControl(item);
  }

  function updateFeedCounter() {
    var counter = document.getElementById('hero-top-count');
    if (counter) counter.textContent = feedItems.length ? (feedIndex + 1) + ' / ' + feedItems.length : '0 / 0';
  }

  function showRecommendationPlaceholder(title, summary) {
    var hero = document.getElementById('hero');
    clearTimeout(controlsTimer);
    shell.classList.remove('is-controls-hidden');
    hero.classList.add('is-catalog-loading');
    document.getElementById('hero-placeholder-title').textContent = title;
    var copy = document.getElementById('hero-placeholder-summary');
    copy.textContent = summary || '';
    copy.classList.toggle('is-hidden', !summary);
    document.getElementById('hero-placeholder').classList.remove('is-hidden');
    setPlayerStatus('');
  }

  function switchRecommendation(step) {
    if (pageMode() !== 'recommend' || detailModalOpen || playerOptionsOpen || confirmOpen || discussionOpen || applicationInBackground || document.hidden || feedIndex < 0) return;
    playFeedItem(feedIndex + step);
  }

  function installRecommendationGestures() {
    var surface = document.querySelector('.hero-media');
    var touch = null;
    var suppressClickUntil = 0;
    var wheelAt = 0, wheelDelta = 0, wheelConsumed = false;
    function allowed(target) {
      return pageMode() === 'recommend' && feedIndex >= 0 && !detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && !applicationInBackground && !document.hidden && !target.closest('button, input, textarea, a');
    }
    surface.addEventListener('touchstart', function (event) {
      touch = null;
      if (event.touches.length !== 1 || !allowed(event.target)) return;
      var point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, at: Date.now(), generation: feedGeneration };
    }, false);
    surface.addEventListener('touchmove', function (event) {
      if (!touch || event.touches.length !== 1) { touch = null; return; }
      var point = event.touches[0];
      if (Math.abs(point.clientY - touch.y) > 8 && Math.abs(point.clientY - touch.y) > Math.abs(point.clientX - touch.x)) event.preventDefault();
    }, false);
    surface.addEventListener('touchend', function (event) {
      var start = touch;
      touch = null;
      if (!start || start.generation !== feedGeneration || !allowed(event.target) || !event.changedTouches.length) return;
      var point = event.changedTouches[0];
      var dy = point.clientY - start.y, dx = point.clientX - start.x;
      if (Date.now() - start.at > 1500 || Math.abs(dy) < 60 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
      event.preventDefault();
      suppressClickUntil = Date.now() + 400;
      switchRecommendation(dy < 0 ? 1 : -1);
      goFocus(document.getElementById('hero-feed-focus'));
    }, false);
    surface.addEventListener('touchcancel', function () { touch = null; });
    surface.addEventListener('click', function (event) {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    surface.addEventListener('wheel', function (event) {
      if (!allowed(event.target) || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      var now = Date.now();
      if (now - wheelAt > 200) { wheelDelta = 0; wheelConsumed = false; }
      wheelAt = now;
      if (wheelConsumed) return; // One switch per gesture; ignore trackpad inertia.
      var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1);
      if (wheelDelta * delta < 0) wheelDelta = 0;
      wheelDelta += delta;
      if (Math.abs(wheelDelta) < 60) return;
      wheelConsumed = true;
      switchRecommendation(wheelDelta > 0 ? 1 : -1);
      goFocus(document.getElementById('hero-feed-focus'));
    }, false);
  }

  function firstVid(item) {
    if (!item) return '';
    if (item.vid) return item.vid;
    if (item.vid_list && item.vid_list.length) return item.vid_list[0];
    return '';
  }

  function getDetail(item, signal) {
    if (detailCache[item.series_id]) return Promise.resolve(detailCache[item.series_id]);
    return fetch('/api/v1/series/detail?series_id=' + encodeURIComponent(item.series_id), signal ? { signal: signal } : undefined)
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

  function canContinuePlayback(playback) {
    return activePlayback === playback && playback.generation === feedGeneration && isPlaybackPage() &&
      (!playback.continuationToken || playback.continuationToken === continuationGeneration) && !applicationInBackground && !document.hidden;
  }

  function continueAfterEpisode(playback) {
    if (!canContinuePlayback(playback) || playback.continuationPending || seasonSwitchRequest) return;
    // Android 6 WebViews can support Promise without Promise.finally.
    function finishContinuation() { playback.continuationPending = false; playback.continuationToken = 0; }
    playback.continuationPending = true;
    playback.continuationToken = ++continuationGeneration;
    setPlayerStatus(episodeLoadingText(playback.item.episode_count > playback.episode ? playback.episode + 1 : 0));
    getDetail(playback.item).then(function (detail) {
      if (!canContinuePlayback(playback)) return;
      if (detail.vid_list && detail.vid_list[playback.episode]) {
        playFeedItem(feedIndex, playback.episode + 1, 0, playback);
        return;
      }
      // Missing/incomplete episode data must not be mistaken for season end.
      if (!detail.vid_list || !detail.vid_list.length || playback.episode < Math.max(detail.episode_count || 0, detail.vid_list.length)) {
        throw new Error('本季集列表不完整');
      }
      setPlayerStatus(episodeLoadingText());
      return fetch('/api/v1/series/next-season?series_id=' + encodeURIComponent(playback.item.series_id))
        .then(function (response) { return response.json().then(function (payload) {
          if (!response.ok || !payload.ok || !payload.data || !Object.prototype.hasOwnProperty.call(payload.data, 'next')) throw new Error(payload.error || '季关系响应无效');
          return payload.data;
        }); })
        .then(function (result) {
          if (!canContinuePlayback(playback)) return;
          var epoch = accountEpoch;
          return fetchData('/api/v1/series/seasons?series_id=' + encodeURIComponent(playback.item.series_id)).then(function (series) {
            if (!canContinuePlayback(playback) || epoch !== accountEpoch) return;
            if (!Array.isArray(series.items)) throw new Error('系列剧响应无效');
            var current = series.items.filter(function (item) { return item.series_id === playback.item.series_id; })[0];
            var season = current && current.season_index || result.current_season;
            if (current && result.current_season > 0 && current.season_index !== result.current_season) throw new Error('系列季号不一致');
            var successors = season > 0 ? series.items.filter(function (item) { return item.season_index === season + 1; }) : [];
            if (successors.length > 1) throw new Error('下一季关系存在冲突');
            var successor = successors[0];
            // The full series selector takes precedence, including upcoming
            // seasons. Never skip a reservable season to a later playable one.
            if (successor && successor.upcoming) {
              setPlayerStatus(''); revealControls();
              if (successor.reservation_id) offerNextSeasonReservation(playback, successor, epoch);
              else showNotice('本季已播放完，下一季待上线，尚未开放预约');
              return;
            }
            if (successor && !successor.playable) { setPlayerStatus(''); revealControls(); showNotice('下一季暂不可播放'); return; }
            var next = successor || (!current ? result.next : null);
            if (next) {
              if (!next.series_id || next.series_id === playback.item.series_id || !next.vid || !(season > 0) || next.season_index !== season + 1 || !(next.episode_count > 0)) throw new Error('下一季数据无效');
              feedItems[feedIndex] = next;
              playFeedItem(feedIndex, 1, 0);
              refreshDetailAfterSeason(playback.item.series_id, next);
              showNotice('继续播放第' + next.season_index + '季');
            } else {
              setPlayerStatus(''); revealControls();
              if (pageMode() === 'recommend' && feedItems.length > 1) playFeedItem(feedIndex + 1);
              else showNotice('本剧已播放完，暂无可播放的下一季');
            }
          });

        });
    }).catch(function (error) {
      if (!canContinuePlayback(playback)) return;
      setPlayerStatus(''); revealControls();
      showNotice('连续播放已暂停：' + error.message);
    }).then(finishContinuation, finishContinuation);
  }

  function offerNextSeasonReservation(playback, item, epoch) {
    if (!canContinuePlayback(playback) || confirmOpen) return;
    var label = item.label || '第' + item.season_index + '季';
    if (item.reserved) { showNotice('本季已播放完，' + label + '已预约，等待上线'); return; }
    if (!accountData || !accountData.logged_in) { showNotice('本季已播放完，' + label + '待上线。登录后可在“选集 → 系列剧”预约'); return; }
    ++confirmationGeneration; var generation = confirmationGeneration;
    confirmReturnFocus = document.activeElement; confirmOpen = true;
    document.getElementById('confirm-title').textContent = '预约下一季？';
    document.getElementById('confirm-copy').textContent = '本季已播放完，' + item.title + '尚未上线。预约后可在“我的预约”查看。';
    var accept = document.getElementById('confirm-accept');
    accept.textContent = '预约' + label; accept.classList.add('confirm-reserve'); accept.classList.remove('confirm-danger');
    document.getElementById('confirm-cancel').textContent = '稍后';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    confirmOperation = function () {
      if (epoch !== accountEpoch || activePlayback !== playback || !isPlaybackPage()) return Promise.resolve(true);
      return fetchData('/api/v1/reservation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: item.reservation_id, reserved: true }) }).then(function () {
        if (epoch !== accountEpoch) return true;
        item.reserved = true; reservationPager.loaded = false; calendarPager.loaded = false;
        // Refetch exact counts next time; other pages may have changed remotely.
        reservationCounts.upcoming = null; updateReservationCounts({});
        updateSeasonReservation(item.reservation_id, true);
        updateSeriesRows();
        showNotice('已预约' + label + '，上线后可在“我的预约”查看');
        return true;
      }).catch(function (error) {
        if (epoch === accountEpoch && confirmOpen && generation === confirmationGeneration) document.getElementById('confirm-copy').textContent = '预约未确认成功：' + error.message + '。可以重试，或选择稍后。';
        return false;
      });
    };
    goFocus(document.getElementById('confirm-cancel'));
  }

  function refreshDetailAfterSeason(previousID, next) {
    if (!detailModalOpen || detailSeriesID !== previousID) return;
    var focused = document.activeElement;
    var index = focused && focused.classList.contains('detail-episode') ? 0 : -1;
    var generation = ++detailGeneration;
    detailSeriesID = next.series_id;
    currentDetail = next;
    renderDetail(next);
    updateSeriesRows();
    if (index >= 0) goFocus(detailElements().play);
    getDetail(next).then(function (detail) {
      if (!detailModalOpen || generation !== detailGeneration || !currentDetail || currentDetail.series_id !== next.series_id) return;
      currentDetail = Object.assign({}, next, detail);
      renderDetail(currentDetail);
      if (index >= 0 && document.activeElement === detailElements().play && detailElements().episodes.firstElementChild) goFocus(detailElements().episodes.firstElementChild);
    }).catch(function () { if (detailModalOpen && generation === detailGeneration) showNotice('下一季选集暂时读取失败，可关闭后重试'); });
  }

  function cancelPlaybackPreparation() {
    if (playbackInfoRequest) playbackInfoRequest.abort(); playbackInfoRequest = null;
    if (playbackPrefetchHandoff) playbackPrefetchHandoff.cancel(); playbackPrefetchHandoff = null;
  }
  function maybePrefetchNextEpisode(video) {
    var playback = activePlayback;
    if (!playback) return;
    episodePrefetch.maybe({ item: playback.item, series_id: playback.item.series_id, vid: playback.vid,
      episode: playback.episode, quality: playbackPreferences.quality, generation: playback.generation, owner: accountEpoch,
      duration: Number(video.duration), position: Number(video.currentTime), paused: video.paused, ended: video.ended,
      stable_seconds: playback.stableSince ? Math.max(0, Date.now() - playback.stableSince) / 1000 : 0,
      started: playback.started, active: playback.generation === feedGeneration && isPlaybackPage() && !applicationInBackground && !document.hidden && !qualityPrevious });
  }
  function playFeedItem(index, forcedEpisode, forcedPosition, continuation) {
    closePlayerOptions(false);
    closeDiscussion(false); resetDanmaku();
    if (!feedItems.length) return;
    if (index < 0) { showNotice('已经是第一条推荐'); return; }
    if (index >= feedItems.length && pageMode() === 'recommend') {
      var pendingIndex = feedIndex;
      var pendingGeneration = feedPager.generation;
      if (feedPager.error) { showNotice('推荐加载失败，请再按向下重试'); }
      if (feedPager.hasMore() || feedPager.error) {
        feedPager.load(!!feedPager.error).then(function () { if (pageMode() === 'recommend' && feedPager.generation === pendingGeneration && feedIndex === pendingIndex && index < feedItems.length) playFeedItem(index); });
      } else showNotice('已浏览全部推荐');
      return;
    }
    if (index >= feedItems.length) return;
    var item = feedItems[index];
    if (!item || !item.series_id) return;
    var switchStartedAt = Date.now();
    var fastContinuation = !!(continuation && continuation.completed && canContinuePlayback(continuation) &&
      continuation.owner === accountEpoch && continuation.item.series_id === item.series_id &&
      forcedEpisode === continuation.episode + 1 && forcedPosition === 0 && libraryLoaded);
    cancelPlaybackPreparation();
    var request = new AbortController();
    playbackInfoRequest = request;
    episodePrefetch.keepFor(item.series_id, forcedEpisode, playbackPreferences.quality, accountEpoch);
    // ended has already queued the completed episode. Keep that write alive,
    // but do not queue it twice or make the next source wait for its fsync.
    if (!fastContinuation) saveProgress(true);
    activePlayback = null;
    playbackRequest = { index: index, episode: forcedEpisode, position: forcedPosition };
    playbackQuality = '';
    playbackQualities = [];
    feedIndex = index;
    if (pageMode() === 'recommend' && feedIndex >= feedItems.length - 3 && !feedPager.error) feedPager.load();
    var hero = document.getElementById('hero');
    var video = document.getElementById('hero-video');
    var placeholder = document.getElementById('hero-placeholder');
    var generation = ++feedGeneration;
    clearTimeout(controlsTimer);
    hero.classList.add('is-feed', 'is-preparing-video');
    hero.classList.remove('is-catalog-loading');
    placeholder.classList.add('is-hidden');
    updateFeedCounter();
    var incomingEpisode = forcedEpisode || (libraryLoaded ? resumeEpisode(libraryEntry(item.series_id), item) : 0);
    setFeatured(Object.assign({}, item, { start_episode: incomingEpisode }), !incomingEpisode);
    updateSeriesRows();
    setPlayerStatus(episodeLoadingText(incomingEpisode));
    // Hide the old WebView video surface before resetting its native source.
    // Opacity alone can leave a grey hardware-video rectangle during load().
    video.classList.remove('has-source');
    video.pause();
    video.removeAttribute('src');
    video.load();
    updatePlaybackControls();
    var waitForLibrary = fastContinuation ? Promise.resolve() : Promise.resolve(libraryReady).then(function () { return libraryQueue.catch(function () {}); });
    waitForLibrary.then(function () {
      if (generation !== feedGeneration || request.signal.aborted) return null;
      var entry = libraryEntry(item.series_id);
      var episode = forcedEpisode || resumeEpisode(entry, item);
      var position = forcedPosition !== undefined ? forcedPosition : entry && episode === entry.episode && !entry.completed ? entry.position || 0 : 0;
      playbackRequest.episode = episode; playbackRequest.position = position;
      setFeatured(Object.assign({}, item, { start_episode: episode }));
      setPlayerStatus(episodeLoadingText(episode));
      var source = episode === 1 && firstVid(item) ? Promise.resolve(item) : getDetail(item, request.signal);
      return source.then(function (detail) {
        if (generation !== feedGeneration || request.signal.aborted) return null;
        var vid = episode === 1 ? firstVid(detail) : detail.vid_list && detail.vid_list[episode - 1];
        if (!vid) throw new Error('第' + episode + '集暂无视频数据');
        var playing = Object.assign({}, item, detail, { start_episode: episode, vid: vid });
        activePlayback = { item: playing, episode: episode, vid: vid, position: position, generation: generation, owner: accountEpoch, started: false, stableSince: 0, lastWrite: 0, completed: false,
          timing: { episode: episode, automatic_next: fastContinuation, started_at: switchStartedAt, ready_at: 0, prefetch_ms: null, prepared_before_switch: false, reported: false } };
        setFeatured(playing);
        setPlayerStatus(episodeLoadingText(episode));
        var target = { series_id: item.series_id, vid: vid, episode: episode, quality: playbackPreferences.quality, owner: accountEpoch };
        var handoff = episodePrefetch.consume(target);
        playbackPrefetchHandoff = handoff;
        return (handoff ? handoff.promise : Promise.resolve()).then(function () {
          if (generation !== feedGeneration || request.signal.aborted || applicationInBackground || document.hidden) return null;
          playbackPrefetchHandoff = null;
          if (handoff && handoff.timing.ready_at) {
            activePlayback.timing.prefetch_ms = Math.max(0, handoff.timing.ready_at - handoff.timing.started_at);
            activePlayback.timing.prepared_before_switch = handoff.timing.ready_at <= switchStartedAt;
          }
          // Revalidate the prepared cache entry; the core reuses the same file
          // and retries a failed speculative job through the normal resolver.
          var params = { series_id: item.series_id, vid: vid, quality: playbackPreferences.quality, fallback: '1' };
          return fetchData('/api/v1/play/info?' + new URLSearchParams(params), { signal: request.signal });
        });
      });
    })
      .then(function (data) {
        if (generation !== feedGeneration || request.signal.aborted || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        if (!data) return;
        playbackInfoRequest = null;
        if (!data.path) throw new Error('播放服务没有返回地址');
        activePlayback.timing.ready_at = Date.now();
        video.src = data.path;
        playbackQuality = data.quality || '';
        playbackQualities = data.qualities || [];
        if (playbackPreferences.quality && playbackQuality !== playbackPreferences.quality) showNotice('本集没有 ' + playbackPreferences.quality + '，使用 ' + (playbackQuality || '自动清晰度'));
        updatePlaybackControls();
        video.classList.add('has-source');
        placeholder.classList.add('is-hidden');
        video.load();
        setPlayerStatus(episodeLoadingText(activePlayback.episode));
        if (!document.hidden && !applicationInBackground) playMedia(video).catch(function () { setPlayerStatus(''); revealControls(); showNotice('视频已准备好，请按确认键开始播放'); });
        else { setPlayerStatus(''); revealControls(); }
      })
      .catch(function (error) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        playbackInfoRequest = null; playbackPrefetchHandoff = null;
        if (error.name !== 'AbortError') setPlayerStatus('暂时无法播放这集', true);
      });
  }

  function renderFeed(items) {
    feedItems = (items || []).filter(function (item) { return item && item.series_id; });
    feedIndex = feedItems.length ? 0 : -1;
    updateFeedCounter();
    if (!feedItems.length) {
      featuredItem = null;
      updateSeasonControl(null);
      showRecommendationPlaceholder(feedPager.hasMore() ? '正在读取推荐' : '暂时没有推荐内容');
      return;
    }
    playFeedItem(0);
  }

  function startPlayer(item, returnFocus) {
    if (!item || !item.series_id) return;
    allPagers.forEach(function (pager) { pager.cancel(); });
    if (!isPlaybackPage()) resetPlayerUI();
    if (pageMode() !== 'player') {
      playerReturnPage = pageMode();
      playerReturnFocus = returnFocus || document.activeElement;
    }
    shell.dataset.mode = 'player';
    shell.classList.add('is-player');
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

  function posterSeasonLabel(item) {
    var season = Number(item && item.season_index);
    if (season > 0 && season <= 999 && Math.floor(season) === season) return '第' + season + '季';
    var match = String(item && item.title || '').match(/第\s*([0-9０-９零〇一二两三四五六七八九十百]+)\s*季/);
    if (!match) return '';
    var text = match[1].replace(/[０-９]/g, function (digit) { return String(digit.charCodeAt(0) - 65296); });
    var digits = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    if (/^[0-9]+$/.test(text)) season = Number(text);
    else if (/[0-9]/.test(text)) return '';
    else if (!/[十百]/.test(text)) season = Number(text.split('').map(function (digit) { return digits[digit]; }).join(''));
    else {
      season = 0; var digit = 0;
      text.split('').forEach(function (character) {
        var unit = character === '百' ? 100 : character === '十' ? 10 : 0;
        if (unit) { season += (digit || 1) * unit; digit = 0; }
        else digit = digits[character];
      });
      season += digit;
    }
    return season > 0 && season <= 999 && Math.floor(season) === season ? '第' + season + '季' : '';
  }

  // Normal posters share one decoration. Compact catalog/series/calendar
  // thumbnails deliberately do not call this helper or gain focus targets.
  function updatePosterSeason(poster, item) {
    var label = posterSeasonLabel(item); var badge = poster.querySelector('.poster-season-badge');
    if (!label) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'poster-season-badge'; poster.appendChild(badge); }
    badge.textContent = label;
  }
  function dramaPoster(image, item) {
    var poster = document.createElement('span'); poster.className = 'drama-poster';
    poster.appendChild(image); updatePosterSeason(poster, item); return poster;
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
      card.appendChild(dramaPoster(image, item));
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

  function filterSummary() {
    var labels = [];
    filterRows.forEach(function (row) {
      var value = searchFilters[row.type];
      row.options.forEach(function (option) { if (value === option.id) labels.push(option.label); });
    });
    return labels.join(' · ') || '全部短剧';
  }

  function selectSearchFilter(button) {
    var type = button.dataset.filterType;
    var value = button.dataset.filterValue || '';
    if ((searchFilters[type] || '') === value && !searchPager.error) return;
    searchFilters[type] = value;
    var refresh = type === 'genre';
    if (refresh) {
      // Theme/role/era options depend on genre. Reset these along with the
      // previous list cursor before requesting the new selector panel.
      ['category_dim_theme', 'category_dim_role', 'category_dim_epoch'].forEach(function (key) { delete searchFilters[key]; });
    }
    document.querySelectorAll('.search-filter').forEach(function (node) {
      var selected = (searchFilters[node.dataset.filterType] || '') === (node.dataset.filterValue || '');
      node.classList.toggle('is-active', selected);
      node.setAttribute('aria-pressed', String(selected));
    });
    document.getElementById('filter-state').textContent = filterSummary();
    loadBrowse(false, refresh);
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
    if (append) return searchPager.load(searchPager.error !== '');
    var path = ({ comic_series: '/category/comic-drama', ai_series: '/category/ai-drama' })[searchFilters.genre] || '/category/real-drama';
    if (refreshFilters || !filterRows.length) searchPanelPending = true;
    var params = Object.assign({ path: path }, searchFilters);
    if (searchPanelPending) params.selectors = '1';
    searchKind = 'browse';
    document.getElementById('filter-panel').classList.remove('is-hidden');
    document.getElementById('search-browse').classList.add('is-hidden');
    document.getElementById('search-result-title').textContent = filterSummary();
    return searchPager.reset(params);
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

  function renderRankSelectors(data) {
    if (!data || !data.length) return;
    rankOptions = data;
    var key = document.activeElement && document.activeElement.dataset.focus;
    var priorZone = zoneOf(document.activeElement);
    var root = document.getElementById('rank-tabs');
    var subnav = document.getElementById('rank-subnav');
    var panels = document.getElementById('rank-panels');
    root.innerHTML = ''; subnav.innerHTML = ''; panels.innerHTML = '';
    var active = data.filter(function (x) { return x.id === rankSelection.rank; })[0] || data[0];
    rankSelection.rank = active.id;
    var children = active.children || [];
    var sub = children.filter(function (x) { return x.id === rankSelection.rank_sub; })[0] || children.filter(function (x) { return x.selected; })[0] || children[0];
    if (sub) rankSelection.rank_sub = sub.id;
    function button(option, cls, selected, target, handler) {
      var node = document.createElement('button'); node.className = cls + (selected ? ' is-active' : '');
      node.dataset.focus = cls + '-' + (option.id || 'all'); node.textContent = option.label;
      node.setAttribute('aria-pressed', String(selected));
      node.addEventListener('click', handler);
      node.addEventListener('focus', function () { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      target.appendChild(node); return node;
    }
    data.forEach(function (option) {
      button(option, 'rank-tab', option === active, root, function () {
        rankSelection = { rank: option.id, rank_sub: '', rank_panel: '' };
        var child = (option.children || []).filter(function (x) { return x.label === '热播榜'; })[0] || (option.children || [])[0];
        if (child) rankSelection.rank_sub = child.id;
        renderRankSelectors(rankOptions); loadRank();
      });
    });
    children.forEach(function (option) { button(option, 'rank-subtab', option === sub, subnav, function () { rankSelection.rank_sub = option.id; rankSelection.rank_panel = ''; renderRankSelectors(rankOptions); loadRank(); }); });
    (sub && sub.panels || []).forEach(function (group) {
      var line = document.createElement('div'); line.className = 'rank-panel-row';
      var label = document.createElement('span'); label.textContent = group.label; line.appendChild(label);
      var options = document.createElement('div'); options.className = 'rank-panel-options'; line.appendChild(options);
      group.options.forEach(function (option) { button(option, 'rank-panel', option.id === rankSelection.rank_panel, options, function () { rankSelection.rank_panel = option.id; renderRankSelectors(rankOptions); loadRank(); }); });
      panels.appendChild(line);
    });
    if (['rankTabs', 'rankSubnav', 'rankPanels'].indexOf(priorZone) >= 0) {
      var match = Array.prototype.filter.call(document.querySelectorAll('[data-focus]'), function (node) { return node.dataset.focus === key; })[0];
      goFocus(match || firstVisible('.rank-tab.is-active'));
    }
  }

  function renderRank(items, append) {
    if (!append) { rankItems = []; rankList.innerHTML = ''; }
    var start = rankItems.length;
    rankItems = rankItems.concat(items || []);
    document.getElementById('rank-list-title').textContent = rankLabel();
    document.getElementById('rank-list-update').textContent = rankItems.length ? '已加载 ' + rankItems.length + (rankSelection.rank === 'ranklist_celebrity' ? '位' : '部') : '暂时没有榜单内容';
    if (!rankItems.length) {
      rankList.innerHTML = '<div class="rank-empty">暂时没有榜单内容，请稍后刷新。</div>';
      return;
    }
    (items || []).forEach(function (item, localIndex) {
      var index = start + localIndex;
      var row = document.createElement('div');
      row.className = 'rank-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', (item.actor_id ? '演员：' : '播放：') + item.title);
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
      if (!item.actor_id) { side.appendChild(play); side.appendChild(detail); }
      row.appendChild(rank); row.appendChild(item.actor_id ? image : dramaPoster(image, item)); row.appendChild(copy); row.appendChild(side);
      row.addEventListener('click', function (event) { if (!item.actor_id && !event.target.closest('button')) startPlayer(item, row); });
      row.addEventListener('focus', function () { try { row.scrollIntoView({ block: 'nearest' }); } catch (ignore) {} });
      rankList.appendChild(row);
    });
  }

  function loadRank() { return rankPager.reset(Object.assign({}, rankSelection)); }

  function renderNew(items, append) {
    if (!append) { newItems = []; newGrid.innerHTML = ''; }
    newItems = newItems.concat(items || []);
    if (!newItems.length) {
      newGrid.innerHTML = '<div class="search-result-empty">暂时没有新剧内容。</div>';
      return;
    }
    (items || []).forEach(function (item) {
      newGrid.appendChild(publicationCard(item, 'new-item-'));
    });
  }

  function publicationCard(item, prefix) {
      var card = document.createElement('button');
      card.className = 'new-card';
      card.dataset.focus = prefix + item.series_id;
      var poster = document.createElement('span'); poster.className = 'new-card-poster drama-poster';
      var image = document.createElement('img');
      image.className = 'new-card-image'; setCover(image, item);
      var episodeCount = document.createElement('span'); episodeCount.className = 'new-card-episodes'; episodeCount.textContent = item.episode_count ? '共' + item.episode_count + '集' : '';
      poster.appendChild(image); if (episodeCount.textContent) poster.appendChild(episodeCount); updatePosterSeason(poster, item);
      var title = document.createElement('span'); title.className = 'new-card-title'; title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span'); meta.className = 'new-card-meta'; meta.textContent = (item.tags || []).slice(0, 3).join(' · ') || (prefix === 'reservation-' ? '已上线' : '新剧');
      var score = document.createElement('span'); score.className = 'new-card-score'; score.textContent = item.score ? item.score + ' 分' : (item.episode_count ? '共' + item.episode_count + '集' : '');
      card.appendChild(poster); card.appendChild(title); card.appendChild(meta); card.appendChild(score);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () { try { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (ignore) {} });
      return card;
  }

  function updateReservationCounts(data) {
    if (typeof data.online_total_count === 'number') reservationCounts.online = data.online_total_count;
    if (typeof data.offline_total_count === 'number') reservationCounts.upcoming = data.offline_total_count;
    document.querySelectorAll('.reservation-tab').forEach(function (tab) {
      var mode = tab.dataset.reservationMode; var count = reservationCounts[mode];
      tab.textContent = (mode === 'online' ? '已上线' : '待上线') + (count === null ? '' : ' ' + count);
    });
  }

  function renderCalendarDays(schema) {
    if (!schema || !schema.dates || !schema.dates.length) return;
    if (calendarSchema && JSON.stringify(calendarSchema) === JSON.stringify(schema)) return;
    calendarSchema = schema;
    if (!calendarDate) calendarDate = schema.default_date;
    var key = document.activeElement && document.activeElement.dataset.focus;
    var onDays = zoneOf(document.activeElement) === 'calendarDays';
    dateStrip.innerHTML = '';
    schema.dates.forEach(function (value) {
      var date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
      var day = document.createElement('button'); day.className = 'calendar-day' + (value === calendarDate ? ' is-active' : '');
      day.dataset.focus = 'calendar-day-' + value; day.dataset.date = value;
      var week = document.createElement('span'); week.textContent = value === schema.current_date ? '今天' : '周' + ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
      var label = document.createElement('strong'); label.textContent = (date.getMonth() + 1) + '/' + date.getDate();
      day.appendChild(week); day.appendChild(label);
      day.addEventListener('click', function () { calendarDate = value; document.querySelectorAll('.calendar-day').forEach(function (node) { node.classList.toggle('is-active', node === day); }); loadCalendar(); });
      day.addEventListener('focus', function () { day.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      dateStrip.appendChild(day);
    });
    if (onDays) goFocus(dateStrip.querySelector('[data-focus="' + key + '"]') || firstCalendarDay());
    else { var selected = dateStrip.querySelector('.is-active'); if (selected) selected.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }

  function changeReservation(item, button) {
    if (!item.reservation_id || button.disabled) return;
    if (!accountData || !accountData.logged_in) {
      showNotice('请先登录红果账号'); activatePage(document.querySelector('.side-item[data-page="account"]')); return;
    }
    var epoch = accountEpoch; var reserve = !item.reserved;
    var originPage = pageMode(); var hadFocus = document.activeElement === button;
    button.disabled = true; button.textContent = reserve ? '正在预约…' : '正在取消…';
    fetchData('/api/v1/reservation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: item.reservation_id, reserved: reserve }) })
      .then(function () {
        if (epoch !== accountEpoch) return;
        item.reserved = reserve;
        if (reservationCounts.upcoming !== null && item.upcoming) { reservationCounts.upcoming = Math.max(0, reservationCounts.upcoming + (reserve ? 1 : -1)); updateReservationCounts({}); }
        document.querySelectorAll('.publication-row').forEach(function (row) { if (row.__item && row.__item.reservation_id === item.reservation_id) { row.__item.reserved = reserve; var b = row.querySelector('.publication-action'); if (b) b.textContent = reserve ? '取消预约' : '预约'; } });
        if (!reserve && originPage === 'reservations' && pageMode() === 'reservations' && reservationMode === 'upcoming' && document.contains(button)) {
          var row = button.closest('.publication-row'); var next = row.nextElementSibling || row.previousElementSibling;
          var focused = hadFocus && (document.activeElement === button || document.activeElement === document.body);
          reservationPager.items = reservationPager.items.filter(function (x) { return x.reservation_id !== item.reservation_id; });
          reservationPager.buffer = reservationPager.buffer.filter(function (x) { return x.reservation_id !== item.reservation_id; });
          row.remove(); if (focused) goFocus(next || firstVisible('.reservation-tab.is-active'));
          if (!reservationPager.items.length) renderPublications([], false, true);
        }
        showNotice(reserve ? '已预约，上线后可在预约中查看' : '已取消预约');
      }).catch(function (error) { if (epoch === accountEpoch) showNotice(error.message); })
      .then(function () {
        if (epoch !== accountEpoch) return;
        button.disabled = false; button.textContent = item.reserved ? '取消预约' : '预约';
        if (hadFocus && pageMode() === originPage && document.contains(button) && document.activeElement === document.body) goFocus(button);
      });
  }
  function renderPublications(items, append, reservations) {
    var container = reservations ? document.getElementById('reservation-list') : calendarList;
    if (!append) container.innerHTML = '';
    if (!items.length && !container.children.length) renderMessage(container, 'calendar-empty', reservations ? '暂无' + (reservationMode === 'online' ? '已上线' : '待上线') + '的预约' : '这一天暂无上新安排');
    items.forEach(function (item) {
      if (reservations && reservationMode === 'online') {
        var card = publicationCard(item, 'reservation-'); card.classList.add('reservation-row'); card.__item = item;
        container.appendChild(card); return;
      }
      var row = document.createElement('div'); row.className = 'publication-row ' + (reservations ? 'reservation-row' : 'calendar-row'); row.tabIndex = 0;
      row.dataset.focus = (reservations ? 'reservation-' : 'calendar-') + (item.reservation_id || item.series_id); row.__item = item;
      var image = document.createElement('img'); image.loading = 'lazy'; setCover(image, item); row.appendChild(image);
      var copy = document.createElement('div'); copy.className = 'publication-copy';
      var title = document.createElement('strong'); title.textContent = item.title;
      var meta = document.createElement('span'); meta.textContent = dramaMeta(item);
      var summary = document.createElement('p'); summary.textContent = item.intro || '';
      var schedule = document.createElement('span'); schedule.className = 'publication-date';
      var scheduled = item.publish_time ? new Date(item.publish_time * 1000) : null;
      var scheduleTime = scheduled && !isNaN(scheduled.getTime()) ? scheduled.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      schedule.textContent = item.upcoming ? '待上线 · ' + (scheduleTime ? '预计 ' + scheduleTime + ' 上线' : item.publish_text || '上线时间待定') : '已上线' + (scheduleTime ? ' · ' + scheduleTime : '');
      copy.appendChild(title); copy.appendChild(meta); copy.appendChild(summary); copy.appendChild(schedule); row.appendChild(copy);
      if (!item.upcoming || item.reservation_id) {
        var action = document.createElement('button'); action.className = 'publication-action';
        action.dataset.focus = row.dataset.focus + (item.upcoming ? '-reserve' : '-play');
        action.textContent = item.upcoming ? item.reserved ? '取消预约' : '预约' : '播放';
        action.addEventListener('click', function (event) { event.stopPropagation(); if (item.upcoming) changeReservation(item, action); else startPlayer(item, row); }); row.appendChild(action);
      }
      row.addEventListener('click', function (event) { if (event.target.closest('button')) return; if (item.upcoming) { var action = row.querySelector('button'); if (action) goFocus(action); else showNotice('这部短剧尚未上线'); } else startPlayer(item, row); });
      row.addEventListener('focus', function () { row.scrollIntoView({ block: 'nearest' }); });
      container.appendChild(row);
    });
  }
  function genderParam() { return ({ male: '1', female: '0' })[newGender] || '2'; }
  function loadCalendar() { return calendarPager.reset({ date: calendarDate }); }
  function loadNew() { return newPager.reset({ gender: genderParam() }); }
  function renderNewMode() {
    var calendar = newMode === 'calendar';
    // The confirmed calendar contract does not apply audience filters.
    document.querySelector('.new-filters').classList.toggle('is-hidden', calendar);
    dateStrip.classList.toggle('is-hidden', !calendar); newGrid.classList.toggle('is-hidden', calendar); calendarList.classList.toggle('is-hidden', !calendar);
    document.getElementById('new-pagination').classList.toggle('is-hidden', calendar);
    document.getElementById('calendar-pagination').classList.toggle('is-hidden', !calendar);
  }
  function switchNewMode(mode) {
    newMode = mode === 'calendar' ? 'calendar' : 'recommend';
    document.querySelectorAll('.new-tab').forEach(function (node) { node.classList.toggle('is-active', node.dataset.newMode === newMode); });
    newPager.cancel(); calendarPager.cancel(); renderNewMode();
    if (newMode === 'calendar') { if (!calendarPager.loaded) loadCalendar(); else queueTailCheck(); }
    else { if (!newPager.loaded) loadNew(); else queueTailCheck(); }
  }
  function renderReservations(mode, restoring) {
    reservationMode = mode || reservationMode;
    document.getElementById('reservation-list').className = reservationMode === 'online' ? 'new-grid reservation-grid' : 'calendar-list';
    document.querySelectorAll('.reservation-tab').forEach(function (node) { node.classList.toggle('is-active', node.dataset.reservationMode === reservationMode); });
    if (restoring && reservationPager.loaded) { queueTailCheck(); return; }
    if (!accountData || !accountData.logged_in) {
      reservationPager.cancel(); reservationPager.items = []; reservationPager.loaded = false;
      var list = document.getElementById('reservation-list'); list.innerHTML = '';
      var empty = document.createElement('div'); empty.className = 'calendar-empty reservation-login';
      var message = document.createElement('p'); message.textContent = '登录后查看你的预约'; empty.appendChild(message); list.appendChild(empty);
      var login = document.createElement('button'); login.className = 'publication-action'; login.dataset.focus = 'reservation-login'; login.textContent = '登录红果账号'; login.addEventListener('click', function () { activatePage(document.querySelector('.side-item[data-page="account"]')); });
      empty.appendChild(login); return;
    }
    reservationPager.reset({ mode: reservationMode });
  }

  function submitSearch() {
    var query = searchInput ? searchInput.value.trim() : '';
    if (!query) { showNotice('请输入剧名或关键词'); goFocus(searchInput); return; }
    var returnTarget = document.activeElement;
    activeSearchQuery = query; searchKind = 'keyword';
    document.getElementById('filter-panel').classList.add('is-hidden'); document.getElementById('search-browse').classList.remove('is-hidden');
    document.getElementById('search-result-title').textContent = '搜索：' + query;
    searchPager.reset({ q: query }).then(function () { if (activeSearchQuery === query && pageMode() === 'search' && !searchPager.error && document.activeElement === returnTarget) goFocus(firstSearchResult() || searchInput); });
  }

  function loadCatalog(title) {
    episodePrefetch.cancel(); cancelPlaybackPreparation();
    saveProgress(true); activePlayback = null; ++feedGeneration;
    document.getElementById('hero-video').pause();
    document.getElementById('hero-video').removeAttribute('src');
    document.getElementById('hero-video').classList.remove('has-source');
    document.getElementById('hero').classList.remove('is-preparing-video');
    document.getElementById('hero-video').load();
    resetDanmaku(); closeDiscussion(false);
    featuredItem = null; feedItems = []; feedIndex = -1;
    updateSeasonControl(null);
    showRecommendationPlaceholder('正在读取推荐');
    var channel = activeChannel();
    var tab = ({ 'channel-follow': '45', 'channel-comic': '36', 'channel-real': '39', 'channel-recommend': '16' })[channel && channel.dataset.focus] || '16';
    if (tab === '45' && (!accountData || !accountData.logged_in)) {
      feedPager.cancel(); renderFeed([]);
      showRecommendationPlaceholder('登录后查看关注内容', '在我的账号中登录红果账号。'); return Promise.resolve([]);
    }
    setCatalogHeading(title || '推荐');
    return feedPager.reset({ channel: tab }).then(function firstContent() {
      if (pageMode() !== 'recommend' || feedPager.params.channel !== tab) return;
      if (!feedPager.items.length && feedPager.hasMore() && !feedPager.error) return feedPager.load().then(firstContent);
      if (pageMode() === 'recommend' && feedPager.error) {
        showRecommendationPlaceholder('推荐加载失败', feedPager.error + '，重新选择频道可重试。');
      }
    });
  }

  function seriesMessage(text, retry) {
    document.getElementById('detail-series-message').textContent = text || '';
    document.getElementById('detail-series-retry').classList.toggle('is-hidden', !retry);
  }

  function cancelSeasonSwitch() {
    ++seasonSwitchGeneration;
    if (seasonSwitchRequest) seasonSwitchRequest.abort();
    seasonSwitchRequest = null; seasonSwitchID = '';
    updateSeriesRows();
  }

  function resetSeriesPanel() {
    cancelSeasonSwitch();
    ++seriesGeneration;
    if (seriesRequest) seriesRequest.abort();
    if (seriesReservationRequest) seriesReservationRequest.abort();
    seriesRequest = null; seriesReservationRequest = null; seriesReservationID = '';
    seriesItems = []; seriesLoaded = false;
    seriesFocusCurrent = false;
    document.getElementById('detail-series-list').innerHTML = '';
    document.getElementById('detail-series-count').textContent = '';
    seriesMessage('');
  }

  function rememberSeasonCatalog(id, entry) {
    var index = seasonCatalogKeys.indexOf(id);
    if (index >= 0) seasonCatalogKeys.splice(index, 1);
    seasonCatalogCache[id] = entry; seasonCatalogKeys.push(id);
    while (seasonCatalogKeys.length > 24) delete seasonCatalogCache[seasonCatalogKeys.shift()];
  }

  function updateSeasonReservation(id, reserved) {
    function update(items) { items.forEach(function (item) { if (item.reservation_id === id) item.reserved = reserved; }); }
    update(seriesItems);
    seasonCatalogKeys.forEach(function (key) {
      var entry = seasonCatalogCache[key];
      if (entry && entry.items) update(entry.items);
    });
  }

  function resetSeasonCatalog() {
    seasonCatalogRequests.forEach(function (request) { request.abort(); });
    seasonCatalogRequests = []; seasonCatalogCache = {}; seasonCatalogKeys = [];
    updateSeasonControl(null);
  }

  // Cache only the official season metadata, never media URLs or playback parsing.
  // The selector and its shortcut share the request and account-scoped result.
  function getSeasonCatalog(id) {
    var entry = seasonCatalogCache[id];
    if (entry && entry.epoch === accountEpoch && (entry.pending || entry.expires > Date.now())) return entry.promise;
    var epoch = accountEpoch; var request = new AbortController();
    seasonCatalogRequests.push(request);
    entry = { epoch: epoch, pending: true, expires: 0 };
    rememberSeasonCatalog(id, entry);
    entry.promise = fetchData('/api/v1/series/seasons?series_id=' + encodeURIComponent(id), { signal: request.signal }).then(function (result) {
      if (epoch !== accountEpoch) throw new Error('账号已切换');
      if (!Array.isArray(result.items)) throw new Error('系列剧响应无效');
      var seen = {};
      entry.items = result.items.filter(function (item) {
        if (!item || !/^[1-9][0-9]*$/.test(item.series_id || '') || seen[item.series_id]) return false;
        seen[item.series_id] = true; return true;
      });
      entry.pending = false; entry.expires = Date.now() + 120000;
      entry.items.forEach(function (item) { rememberSeasonCatalog(item.series_id, entry); });
      rememberSeasonCatalog(id, entry);
      return entry.items;
    }).catch(function (error) {
      if (seasonCatalogCache[id] === entry) delete seasonCatalogCache[id];
      throw error;
    }).then(function (items) {
      seasonCatalogRequests = seasonCatalogRequests.filter(function (value) { return value !== request; });
      return items;
    }, function (error) {
      seasonCatalogRequests = seasonCatalogRequests.filter(function (value) { return value !== request; });
      throw error;
    });
    return entry.promise;
  }

  function updateSeasonControl(item) {
    var button = document.querySelector('[data-action="seasons"]');
    var id = item && item.series_id || '';
    var known = id && seasonCatalogCache[id];
    var hinted = item && (item.is_multi_season || posterSeasonLabel(item) || known && known.items && known.items.length > 1);
    if (id && seasonControlID === id && seasonControlState) return;
    var generation = ++seasonControlGeneration;
    seasonControlID = id; seasonControlState = id ? 'loading' : '';
    button.classList.toggle('is-hidden', !hinted);
    if (!hinted && document.activeElement === button) goFocus(document.querySelector('[data-action="episodes"]'));
    setControlIcon('seasons', '选季…', 'icon-seasons'); button.setAttribute('aria-busy', id ? 'true' : 'false');
    if (!id) {
      return;
    }
    // A base title can be season one without a suffix or a multi-season flag.
    // Ask the official selector for every new drama; ordinary ones stay hidden.
    getSeasonCatalog(id).then(function (items) {
      if (generation !== seasonControlGeneration || !featuredItem || featuredItem.series_id !== id) return;
      seasonControlState = 'loaded';
      var count = items.filter(function (season) { return season.playable && !season.upcoming; }).length;
      setControlIcon('seasons', '选季 · ' + count + ' 季', 'icon-seasons'); button.setAttribute('aria-busy', 'false');
      var hasSeasons = items.length > 1 || items.some(function (season) { return !!(season.season_index > 0 || season.label || posterSeasonLabel(season)); });
      button.classList.toggle('is-hidden', !hasSeasons);
      if (!hasSeasons && document.activeElement === button) goFocus(document.querySelector('[data-action="episodes"]'));
    }).catch(function () {
      if (generation !== seasonControlGeneration) return;
      seasonControlState = 'error'; setControlIcon('seasons', '选季', 'icon-seasons'); button.setAttribute('aria-busy', 'false');
    });
  }

  function focusCurrentSeason() {
    var row = currentSeriesRow();
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (seriesFocusCurrent && detailTab === 'series' && document.activeElement.id === 'detail-tab-series') {
      seriesFocusCurrent = false; if (row) goFocus(row);
    }
  }

  function currentSeriesRow() {
    var id = activePlayback && activePlayback.item.series_id || detailSeriesID;
    return Array.from(document.querySelectorAll('.series-row')).filter(function (row) { return row.dataset.seriesId === id; })[0] || null;
  }

  function updateSeriesRows() {
    document.querySelectorAll('.series-row').forEach(function (row, index) {
      var item = seriesItems[index]; if (!item) return;
      var playing = !!(activePlayback && activePlayback.item.series_id === item.series_id);
      row.classList.toggle('is-current', playing || !activePlayback && detailSeriesID === item.series_id);
      row.setAttribute('aria-current', playing || !activePlayback && detailSeriesID === item.series_id ? 'true' : 'false');
      var entry = libraryEntry(item.series_id);
      var status = '暂不可播放';
      if (item.upcoming) status = item.reservation_id ? item.reserved ? '取消预约' : '预约' : '待上线';
      else if (item.playable) status = playing ? '播放中' : entry && entry.last_played_at ? '继续播放' : '播放';
      if (seasonSwitchID === item.series_id) status = '正在切换…';
      if (seriesReservationID === item.reservation_id && seriesReservationRequest) status = '正在提交…';
      row.querySelector('.series-status').textContent = status;
      row.setAttribute('aria-busy', seasonSwitchID === item.series_id || seriesReservationID === item.reservation_id && !!seriesReservationRequest ? 'true' : 'false');
    });
  }

  function selectDetailTab(tab) {
    if (!detailModalOpen) return;
    if (tab !== detailTab) { cancelSeasonSwitch(); seriesMessage(''); }
    detailTab = tab;
    document.querySelectorAll('.detail-tab').forEach(function (node) {
      var selected = node.id === 'detail-tab-' + tab;
      node.classList.toggle('is-active', selected); node.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    document.getElementById('detail-episode-panel').classList.toggle('is-hidden', tab !== 'episodes');
    document.getElementById('detail-series-panel').classList.toggle('is-hidden', tab !== 'series');
    goFocus(document.getElementById('detail-tab-' + tab));
    if (tab === 'series') {
      if (!seriesLoaded) loadSeriesSeasons();
      else { updateSeriesRows(); focusCurrentSeason(); }
    }
  }

  function loadSeriesSeasons() {
    if (seriesRequest || !detailModalOpen || !seriesRootID) return;
    if (document.activeElement.id === 'detail-series-retry') goFocus(document.getElementById('detail-tab-series'));
    var generation = ++seriesGeneration; var epoch = accountEpoch;
    var request = new AbortController(); seriesRequest = request;
    seriesMessage('正在读取系列剧…');
    getSeasonCatalog(seriesRootID).then(function (items) {
      if (!detailModalOpen || request.signal.aborted || generation !== seriesGeneration || epoch !== accountEpoch) return;
      seriesItems = items; seriesLoaded = true;
      var list = document.getElementById('detail-series-list'); list.innerHTML = '';
      seriesItems.forEach(function (item) {
        var row = document.createElement('button'); row.className = 'series-row'; row.dataset.seriesId = item.series_id; row.dataset.focus = 'series-' + item.series_id;
        var image = document.createElement('img'); image.className = 'series-cover'; image.alt = ''; setCover(image, item);
        var copy = document.createElement('span'); copy.className = 'series-copy';
        var title = document.createElement('span'); title.className = 'series-title'; title.textContent = item.title;
        var meta = document.createElement('span'); meta.className = 'series-meta'; meta.textContent = [item.label, item.subtitle || (item.episode_count ? '全' + item.episode_count + '集' : '')].filter(Boolean).join(' · ');
        copy.appendChild(title); copy.appendChild(meta);
        var status = document.createElement('span'); status.className = 'series-status';
        row.appendChild(image); row.appendChild(copy); row.appendChild(status);
        row.addEventListener('focus', function () { row.scrollIntoView({ block: 'nearest' }); });
        row.addEventListener('click', function () { if (item.upcoming) reserveSeriesSeason(item); else switchSeriesSeason(item); });
        list.appendChild(row);
      });
      document.getElementById('detail-series-count').textContent = seriesItems.length ? String(seriesItems.length) : '';
      updateSeriesRows(); seriesMessage(seriesItems.length ? '' : '这部短剧暂无同系列的其他季。');
      if (featuredItem && seriesItems.some(function (item) { return item.series_id === featuredItem.series_id; })) {
        seasonControlState = ''; updateSeasonControl(featuredItem);
      }
      if (detailTab === 'series') focusCurrentSeason();
      if (document.activeElement.id === 'detail-series-retry') goFocus(document.getElementById('detail-tab-series'));
    }).catch(function (error) {
      if (generation === seriesGeneration && epoch === accountEpoch && detailModalOpen && error.name !== 'AbortError') seriesMessage('系列剧加载失败：' + error.message, true);
    }).then(function () { if (seriesRequest === request) seriesRequest = null; });
  }

  function reserveSeriesSeason(item) {
    if (!item.reservation_id) { seriesMessage('这季尚未开放预约。'); return; }
    if (!accountData || !accountData.logged_in) { seriesMessage('请先关闭面板，在左侧“我的”登录账号后再预约。'); return; }
    if (seriesReservationRequest) return;
    var generation = seriesGeneration; var epoch = accountEpoch; var reserved = !item.reserved;
    var request = new AbortController(); seriesReservationRequest = request; seriesReservationID = item.reservation_id;
    updateSeriesRows(); seriesMessage('');
    fetchData('/api/v1/reservation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: item.reservation_id, reserved: reserved }), signal: request.signal }).then(function () {
      if (epoch !== accountEpoch || generation !== seriesGeneration || !detailModalOpen) return;
      item.reserved = reserved; updateSeasonReservation(item.reservation_id, reserved);
      reservationPager.loaded = false; calendarPager.loaded = false;
      if (reservationCounts.upcoming !== null) { reservationCounts.upcoming = Math.max(0, reservationCounts.upcoming + (reserved ? 1 : -1)); updateReservationCounts({}); }
      document.querySelectorAll('.publication-row').forEach(function (row) {
        if (row.__item && row.__item.reservation_id === item.reservation_id) {
          row.__item.reserved = reserved;
          var button = row.querySelector('.publication-action'); if (button) button.textContent = reserved ? '取消预约' : '预约';
        }
      });
      seriesMessage(reserved ? '预约成功，上线后可在“预约”查看。' : '已取消预约。');
    }).catch(function (error) {
      if (epoch === accountEpoch && generation === seriesGeneration && detailModalOpen && error.name !== 'AbortError') seriesMessage('预约未确认成功：' + error.message);
    }).then(function () {
      if (seriesReservationRequest !== request) return;
      seriesReservationRequest = null; seriesReservationID = ''; updateSeriesRows();
    });
  }

  function switchSeriesSeason(item) {
    if (!item.playable || item.upcoming) { seriesMessage('这季暂时不可播放。'); return; }
    if (activePlayback && activePlayback.item.series_id === item.series_id) { seriesMessage('当前正在播放这一季。'); return; }
    if (seasonSwitchRequest) return;
    ++continuationGeneration;
    var generation = ++seasonSwitchGeneration; var panel = detailGeneration; var feed = feedGeneration; var epoch = accountEpoch;
    var request = new AbortController(); seasonSwitchRequest = request; seasonSwitchID = item.series_id;
    updateSeriesRows(); seriesMessage('');
    getDetail(item, request.signal).then(function (detail) {
      if (!detailModalOpen || detailTab !== 'series' || generation !== seasonSwitchGeneration || panel !== detailGeneration || feed !== feedGeneration || epoch !== accountEpoch || applicationInBackground || document.hidden) return;
      if (!detail.vid_list || !detail.vid_list.length) throw new Error('这季尚无可播放集数');
      var next = Object.assign({}, item, detail);
      ++detailGeneration; currentDetail = next; detailSeriesID = next.series_id; renderDetail(next);
      if (isPlaybackPage()) {
        // Keep the recommendation slot and original card/page return target.
        feedItems[feedIndex] = next; playFeedItem(feedIndex);
      } else {
        startPlayer(next, detailReturnFocus);
        // startPlayer focuses the video; restore the open selector's row.
        goFocus(currentSeriesRow());
      }
      updateSeriesRows(); seriesMessage('已切换到' + (item.label || item.title) + '。');
    }).catch(function (error) {
      if (generation === seasonSwitchGeneration && detailModalOpen && error.name !== 'AbortError') seriesMessage('切换失败：' + error.message + '，保留原播放状态。');
    }).then(function () {
      if (seasonSwitchRequest !== request) return;
      seasonSwitchRequest = null; seasonSwitchID = ''; updateSeriesRows();
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
      button.className = 'detail-episode';
      button.dataset.index = String(Math.max(0, episode.index - 1));
      button.textContent = String(episode.index);
      button.title = '播放第' + episode.index + '集';
      button.addEventListener('click', function () { playEpisode(Number(button.dataset.index)); });
      nodes.episodes.appendChild(button);
    });
    if (entry && entry.episode) updateEpisodeHighlight(entry.episode - 1);
    updateSavedButtons();
  }

  function updateDetailProgress() {
    if (!detailModalOpen || !currentDetail) return;
    var entry = libraryEntry(currentDetail.series_id);
    var episode = resumeEpisode(entry, currentDetail);
    detailElements().play.textContent = entry && entry.last_played_at ? entry.completed && episode === 1 ? '重新播放' : '继续第' + episode + '集' : '播放第一集';
    updateEpisodeHighlight(entry && entry.episode ? entry.episode - 1 : -1);
    updateSeriesRows();
  }

  function openDetail(item, initialTab) {
    if (!item || !item.series_id) return;
    closePlayerOptions(false); clearTimeout(controlsTimer); revealControls();
    detailReturnFocus = document.activeElement;
    detailModalOpen = true;
    detailSeriesID = item.series_id;
    seriesRootID = item.series_id;
    resetSeriesPanel();
    seriesFocusCurrent = initialTab === 'series';
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
    selectDetailTab(initialTab === 'series' ? 'series' : 'episodes');
    if (detailTab === 'episodes') goFocus(document.querySelector('.detail-close'));
    getDetail(item).then(function (detail) {
        if (!detailModalOpen || generation !== detailGeneration) return;
        currentDetail = Object.assign({}, item, detail);
        renderDetail(currentDetail);
        if (detailTab === 'episodes' && document.activeElement.id === 'detail-close') goFocus(document.querySelector('.detail-play'));
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
    resetSeriesPanel();
    ++detailGeneration;
    seriesRootID = '';
    detailModalOpen = false;
    detailSeriesID = '';
    currentDetail = null;
    detailModal.classList.add('is-hidden');
    detailModal.setAttribute('aria-hidden', 'true');
    var target = detailReturnFocus && document.contains(detailReturnFocus) ? detailReturnFocus : firstCatalog() || activeChannel();
    detailReturnFocus = null;
    goFocus(target);
    scheduleControlsHide();
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
    if (video.paused) playMedia(video).catch(function () { showNotice('播放被设备阻止，请再次确认。'); });
    else video.pause();
  }

  function activatePage(item, restoring) {
    if (smsVerification) smsVerification.stop();
    if (supportModalOpen) closeSupportQR();
    if (accountKeypadOpen()) numericKeypad.close('page');
    engagement.clear();
    if (detailModalOpen) closeDetail();
    saveProgress(true);
    allPagers.forEach(function (pager) { pager.cancel(); });
    activePlayback = null;
    ++feedGeneration;
    document.getElementById('hero-video').pause();
    resetPlayerUI();
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
      loadCatalog(active ? active.textContent : '推荐');
    } else if (item.dataset.page === 'search') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      mainSurface.classList.add('has-search');
      searchPage.classList.remove('is-hidden');
      if (!searchPager.loaded) { if (searchKind === 'keyword' && activeSearchQuery) submitSearch(); else loadBrowse(false, !filterRows.length); } else queueTailCheck();
    } else if (item.dataset.page === 'rank') {
      mainSurface.classList.add('has-workspace');
      rankPage.classList.remove('is-hidden');
      if (!rankPager.loaded) loadRank(); else queueTailCheck();
    } else if (item.dataset.page === 'new') {
      mainSurface.classList.add('has-workspace');
      newPage.classList.remove('is-hidden');
      renderNewMode(); if (newMode === 'recommend' && !newPager.loaded) loadNew(); else if (newMode === 'calendar' && !calendarPager.loaded) loadCalendar(); else queueTailCheck();
    } else if (item.dataset.page === 'reservations') {
      mainSurface.classList.add('has-workspace');
      reservationPage.classList.remove('is-hidden');
      var reservationTab = document.querySelector('.reservation-tab.is-active');
      renderReservations(reservationTab ? reservationTab.dataset.reservationMode : 'online', restoring);
    } else if (['history', 'favorites', 'likes'].indexOf(item.dataset.page) >= 0) {
      mainSurface.classList.add('has-workspace');
      libraryPage.classList.remove('is-hidden');
      if (!restoring) libraryEditing = false;
      renderLibrary(!!restoring);
    } else if (item.dataset.page === 'account') {
      mainSurface.classList.add('has-workspace');
      accountPage.classList.remove('is-hidden');
      renderAccount();
      pollAccount();
    } else if (item.dataset.page === 'support') {
      mainSurface.classList.add('has-workspace');
      supportPage.classList.remove('is-hidden');
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
  document.addEventListener('scroll', queueTailCheck, true);
  window.addEventListener('resize', queueTailCheck);
  document.addEventListener('focusin', function (event) {
    if (accountKeypadOpen()) {
      if (!event.target.closest('#account-keypad-modal')) { goFocus(accountKeypadFocus()); return; }
      var keyIndex = Array.prototype.indexOf.call(document.querySelectorAll('.account-keypad-key'), event.target);
      if (keyIndex >= 0 && keyIndex !== numericKeypad.snapshot().index) numericKeypad.choose(keyIndex);
    }
    markFocus(event.target);
    queueTailCheck();
    var zone = zoneOf(event.target);
    if (zone === 'controls' && event.target.closest('.playback-buttons')) lastPlaybackControl = event.target;
    if (zone === 'sidebar') clearTimeout(controlsTimer);
    else if (isPlaybackPage() && ['controls', 'timeline', 'actions', 'channels'].indexOf(zone) >= 0) revealControls();
    if (!accountKeypadOpen() && !detailModalOpen && !confirmOpen && !playerOptionsOpen && !discussionOpen && zone !== 'sidebar') {
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
      } else if (item.dataset.action === 'comment') openDiscussion(item);
      else if (item.dataset.action === 'danmaku') toggleDanmaku();
      else if (item.dataset.action === 'featured') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      } else if (item.dataset.action === 'play' || item.dataset.action === 'pause') toggleVideo();
      else if (item.dataset.action === 'seasons') {
        if (featuredItem) openDetail(featuredItem, 'series');
      }
      else if (item.dataset.action === 'episodes') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      }
      else if (['speed', 'volume', 'quality', 'send-danmaku'].indexOf(item.dataset.action) >= 0) openPlayerOptions(item.dataset.action, item);
      else if (item.dataset.action === 'fullscreen') toggleCinema();
      else if (item.dataset.action === 'retry') {
        if (playbackRequest) { goFocus(document.getElementById('hero-feed-focus')); playFeedItem(playbackRequest.index, playbackRequest.episode, playbackRequest.position); }
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
      loadCatalog(item.textContent);
    });
  });
  document.querySelectorAll('.new-tab').forEach(function (item) {
    item.addEventListener('click', function () { switchNewMode(item.dataset.newMode); });
  });
  document.querySelectorAll('.new-filter').forEach(function (item) {
    item.addEventListener('click', function () {
      newGender = item.dataset.newGender;
      newItems = [];
      document.querySelectorAll('.new-filter').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      newPager.cancel(); calendarPager.cancel();
      newPager.loaded = false; calendarPager.loaded = false;
      if (newMode === 'recommend') loadNew(); else loadCalendar();
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
  document.getElementById('detail-tab-episodes').addEventListener('click', function () { selectDetailTab('episodes'); });
  document.getElementById('detail-tab-series').addEventListener('click', function () { selectDetailTab('series'); });
  document.getElementById('detail-series-retry').addEventListener('click', loadSeriesSeasons);
  document.getElementById('account-send-code').addEventListener('click', accountSendCode);
  document.getElementById('account-login').addEventListener('click', accountLogin);
  document.getElementById('account-verify').addEventListener('click', verifyAccountSMS);
  document.getElementById('account-cancel').addEventListener('click', cancelAccountVerification);
  document.getElementById('account-change-phone').addEventListener('click', cancelAccountVerification);
  document.getElementById('account-logout').addEventListener('click', confirmAccountLogout);
  document.getElementById('account-sync').addEventListener('click', function () { accountRequest('sync').then(function () { if (pageMode() === 'account') goFocus(document.getElementById('account-logout')); }); });
  document.getElementById('account-import-history').addEventListener('click', function () {
    var owner = accountData && accountData.profile && accountData.profile.uid;
    if (!owner || this.disabled) return;
    var epoch = accountEpoch;
    accountRequest('import-history', { owner_id: owner }).then(function (ok) {
      if (!ok || epoch !== accountEpoch) return;
      libraryQueue = libraryQueue.catch(function () {}).then(function () { if (epoch === accountEpoch) return loadLibrary(); });
      libraryReady = libraryQueue;
      if (pageMode() === 'account') goFocus(firstVisible('#account-import-history') || firstVisible('#account-sync') || firstVisible('#account-logout'));
    });
  });
  setInterval(function () { if (pageMode() === 'account' && !accountBusy) renderAccount(); }, 1000);
  document.getElementById('detail-play').addEventListener('click', function () {
    if (!currentDetail) return;
    var item = Object.assign({}, currentDetail);
    var returnFocus = detailReturnFocus;
    closeDetail();
    startPlayer(item, returnFocus);
  });
  document.getElementById('discussion-close').addEventListener('click', function () { closeDiscussion(); });
  document.getElementById('discussion-send').addEventListener('click', sendDiscussion);
  document.getElementById('discussion-cancel-reply').addEventListener('click', function () { selectDiscussionReply(null); goFocus(document.getElementById('discussion-input')); });
  document.getElementById('player-compose-send').addEventListener('click', sendDanmaku);
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
  installRecommendationGestures();
  document.getElementById('player-options-close').addEventListener('click', function () { closePlayerOptions(); });
  document.getElementById('control-progress').addEventListener('click', function (event) {
    if (!event.detail) return;
    var rect = this.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width * document.getElementById('hero-video').duration);
  });
  document.addEventListener(window.PointerEvent ? 'pointermove' : 'mousemove', function (event) { if (isPlaybackPage() && event.target.closest('#hero')) revealControls(); });
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement) { nativeFullscreen = true; setCinema(true); }
    else if (nativeFullscreen) {
      nativeFullscreen = false; setCinema(false);
      if (fullscreenExitKeepsHidden) hideControls(); else revealControls();
      fullscreenExitKeepsHidden = false;
    }
  });

  function loadStatus() {
    // Use a bounded request even on WebViews without fetch/AbortController.
    var request = new XMLHttpRequest();
    request.open('GET', '/api/v1/status', true);
    request.timeout = 8000;
    var label = document.getElementById('core-status-label');
    function failed() { label.textContent = '本机服务连接失败，请重新打开应用'; status.dataset.ok = 'false'; }
    request.onload = function () {
      try {
        var data = JSON.parse(request.responseText);
        label.textContent = request.status === 200 && data.ok ? '已连接' : '连接异常';
        status.dataset.ok = request.status === 200 && data.ok ? 'true' : 'false';
        if (request.status === 200 && data.ok) status.title = '版本 ' + data.version;
      } catch (error) { failed(); }
    };
    request.onerror = failed; request.ontimeout = failed;
    request.send();
  }

  var media = document.getElementById('hero-video');
  media.addEventListener('loadedmetadata', function () {
    if (!activePlayback || activePlayback.generation !== feedGeneration) return;
    var position = activePlayback.position;
    if (position > 0 && Number.isFinite(media.duration)) media.currentTime = Math.min(position, Math.max(0, media.duration - .25));
    media.playbackRate = playbackPreferences.speed;
    updatePlaybackControls();
  });
  media.addEventListener('playing', function () {
    document.getElementById('danmaku-layer').classList.remove('is-paused'); tickDanmaku();
    if (!activePlayback || activePlayback.generation !== feedGeneration) return;
    if (applicationInBackground || document.hidden) { media.pause(); return; }
    document.getElementById('hero').classList.remove('is-preparing-video');
    activePlayback.started = true;
    activePlayback.stableSince = Date.now();
    if (activePlayback.timing && !activePlayback.timing.reported) {
      var timing = activePlayback.timing;
      timing.reported = true;
      playbackTiming.push({ episode: timing.episode, automatic_next: timing.automatic_next, prefetch_ms: timing.prefetch_ms,
        prepared_before_switch: timing.prepared_before_switch,
        source_ready_ms: Math.max(0, timing.ready_at - timing.started_at),
        video_start_ms: Math.max(0, Date.now() - timing.ready_at), total_ms: Math.max(0, Date.now() - timing.started_at) });
      if (playbackTiming.length > 20) playbackTiming.shift();
    }
    setPlayerStatus(''); updatePlaybackControls(); scheduleControlsHide();
    saveProgress(true);
  });
  media.addEventListener('timeupdate', function () {
    tickDanmaku();
    if (!activePlayback || !activePlayback.started) return;
    updatePlaybackControls();
    maybePrefetchNextEpisode(media);
    saveProgress(false);
  });
  media.addEventListener('pause', function () {
    if (activePlayback) activePlayback.stableSince = 0;
    document.getElementById('danmaku-layer').classList.add('is-paused');
    saveProgress(true); updatePlaybackControls();
    if (activePlayback && activePlayback.started && media.getAttribute('src') && media.paused && !media.ended) revealControls();
  });
  media.addEventListener('ratechange', updatePlaybackControls);
  media.addEventListener('volumechange', updatePlaybackControls);
  media.addEventListener('emptied', updatePlaybackControls);
  media.addEventListener('waiting', function () { if (activePlayback) { activePlayback.stableSince = 0; setPlayerStatus(activePlayback.started ? '正在缓冲…' : episodeLoadingText(activePlayback.episode)); } });
  media.addEventListener('seeking', function () { if (activePlayback) activePlayback.stableSince = 0; });
  media.addEventListener('canplay', function () {
    if (media.paused && activePlayback && activePlayback.generation === feedGeneration && media.readyState >= 2) {
      document.getElementById('hero').classList.remove('is-preparing-video');
      setPlayerStatus('');
    }
  });
  media.addEventListener('seeked', function () { if (activePlayback && activePlayback.started && !media.paused && !media.ended) activePlayback.stableSince = Date.now(); resetDanmaku(); tickDanmaku(); updatePlaybackControls(); saveProgress(true); if (media.paused) setPlayerStatus(''); });
  media.addEventListener('error', function () { if (activePlayback && media.getAttribute('src')) setPlayerStatus('这集未能正常播放', true); });
  media.addEventListener('ended', function () {
    var playback = activePlayback;
    if (!playback || !playback.started || playback.generation !== feedGeneration) return;
    saveProgress(true, true);
    continueAfterEpisode(playback);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseForBackground(); else resumeFromBackground(); });

  function openQRCode(card, image, title) {
    supportReturnFocus = card; supportModalOpen = true;
    document.getElementById('support-modal-title').textContent = title;
    document.getElementById('support-large-qr').src = image.getAttribute('src');
    document.getElementById('support-large-qr').alt = image.alt;
    document.getElementById('support-modal').classList.remove('is-hidden');
    document.getElementById('support-modal').setAttribute('aria-hidden', 'false');
    goFocus(document.getElementById('support-close'));
  }
  function closeSupportQR() {
    supportModalOpen = false;
    document.getElementById('support-modal').classList.add('is-hidden');
    document.getElementById('support-modal').setAttribute('aria-hidden', 'true');
    document.getElementById('support-large-qr').removeAttribute('src');
    goFocus(focusables().indexOf(supportReturnFocus) >= 0 ? supportReturnFocus : firstContentFocus());
  }
  document.querySelectorAll('.support-card').forEach(function (card) { card.addEventListener('click', function () { openQRCode(card, card.querySelector('img'), card.querySelector('h2').textContent); }); });
  document.getElementById('account-sms-qr').addEventListener('click', function () {
    var image = document.getElementById('account-sms-qr-image');
    if (image.getAttribute('src')) openQRCode(this, image, '扫码填写短信 · 请手动发送');
  });
  document.getElementById('support-close').addEventListener('click', closeSupportQR);
  numericKeypad = window.HongguoNumericKeypad.create({
    render: function (state) {
      var modal = document.getElementById('account-keypad-modal');
      modal.classList.toggle('is-hidden', !state.open); modal.setAttribute('aria-hidden', state.open ? 'false' : 'true');
      document.getElementById('account-keypad-title').textContent = state.kind === 'code' ? '输入验证码' : '输入手机号';
      var value = document.getElementById('account-keypad-value');
      value.textContent = state.value || '请输入数字'; value.classList.toggle('is-empty', !state.value);
      document.getElementById('account-keypad-hint').textContent = state.open ? state.value.length + ' / ' + state.maxLength + ' 位 · 也可使用遥控器数字键' : '';
      document.getElementById('account-keypad-error').textContent = state.error;
      if (state.open && document.activeElement !== accountKeypadFocus()) goFocus(accountKeypadFocus());
    },
    change: function (kind, value) {
      var field = document.getElementById(kind === 'phone' ? 'account-phone' : 'account-code');
      field.value = value; renderAccountNumber(field);
    },
    close: function (result) {
      accountNumberScan.stop();
      var origin = accountKeypadReturnFocus; accountKeypadReturnFocus = null; accountKeypadPhase = '';
      if (result.reason !== 'complete' && result.reason !== 'back') return;
      renderAccount();
      if (pageMode() !== 'account' || accountBusy || confirmOpen || supportModalOpen) return;
      var next = result.reason === 'back' ? origin : result.kind === 'code' ? firstVisible('#account-login') : firstVisible('#account-code') || firstVisible('#account-send-code');
      goFocus(next || (origin && !origin.disabled ? origin : firstContentFocus()));
    }
  });
  accountNumberScan = window.HongguoNumberInput.create({
    request: function (method, session, kind) {
      var options = { method: method };
      if (method === 'POST') { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify({ kind: kind }); }
      return fetchData('/api/v1/number-input' + (session ? '?session=' + encodeURIComponent(session) : ''), options);
    },
    render: function (state) {
      var image = document.getElementById('account-number-qr');
      image.classList.toggle('is-hidden', state.state !== 'waiting');
      if (state.state === 'waiting') image.src = state.qr; else image.removeAttribute('src');
      document.getElementById('account-number-scan-status').textContent = state.state === 'creating' ? '正在生成二维码…' : state.state === 'waiting' ? '手机扫码，填写或粘贴数字后回填电视' : state.state === 'closed' ? '' : state.message;
    },
    complete: function (kind, value) { numericKeypad.completeRemote(kind, value); }
  });
  window.HongguoNumericKeypad.keys.forEach(function (key, index) {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'account-keypad-key';
    button.setAttribute('data-key', key); button.setAttribute('data-focus', 'account-digit-' + key);
    button.textContent = key === 'delete' ? '删除' : key === 'done' ? '完成' : key;
    button.addEventListener('click', function () { numericKeypad.choose(index); numericKeypad.press(key); });
    document.getElementById('account-keypad-keys').appendChild(button);
  });
  document.querySelectorAll('.account-input').forEach(function (field) { field.addEventListener('click', function () { openAccountKeypad(field); }); });

  engagement = window.HongguoEngagement.create({
    request: function (target) {
      var controller = new AbortController();
      return { abort: function () { controller.abort(); }, promise: fetchData('/api/v1/player/stats?' + new URLSearchParams(target), { signal: controller.signal }) };
    },
    render: function (target, data) {
      ['like', 'favorite', 'comment'].forEach(function (kind) {
        var field = { like: 'likes', favorite: 'favorites', comment: 'comments' }[kind];
        var text = window.HongguoEngagement.countText(data && data[field]);
        document.getElementById('hero-' + kind + '-count').textContent = text;
        var button = document.querySelector('.round-action[data-action="' + kind + '"]');
        button.setAttribute('aria-label', button.querySelector('small').textContent + ' · ' + text);
      });
    }
  });

  smsVerification = window.HongguoSMSVerification.create({
    canPoll: function () { return pageMode() === 'account' && !document.hidden; },
    request: function () {
      var controller = new AbortController();
      return { abort: function () { controller.abort(); }, promise: accountRequest('verify', {}, controller.signal).then(function (ok) {
        return { confirmed: ok && accountData && accountData.logged_in, active: ok && accountData && accountData.phase === 'mfa', error: !ok };
      }) };
    },
    onState: function (value) {
      if (value.state === 'expired') accountNotice = '本机验证等待时间已结束，请重新获取验证码';
      renderAccount();
      if (value.state === 'timeout' && pageMode() === 'account' && !supportModalOpen) goFocus(document.getElementById('account-verify'));
      if (value.state === 'expired' && !document.hidden) pollAccount();
    }
  });

  var appUpdates = window.HongguoAppUpdates.create({
    bridge: window.HongguoTVUpdates,
    canPrompt: canShowAppUpdate,
    render: function (data) {
      var current = document.getElementById('app-current-version');
      if (data.current_version) current.textContent = data.current_version;
      else if (data.state === 'browser') current.textContent = '网页预览';
      document.getElementById('app-update-state').textContent = data.message || '启动后每天自动检查一次，播放时不打扰。';
      var check = document.getElementById('app-check-update');
      // Keep the active TV focus node alive while native checking/download runs.
      check.disabled = !data.supported;
      check.setAttribute('aria-disabled', data.state === 'checking' || data.state === 'downloading' ? 'true' : 'false');
      check.textContent = data.state === 'checking' ? '检查中…' : data.state === 'available' || data.state === 'ready' ? '查看更新 ' + data.latest_version : '检查更新';
    }
  });
  document.getElementById('app-check-update').addEventListener('click', appUpdates.check);
  appUpdates.refresh();
  setInterval(appUpdates.refresh, 1000);
  goFocus(document.querySelector('.side-item.is-active'));
  restorePlaybackPreferences();
  loadStatus();
  libraryReady = loadLibrary();
  pollAccount();
  accountPollTimer = setInterval(function () { if (!document.hidden) pollAccount(); }, 8000);
  loadCatalog('推荐');
}());
