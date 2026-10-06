(function () {
  'use strict';

  var focusOrder = [
    '.side-item',
    '.channel-tab',
    '.primary-action',
    '.round-action',
    '.control-button'
  ];
  var status = document.getElementById('core-status');
  var notice = document.getElementById('action-notice');
  var shell = document.querySelector('.app-shell');
  var lastContentFocus = null;

  function focusables() {
    var result = [];
    focusOrder.forEach(function (selector) {
      Array.prototype.forEach.call(document.querySelectorAll(selector), function (element) {
        if (!element.disabled) result.push(element);
      });
    });
    return result;
  }

  function markFocus(element) {
    document.querySelectorAll('.is-focused').forEach(function (node) { node.classList.remove('is-focused'); });
    if (element) element.classList.add('is-focused');
  }

  function goFocus(element) {
    if (!element) return;
    element.focus({ preventScroll: false });
    markFocus(element);
    if (!element.classList.contains('side-item')) lastContentFocus = element;
  }

  function visibleRect(element) {
    return element.getBoundingClientRect();
  }

  function nextInDirection(current, direction) {
    var all = focusables();
    if (!current) return all[0] || null;
    var currentRect = visibleRect(current);
    var candidates = all.filter(function (node) {
      if (node === current) return false;
      var rect = visibleRect(node);
      if (direction === 'left') return rect.right <= currentRect.left + 8;
      if (direction === 'right') return rect.left >= currentRect.right - 8;
      if (direction === 'up') return rect.bottom <= currentRect.top + 8;
      return rect.top >= currentRect.bottom - 8;
    });
    if (!candidates.length) return null;
    var axis = direction === 'left' || direction === 'right' ? 'left' : 'top';
    var sign = direction === 'left' || direction === 'up' ? -1 : 1;
    candidates.sort(function (a, b) {
      var ar = visibleRect(a), br = visibleRect(b);
      var ad = Math.abs((axis === 'left' ? ar.left : ar.top) - (axis === 'left' ? currentRect.left : currentRect.top));
      var bd = Math.abs((axis === 'left' ? br.left : br.top) - (axis === 'left' ? currentRect.left : currentRect.top));
      if (ad !== bd) return ad - bd;
      var cross = axis === 'left' ? Math.abs(ar.top - currentRect.top) : Math.abs(ar.left - currentRect.left);
      var crossB = axis === 'left' ? Math.abs(br.top - currentRect.top) : Math.abs(br.left - currentRect.left);
      return cross - crossB || sign;
    });
    return candidates[0];
  }

  function isContent(element) {
    return element && !element.classList.contains('side-item');
  }

  function handleKey(event) {
    var current = document.activeElement;
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[event.key];
    if (!direction) {
      if (event.key === 'Escape' || event.key === 'Backspace') {
        if (!current || !current.classList.contains('side-item')) {
          goFocus(lastContentFocus || document.querySelector('.primary-action'));
          event.preventDefault();
        }
      }
      return;
    }
    if (direction === 'left' && current && current.classList.contains('side-item')) return;
    if (direction === 'left' && current && isContent(current) && visibleRect(current).left < 270) {
      var activeSide = document.querySelector('.side-item.is-active');
      if (activeSide) { goFocus(activeSide); event.preventDefault(); return; }
    }
    if (direction === 'right' && current && current.classList.contains('side-item')) {
      goFocus(lastContentFocus || document.querySelector('.channel-tab.is-active') || document.querySelector('.primary-action'));
      event.preventDefault();
      return;
    }
    var target = nextInDirection(current, direction);
    if (target) {
      goFocus(target);
      event.preventDefault();
    }
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.remove('is-hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(function () { notice.textContent = '当前为 TV 界面骨架，未调用假数据。'; }, 2600);
  }

  function activatePage(item) {
    document.querySelectorAll('.side-item').forEach(function (node) { node.classList.toggle('is-active', node === item); });
    var label = item.querySelector('span:last-child');
    document.getElementById('page-context').textContent = label ? label.textContent : '页面';
    shell.dataset.mode = item.dataset.page || 'recommend';
    showNotice('页面骨架已切换：' + (label ? label.textContent : '页面') + '，真实数据接口待接入。');
  }

  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('focusin', function (event) { markFocus(event.target); });
  document.querySelectorAll('.side-item').forEach(function (item) {
    item.addEventListener('click', function () { activatePage(item); });
  });
  document.querySelectorAll('[data-action]').forEach(function (item) {
    item.addEventListener('click', function () { showNotice('已收到操作：' + item.dataset.action + '。真实接口待接入。'); });
  });
  document.querySelectorAll('.channel-tab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.channel-tab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      showNotice('频道已切换，真实分类接口待接入。');
    });
  });

  function loadStatus() {
    fetch('/api/v1/status').then(function (response) { return response.json(); }).then(function (data) {
      status.textContent = data.ok ? 'Go 核心服务已连接' : '核心服务异常';
      status.dataset.ok = data.ok ? 'true' : 'false';
    }).catch(function () {
      status.textContent = '核心服务未连接';
      status.dataset.ok = 'false';
    });
  }

  goFocus(document.querySelector('.side-item.is-active'));
  loadStatus();
}());
