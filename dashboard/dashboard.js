(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat();
  const SVG = 'http://www.w3.org/2000/svg';
  const Model = globalThis.RRStats;
  const File = globalThis.RRStatsFile;
  const extension = !!globalThis.chrome?.runtime?.id;
  const pickerOptions = { types: [{ description: 'Reel history JSON', accept: { 'application/json': ['.json'] } }] };
  let fileHandle = null;
  let fileSnapshot = null;
  let currentStats = Model.emptyStats();
  let currentLimit = 50;
  let range = '7';
  let data = null;
  let page = 0;
  let requestNumber = 0;
  const PAGE_SIZE = 15;

  async function message(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Could not update local history.');
    return response;
  }

  function showError(error) {
    $('error-state').textContent = String(error.message || error);
    $('error-state').hidden = false;
  }

  function fileInfo(state = 'unlinked') {
    $('file-name').textContent = fileHandle?.name || 'Local history';
    $('reconnect-json').hidden = !extension || state !== 'permission';
    $('file-hint').textContent = state === 'permission'
      ? 'Reconnect this file to resume automatic updates. Your history is still saved in the extension.'
      : state === 'error' ? 'Could not update this JSON file. Your history is still saved in the extension.'
      : fileHandle ? extension ? 'This JSON file updates automatically as you watch.' : 'Reading this JSON file every 15 seconds.'
      : extension ? window.showSaveFilePicker ? 'Save a JSON file to keep it updated automatically as you watch.'
        : 'History updates here automatically. Use Save JSON to download a copy.'
      : 'Open your history JSON file to view the charts. No server is needed.';
  }
  function dateLabel(key, short = false) {
    return new Date(`${key}T12:00:00`).toLocaleDateString(undefined,
      short ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function duration(milliseconds) {
    const total = Math.floor(milliseconds / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    if (hours) return `${integer.format(hours)}h ${minutes}m`;
    return minutes ? `${minutes}m ${total % 60}s` : `${total}s`;
  }
  function svgElement(name, attrs = {}, text) {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function chartDays(days) {
    if (days.length <= 90) return days;
    const months = new Map();
    for (const day of days) {
      const key = day.date.slice(0, 7);
      if (!months.has(key)) months.set(key, { date: `${key}-01`, reels: 0, watchMs: 0, monthly: true });
      const month = months.get(key);
      month.reels += day.reels;
      month.watchMs += day.watchMs;
    }
    return [...months.values()];
  }

  function chart(target, points, { key, label, line = false, limit = null, weekday = false }) {
    const width = Math.max(340, ($(target).clientWidth || 900) - 28), height = 270;
    const left = 52, right = 20, top = 22, bottom = 42;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    const values = points.map(point => key === 'watchMs' ? point[key] / 60000 : point[key]);
    const max = Math.max(1, ...values, limit || 0) * 1.12;
    const y = value => top + innerHeight * (1 - value / max);
    const step = innerWidth / Math.max(points.length, 1);
    const x = index => left + step * (index + .5);
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label });
    svg.append(svgElement('title', {}, label));
    for (let index = 0; index <= 4; index++) {
      const value = max * index / 4;
      svg.append(svgElement('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'chart-gridline' }));
      svg.append(svgElement('text', { x: left - 10, y: y(value) + 4, 'text-anchor': 'end' }, number.format(value)));
    }
    if (limit !== null) {
      svg.append(svgElement('line', { x1: left, x2: width - right, y1: y(limit), y2: y(limit), stroke: '#88938c', 'stroke-dasharray': '5 5', 'stroke-width': 1 }));
    }
    if (line && points.length) {
      svg.append(svgElement('path', { d: values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`).join(' '), fill: 'none', stroke: '#75dda6', 'stroke-width': 2.5 }));
    }
    const labelEvery = Math.max(1, Math.ceil(points.length / 7));
    points.forEach((point, index) => {
      const value = values[index];
      const pointLabel = weekday ? point.label : point.monthly
        ? new Date(`${point.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : dateLabel(point.date);
      const description = `${pointLabel}: ${key === 'watchMs' ? duration(point.watchMs) + ' watching' : number.format(value) + (weekday ? ' reels per day' : ' reels scrolled')}`;
      const shape = line ? svgElement('circle', { cx: x(index), cy: y(value), r: 4, class: 'chart-point', tabindex: 0, 'aria-label': description })
        : svgElement('rect', { x: x(index) - Math.min(step * .62, 58) / 2, y: y(value), width: Math.min(step * .62, 58),
          height: Math.max(value ? 2 : 0, innerHeight * value / max), rx: 2, class: 'chart-bar', tabindex: 0, 'aria-label': description });
      shape.append(svgElement('title', {}, description));
      svg.append(shape);
      if (index % labelEvery === 0 || index === points.length - 1) {
        const shortLabel = weekday ? point.label : point.monthly
          ? new Date(`${point.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : dateLabel(point.date, true);
        svg.append(svgElement('text', { x: x(index), y: height - 14, 'text-anchor': 'middle' }, shortLabel));
      }
    });
    $(target).replaceChildren(svg);
  }

  function renderTable() {
    const days = [...data.days].reverse();
    const pageCount = Math.max(1, Math.ceil(days.length / PAGE_SIZE));
    page = Math.min(page, pageCount - 1);
    const rows = days.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(day => {
      const row = document.createElement('tr');
      const values = [dateLabel(day.date), integer.format(day.reels), duration(day.watchMs), integer.format(day.sessions),
        day.reels === data.dailyLimit ? 'At limit' : day.reels > data.dailyLimit
          ? `${integer.format(day.reels - data.dailyLimit)} over` : `${integer.format(data.dailyLimit - day.reels)} remaining`];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index === 4) cell.className = day.reels >= data.dailyLimit ? 'over-limit' : 'under-limit';
        if (index === 0 && day.date === data.end) {
          const marker = document.createElement('span');
          marker.className = 'table-today';
          marker.textContent = 'Today';
          cell.append(marker);
        }
        row.append(cell);
      });
      return row;
    });
    $('history-body').replaceChildren(...rows);
    $('history-count').textContent = `${integer.format(days.length)} days`;
    $('page-caption').textContent = `Page ${page + 1} of ${pageCount}`;
    $('previous-page').disabled = page === 0;
    $('next-page').disabled = page >= pageCount - 1;
  }

  function render() {
    const totals = data.totals;
    $('total-reels').textContent = integer.format(totals.reels);
    $('reel-average').textContent = `${number.format(totals.averageReels)} per day on average`;
    $('total-time').textContent = duration(totals.watchMs);
    $('total-sessions').textContent = integer.format(totals.sessions);
    $('session-average').textContent = `${duration(totals.averageSessionMs)} watching per session`;
    $('today-reels').textContent = integer.format(data.today.reels);
    $('today-limit').textContent = ` / ${integer.format(data.dailyLimit)}`;
    const progress = Math.min(data.today.reels / data.dailyLimit, 1);
    const color = `hsl(${Math.round(120 * (1 - progress))}, 60%, 65%)`;
    $('today-reels').style.color = color;
    $('limit-fill').style.width = `${progress * 100}%`;
    $('limit-fill').style.background = color;
    $('limit-caption').textContent = data.today.reels >= data.dailyLimit ? 'Daily limit reached · resets at midnight' : `${data.dailyLimit - data.today.reels} reels left today · resets at midnight`;
    const sameYear = data.start.slice(0, 4) === data.end.slice(0, 4);
    $('range-caption').textContent = `${dateLabel(data.start, sameYear)} – ${dateLabel(data.end, sameYear)} · local time`;
    $('empty-state').hidden = totals.sessions > 0;
    const points = chartDays(data.days);
    const monthly = !!points[0]?.monthly;
    $('reel-chart-subtitle').textContent = monthly ? 'Monthly totals across your full history' : 'Reels scrolled each day';
    $('reel-chart-caption').textContent = monthly ? 'Long histories are grouped by month. Exact daily totals are in the table below.' : 'Hover over a bar for the exact count. The dashed line is your current daily limit.';
    document.querySelector('.limit-legend').hidden = monthly;
    chart('reel-chart', points, { key: 'reels', label: monthly ? 'Reels scrolled by month' : 'Reels scrolled by day', limit: monthly ? null : data.dailyLimit });
    chart('time-chart', points, { key: 'watchMs', label: 'Watching time in minutes', line: true });
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekdays = data.weekdays.map(day => ({ label: labels[day.weekday], reels: day.days ? day.reels / day.days : 0 }));
    chart('weekday-chart', [...weekdays.slice(1), weekdays[0]], { key: 'reels', label: 'Average reels per day of the week', weekday: true });
    renderTable();
  }

  async function refresh() {
    const request = ++requestNumber;
    const selectedRange = range;
    $('refresh').disabled = true;
    try {
      await ready;
      let source;
      let fileError = null;
      if (extension) {
        const stored = await chrome.storage.local.get({ reelStats: Model.emptyStats(), reelCounter: { limit: 50 } });
        source = { stats: stored.reelStats, dailyLimit: File.dailyLimit(stored.reelCounter?.limit) };
        if (fileHandle) {
          try {
            const result = await message('RR_STATS_FILE_SAVE');
            fileInfo(result.file?.state);
            if (result.file?.state === 'saved') source = await File.read(fileHandle);
            else if (result.file?.state === 'error') fileError = new Error(result.file.error);
          } catch (error) { fileInfo('error'); fileError = error; }
        }
      } else {
        source = fileHandle ? await File.read(fileHandle) : fileSnapshot || { stats: Model.emptyStats(), dailyLimit: 50 };
      }
      if (request !== requestNumber) return;
      currentStats = source.stats;
      currentLimit = source.dailyLimit;
      data = { ...Model.summary(currentStats, selectedRange), dailyLimit: currentLimit };
      $('error-state').hidden = true;
      if (fileError) showError(fileError);
      $('connection-status').textContent = `${fileHandle ? 'JSON history' : extension ? 'Extension history' : 'Open a JSON file'} · ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      render();
    } catch (error) {
      if (request !== requestNumber) return;
      $('connection-status').textContent = 'Could not read local history';
      showError(new Error(`${error.message} ${extension ? 'Your recorded history is kept in the extension.' : 'Open the JSON file again to restore access.'}`));
    } finally {
      if (request === requestNumber) $('refresh').disabled = false;
    }
  }

  async function openJson() {
    if (!window.showOpenFilePicker) { $('json-input').click(); return; }
    try {
      const [handle] = await window.showOpenFilePicker(pickerOptions);
      const permission = extension ? await handle.requestPermission({ mode: 'readwrite' }) : 'granted';
      const imported = await File.read(handle);
      if (extension) {
        await message('RR_STATS_IMPORT', { history: { ...imported.stats, dailyLimit: imported.dailyLimit } });
        await File.setHandle(handle);
      }
      fileHandle = handle;
      fileInfo(permission === 'granted' ? 'saved' : 'permission');
      await refresh();
    } catch (error) { if (error.name !== 'AbortError') showError(error); }
  }

  async function saveJson() {
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ ...pickerOptions, suggestedName: 'reel-history.json' });
        if (extension) {
          // Preserve any history in an existing file before linking it.
          const existing = await (await handle.getFile()).text();
          if (existing.trim()) {
            const imported = File.parse(existing);
            await message('RR_STATS_IMPORT', { history: imported.stats });
          }
          await File.setHandle(handle);
          fileHandle = handle;
          await refresh();
        } else {
          const result = await File.write(handle, currentStats, currentLimit);
          if (result.state !== 'saved') throw new Error('Allow file access to save this JSON file.');
          fileHandle = handle;
          fileInfo();
          await refresh();
        }
      } else {
        const stored = extension ? await chrome.storage.local.get({ reelStats: Model.emptyStats(), reelCounter: { limit: 50 } }) : null;
        const blob = new Blob([File.stringify(stored?.reelStats || currentStats, stored?.reelCounter?.limit || currentLimit)], { type: 'application/json' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = 'reel-history.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { if (error.name !== 'AbortError') showError(error); }
  }

  $('open-json').addEventListener('click', openJson);
  $('save-json').addEventListener('click', saveJson);
  $('reconnect-json').addEventListener('click', async () => {
    try {
      if (await fileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
      await refresh();
    } catch (error) { showError(error); }
  });
  $('json-input').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = File.parse(await file.text());
      if (extension) await message('RR_STATS_IMPORT', { history: imported.stats });
      else { fileSnapshot = imported; fileHandle = null; }
      await refresh();
      if (!extension) {
        $('file-name').textContent = file.name;
        $('file-hint').textContent = 'Showing this JSON snapshot. Open it again after exporting new history.';
      }
    } catch (error) { showError(error); }
    event.target.value = '';
  });
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    range = button.dataset.range;
    page = 0;
    document.querySelectorAll('[data-range]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    refresh();
  }));
  $('refresh').addEventListener('click', refresh);
  $('previous-page').addEventListener('click', () => { page -= 1; renderTable(); });
  $('next-page').addEventListener('click', () => { page += 1; renderTable(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (data) render(); }, 150);
  });
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  if (extension) chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.reelStats || changes.reelCounter)) refresh();
  });
  const ready = (async () => {
    if (extension) {
      try { fileHandle = await File.getHandle(); }
      catch (error) { showError(error); }
    }
    fileInfo();
  })();
  refresh();
})();
